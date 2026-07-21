#!/usr/bin/env node
// scripts/daemon.mjs — FabInvests V2 main trading loop
// Real prices, fake money, honest fills. No faking, no looking ahead.
//
// npm run daemon     → continuous loop (30s cycles)
// npm run cycle      → single cycle then exit (--once)

import {
  loadConfig, log, ensureData, now, iso,
  fetchQuote, fetchHistory, indicators, regime as computeRegime,
} from "./lib.mjs";
import {
  V2, readJSON, writeJSON, appendJSONL, round, clamp,
} from "./v2/store.mjs";
import {
  freshV2State, recordEquityPeak, episodeEndReason,
  finalizeEpisode, nextEpisode,
} from "./v2/episode.mjs";
import { ensureStrategies, runStrategies } from "./v2/strategies.mjs";
import { sizeOrder } from "./v2/sizing.mjs";
import {
  openPosition, markPosition, unrealizedPnl, tradeFee,
  fundingPayment, crossedFundingTimestamps, sideSign, tierFor,
} from "./v2/perp.mjs";
import { onEpisodeEnd, evolveTick, onClose } from "./v2/brain.mjs";
import { collectWorld } from "./v2/world.mjs";

const ONCE = process.argv.includes("--once");

// ── History cache ──────────────────────────────────────────────────────────

const _hist   = {};
const _histTs = {};

async function cachedHistory(sym, range, interval, ttlMs) {
  const key = `${sym}_${range}_${interval}`;
  if (_histTs[key] && (now() - _histTs[key]) < ttlMs) return _hist[key] || [];
  try {
    const data = await fetchHistory(sym, range, interval);
    if (data.length) { _hist[key] = data; _histTs[key] = now(); }
  } catch { /* use stale */ }
  return _hist[key] || [];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  if (!cfg) { console.error("ERROR: config.json not found."); process.exit(1); }
  ensureData();

  // Load or auto-initialise state
  let state = readJSON(V2.state, null);
  if (!state) {
    log("No state found — creating fresh V2 state.");
    state = freshV2State(cfg);
    writeJSON(V2.state, state);
    ensureStrategies();
  }

  log("═══════════════════════════════════════════════");
  log("  FabInvests V2 daemon started");
  log(`  Episode ${state.episodeNum} | Gen ${state.generation}`);
  log(`  Equity $${round(state.equity, 2)} | Kelly ${round(state.aggression.kellyFraction, 2)}`);
  log(`  Leverage cap ${state.aggression.leverageCap}x`);
  log("═══════════════════════════════════════════════");

  const loopMs = (cfg.v2.strategies.loopSeconds || 30) * 1000;
  let lastBrainTs = 0;

  while (true) {
    try {
      await cycle(state, cfg, lastBrainTs);

      // Periodic brain evolve
      const brainMs = (cfg.v2.strategies.brainLoopMinutes || 8) * 60_000;
      if (now() - lastBrainTs >= brainMs) {
        evolveTick(state, cfg);
        lastBrainTs = now();
      }
    } catch (err) {
      log(`Cycle error: ${err.message}`);
      console.error(err);
    }

    // Always save after each cycle
    writeJSON(V2.state, state);

    if (ONCE) {
      log("Single cycle complete (--once). Exiting.");
      break;
    }
    await sleep(loopMs);
  }
}

// ── One cycle ──────────────────────────────────────────────────────────────

