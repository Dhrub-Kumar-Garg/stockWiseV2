import {trueATR,volumeVWAP,observedRegime} from './features.mjs';
import {flowDeltas} from './flow.mjs';
import {queueShadowCandidates,netCandidates} from './shadow.mjs';
import {candidateFeatures,calibratedDecision,strategyFingerprint,costFingerprint,scopeKey,expiringContext} from './calibration.mjs';
import {quoteUsable, alignPair} from "./market_data.mjs";
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

export const SEED_STRATEGIES = [
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
  { id: "pairs_trade", name: "Statistical Arbitrage (BTC/ETH)", setup_tag: "stat-arb", pool: "both",
    markets: ["crypto"],
    text: "Trade the mean reversion of the spread between BTC and ETH using z-scores.",
    status: "candidate", baseLev: 3, stopPct: 0.03, targetPct: 0.06 },
  { id: "adaptive_regime", name: "Adaptive regime switch", setup_tag: "regime-adaptive", pool: "both",
    markets: ["crypto", "us", "india"],
    text: "Meta-strategy: trend-follow in high-vol, mean-revert in low-vol, sit out in the middle.",
    status: "candidate", baseLev: 4, stopPct: 0.04, targetPct: 0.10 },
  { id: "oi_diverge", name: "OI divergence", setup_tag: "flow-oi", pool: "both",
    markets: ["crypto"],
    text: "Detect weak vs confirmed moves using open interest vs price divergence.",
    status: "candidate", baseLev: 4, stopPct: 0.03, targetPct: 0.08 },
];

const DEFAULT_LEARNED = { n: 0, expectancy_R: 0, win_rate: 0, kelly: 0, confidence: 0 };

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
  const idx = last - n;
  if (idx < 0 || !c[idx]) return 0;
  return c[last] / c[idx] - 1;
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
    q.mom > 0.01 &&
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

