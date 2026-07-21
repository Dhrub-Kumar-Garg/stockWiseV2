#!/usr/bin/env node
// scripts/v2/engine.mjs — FabInvests V2 always-on trading engine
// Zero AI tokens.  Immutable core = HONESTY:
//   • next-tick fills (no looking ahead)
//   • mark-price liquidation (EMA-smoothed, not last tick)
//   • real fees, funding, slippage
//   • never rounds a loss away
//
// Usage:  node scripts/v2/engine.mjs          (continuous 30-second loop)
//         node scripts/v2/engine.mjs --once   (single cycle, then exit)

import {
  V2, readJSON, writeJSON, readJSONL, appendJSONL,
  now, iso, round, clamp,
} from "./store.mjs";
import {
  loadConfig, log, ensureData,
  fetchQuote, fetchFx, fetchHistory,
  indicators, regime as computeRegime,
} from "../lib.mjs";
import * as P from "./perp.mjs";
import {
  freshV2State, recordEquityPeak, episodeEndReason,
  finalizeEpisode, nextEpisode,
} from "./episode.mjs";
import { ensureStrategies, runStrategies, cacheOiSnapshot } from "./strategies.mjs";
import { sizeOrder } from "./sizing.mjs";
import {
  onEpisodeEnd, onClose, buildBrainV2,
  scoreStrategies, evolveTick,
} from "./brain.mjs";
import { collectWorld } from "./world.mjs";
import {
  notify, notifyOpen, notifyClose, notifyEpisodeEnd,
  notifyStartup, checkCommands,
} from "./telegram.mjs";

const ONCE = process.argv.includes("--once");

// ── Caches (persist across cycles) ─────────────────────────────────────────
const _quotes  = {};          // sym → last good quote + stale flag
const _hist    = {};          // key → close array
const _histTs  = {};          // key → fetch timestamp
let   _fxRate  = 83;          // USD/INR fallback
let   _lastBrainTs = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Quote fetching (parallel, stale-fallback) ──────────────────────────────

async function fetchAllQuotes(symbols) {
  const jobs = symbols.map(async (sym) => {
    try {
      const q = await fetchQuote(sym);
      if (q.ok) {
        _quotes[sym] = { ...q, stale: false, fetchedAt: now() };
      } else if (_quotes[sym]) {
        _quotes[sym].stale = true;
      }
    } catch {
      if (_quotes[sym]) _quotes[sym].stale = true;
    }
  });
  await Promise.allSettled(jobs);
}

// ── History (TTL-cached) ───────────────────────────────────────────────────

async function refreshHistory(sym, range, interval, ttlMs) {
  const key = `${sym}|${range}|${interval}`;
  if (_histTs[key] && (now() - _histTs[key]) < ttlMs) return _hist[key] || [];
  try {
    const data = await fetchHistory(sym, range, interval);
    if (data.length) { _hist[key] = data; _histTs[key] = now(); }
  } catch { /* keep stale */ }
  return _hist[key] || [];
}

// ── Enriched quotes ────────────────────────────────────────────────────────

async function buildEnriched(cfg, histTtl) {
  const eq = {};

  for (const item of cfg.watchlist) {
    const q = _quotes[item.symbol];
    if (!q || !q.ok) continue;

    const closes = await refreshHistory(item.symbol, "1y", "1d", histTtl);
    const ind = closes.length >= 20 ? indicators(closes) : {};

    let closesIntraday = null;
    if (item.market === "crypto") {
      closesIntraday = await refreshHistory(item.symbol, "5d", "15m", 10 * 60_000);
    }

    eq[item.symbol] = { ...q, ...ind, closes, closesIntraday, market: item.market };
  }

  // Index enrichment for regime
  for (const idx of cfg.indices) {
    if (eq[idx.symbol]) continue;
    const q = _quotes[idx.symbol];
    if (!q || !q.ok) continue;
    const closes = await refreshHistory(idx.symbol, "1y", "1d", histTtl);
    const ind = closes.length >= 20 ? indicators(closes) : {};
    eq[idx.symbol] = { ...q, ...ind, closes, market: "index" };
  }

  return eq;
}

