// scripts/v2/strategies.mjs — Deterministic strategy library
// Reads enriched quotes, emits open/close orders with next-tick fills.
// No looking into the future. No faking signals.
// V3: Strategies are tagged into pools (trend/revert) and routed by the AI analyst.

import { V2, readJSON, writeJSON, now, clamp } from "./store.mjs";
import {
  rsi, sma, atr, bollingerBands, percentileRank,
  logReturns, donchianChannel, stdev, mean,
} from "../lib.mjs";
import { readAnalystDecision } from "./analyst.mjs";

// ── Seed strategy definitions ──────────────────────────────────────────────

const SEED_STRATEGIES = [
  // ── TREND POOL: Activated when AI analyst says mode=TREND ──────────────
  { id: "tsmom", name: "Time-series momentum", setup_tag: "momentum", pool: "trend",
    markets: ["crypto", "us", "india"],
    text: "Long when the 28-day trend is up (price > 200-SMA); short when down.",
    status: "candidate", baseLev: 5, stopPct: 0.04, targetPct: 0.12 },
  { id: "donchian", name: "Donchian breakout", setup_tag: "breakout", pool: "trend",
    markets: ["crypto", "us", "india"],
    text: "Long a 20-day high breakout above the 200-SMA; short the 20-day breakdown below it.",
    status: "candidate", baseLev: 5, stopPct: 0.04, targetPct: 0.10 },
  { id: "mom_trend", name: "Momentum + trend", setup_tag: "trend", pool: "trend",
    markets: ["crypto", "us", "india"],
    text: "Long strong 28-day momentum above the 200-SMA; ride the trailing exit.",
    status: "candidate", baseLev: 4, stopPct: 0.04, targetPct: 0.10 },
  { id: "orb", name: "Opening-range breakout", setup_tag: "orb", pool: "trend",
    markets: ["us"],
    text: "Trade the break of the first 30m session range at the US open (live-only).",
    status: "candidate", baseLev: 5, stopPct: 0.016, targetPct: 0.04 },
  { id: "ibreakout", name: "Intraday breakout (discovered)", setup_tag: "breakout-15m", pool: "trend",
    markets: ["crypto"],
    text: "15-minute breakout of the prior ~12h range (48 bars). Tight stop, wide target.",
    status: "candidate", baseLev: 5, stopPct: 0.015, targetPct: 0.08, intraday: true },
  { id: "atr_expand", name: "ATR expansion breakout", setup_tag: "vol-breakout", pool: "trend",
    markets: ["crypto", "us", "india"],
    text: "Breakout confirmed by volatility expansion (ATR ratio > 1.3).",
    status: "candidate", baseLev: 4, stopPct: 0.04, targetPct: 0.12 },
  { id: "vol_expand", name: "Volatility expansion (BB squeeze)", setup_tag: "squeeze", pool: "trend",
    markets: ["crypto", "us", "india"],
    text: "Trade the Bollinger squeeze release: bandwidth in bottom 20th pctile then expands >15%.",
    status: "candidate", baseLev: 5, stopPct: 0.04, targetPct: 0.10 },

  // ── REVERT POOL: Activated when AI analyst says mode=REVERT ────────────
  { id: "rsi2dip", name: "RSI-2 dip (Connors)", setup_tag: "mean-reversion", pool: "revert",
    markets: ["crypto", "us", "india"],
    text: "Buy 2-day oversold ONLY in an uptrend (RSI2<10 & price>200-SMA); short overbought in a downtrend.",
    status: "candidate", baseLev: 3, stopPct: 0.02, targetPct: 0.05 },
  { id: "vwap_revert", name: "VWAP mean reversion", setup_tag: "mean-rev-vwap", pool: "revert",
    markets: ["crypto"],
    text: "Fade extended moves from session VWAP ± 2σ. Crypto intraday only.",
    status: "candidate", baseLev: 3, stopPct: 0.02, targetPct: 0.04, intraday: true },
  { id: "orderflow", name: "Order flow edge (proxy)", setup_tag: "flow-proxy", pool: "revert",
    markets: ["crypto"],
    text: "Trade crowd positioning using funding rate + OI delta as proxy for order flow.",
    status: "candidate", baseLev: 3, stopPct: 0.02, targetPct: 0.05 },

  // ── BOTH POOLS: Run in TREND or REVERT mode ───────────────────────────
  { id: "adaptive_regime", name: "Adaptive regime switch", setup_tag: "regime-adaptive", pool: "both",
    markets: ["crypto", "us", "india"],
    text: "Meta-strategy: trend-follow in high-vol, mean-revert in low-vol, sit out in the middle.",
    status: "candidate", baseLev: 4, stopPct: 0.04, targetPct: 0.10 },
  { id: "oi_diverge", name: "OI divergence", setup_tag: "flow-oi", pool: "both",
    markets: ["crypto"],
    text: "Detect weak vs confirmed moves using open interest vs price divergence.",
    status: "candidate", baseLev: 4, stopPct: 0.03, targetPct: 0.08 },
];