async function cycle(state, cfg) {
  state.cycles = (state.cycles || 0) + 1;
  state.updatedAt = now();
  const v2 = cfg.v2;
  const histTtl = (cfg.historyRefreshMinutes || 20) * 60_000;

  // ── 1. Fetch live quotes & enrich ──────────────────────────────────────
  const eq = {};
  for (const item of cfg.watchlist) {
    try {
      const q = await fetchQuote(item.symbol);
      if (!q.ok) continue;

      const closes = await cachedHistory(item.symbol, "1y", "1d", histTtl);
      const ind = closes.length >= 20 ? indicators(closes) : {};

      // 15m bars for crypto intraday strategies
      let closesIntraday = null;
      if (item.market === "crypto") {
        closesIntraday = await cachedHistory(item.symbol, "5d", "15m", histTtl);
      }

      eq[item.symbol] = { ...q, ...ind, closes, closesIntraday, market: item.market };
    } catch { /* skip failed symbol */ }
  }

  if (!Object.keys(eq).length) {
    log("No quotes available — skipping cycle.");
    return;
  }

  // ── 2. Index quotes for regime ─────────────────────────────────────────
  const indexQuotes = {};
  for (const idx of cfg.indices) {
    if (eq[idx.symbol]) {
      indexQuotes[idx.symbol] = eq[idx.symbol];
    } else {
      try {
        const q = await fetchQuote(idx.symbol);
        if (q.ok) {
          const closes = await cachedHistory(idx.symbol, "1y", "1d", histTtl);
          const ind = closes.length >= 20 ? indicators(closes) : {};
          indexQuotes[idx.symbol] = { ...q, ...ind, closes };
        }
      } catch { /* skip */ }
    }
  }

  state.regime = computeRegime(indexQuotes, { halt: state.riskState === "halt" });

  // ── 3. World data (internal TTL caching handles refresh) ───────────────
  try { await collectWorld(state, cfg); }
  catch (err) { log(`World poll error: ${err.message}`); }

  // ── 4. Drawdown & risk state ───────────────────────────────────────────
  const dd = recordEquityPeak(state);
  const ddHalt    = cfg.risk?.ddHalt    ?? 0.20;
  const ddCaution = cfg.risk?.ddCaution ?? 0.12;

  if (dd >= ddHalt)         state.riskState = "halt";
  else if (dd >= ddCaution) state.riskState = "caution";
  else                      state.riskState = "normal";

  // ── 5. Hard floor — emergency close ALL ────────────────────────────────
  const hardFloor = state.startingCapital * (cfg.risk?.hardFloorPct ?? 0.70);
  if (state.equity <= hardFloor && Object.keys(state.positions).length > 0) {
    log(`⚠ HARD FLOOR: equity $${round(state.equity, 2)} ≤ floor $${round(hardFloor, 2)} — closing ALL`);
    for (const sym of Object.keys(state.positions)) {
      if (eq[sym]) closePosition(state, sym, eq[sym].price, "capital-floor", cfg);
    }
  }

  // ── 6. Mark positions, apply funding, risk exits ───────────────────────
  const closeOrders = [];

  for (const [sym, pos] of Object.entries(state.positions)) {
    const q = eq[sym];
    if (!q) continue;

    // Mark to market
    const snap = markPosition(pos, q.price);

    // Track peak unrealized PnL (for trailing stop)
    if (snap.uPnl > (pos.peakUPnl || 0)) pos.peakUPnl = snap.uPnl;

    // Apply funding at 0h/8h/16h UTC (crypto perps only)
    if (pos.market === "crypto" && v2.leverage?.crypto?.funding) {
      const rate = (state.fundingRate || 0) / 100; // world gives %
      const crossed = crossedFundingTimestamps(
        pos.lastFundingTs, now(), v2.fundingHoursUTC
      );
      for (const ts of crossed) {
        const payment = fundingPayment(pos.notional, rate, pos.side);
        pos.fundingAccrued = (pos.fundingAccrued || 0) + payment;
        pos.lastFundingTs = ts;
      }
    }

    // ── Risk exits (priority order) ──

    // Liquidation (mark crossed liqPrice)
    if (snap.liquidated) {
      closeOrders.push({ op: "close", symbol: sym, reason: "liquidation" });
      continue;
    }

    // Price-based stop-loss
    const stopPct = pos.openMeta?.stopPct ?? cfg.risk?.stopLoss?.[pos.market] ?? 0.08;
    const priceVsEntry = (q.price - pos.entryPrice) / pos.entryPrice * sideSign(pos.side);
    // priceVsEntry > 0 = in our favor, < 0 = against us
    if (-priceVsEntry >= stopPct) {
      closeOrders.push({ op: "close", symbol: sym, reason: "stop-loss" });
      continue;
    }

    // Price-based take-profit
    const targetPct = pos.openMeta?.targetPct ?? cfg.risk?.takeProfit?.[pos.market] ?? 0.16;
    if (priceVsEntry >= targetPct) {
      closeOrders.push({ op: "close", symbol: sym, reason: "take-profit" });
      continue;
    }

    // ROI-based trailing stop
    const roi     = pos.isolatedMargin > 0 ? snap.uPnl / pos.isolatedMargin : 0;
    const peakRoi = pos.isolatedMargin > 0 ? (pos.peakUPnl || 0) / pos.isolatedMargin : 0;
    if (peakRoi >= (v2.aggression.trailActivateRoi ?? 0.5)) {
      if (roi <= peakRoi - (v2.aggression.trailGiveRoi ?? 0.25)) {
        closeOrders.push({ op: "close", symbol: sym, reason: "trailing-stop" });
        continue;
      }
    }

    // Max hold time
    const holdHours = (now() - pos.openedAt) / (3600_000);
    if (holdHours >= (v2.aggression.maxHoldHours ?? 4)) {
      closeOrders.push({ op: "close", symbol: sym, reason: "time-exit" });
      continue;
    }
  }

  // ── 7. Strategy signals (entries + strategy-driven exits) ──────────────
  const stratOrders = (state.riskState !== "halt")
    ? runStrategies(state, eq, cfg)
    : [];

  // Strategy-generated closes go into the close queue
  for (const o of stratOrders) {
    if (o.op === "close") closeOrders.push(o);
  }

  // ── 8. Execute closes first (frees margin) ────────────────────────────
  for (const o of closeOrders) {
    if (!state.positions[o.symbol]) continue; // already closed
    if (!eq[o.symbol]) continue;
    closePosition(state, o.symbol, eq[o.symbol].price, o.reason, cfg);
  }

  // ── 9. Size & execute opens (skip if halted) ──────────────────────────
  if (state.riskState !== "halt") {
    const openOrders = stratOrders.filter((o) => o.op === "open");

    for (const o of openOrders) {
      // One position per symbol
      if (state.positions[o.symbol]) continue;

      // Size the order
      const sized = sizeOrder(state, o, eq, cfg);
      if (!sized.marginUsd || sized.marginUsd < (v2.strategies.minNotionalUsd ?? 2)) continue;

      // Must have a live quote
      if (!eq[o.symbol]) continue;

      executeOpen(state, sized, eq[o.symbol], cfg);
    }
  }

  // ── 10. Update equity ─────────────────────────────────────────────────
  recalcEquity(state, eq);

  // ── 11. Record equity snapshot ────────────────────────────────────────
  appendJSONL(V2.equity, {
    ts:        now(),
    equity:    round(state.equity, 4),
    wallet:    round(state.walletBalance, 4),
    positions: Object.keys(state.positions).length,
    uPnl:     round(state.equity - state.walletBalance - totalMarginLocked(state), 4),
    dd:        round(dd, 4),
    regime:    state.regime,
    riskState: state.riskState,
    episode:   state.episodeNum,
  });

  // ── 12. Episode end check ─────────────────────────────────────────────
  const endReason = episodeEndReason(state, cfg);
  if (endReason) {
    log(`━━━ Episode ${state.episodeNum} ended: ${endReason} | Equity $${round(state.equity, 2)} ━━━`);

    // Close remaining positions
    for (const sym of Object.keys(state.positions)) {
      if (eq[sym]) closePosition(state, sym, eq[sym].price, "episode-end", cfg);
    }

    recalcEquity(state, eq);
    const rec = finalizeEpisode(state, endReason);
    onEpisodeEnd(state, rec, cfg);

    if (v2.episode.autoResetOnBlowup || endReason !== "blowup") {
      nextEpisode(state, cfg);
      log(
        `━━━ New episode ${state.episodeNum} | Gen ${state.generation} ` +
        `| Capital $${state.startingCapital} ━━━`
      );
    }
  }

  // ── 13. Cycle summary log ─────────────────────────────────────────────
  const posCount = Object.keys(state.positions).length;
  const posSyms  = Object.keys(state.positions).join(", ") || "none";
  log(
    `Cycle ${state.cycles} | ` +
    `Eq $${round(state.equity, 2)} | ` +
    `Pos ${posCount} [${posSyms}] | ` +
    `DD ${round(dd * 100, 1)}% | ` +
    `Regime ${state.regime} | Risk ${state.riskState}`
  );
}