// ── Mark & Manage ──────────────────────────────────────────────────────────
// For every open position, in strict order:
//   1. EMA mark  2. Funding  3. Liquidation  4. Stop  5. Target
//   6. Time-stop  7. Trailing

function markAndManage(state, eq, cfg) {
  const v2       = cfg.v2;
  const alpha    = v2.markEmaAlpha ?? 0.25;
  const closedSyms = [];

  for (const sym of Object.keys(state.positions)) {
    const pos = state.positions[sym];
    const q   = eq[sym];
    if (!q) continue;

    // 1. EMA mark
    pos.emaMark = P.emaUpdate(pos.emaMark ?? pos.entryPrice, q.price, alpha);
    const mark  = pos.emaMark;

    // 2. Funding (crypto, every 8 h)
    if (pos.market === "crypto" && v2.leverage?.crypto?.funding) {
      const rate    = (state.fundingRate || 0) / 100;
      const crossed = P.crossedFundingTimestamps(
        pos.lastFundingTs, now(), v2.fundingHoursUTC
      );
      for (const ts of crossed) {
        pos.fundingAccrued = (pos.fundingAccrued || 0) +
          P.fundingPayment(pos.notional, rate, pos.side);
        pos.lastFundingTs = ts;
      }
    }

    // Snapshot at mark
    const snap = P.markPosition(pos, mark);
    if (snap.uPnl > (pos.peakUPnl || 0)) pos.peakUPnl = snap.uPnl;

    // 3. Liquidation (mark price — the honest way)
    if (snap.liquidated) {
      doClose(state, sym, mark, "liquidation", cfg);
      closedSyms.push(sym); continue;
    }

    // Price move vs entry (positive = in our favour)
    const pVsE = (mark - pos.entryPrice) / pos.entryPrice * P.sideSign(pos.side);

    // 4. Stop-loss
    const stopPct = pos.openMeta?.stopPct ?? cfg.risk?.stopLoss?.[pos.market] ?? 0.08;
    if (-pVsE >= stopPct) {
      doClose(state, sym, mark, "stop-loss", cfg);
      closedSyms.push(sym); continue;
    }

    // 5. Take-profit
    const tgtPct = pos.openMeta?.targetPct ?? cfg.risk?.takeProfit?.[pos.market] ?? 0.16;
    if (pVsE >= tgtPct) {
      doClose(state, sym, mark, "take-profit", cfg);
      closedSyms.push(sym); continue;
    }

    // 6. Time-stop (no trade sits past maxHoldHours)
    const holdH = (now() - pos.openedAt) / 3_600_000;
    if (holdH >= (v2.aggression.maxHoldHours ?? 4)) {
      doClose(state, sym, mark, "time-exit", cfg);
      closedSyms.push(sym); continue;
    }

    // 7. Trailing exit (once profit peaks and gives back)
    const roi     = pos.isolatedMargin > 0 ? snap.uPnl / pos.isolatedMargin : 0;
    const peakRoi = pos.isolatedMargin > 0 ? (pos.peakUPnl || 0) / pos.isolatedMargin : 0;
    if (peakRoi >= (v2.aggression.trailActivateRoi ?? 0.5) &&
        roi    <= peakRoi - (v2.aggression.trailGiveRoi ?? 0.25)) {
      doClose(state, sym, mark, "trailing-stop", cfg);
      closedSyms.push(sym); continue;
    }
  }

  return closedSyms;
}

// ── Open a position ────────────────────────────────────────────────────────