const DEFAULT_LEARNED = { n: 0, expectancy_R: 0, win_rate: 0, kelly: 0.12, confidence: 0.2 };

// ── Strategy persistence ───────────────────────────────────────────────────

/**
 * Load strategies from disk, or seed from SEED_STRATEGIES.
 * New seeds are merged without clobbering learned stats.
 */
export function ensureStrategies() {
  let strategies = readJSON(V2.strategies, null);

  if (!strategies) {
    strategies = SEED_STRATEGIES.map((s) => ({
      ...s,
      learned: { ...DEFAULT_LEARNED },
    }));
    writeJSON(V2.strategies, strategies);
    return strategies;
  }

  // Merge any NEW seeds that don't exist yet
  const existingIds = new Set(strategies.map((s) => s.id));
  let changed = false;
  for (const seed of SEED_STRATEGIES) {
    if (!existingIds.has(seed.id)) {
      strategies.push({ ...seed, learned: { ...DEFAULT_LEARNED } });
      changed = true;
    }
  }

  // V3: Merge pool, stopPct, targetPct, baseLev from seeds into existing strategies
  // This ensures saved strategies get the new pool tags and updated risk-reward ratios.
  for (const strat of strategies) {
    const seed = SEED_STRATEGIES.find((s) => s.id === strat.id);
    if (!seed) continue;
    if (strat.pool !== seed.pool || strat.stopPct !== seed.stopPct ||
        strat.targetPct !== seed.targetPct || strat.baseLev !== seed.baseLev) {
      strat.pool      = seed.pool;
      strat.stopPct   = seed.stopPct;
      strat.targetPct = seed.targetPct;
      strat.baseLev   = seed.baseLev;
      changed = true;
    }
  }

  // Remove strategies that no longer exist in SEED_STRATEGIES
  const seedIds = new Set(SEED_STRATEGIES.map((s) => s.id));
  const before = strategies.length;
  strategies = strategies.filter((s) => seedIds.has(s.id));
  if (strategies.length !== before) changed = true;

  if (changed) writeJSON(V2.strategies, strategies);

  return strategies;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** N-bar return: c[last] / c[last - 1 - n] - 1 */
function retN(c, n) {
  const last = c.length - 1;
  const idx = last - 1 - n;
  if (idx < 0 || !c[idx]) return 0;
  return c[last] / c[idx] - 1;
}

// Module-level state for ORB session tracking, re-entry cooldowns, OI cache
const _orbState = new Map();
const _cooldowns = new Map();
const _oiCache = {};        // symbol → { timestamps: [], ois: [] }
const _fundingCache = {};   // symbol → { timestamps: [], rates: [] }

/** Store an OI snapshot for a symbol (called from engine each cycle). */
export function cacheOiSnapshot(symbol, oi, fundingRate) {
  if (!_oiCache[symbol]) _oiCache[symbol] = { ts: [], oi: [] };
  const c = _oiCache[symbol];
  c.ts.push(now());
  c.oi.push(oi);
  // Keep last 100 snapshots (~50 min at 30s cycles)
  if (c.ts.length > 100) { c.ts.shift(); c.oi.shift(); }

  if (fundingRate != null) {
    if (!_fundingCache[symbol]) _fundingCache[symbol] = { ts: [], rate: [] };
    const f = _fundingCache[symbol];
    f.ts.push(now());
    f.rate.push(fundingRate);
    if (f.ts.length > 100) { f.ts.shift(); f.rate.shift(); }
  }
}

// ── Signal functions ───────────────────────────────────────────────────────
// Each returns { side, baseLev, stopPct, targetPct, confidence, reason } or null.

function sigTsmom(q, strat) {
  const c = q.closes;
  if (!c || c.length < 30) return null;

  const r28 = retN(c, 28);
  const s200 = sma(c, 200);
  const price = q.price;

  if (r28 > 0.03 && (isNaN(s200) || price > s200)) {
    return {
      side: "long", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.62,
      reason: `TSMOM long: r28=${(r28 * 100).toFixed(1)}%`,
    };
  }
  if (r28 < -0.03 && (isNaN(s200) || price < s200)) {
    return {
      side: "short", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.55,
      reason: `TSMOM short: r28=${(r28 * 100).toFixed(1)}%`,
    };
  }
  return null;
}

function sigDonchian(q, strat) {
  const c = q.closes;
  if (!c || c.length < 25) return null;

  // Prior 20 closes, excluding the latest
  const window = c.slice(-21, -1);
  const hi = Math.max(...window);
  const lo = Math.min(...window);
  const s200 = sma(c, 200);
  const price = q.price;

  if (price > hi && (isNaN(s200) || price > s200)) {
    return {
      side: "long", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.6,
      reason: `Donchian long: price ${price.toFixed(2)} > 20d hi ${hi.toFixed(2)}`,
    };
  }
  if (price < lo && (isNaN(s200) || price < s200)) {
    return {
      side: "short", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.55,
      reason: `Donchian short: price ${price.toFixed(2)} < 20d lo ${lo.toFixed(2)}`,
    };
  }
  return null;
}

function sigRsi2dip(q, strat) {
  const c = q.closes;
  if (!c || c.length < 210) return null;

  const r2 = rsi(c, 2);
  const s200 = sma(c, 200);
  const price = q.price;

  if (isNaN(s200)) return null; // Need 200-SMA for this strategy

  if (r2 < 10 && price > s200) {
    return {
      side: "long", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.6,
      reason: `RSI2 dip long: RSI(2)=${r2.toFixed(1)}, price > 200-SMA`,
    };
  }
  if (r2 > 90 && price < s200) {
    return {
      side: "short", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.55,
      reason: `RSI2 overbought short: RSI(2)=${r2.toFixed(1)}, price < 200-SMA`,
    };
  }
  return null;
}

function sigMomTrend(q, strat) {
  const c = q.closes;
  if (!c || c.length < 30) return null;

  const s200 = sma(c, 200);
  const r28 = retN(c, 28);
  const price = q.price;

  if (
    (isNaN(s200) || price > s200) &&
    r28 > 0.05 &&
    q.mom > 1 &&
    q.rsi < 78
  ) {
    return {
      side: "long", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.55,
      reason: `MomTrend long: r28=${(r28 * 100).toFixed(1)}%, mom=${q.mom?.toFixed(2)}, rsi=${q.rsi?.toFixed(1)}`,
    };
  }
  return null;
}

function sigOrb(q, strat) {
  if (q.market !== "us") return null;
  if (!q.sessionStart || !q.price) return null;

  const nowTs = now();
  const sym = q.symbol;

  // Normalize sessionStart to ms (Yahoo returns seconds)
  const sessionMs =
    typeof q.sessionStart === "number" && q.sessionStart < 1e12
      ? q.sessionStart * 1000
      : q.sessionStart;

  let orb = _orbState.get(sym);

  // Reset on new session
  if (!orb || orb.sessionStart !== sessionMs) {
    // Must start watching within ~5 min of real session open
    if (nowTs - sessionMs > 5 * 60 * 1000) return null;

    orb = {
      sessionStart: sessionMs,
      watchStart: nowTs,
      orHi: q.price,
      orLo: q.price,
      rangeFormed: false,
    };
    _orbState.set(sym, orb);
  }

  // First 30 minutes: build the opening range, no signals yet
  const elapsedMin = (nowTs - sessionMs) / (60 * 1000);

  if (elapsedMin <= 30) {
    if (q.price > orb.orHi) orb.orHi = q.price;
    if (q.price < orb.orLo) orb.orLo = q.price;
    return null;
  }

  orb.rangeFormed = true;

  // After range is set, trade the breakout
  if (q.price > orb.orHi) {
    return {
      side: "long", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.55,
      reason: `ORB long: price ${q.price.toFixed(2)} > orHi ${orb.orHi.toFixed(2)}`,
    };
  }
  if (q.price < orb.orLo) {
    return {
      side: "short", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.5,
      reason: `ORB short: price ${q.price.toFixed(2)} < orLo ${orb.orLo.toFixed(2)}`,
    };
  }
  return null;
}

function sigBreakoutIntraday(q, strat) {
  if (q.market !== "crypto") return null;

  const bars = q.closesIntraday;
  if (!bars || bars.length < 50) return null; // need 48 + current

  const N = 48;
  const i = bars.length - 1; // latest bar
  const channel = bars.slice(i - N, i); // prior 48 bars, exclude current
  const hi = Math.max(...channel);
  const lo = Math.min(...channel);
  const close = bars[i];

  if (close > hi) {
    return {
      side: "long", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.5,
      reason: `Intraday breakout long: close ${close.toFixed(2)} > 48-bar hi ${hi.toFixed(2)}`,
    };
  }
  if (close < lo) {
    return {
      side: "short", baseLev: strat.baseLev,
      stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.5,
      reason: `Intraday breakout short: close ${close.toFixed(2)} < 48-bar lo ${lo.toFixed(2)}`,
    };
  }
  return null;
}

// ── V2.1 signal functions ──────────────────────────────────────────────────

function sigAdaptiveRegime(q, strat) {
  const c = q.closes;
  if (!c || c.length < 110) return null;

  // Realized volatility = stdev(logReturns, 20) * sqrt(365)
  const lr = logReturns(c);
  if (lr.length < 90) return null;
  const recentLR = lr.slice(-20);
  const rv = stdev(recentLR) * Math.sqrt(365);

  // RV percentile over last 90 log-return stdevs
  const rvHistory = [];
  for (let i = 20; i <= lr.length; i++) {
    const window = lr.slice(i - 20, i);
    rvHistory.push(stdev(window) * Math.sqrt(365));
  }
  const rvPct = percentileRank(rv, rvHistory.slice(-90));

  const s200 = sma(c, 200);
  const price = q.price;
  const r2 = rsi(c, 2);

  // High vol → trend-follow (Donchian-style)
  if (rvPct > 0.60) {
    const ch = donchianChannel(c, 20);
    if (!ch) return null;
    if (price > ch.hi && (isNaN(s200) || price > s200)) {
      return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
        confidence: 0.58, reason: `AdaptiveRegime trend-long: RV_pct=${(rvPct*100).toFixed(0)}%, price > 20d hi` };
    }
    if (price < ch.lo && (isNaN(s200) || price < s200)) {
      return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
        confidence: 0.55, reason: `AdaptiveRegime trend-short: RV_pct=${(rvPct*100).toFixed(0)}%, price < 20d lo` };
    }
    return null;
  }

  // Low vol → mean-revert (RSI2-style)
  if (rvPct < 0.40) {
    if (r2 < 10 && (isNaN(s200) || price > s200)) {
      return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
        confidence: 0.55, reason: `AdaptiveRegime revert-long: RV_pct=${(rvPct*100).toFixed(0)}%, RSI2=${r2.toFixed(0)}` };
    }
    if (r2 > 90 && (isNaN(s200) || price < s200)) {
      return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
        confidence: 0.52, reason: `AdaptiveRegime revert-short: RV_pct=${(rvPct*100).toFixed(0)}%, RSI2=${r2.toFixed(0)}` };
    }
    return null;
  }

  // 40-60% → ambiguous regime, no entry
  return null;
}