// ── Execution: Open ────────────────────────────────────────────────────────

function executeOpen(state, order, q, cfg) {
  const v2 = cfg.v2;
  const market = (cfg.watchlist.find((w) => w.symbol === order.symbol) || {}).market || "crypto";

  // Maintenance tiers for liq math
  const tiers = v2.maintenanceTiers?.[market] || [
    { floor: 0, cap: 1e9, maxLev: order.leverage, mmr: 0.01, deduction: 0 },
  ];

  // Honest fill: slippage makes the fill WORSE than the live price
  const slip      = cfg.slippage?.[market] ?? 0.001;
  const entryFill = q.price * (1 + sideSign(order.side) * slip);

  // Ensure we don't exceed free cash
  const maxMargin = Math.max(0, state.walletBalance * 0.98);
  const margin    = Math.min(order.marginUsd, maxMargin);
  if (margin < (v2.strategies.minNotionalUsd ?? 2)) return; // too small

  // Build position
  const pos = openPosition({
    symbol:    order.symbol,
    market,
    side:      order.side,
    entryMark: entryFill,
    margin,
    leverage:  order.leverage,
    tiers,
    meta: {
      trade_id:    order.trade_id,
      strategy_id: order.strategy_id,
      setup_tag:   order.setup_tag,
      stopPct:     order.stopPct,
      targetPct:   order.targetPct,
      confidence:  order.confidence,
      reason:      order.reason,
    },
  });

  // Entry fee (taker)
  const entryFee = tradeFee(pos.notional, v2.perpFees?.taker ?? 0.0005);
  pos.feesPaid = (pos.feesPaid || 0) + entryFee;

  // Deduct margin + fee from wallet
  state.walletBalance -= (pos.isolatedMargin + entryFee);

  // Store
  state.positions[order.symbol] = pos;

  // Journal pre-trade
  appendJSONL(V2.journal, {
    type:        "pre",
    trade_id:    order.trade_id,
    symbol:      order.symbol,
    market,
    strategy_id: order.strategy_id,
    setup_tag:   order.setup_tag,
    regime:      state.regime,
    side:        order.side,
    entryPrice:  round(entryFill, 6),
    margin:      round(margin, 4),
    leverage:    order.leverage,
    notional:    round(pos.notional, 4),
    liqPrice:    round(pos.liqPrice, 6),
    confidence:  order.confidence,
    ts:          now(),
  });

  log(
    `📈 OPEN ${order.side.toUpperCase()} ${order.symbol} ` +
    `@ ${round(entryFill, 2)} | $${round(margin, 2)} margin ` +
    `| ${order.leverage}x | ${order.strategy_id} | ${order.reason}`
  );
}