function doOpen(state, order, q, cfg) {
  const v2     = cfg.v2;
  const market = (cfg.watchlist.find((w) => w.symbol === order.symbol) || {}).market || "crypto";

  // Guard: max concurrent
  if (Object.keys(state.positions).length >= (v2.strategies.maxConcurrentPositions ?? 10)) return;
  // Guard: already open
  if (state.positions[order.symbol]) return;

  const tiers = v2.maintenanceTiers?.[market] || [
    { floor: 0, cap: 1e9, maxLev: order.leverage, mmr: 0.01, deduction: 0 },
  ];

  // Honest fill: slippage makes the price worse for us
  const slip      = cfg.slippage?.[market] ?? 0.001;
  const entryFill = q.price * (1 + P.sideSign(order.side) * slip);

  // Never exceed free cash
  const maxMargin = Math.max(0, state.walletBalance * 0.98);
  const margin    = Math.min(order.marginUsd, maxMargin);
  if (margin < (v2.strategies.minNotionalUsd ?? 2)) return;

  const pos = P.openPosition({
    symbol:    order.symbol,
    market,
    side:      order.side,
    entryMark: entryFill,
    margin,
    leverage:  order.leverage,
    tiers,
    meta: {
      trade_id:    order.trade_id || `${order.strategy_id || "manual"}_${order.symbol}_${now()}`,
      strategy_id: order.strategy_id,
      setup_tag:   order.setup_tag,
      stopPct:     order.stopPct,
      targetPct:   order.targetPct,
      confidence:  order.confidence,
      reason:      order.reason,
    },
  });

  // Entry fee (taker)
  const entryFee = P.tradeFee(pos.notional, v2.perpFees?.taker ?? 0.0005);
  pos.feesPaid   = (pos.feesPaid || 0) + entryFee;

  // EMA mark starts at entry
  pos.emaMark = pos.entryPrice;

  // Deduct margin + fee from wallet
  state.walletBalance -= (pos.isolatedMargin + entryFee);

  state.positions[order.symbol] = pos;

  // Journal pre-trade
  appendJSONL(V2.journal, {
    type:        "pre",
    trade_id:    pos.openMeta.trade_id,
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

  // Fill record in trades log
  appendJSONL(V2.trades, {
    type:     "fill",
    trade_id: pos.openMeta.trade_id,
    symbol:   order.symbol, market,
    side:     order.side,
    price:    round(entryFill, 6),
    margin:   round(margin, 4),
    leverage: order.leverage,
    notional: round(pos.notional, 4),
    fee:      round(entryFee, 6),
    ts:       now(),
  });

  log(
    `📈 OPEN ${order.side.toUpperCase()} ${order.symbol} ` +
    `@ ${round(entryFill, 2)} | $${round(margin, 2)} margin ` +
    `| ${order.leverage}x | liq ${round(pos.liqPrice, 2)} ` +
    `| ${order.strategy_id || "manual"} | ${order.reason || ""}`
  );

  // Telegram notification
  try { notifyOpen(order, pos); } catch { /* non-fatal */ }
}

// ── Close a position ───────────────────────────────────────────────────────
// Charges real fees + slippage, writes post journal + trade, calls onClose.

function doClose(state, symbol, markPrice, reasonTag, cfg) {
  const pos = state.positions[symbol];
  if (!pos) return null;

  const v2     = cfg.v2;
  const market = pos.market || "crypto";
  const slip   = cfg.slippage?.[market] ?? 0.001;

  // Honest exit fill: slippage is adverse
  const exitFill = markPrice * (1 - P.sideSign(pos.side) * slip);

  const uPnl     = P.unrealizedPnl(pos.side, pos.entryPrice, exitFill, pos.qty);
  const exitFee  = P.tradeFee(pos.notional, v2.perpFees?.taker ?? 0.0005);
  const fees     = (pos.feesPaid || 0) + exitFee;
  const funding  = pos.fundingAccrued || 0;
  const netPnl   = uPnl - exitFee - funding;

  // Return margin + raw PnL − exit fee
  state.walletBalance += pos.isolatedMargin + uPnl - exitFee;

  const realizedR   = pos.isolatedMargin > 0 ? netPnl / pos.isolatedMargin : 0;
  const roiOnMargin = pos.isolatedMargin > 0 ? (uPnl - fees - funding) / pos.isolatedMargin : 0;

  state.realizedPnlEpisode = (state.realizedPnlEpisode || 0) + netPnl;

  const tradeId = pos.openMeta?.trade_id || `${symbol}_${pos.openedAt}`;

  // Journal post
  appendJSONL(V2.journal, {
    type: "post", trade_id: tradeId, symbol,
    exit_reason:   reasonTag,
    exitPrice:     round(exitFill, 6),
    net_pnl:       round(netPnl, 6),
    realized_R:    round(realizedR, 6),
    roi_on_margin: round(roiOnMargin, 6),
    fees:          round(fees, 6),
    funding:       round(funding, 6),
    hold_secs:     round((now() - pos.openedAt) / 1000, 0),
    ts:            now(),
  });

  // Trades log
  appendJSONL(V2.trades, {
    trade_id: tradeId, symbol, market,
    strategy_id:  pos.openMeta?.strategy_id,
    setup_tag:    pos.openMeta?.setup_tag,
    side:         pos.side,
    entryPrice:   pos.entryPrice,
    exitPrice:    exitFill,
    margin:       round(pos.isolatedMargin, 4),
    leverage:     pos.leverage,
    net_pnl:      round(netPnl, 6),
    realized_R:   round(realizedR, 6),
    roi_on_margin: round(roiOnMargin, 6),
    exit_reason:  reasonTag,
    regime:       state.regime,
    openedAt:     pos.openedAt,
    closedAt:     now(),
  });

  // Brain importance accrual
  onClose(state, pos, reasonTag);

  delete state.positions[symbol];

  const icon = netPnl >= 0 ? "✅" : "❌";
  log(
    `${icon} CLOSE ${pos.side.toUpperCase()} ${symbol} ` +
    `@ ${round(exitFill, 2)} | PnL $${round(netPnl, 4)} ` +
    `(${round(realizedR * 100, 1)}%R) | ${reasonTag}`
  );

  // Telegram notification
  try { notifyClose(symbol, pos, reasonTag, netPnl, realizedR); } catch { /* non-fatal */ }

  return { netPnl, realizedR };
}

// ── Equity recalculation ───────────────────────────────────────────────────

function recalcEquity(state, eq) {
  let totalMargin = 0, totalUPnl = 0;
  for (const pos of Object.values(state.positions)) {
    totalMargin += pos.isolatedMargin || 0;
    const mark = pos.emaMark ?? (eq[pos.symbol]?.price ?? pos.entryPrice);
    totalUPnl  += P.unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  }
  state.equity = state.walletBalance + totalMargin + totalUPnl;
  return { totalMargin, totalUPnl };
}

// ── Publish signals (the dashboard reads this) ─────────────────────────────

function publishSignals(state, eq, cfg, worldDigest) {
  const totalPnl    = state.equity - state.startingCapital;
  const totalPnlPct = state.startingCapital > 0 ? totalPnl / state.startingCapital : 0;
  const goalGap     = state.goal.target - state.equity;
  const progressPct = state.goal.target > state.goal.startEquity
    ? clamp((state.equity - state.goal.startEquity) / (state.goal.target - state.goal.startEquity), 0, 1)
    : 0;

  let investedNotional = 0;
  const positions = [];

  for (const [sym, pos] of Object.entries(state.positions)) {
    const mark = pos.emaMark ?? (eq[sym]?.price ?? pos.entryPrice);
    const uPnl = P.unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
    const roiPct = pos.isolatedMargin > 0 ? (uPnl / pos.isolatedMargin) * 100 : 0;
    investedNotional += Math.abs(pos.notional);

    const wl = cfg.watchlist.find((w) => w.symbol === sym);
    positions.push({
      symbol: sym,
      name:          wl?.name || sym,
      market:        pos.market,
      side:          pos.side,
      leverage:      pos.leverage,
      notional:      round(pos.notional, 2),
      margin:        round(pos.isolatedMargin, 4),
      entry:         round(pos.entryPrice, 6),
      mark:          round(mark, 6),
      liqPrice:      round(pos.liqPrice, 6),
      uPnl:          round(uPnl, 4),
      roiPct:        round(roiPct, 2),
      fundingAccrued: round(pos.fundingAccrued || 0, 6),
      setup_tag:     pos.openMeta?.setup_tag,
      strategy_id:   pos.openMeta?.strategy_id,
      stopPct:       pos.openMeta?.stopPct,
      targetPct:     pos.openMeta?.targetPct,
      reason:        pos.openMeta?.reason,
    });
  }

  const grossLeverage = state.equity > 0 ? investedNotional / state.equity : 0;

  const watch = cfg.watchlist.map((item) => {
    const q = _quotes[item.symbol];
    const ind = eq[item.symbol];
    return {
      symbol:    item.symbol,
      name:      item.name,
      market:    item.market,
      icon:      item.icon,
      price:     q?.price ?? null,
      changePct: q ? round((q.changePct || 0) * 100, 2) : null,
      trend:     ind?.trend || null,
      rsi:       ind?.rsi != null ? round(ind.rsi, 1) : null,
      bias:      ind?.bias || null,
      stale:     q?.stale || false,
    };
  });

  const recentEps = readJSONL(V2.episodes, 10);
  const brain     = buildBrainV2(state, state.regime);

  const sig = {
    ts:   now(),
    iso:  iso(now()),
    version: 2,

    episodeNum:        state.episodeNum,
    equity:            round(state.equity, 4),
    walletBalance:     round(state.walletBalance, 4),
    startingCapital:   state.startingCapital,
    goal:              state.goal,
    totalPnl:          round(totalPnl, 4),
    totalPnlPct:       round(totalPnlPct, 4),
    progressPct:       round(progressPct, 4),
    goalGap:           round(goalGap, 4),
    realizedPnlEpisode: round(state.realizedPnlEpisode || 0, 4),
    peakEquity:        round(state.peakEquity, 4),
    maxDrawdownPct:    round(state.maxDrawdownPct, 4),

    riskState:         state.riskState,
    regime:            state.regime,
    generation:        state.generation,
    aggression:        state.aggression,
    lifetime:          state.lifetime,
    fundingRate:       state.fundingRate ?? 0,

    investedNotional:  round(investedNotional, 2),
    grossLeverage:     round(grossLeverage, 2),

    positions,
    watch,
    recentEpisodes:    recentEps,
    brain,
    world:             worldDigest || null,
  };

  writeJSON(V2.signals, sig);
  return sig;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const cfg = loadConfig();
  if (!cfg) { console.error("config.json not found."); process.exit(1); }
  ensureData();

  let state = readJSON(V2.state, null);
  if (!state) {
    log("No V2 state found — run: node scripts/v2/init.mjs");
    log("Auto-initialising fresh state…");
    state = freshV2State(cfg);
    writeJSON(V2.state, state);
    ensureStrategies();
    writeJSON(V2.pending, []);
  }

  log("═══════════════════════════════════════════════════════");
  log("  FabInvests V2 engine started");
  log(`  Episode ${state.episodeNum}  |  Gen ${state.generation}`);
  log(`  Equity $${round(state.equity, 2)}  |  Kelly ${round(state.aggression.kellyFraction, 2)}`);
  log(`  Leverage cap ${state.aggression.leverageCap}x  →  ceiling ${state.aggression.leverageCeiling}x`);
  log("═══════════════════════════════════════════════════════");

  // Telegram startup notification
  try { await notifyStartup(state); } catch { /* non-fatal */ }

  const loopMs = (cfg.v2.strategies.loopSeconds || 30) * 1000;

  while (true) {
    try { await cycle(state, cfg); }
    catch (err) { log(`Cycle error: ${err.message}`); console.error(err); }

    writeJSON(V2.state, state);

    if (ONCE) { log("Single cycle complete (--once).  Exiting."); break; }
    await sleep(loopMs);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ONE CYCLE
// ═══════════════════════════════════════════════════════════════════════════

async function cycle(state, cfg) {
  state.cycles   = (state.cycles || 0) + 1;
  state.updatedAt = now();
  const v2       = cfg.v2;

  // ── Telegram: check for remote commands ──
  try { await checkCommands(state); } catch { /* non-fatal */ }
  const histTtl  = (cfg.historyRefreshMinutes || 20) * 60_000;

  // ──────────────────────────────────────────────────────────────────────
  // 1) FETCH — quotes (parallel), FX, history
  // ──────────────────────────────────────────────────────────────────────
  const allSyms = [
    ...cfg.watchlist.map((w) => w.symbol),
    ...cfg.indices.map((i) => i.symbol),
  ];
  const uniqueSyms = [...new Set(allSyms)];

  _fxRate = await fetchFx();
  await fetchAllQuotes(uniqueSyms);

  if (!Object.keys(_quotes).length) { log("No quotes — skipping cycle."); return; }

  // History refresh (daily + intraday crypto)
  for (const item of cfg.watchlist) {
    await refreshHistory(item.symbol, "1y", "1d", histTtl);
    if (item.market === "crypto") {
      await refreshHistory(item.symbol, "5d", "15m", 10 * 60_000);
    }
  }
  for (const idx of cfg.indices) {
    await refreshHistory(idx.symbol, "1y", "1d", histTtl);
  }

  // ──────────────────────────────────────────────────────────────────────
  // 2) ENRICH — indicators + regime
  // ──────────────────────────────────────────────────────────────────────
  const eq = await buildEnriched(cfg, histTtl);
  state.regime = computeRegime(eq, { halt: state.riskState === "halt" });

  // ──────────────────────────────────────────────────────────────────────
  // 3) MARK & MANAGE — mark, fund, liq, stop, target, time, trail
  // ──────────────────────────────────────────────────────────────────────
  const closedHere = markAndManage(state, eq, cfg);

  // ──────────────────────────────────────────────────────────────────────
  // 4) EQUITY — wallet + Σ(margin + unrealized) at mark
  // ──────────────────────────────────────────────────────────────────────
  recalcEquity(state, eq);

  // ──────────────────────────────────────────────────────────────────────
  // 5) PENDING — external / manual orders
  // ──────────────────────────────────────────────────────────────────────
  const pending = readJSON(V2.pending, []);
  if (pending.length) {
    for (const raw of pending) {
      if (raw.op === "close" && state.positions[raw.symbol]) {
        const q = eq[raw.symbol];
        if (q) doClose(state, raw.symbol, q.price, raw.reason || "manual-close", cfg);
      } else if (raw.op === "open") {
        const sized = sizeOrder(state, raw, eq, cfg);
        const q = eq[raw.symbol];
        if (sized.marginUsd && q) doOpen(state, sized, q, cfg);
      }
    }
    writeJSON(V2.pending, []);      // clear the queue
    recalcEquity(state, eq);
  }

  // ──────────────────────────────────────────────────────────────────────
  // 6) STRATEGIES — generate signals, size, execute
  // ──────────────────────────────────────────────────────────────────────
  if (state.riskState !== "halt") {
    const orders = runStrategies(state, eq, cfg);

    // Closes first (free margin)
    for (const o of orders.filter((o) => o.op === "close")) {
      if (state.positions[o.symbol] && eq[o.symbol]) {
        doClose(state, o.symbol, eq[o.symbol].price, o.reason, cfg);
      }
    }

    // Opens (sized)
    for (const o of orders.filter((o) => o.op === "open")) {
      const sized = sizeOrder(state, o, eq, cfg);
      const q = eq[o.symbol];
      if (sized.marginUsd && q) doOpen(state, sized, q, cfg);
    }

    recalcEquity(state, eq);
  }

  // ──────────────────────────────────────────────────────────────────────
  // 7) EPISODE CHECK — peak, end, evolve
  // ──────────────────────────────────────────────────────────────────────
  const dd = recordEquityPeak(state);

  // Drawdown risk state
  if (dd >= (cfg.risk?.ddHalt ?? 0.20))         state.riskState = "halt";
  else if (dd >= (cfg.risk?.ddCaution ?? 0.12)) state.riskState = "caution";
  else                                          state.riskState = "normal";

  const endReason = episodeEndReason(state, cfg);
  if (endReason) {
    log(`━━━ Episode ${state.episodeNum} ended: ${endReason}  |  Equity $${round(state.equity, 2)} ━━━`);
    try { notifyEpisodeEnd(state, endReason); } catch { /* non-fatal */ }

    // Close survivors at mark
    for (const sym of Object.keys(state.positions)) {
      const mark = state.positions[sym].emaMark ?? eq[sym]?.price;
      if (mark) doClose(state, sym, mark, "episode-end", cfg);
    }
    recalcEquity(state, eq);

    const rec = finalizeEpisode(state, endReason);
    onEpisodeEnd(state, rec, cfg);
    nextEpisode(state, cfg);

    log(
      `━━━ New episode ${state.episodeNum}  |  Gen ${state.generation} ` +
      `|  Capital $${state.startingCapital} ━━━`
    );
  } else {
    // Mid-run: rescore if any trades closed
    if (closedHere.length) scoreStrategies();

    // Periodic brain evolve
    const brainMs = (v2.strategies.brainLoopMinutes || 8) * 60_000;
    if (now() - _lastBrainTs >= brainMs) {
      evolveTick(state, cfg);
      _lastBrainTs = now();
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 8) WORLD, PERSIST, PUBLISH
  // ──────────────────────────────────────────────────────────────────────
  let worldDigest = null;
  try { worldDigest = await collectWorld(state, cfg); }
  catch (err) { log(`World poll error: ${err.message}`); }

  // Cache OI + funding snapshots for OI Divergence / Order Flow strategies
  if (worldDigest?.crypto) {
    const symMap = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", DOGE: "DOGE-USD" };
    for (const [short, full] of Object.entries(symMap)) {
      const cd = worldDigest.crypto[short];
      if (cd?.openInterest) {
        cacheOiSnapshot(full, cd.openInterest, cd.funding ?? null);
      }
    }
  }

  // Persist state
  writeJSON(V2.state, state);

  // Prices snapshot
  const priceMap = {};
  for (const sym of Object.keys(_quotes)) {
    const q = _quotes[sym];
    if (q?.ok) priceMap[sym] = { price: q.price, changePct: round(q.changePct || 0, 4), stale: !!q.stale };
  }
  writeJSON(V2.prices, { ts: now(), fx: _fxRate, prices: priceMap });

  // Equity row
  const { totalMargin, totalUPnl } = recalcEquity(state, eq);
  appendJSONL(V2.equity, {
    ts:        now(),
    equity:    round(state.equity, 4),
    wallet:    round(state.walletBalance, 4),
    margin:    round(totalMargin, 4),
    uPnl:     round(totalUPnl, 4),
    positions: Object.keys(state.positions).length,
    dd:        round(dd, 4),
    regime:    state.regime,
    riskState: state.riskState,
    episode:   state.episodeNum,
  });

  // Publish the full signals object for the dashboard
  publishSignals(state, eq, cfg, worldDigest);

  // ── Summary ──
  const posCount = Object.keys(state.positions).length;
  const posSyms  = Object.keys(state.positions).join(", ") || "none";
  log(
    `Cycle ${state.cycles}  |  Eq $${round(state.equity, 2)}  |  ` +
    `Pos ${posCount} [${posSyms}]  |  ` +
    `DD ${round(dd * 100, 1)}%  |  Regime ${state.regime}  |  Risk ${state.riskState}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