function sigOiDivergence(q, strat) {
  if (q.market !== "crypto") return null;
  const sym = q.symbol;
  const cache = _oiCache[sym];
  if (!cache || cache.oi.length < 16) return null; // need ~8 min of snapshots

  const c = q.closes;
  if (!c || c.length < 10) return null;

  // ΔP over last 8 closes
  const n = Math.min(8, c.length - 1);
  const pricePrev = c[c.length - 1 - n];
  const priceNow = c[c.length - 1];
  const deltaP = pricePrev > 0 ? (priceNow - pricePrev) / pricePrev : 0;

  // ΔOI over last 8 cached OI snapshots
  const oiN = Math.min(8, cache.oi.length - 1);
  const oiPrev = cache.oi[cache.oi.length - 1 - oiN];
  const oiNow = cache.oi[cache.oi.length - 1];
  const deltaOI = oiPrev > 0 ? (oiNow - oiPrev) / oiPrev : 0;

  // Threshold filter: |ΔP| > 1.5%, |ΔOI| > 3%
  if (Math.abs(deltaP) < 0.015 || Math.abs(deltaOI) < 0.03) return null;

  // Signal classification
  if (deltaP > 0 && deltaOI > 0) {
    // Confirmed uptrend
    return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.6, reason: `OI confirmed long: ΔP=${(deltaP*100).toFixed(1)}%, ΔOI=${(deltaOI*100).toFixed(1)}%` };
  }
  if (deltaP > 0 && deltaOI < 0) {
    // Weak rally (short covering) → fade short
    return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.52, reason: `OI diverge short: ΔP=${(deltaP*100).toFixed(1)}% but ΔOI=${(deltaOI*100).toFixed(1)}% (short covering)` };
  }
  if (deltaP < 0 && deltaOI > 0) {
    // Confirmed downtrend
    return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.6, reason: `OI confirmed short: ΔP=${(deltaP*100).toFixed(1)}%, ΔOI=${(deltaOI*100).toFixed(1)}%` };
  }
  if (deltaP < 0 && deltaOI < 0) {
    // Weak selloff (long liquidation exhaustion) → fade long
    return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.52, reason: `OI diverge long: ΔP=${(deltaP*100).toFixed(1)}% but ΔOI=${(deltaOI*100).toFixed(1)}% (liquidation exhaustion)` };
  }
  return null;
}