// ── Execution: Close ───────────────────────────────────────────────────────

function closePosition(state, symbol, markPrice, reasonTag, cfg) {
  const pos = state.positions[symbol];
  if (!pos) return;

  const v2     = cfg.v2;
  const market = pos.market || "crypto";

  // Honest fill: slippage is adverse on exit
  const slip     = cfg.slippage?.[market] ?? 0.001;
  const exitFill = markPrice * (1 - sideSign(pos.side) * slip);

  // Unrealized PnL at fill price
  const uPnl = unrealizedPnl(pos.side, pos.entryPrice, exitFill, pos.qty);

  // Exit fee
  const exitFee  = tradeFee(pos.notional, v2.perpFees?.taker ?? 0.0005);
  const totalFee = (pos.feesPaid || 0) + exitFee;
  const funding  = pos.fundingAccrued || 0;

  // Net PnL = raw gain/loss - all costs
  const netPnl = uPnl - exitFee - funding;

  // Return margin + raw PnL - exit fee to wallet
  state.walletBalance += pos.isolatedMargin + uPnl - exitFee;

  // R-multiple (return on margin risked)
  const realizedR   = pos.isolatedMargin > 0 ? netPnl / pos.isolatedMargin : 0;
  const roiOnMargin = pos.isolatedMargin > 0 ? (uPnl - totalFee - funding) / pos.isolatedMargin : 0;

  state.realizedPnlEpisode = (state.realizedPnlEpisode || 0) + netPnl;

  // Journal post-trade
  const tradeId = pos.openMeta?.trade_id || `${symbol}_${pos.openedAt}`;
  appendJSONL(V2.journal, {
    type:         "post",
    trade_id:     tradeId,
    symbol,
    exit_reason:  reasonTag,
    exitPrice:    round(exitFill, 6),
    net_pnl:      round(netPnl, 4),
    realized_R:   round(realizedR, 4),
    roi_on_margin: round(roiOnMargin, 4),
    fees:         round(totalFee, 4),
    funding:      round(funding, 4),
    hold_secs:    round((now() - pos.openedAt) / 1000, 0),
    ts:           now(),
  });

  // Trades log (persistent trade history)
  appendJSONL(V2.trades, {
    trade_id:     tradeId,
    symbol,
    market,
    strategy_id:  pos.openMeta?.strategy_id,
    setup_tag:    pos.openMeta?.setup_tag,
    side:         pos.side,
    entryPrice:   pos.entryPrice,
    exitPrice:    exitFill,
    margin:       round(pos.isolatedMargin, 4),
    leverage:     pos.leverage,
    net_pnl:      round(netPnl, 4),
    realized_R:   round(realizedR, 4),
    roi_on_margin: round(roiOnMargin, 4),
    exit_reason:  reasonTag,
    regime:       state.regime,
    openedAt:     pos.openedAt,
    closedAt:     now(),
  });

  // Brain importance accrual
  onClose(state, pos, reasonTag);

  // Remove position
  delete state.positions[symbol];

  const icon = netPnl >= 0 ? "✅" : "❌";
  log(
    `${icon} CLOSE ${pos.side.toUpperCase()} ${symbol} ` +
    `@ ${round(exitFill, 2)} | PnL $${round(netPnl, 4)} ` +
    `(${round(realizedR * 100, 1)}%R) | ${reasonTag}`
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function totalMarginLocked(state) {
  return Object.values(state.positions).reduce(
    (s, p) => s + (p.isolatedMargin || 0), 0
  );
}

function recalcEquity(state, eq) {
  let uPnl = 0;
  for (const pos of Object.values(state.positions)) {
    const q = eq[pos.symbol];
    if (q) uPnl += unrealizedPnl(pos.side, pos.entryPrice, q.price, pos.qty);
  }
  state.equity = state.walletBalance + totalMarginLocked(state) + uPnl;
}

// ── Run ────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