function sigOrb(q,strat){
 const start=q.sessionStart<1e12?q.sessionStart*1000:q.sessionStart,at=q.observedAt;
 if(!Number.isFinite(start)||at<start+1800000)return null;
 const bars=(q.intradayBars||[]).filter(b=>b.ts>=start&&b.closeTs<=start+1800000&&b.closeTs<=at);
 if(bars.length<2||bars[0].ts!==start||bars.at(-1).closeTs!==start+1800000)return null;
 const hi=Math.max(...bars.map(b=>b.h)),lo=Math.min(...bars.map(b=>b.l));
 if(q.price<=hi&&q.price>=lo)return null;
 return {side:q.price>hi?'long':'short',baseLev:strat.baseLev,stopPct:strat.stopPct,targetPct:strat.targetPct,confidence:.5,reason:'Closed first-30-minute session OHLC breakout'};
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

function sigOiDivergence(q,strat){
 const d=flowDeltas(q);if(!d||Math.abs(d.price)<.015||Math.abs(d.oi)<.03)return null;
 const side=d.price*d.oi>0?'long':'short';
 return {side,baseLev:strat.baseLev,stopPct:strat.stopPct,targetPct:strat.targetPct,confidence:.5,reason:'Matched 8-minute price/OI divergence; received-time public data'};
}
function sigOrderFlow(q,strat){
 const d=flowDeltas(q);if(!d||d.oi<.01||Math.abs(d.funding)<.0001)return null;
 return {side:d.funding>0?'short':'long',baseLev:strat.baseLev,stopPct:strat.stopPct,targetPct:strat.targetPct,confidence:.5,reason:'Hourly funding crowd proxy; matched 8-minute OI window'};
}

function sigAtrExpansion(q, strat) {
  const c = q.closes;
  if (!c || c.length < 40) return null;

  const atrNow = trueATR(q.dailyBars, 14);
  // ATR 20 bars ago: use closes up to -20
  const cOld = c.slice(0, -20);
  const atrOld = trueATR(q.dailyBars?.slice(0,-20),14);
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

  const volume=volumeVWAP(q.intradayBars);if(!volume)return null;
  const vwap=volume.value,sigmaVwap=volume.sd;if(sigmaVwap===0)return null;

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

// ── Generic z-score spread calculator for any two assets ──
function calcSpreadZScore(closesA, closesB, lookback = 50) {
  if (!closesA || !closesB || closesA.length < lookback || closesB.length < lookback) return null;
  const a = closesA.slice(-lookback);
  const b = closesB.slice(-lookback);
  const spread = [];
  for (let i = 0; i < lookback; i++) spread.push(Math.log(a[i]) - Math.log(b[i]));
  const current = spread[spread.length - 1];
  const avg = spread.reduce((s, v) => s + v, 0) / lookback;
  const v = spread.reduce((s, x) => s + (x - avg) ** 2, 0) / lookback;
  const sd = Math.sqrt(v);
  return sd === 0 ? 0 : (current - avg) / sd;
}

// ── Pairs definitions: [symbolA, symbolB, pairLabel] ──
const PAIRS = [
  ["BTC-USD", "ETH-USD", "BTC/ETH"],
  ["SOL-USD", "ETH-USD", "SOL/ETH"],
  ["BTC-USD", "SOL-USD", "BTC/SOL"],
];

function sigPairsTrade(q, strat, eq) {
  if (q.market !== "crypto") return null;

  // Find the first pair where this symbol is the base (symbolA)
  for (const [symA, symB, label] of PAIRS) {
    if (q.symbol !== symA) continue;
    const otherQ = eq[symB];
    if (!otherQ || !otherQ.closes) continue;

    const aligned = alignPair(q.dailyBars, otherQ.dailyBars, 50);
    if (!aligned.length) continue;
    const zScore = calcSpreadZScore(aligned.map(p => p[0].c), aligned.map(p => p[1].c), 50);
    if (zScore === null) continue;

    // Dynamic confidence: |z| / 3.0 (lower divisor = more confident at moderate z)
    const dynamicConfidence = Math.min(1.0, Math.abs(zScore) / 3.0);

    // RSI confirmation: only enter if RSI supports the direction
    const r = q.closes.length >= 14 ? rsi(q.closes, 14) : 50;

    // Entry threshold: 1.5 (was 2.0 — too conservative)
    if (zScore < -1.5 && r < 40) {
      return {
        side: "long", hedgeSymbol:symB, baseLev: strat.baseLev,
        stopPct: strat.stopPct, targetPct: strat.targetPct,
        confidence: dynamicConfidence,
        reason: `PairsTrade: ${symA} undervalued vs ${symB} (z=${zScore.toFixed(2)}, RSI=${r.toFixed(0)})`,
      };
    }
    if (zScore > 1.5 && r > 60) {
      return {
        side: "short", hedgeSymbol:symB, baseLev: strat.baseLev,
        stopPct: strat.stopPct, targetPct: strat.targetPct,
        confidence: dynamicConfidence,
        reason: `PairsTrade: ${symA} overvalued vs ${symB} (z=${zScore.toFixed(2)}, RSI=${r.toFixed(0)})`,
      };
    }
  }
  return null;
}

// Strategy ID → signal function dispatch
export const SIGNAL_FN = {
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
  pairs_trade: sigPairsTrade,
};

// ── Exit logic ─────────────────────────────────────────────────────────────

/**
 * Check if an open position should exit based on its strategy rules.
 * Returns { exit: true, reason } or null.
 */
export function strategyExit(pos, q, eq, regime) {
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

  if(stratId==='oi_diverge'){const d=flowDeltas(q);if(d&&d.oi>.02&&(pos.side==='long'?d.price<-.01:d.price>.01))return {exit:true,reason:'Opposite matched-horizon OI move'};}

  // ── atr_expand: ATR-based stop ──
  if (stratId === "atr_expand" && c.length >= 15) {
    const a = trueATR(q.dailyBars,14);
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
    const volume=volumeVWAP(q.intradayBars);if(!volume)return null;
    const vwap=volume.value,sigmaVwap=volume.sd;
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

  // ── pairs_trade: exit when z-score reverts to 0 (mean reversion) ──
  if (stratId === "pairs_trade" && q.market === "crypto" && q.symbol === "BTC-USD" && eq) {
    const ethQ = eq["ETH-USD"];
    if (ethQ && ethQ.closes && ethQ.closes.length >= 50 && c.length >= 50) {
      const lookback = 50;
      const btcC = c.slice(-lookback);
      const ethC = ethQ.closes.slice(-lookback);
      
      const spread = [];
      for (let i = 0; i < lookback; i++) {
        spread.push(Math.log(btcC[i]) - Math.log(ethC[i]));
      }
      
      const currentSpread = spread[spread.length - 1];
      const meanSpread = spread.reduce((a, b) => a + b, 0) / lookback;
      const variance = spread.reduce((s, v) => s + (v - meanSpread) ** 2, 0) / lookback;
      const stdev = Math.sqrt(variance);
      const zScore = stdev === 0 ? 0 : (currentSpread - meanSpread) / stdev;
      
      // If we are LONG BTC vs ETH, we entered when zScore < -2.0. We exit when it crosses 0 (or goes above it).
      if (pos.side === "long" && zScore >= 0) {
        return { exit: true, reason: `PairsTrade exit long: z-score reverted to ${zScore.toFixed(2)} (>= 0)` };
      }
      // If we are SHORT BTC vs ETH, we entered when zScore > 2.0. We exit when it crosses 0 (or goes below it).
      if (pos.side === "short" && zScore <= 0) {
        return { exit: true, reason: `PairsTrade exit short: z-score reverted to ${zScore.toFixed(2)} (<= 0)` };
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
// Every symbol/strategy receives a reason; shadow evaluation is independent of capital.
export function evaluateCandidates(state,eq,cfg,{strategies=state.strategies||SEED_STRATEGIES,now:at=Date.now()}={}) {
  const rows=[],dataCostHash=costFingerprint(cfg);
  for(const item of cfg.watchlist)for(const strat of strategies) {
    const q=eq[item.symbol],row={ts:at,symbol:item.symbol,strategy_id:strat.id,pool:strat.pool,market:item.market,stage:'evaluated',reason:'no_signal',signal:null};
    if(strat.status==='retired')row.reason='retired';
    else if(!strat.markets.includes(item.market))row.reason='unsupported_market';
    else if(!cfg.v2.leverage?.[item.market]?.enabled)row.reason='market_disabled';
    else if(!q||!quoteUsable(q,at,cfg.v2.data?.maxQuoteAgeMs??30000))row.reason='missing_or_stale_quote';
    else if(item.market!=='crypto'&&q.marketState!=='REGULAR')row.reason='session_closed';
    else if(!q.closes?.length)row.reason='history_missing';
    else if(['tsmom','donchian','mom_trend','rsi2dip','adaptive_regime'].includes(strat.id)&&q.closes.length<200)row.reason='daily_warmup_missing';
    else if(strat.id==='vwap_revert'&&!volumeVWAP(q.intradayBars))row.reason='volume_bars_missing';
    else if(['orderflow','oi_diverge'].includes(strat.id)&&!q.flow)row.reason='flow_history_missing';
    else if(strat.id==='orb'&&!q.sessionStart)row.reason='session_open_missing';
    else {try {row.signal=SIGNAL_FN[strat.id]?.({...q,symbol:item.symbol,market:item.market,observedAt:at},strat,eq)||null;row.reason=row.signal?'raw_signal':'no_signal';}catch{row.reason='signal_error';}}
    if(row.signal){row.side=row.signal.side;row.rawConfidence=row.signal.confidence;row.regime=observedRegime(q);row.costHash=dataCostHash;row.strategyHash=strategyFingerprint(strat);row.features=candidateFeatures(q,state.world,item.symbol,at);}
    rows.push(row);
  }
  return rows;
}
export function recordDecision(state,row) {
  state.decisionCounters||={};const c=state.decisionCounters[row.strategy_id]||={evaluated:0,raw:0,vetoed:0,selected:0,filled:0};
  if(row.stage==='evaluated'){c.evaluated++;if(row.signal)c.raw++;}
  if(row.stage==='vetoed')c.vetoed++;
  if(row.stage==='selected')c.selected++;
  if(row.stage==='filled')c.filled++;
  c.lastAt=row.ts;c.lastReason=row.reason;
  const {signal,...trace}=row;state.decisionTraces=[...(state.decisionTraces||[]),trace].slice(-500);
}
export function runStrategies(state,eq,cfg,context={}) {
  const at=context.now??Date.now(),strategies=context.strategies||state.strategies||SEED_STRATEGIES,orders=[];
  for(const [symbol,pos] of Object.entries(state.positions)){
    const q=eq[symbol];if(!q?.closes?.length)continue;
    const exit=strategyExit(pos,q,eq,state.regime);if(exit)orders.push({op:'close',symbol,reason:exit.reason});
  }
  const analyst=expiringContext(context.analyst||state.analyst,at);state.analyst=analyst;
  const rows=evaluateCandidates(state,eq,cfg,{strategies,now:at});
  queueShadowCandidates(state,rows,eq,cfg,at);
  for(const row of rows){
    recordDecision(state,row);if(!row.signal)continue;
    let reason=null;
    if(row.strategy_id==='pairs_trade')reason='paired_execution_research_only';
    else if(state.positions[row.symbol])reason='symbol_occupied';
    else if((state.lastClosed?.[row.symbol]||0)+120000>at)reason='reentry_cooldown';
    const model=(context.models||state.calibrationModels||[]).find(m=>m.scope===scopeKey(row));
    row.calibration=calibratedDecision(model,row,cfg,at);
    if(!reason&&!row.calibration.eligible)reason=row.calibration.reason;
    if(reason){row.blocked=true;recordDecision(state,{...row,stage:'vetoed',reason});}
  }
  let available=cfg.v2.strategies.maxConcurrentPositions-Object.keys(state.positions).length;
  for(const item of [...cfg.watchlist].sort((a,b)=>a.symbol.localeCompare(b.symbol))){
    const eligible=rows.filter(r=>r.symbol===item.symbol&&r.signal&&!r.blocked).sort((a,b)=>b.calibration.expectedNetRLower-a.calibration.expectedNetRLower||a.strategy_id.localeCompare(b.strategy_id));
    // Exact opposing EV ties abstain. Never break ties in favor of long or force equal sides.
    const plan=netCandidates(eligible),best=plan?.primary,tie=eligible.length&&!plan;
    if(!best||!available||tie){for(const r of eligible)recordDecision(state,{...r,stage:'vetoed',reason:tie?'opposing_ev_tie':'position_slots'});continue;}
    const chosen=plan.contributors,strat=strategies.find(s=>s.id===best.strategy_id),sig=best.signal;
    orders.push({op:'open',symbol:item.symbol,market:item.market,side:sig.side,leverage:sig.baseLev||strat.baseLev,strategy_id:strat.id,
      confirming_ids:chosen.slice(1).map(r=>r.strategy_id),setup_tag:strat.setup_tag,stopPct:sig.stopPct,targetPct:sig.targetPct,
      sizeScale:plan.sizeScale,features:best.features,strategyHash:best.strategyHash,regime:best.regime,probability:best.calibration.probability,expectedNetRLower:best.calibration.expectedNetRLower,edgeEvidence:best.calibration.evidence,modelHash:best.calibration.artifactHash,
      reason:sig.reason,trade_id:`${strat.id}:${item.symbol}:${at}`});
    for(const r of eligible)recordDecision(state,{...r,stage:chosen.includes(r)?'selected':'vetoed',reason:r===best?'primary':chosen.includes(r)?'confirmation':'lower_net_ev'});

  }
  return [...orders.filter(o=>o.op==='close'),...orders.filter(o=>o.op==='open').sort((a,b)=>b.expectedNetRLower-a.expectedNetRLower||a.symbol.localeCompare(b.symbol))];
}