function sigOrderFlow(q, strat) {
  if (q.market !== "crypto") return null;
  const sym = q.symbol;
  const fCache = _fundingCache[sym];
  const oCache = _oiCache[sym];
  if (!fCache || fCache.rate.length < 5) return null;
  if (!oCache || oCache.oi.length < 5) return null;

  // Average funding over last 5 snapshots
  const recentFunding = fCache.rate.slice(-5);
  const avgFunding = mean(recentFunding);

  // OI delta over last 5 snapshots
  const recentOI = oCache.oi.slice(-5);
  const oiDelta = recentOI.length >= 2
    ? (recentOI[recentOI.length - 1] - recentOI[0]) / (recentOI[0] || 1)
    : 0;

  // Positive funding sustained + OI rising = longs crowded → short (contrarian)
  const allPositive = recentFunding.every(r => r > 0.0001);
  const allNegative = recentFunding.every(r => r < -0.0001);

  if (allPositive && oiDelta > 0.01) {
    return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.5, reason: `OrderFlow short: longs crowded, funding=${(avgFunding*100).toFixed(4)}%, OI↑${(oiDelta*100).toFixed(1)}%` };
  }
  if (allNegative && oiDelta > 0.01) {
    return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.5, reason: `OrderFlow long: shorts crowded, funding=${(avgFunding*100).toFixed(4)}%, OI↑${(oiDelta*100).toFixed(1)}%` };
  }
  return null;
}

function sigAtrExpansion(q, strat) {
  const c = q.closes;
  if (!c || c.length < 40) return null;

  const atrNow = atr(c, 14);
  // ATR 20 bars ago: use closes up to -20
  const cOld = c.slice(0, -20);
  const atrOld = cOld.length >= 15 ? atr(cOld, 14) : NaN;
  if (!isFinite(atrNow) || !isFinite(atrOld) || atrOld === 0) return null;

  const arRatio = atrNow / atrOld;
  if (arRatio < 1.3) return null; // Vol not expanding enough

  const ch = donchianChannel(c, 20);
  if (!ch) return null;
  const price = q.price;
  const prevClose = c[c.length - 2];

  // ATR-based stops
  const atrStop = (1.5 * atrNow) / price;
  const atrTarget = (3 * atrNow) / price;

  if (price > prevClose && price > ch.hi) {
    return { side: "long", baseLev: strat.baseLev,
      stopPct: Math.min(atrStop, 0.08), targetPct: Math.min(atrTarget, 0.16),
      confidence: 0.58, reason: `ATR expand long: AR=${arRatio.toFixed(2)}, price > 20d hi, ATR=${atrNow.toFixed(2)}` };
  }
  if (price < prevClose && price < ch.lo) {
    return { side: "short", baseLev: strat.baseLev,
      stopPct: Math.min(atrStop, 0.08), targetPct: Math.min(atrTarget, 0.16),
      confidence: 0.55, reason: `ATR expand short: AR=${arRatio.toFixed(2)}, price < 20d lo, ATR=${atrNow.toFixed(2)}` };
  }
  return null;
}

function sigVwapRevert(q, strat) {
  if (q.market !== "crypto") return null;
  const bars = q.closesIntraday;
  if (!bars || bars.length < 30) return null;

  // Approximate session VWAP as equal-weight mean of last ~48 bars (12h session)
  const session = bars.slice(-48);
  const vwap = mean(session);
  const diffs = session.map(p => p - vwap);
  const sigmaVwap = stdev(diffs);
  if (sigmaVwap === 0) return null;

  const price = q.price;
  const upperBand = vwap + 2 * sigmaVwap;
  const lowerBand = vwap - 2 * sigmaVwap;

  if (price > upperBand) {
    return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.52, reason: `VWAP revert short: price ${price.toFixed(2)} > VWAP+2σ ${upperBand.toFixed(2)}` };
  }
  if (price < lowerBand) {
    return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.52, reason: `VWAP revert long: price ${price.toFixed(2)} < VWAP-2σ ${lowerBand.toFixed(2)}` };
  }
  return null;
}

function sigVolExpansion(q, strat) {
  const c = q.closes;
  if (!c || c.length < 140) return null;

  const bb = bollingerBands(c, 20, 2);
  if (!bb) return null;

  // Compute BBW history for percentile ranking (last 120)
  const bbwHistory = [];
  for (let i = 20; i <= c.length; i++) {
    const slice = c.slice(i - 20, i);
    const b = bollingerBands(slice, 20, 2);
    if (b) bbwHistory.push(b.bandwidth);
  }
  const lookback = bbwHistory.slice(-120);
  if (lookback.length < 30) return null;

  const currentBBW = bb.bandwidth;
  const bbwPct = percentileRank(currentBBW, lookback);

  // Find squeeze: was BBW in bottom 20th percentile recently (last 10 bars)?
  const recentBBW = bbwHistory.slice(-10);
  const wasInSqueeze = recentBBW.some(bw => percentileRank(bw, lookback) < 0.20);
  if (!wasInSqueeze) return null;

  // Squeeze minimum
  const squeezeMin = Math.min(...recentBBW);
  const expansion = squeezeMin > 0 ? (currentBBW - squeezeMin) / squeezeMin : 0;
  if (expansion < 0.15) return null; // Need >15% expansion from squeeze min

  const price = q.price;

  if (price > bb.upper) {
    return { side: "long", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.58, reason: `BB squeeze long: BBW expanded ${(expansion*100).toFixed(0)}%, price > upper band` };
  }
  if (price < bb.lower) {
    return { side: "short", baseLev: strat.baseLev, stopPct: strat.stopPct, targetPct: strat.targetPct,
      confidence: 0.55, reason: `BB squeeze short: BBW expanded ${(expansion*100).toFixed(0)}%, price < lower band` };
  }
  return null;
}

// Strategy ID → signal function dispatch
const SIGNAL_FN = {
  tsmom: sigTsmom,
  donchian: sigDonchian,
  rsi2dip: sigRsi2dip,
  mom_trend: sigMomTrend,
  orb: sigOrb,
  ibreakout: sigBreakoutIntraday,
  adaptive_regime: sigAdaptiveRegime,
  oi_diverge: sigOiDivergence,
  orderflow: sigOrderFlow,
  atr_expand: sigAtrExpansion,
  vwap_revert: sigVwapRevert,
  vol_expand: sigVolExpansion,
};

// ── Exit logic ─────────────────────────────────────────────────────────────

/**
 * Check if an open position should exit based on its strategy rules.
 * Returns { exit: true, reason } or null.
 */
export function strategyExit(pos, q, regime) {
  const stratId = pos.strategy_id || pos.openMeta?.strategy_id;
  const c = q?.closes;
  if (!c || !c.length) return null;
  const price = q.price;

  // ── rsi2dip: exit when RSI-2 crosses back ──
  if (stratId === "rsi2dip" && c.length >= 3) {
    const r2 = rsi(c, 2);
    if (pos.side === "long" && r2 >= 65) {
      return { exit: true, reason: `RSI2 exit long: RSI(2)=${r2.toFixed(1)} >= 65` };
    }
    if (pos.side === "short" && r2 <= 35) {
      return { exit: true, reason: `RSI2 exit short: RSI(2)=${r2.toFixed(1)} <= 35` };
    }
  }

  // ── donchian: 10-day channel break against the position ──
  if (stratId === "donchian" && c.length >= 11) {
    const window10 = c.slice(-11, -1);
    if (pos.side === "long" && price <= Math.min(...window10)) {
      return { exit: true, reason: `Donchian exit long: price <= 10d low ${Math.min(...window10).toFixed(2)}` };
    }
    if (pos.side === "short" && price >= Math.max(...window10)) {
      return { exit: true, reason: `Donchian exit short: price >= 10d high ${Math.max(...window10).toFixed(2)}` };
    }
  }

  // ── tsmom / mom_trend: exit when 28-day return flips sign ──
  if ((stratId === "tsmom" || stratId === "mom_trend") && c.length >= 30) {
    const r28 = retN(c, 28);
    if (pos.side === "long" && r28 <= 0) {
      return { exit: true, reason: `${stratId} exit long: r28 flipped to ${(r28 * 100).toFixed(1)}%` };
    }
    if (pos.side === "short" && r28 >= 0) {
      return { exit: true, reason: `${stratId} exit short: r28 flipped to ${(r28 * 100).toFixed(1)}%` };
    }
  }

  // ── adaptive_regime: exit when RV regime flips ──
  if (stratId === "adaptive_regime" && c.length >= 110) {
    const lr = logReturns(c);
    if (lr.length >= 90) {
      const recentLR = lr.slice(-20);
      const rv = stdev(recentLR) * Math.sqrt(365);
      const rvHistory = [];
      for (let i = 20; i <= lr.length; i++) {
        rvHistory.push(stdev(lr.slice(i - 20, i)) * Math.sqrt(365));
      }
      const rvPct = percentileRank(rv, rvHistory.slice(-90));
      // Was in trend-follow mode (rvPct>60) but now ambiguous/low
      if (rvPct >= 0.40 && rvPct <= 0.60) {
        return { exit: true, reason: `AdaptiveRegime exit: RV_pct=${(rvPct*100).toFixed(0)}% now ambiguous` };
      }
    }
  }

  // ── oi_diverge: exit on opposite divergence ──
  if (stratId === "oi_diverge" && q.market === "crypto") {
    const cache = _oiCache[q.symbol];
    if (cache && cache.oi.length >= 8) {
      const oiN = Math.min(8, cache.oi.length - 1);
      const oiDelta = (cache.oi[cache.oi.length - 1] - cache.oi[cache.oi.length - 1 - oiN]) / (cache.oi[cache.oi.length - 1 - oiN] || 1);
      const pDelta = c.length >= 8 ? (c[c.length - 1] - c[c.length - 8]) / c[c.length - 8] : 0;
      // Exit long if price falling with OI rising (confirmed down)
      if (pos.side === "long" && pDelta < -0.01 && oiDelta > 0.02) {
        return { exit: true, reason: `OI diverge exit long: ΔP=${(pDelta*100).toFixed(1)}%, ΔOI=${(oiDelta*100).toFixed(1)}%` };
      }
      if (pos.side === "short" && pDelta > 0.01 && oiDelta > 0.02) {
        return { exit: true, reason: `OI diverge exit short: ΔP=${(pDelta*100).toFixed(1)}%, ΔOI=${(oiDelta*100).toFixed(1)}%` };
      }
    }
  }

  // ── atr_expand: ATR-based stop ──
  if (stratId === "atr_expand" && c.length >= 15) {
    const a = atr(c, 14);
    if (isFinite(a)) {
      const atrStop = 1.5 * a;
      const entry = pos.entryPrice;
      if (pos.side === "long" && price < entry - atrStop) {
        return { exit: true, reason: `ATR stop long: price ${price.toFixed(2)} < entry-1.5*ATR ${(entry - atrStop).toFixed(2)}` };
      }
      if (pos.side === "short" && price > entry + atrStop) {
        return { exit: true, reason: `ATR stop short: price ${price.toFixed(2)} > entry+1.5*ATR ${(entry + atrStop).toFixed(2)}` };
      }
    }
  }

  // ── vwap_revert: revert to VWAP ± 0.5σ ──
  if (stratId === "vwap_revert" && q.closesIntraday?.length >= 30) {
    const session = q.closesIntraday.slice(-48);
    const vwap = mean(session);
    const diffs = session.map(p => p - vwap);
    const sigmaVwap = stdev(diffs);
    if (sigmaVwap > 0) {
      const exitUpper = vwap + 0.5 * sigmaVwap;
      const exitLower = vwap - 0.5 * sigmaVwap;
      if (pos.side === "long" && price >= exitLower && price <= exitUpper) {
        return { exit: true, reason: `VWAP revert exit long: price ${price.toFixed(2)} near VWAP ${vwap.toFixed(2)}` };
      }
      if (pos.side === "short" && price >= exitLower && price <= exitUpper) {
        return { exit: true, reason: `VWAP revert exit short: price ${price.toFixed(2)} near VWAP ${vwap.toFixed(2)}` };
      }
    }
  }

  // ── vol_expand: opposite Bollinger Band / middle trail ──
  if (stratId === "vol_expand" && c.length >= 20) {
    const bb = bollingerBands(c, 20, 2);
    if (bb) {
      if (pos.side === "long" && price <= bb.middle) {
        return { exit: true, reason: `BB squeeze exit long: price ${price.toFixed(2)} <= middle band ${bb.middle.toFixed(2)}` };
      }
      if (pos.side === "short" && price >= bb.middle) {
        return { exit: true, reason: `BB squeeze exit short: price ${price.toFixed(2)} >= middle band ${bb.middle.toFixed(2)}` };
      }
    }
  }

  return null;
}

// ── Main dispatcher ────────────────────────────────────────────────────────

/**
 * Run the full strategy pipeline:
 *  1. Check exits on every open position → queue close orders.
 *  2. Scan for entries on free symbols → queue open orders.
 *
 * Returns an array of order objects.
 */
export function runStrategies(state, eq, cfg, histCache) {
  const strategies = ensureStrategies();
  const v2 = cfg.v2;
  const orders = [];
  const nowTs = now();
  const maxPos = v2.strategies.maxConcurrentPositions;

  // ── Phase 1: Exits ──
  for (const [symbol, pos] of Object.entries(state.positions)) {
    const q = eq[symbol];
    if (!q || !q.closes?.length) continue;
    const result = strategyExit(pos, q, state.regime);
    if (result) {
      orders.push({ op: "close", symbol, reason: result.reason });
    }
  }

  // ── Phase 2: Entries ──
  const openCount = Object.keys(state.positions).length;
  let newOpens = 0;

  // ── AI ANALYST MODE ROUTING ──────────────────────────────────────────────
  const analyst = readAnalystDecision();
  const aiMode = (analyst.mode || "SLEEP").toUpperCase();
  const aiBias = (analyst.direction_bias || "NEUTRAL").toUpperCase();

  // SLEEP mode: no new trades at all
  if (aiMode === "SLEEP") return orders;

  // Determine which strategy pool to activate
  const activePool = aiMode === "TREND" ? "trend" : aiMode === "REVERT" ? "revert" : null;
  if (!activePool) return orders;

  // ── LOSS-STREAK BREAKER: Pause after 3 consecutive losses ──
  const recentTrades = (state.recentTradeResults || []).slice(-5);
  const revTrades = [...recentTrades].reverse();
  const firstWinIdx = revTrades.findIndex(r => r >= 0);
  const lossStreak = firstWinIdx === -1 ? revTrades.length : firstWinIdx;
  if (lossStreak >= 3) {
    const lastTradeTs = state.lastTradeCloseTs || 0;
    const cooldownHours = Math.min(lossStreak, 6); // 3 losses = 3hr pause, max 6hr
    if ((nowTs - lastTradeTs) < cooldownHours * 3600_000) return orders;
  }

  const watchlist = cfg.watchlist || [];

  for (const item of watchlist) {
    const { symbol, market } = item;

    // Respect max concurrent positions
    if (openCount + newOpens >= maxPos) break;

    // One position per symbol
    if (state.positions[symbol]) continue;

    // Re-entry cooldown (2 minutes)
    const cooldownEnd = _cooldowns.get(symbol) || 0;
    if (nowTs < cooldownEnd) continue;

    // Market must be enabled in leverage config
    if (!v2.leverage?.[market]?.enabled) continue;

    // Must have valid, non-stale data
    const q = eq[symbol];
    if (!q || !q.closes?.length || !isFinite(q.price)) continue;

    // Non-crypto markets must be in regular session
    if (market !== "crypto" && q.marketState !== "REGULAR") continue;

    // ── Confluence filter: collect signals from ACTIVE POOL only ──
    const longSignals = [];
    const shortSignals = [];

    for (const strat of strategies) {
      if (strat.status === "retired") continue;
      if (!strat.markets.includes(market)) continue;

      // V3: Only run strategies in the active pool (or "both" pool)
      const pool = strat.pool || "trend";
      if (pool !== "both" && pool !== activePool) continue;

      const sigFn = SIGNAL_FN[strat.id];
      if (!sigFn) continue;

      const sig = sigFn(q, strat);
      if (!sig) continue;

      // V3: Direction bias from AI analyst — skip signals against the bias
      if (aiBias === "LONG" && sig.side === "short") continue;
      if (aiBias === "SHORT" && sig.side === "long") continue;

      const stratConf = strat.learned?.confidence ?? 0.2;
      const score = sig.confidence * (0.5 + stratConf);
      const entry = { strat, sig, score };

      if (sig.side === "long")  longSignals.push(entry);
      if (sig.side === "short") shortSignals.push(entry);
    }

    // Pick the side with 2+ confirmations (prefer the side with more)
    let chosenSignals = null;
    if (longSignals.length >= 2 && longSignals.length >= shortSignals.length) {
      chosenSignals = longSignals;
    } else if (shortSignals.length >= 2) {
      chosenSignals = shortSignals;
    }

    if (chosenSignals && chosenSignals.length >= 2) {
      // Use the highest-confidence signal's parameters
      chosenSignals.sort((a, b) => b.score - a.score);
      const best = chosenSignals[0];
      const confirmIds = chosenSignals.map(s => s.strat.id).join("+");
      const side = best.sig.side;

      orders.push({
        op: "open",
        symbol,
        side,
        leverage: clamp(best.sig.baseLev || best.strat.baseLev, 1, state.aggression.leverageCap),
        strategy_id: best.strat.id,
        setup_tag: best.strat.setup_tag,
        stopPct: best.sig.stopPct ?? best.strat.stopPct,
        targetPct: best.sig.targetPct ?? best.strat.targetPct,
        confidence: best.sig.confidence,
        reason: `[${chosenSignals.length}× confluence: ${confirmIds}] ${best.sig.reason}`,
        trade_id: `${best.strat.id}_${symbol}_${nowTs}`,
        sizePct: null,
      });
      _cooldowns.set(symbol, nowTs + 2 * 60 * 1000);
      newOpens++;
    }
  }

  return orders;
}
