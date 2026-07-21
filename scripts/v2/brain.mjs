// scripts/v2/brain.mjs — Evolution brain (engine-side, zero AI tokens)
// FinMem + ReasoningBank inspired: score strategies, bank lessons from
// wins AND losses, weight memories by importance × recency, and only
// raise risk after real proof.

import {
  V2, readJSON, writeJSON, readJSONL, appendJSONL,
  now, round, clamp,
} from "./store.mjs";
import {
  expectancyStats, profitFactor, mean, stdev, sha256,
} from "../lib.mjs";

// ── 1. Importance map ──────────────────────────────────────────────────────

const IMPORTANCE = {
  "liquidation":    10,
  "capital-floor":  10,
  "stop-loss":       7,
  "episode-end":     6,
  "take-profit":     5,
  "trailing-stop":   4,
  "trend-flip":      3,
  "rsi2-reverted":   3,
  "manual-close":    3,
  "strategy-exit":   3,
  "default":         2,
};

// ── 2. Deflated Sharpe helpers ─────────────────────────────────────────────

/** Error function (Abramowitz & Stegun approximation). */
function erf(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Acklam inverse-normal approximation. */
function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e+01,  2.209460984245205e+02,
    -2.759285104469687e+02,  1.383577518672690e+02,
    -3.066479806614716e+01,  2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,  1.615858368580409e+02,
    -1.556989798598866e+02,  6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
     7.784695709041462e-03,  3.224671290700398e-01,
     2.445134137142996e+00,  3.754408661907416e+00,
  ];

  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/** Sample skewness. */
function skewness(a) {
  const n = a.length;
  if (n < 3) return 0;
  const m = mean(a), s = stdev(a);
  if (s === 0) return 0;
  const sum3 = a.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum3;
}

/** Sample excess kurtosis. */
function kurtosis(a) {
  const n = a.length;
  if (n < 4) return 0;
  const m = mean(a), s = stdev(a);
  if (s === 0) return 0;
  const sum4 = a.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum4 -
         (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

/**
 * Deflated Sharpe Ratio — rejects strategies that only looked good by luck.
 * Bailey & López de Prado (2014).
 */
export function deflatedSharpe(rs, nTrials) {
  const n = rs.length;
  if (n < 8) return { sr: 0, dsr: 0, sr0: 0, pass: false };
  const sd = stdev(rs);
  if (sd === 0) return { sr: 0, dsr: 0, sr0: 0, pass: false };

  const sr = mean(rs) / sd;
  const N  = Math.max(2, nTrials || 2);

  const gamma = 0.5772156649;
  const emax  = (1 - gamma) * normInv(1 - 1 / N) +
                gamma * normInv(1 - 1 / (N * Math.E));
  const varSR = 1 / (n - 1);
  const sr0   = Math.sqrt(varSR) * emax;

  const sk = skewness(rs), ku = kurtosis(rs);
  const denom = Math.sqrt(Math.max(1e-6,
    1 - sk * sr + ((ku - 1) / 4) * sr * sr));
  const dsr = normCdf(((sr - sr0) * Math.sqrt(n - 1)) / denom);

  return {
    sr:   round(sr, 3),
    dsr:  round(dsr, 3),
    sr0:  round(sr0, 3),
    pass: dsr > 0.95,
  };
}

// ── 3. Per-strategy fractional Kelly ───────────────────────────────────────

function strategyKelly(s, rs) {
  const n = rs.length;

  if (n < 5) {
    const btStats = readJSON(V2.backtestStats, {});
    const bt = btStats[s.id];
    if (bt && bt.passed === false) return 0.04;
    return 0.12;
  }

  const stats = expectancyStats(rs);
  const variance = stdev(rs) ** 2;
  // Half-Kelly
  let kelly = variance > 0
    ? 0.4 * clamp(stats.expectancyR / variance, 0, 1.5)
    : 0;

  // Blend with backtest prior (pseudo-count 15)
  const btStats = readJSON(V2.backtestStats, {});
  const bt = btStats[s.id];
  if (bt && Number.isFinite(bt.backtest_kelly)) {
    const pseudoN = 15;
    kelly = (kelly * n + bt.backtest_kelly * pseudoN) / (n + pseudoN);
  }

  // Status adjustments
  if (s.status === "probation") kelly *= 0.5;
  if (s.status === "retired")   kelly = 0.02;

  return clamp(kelly, 0.02, 0.40);
}

// ── Reflog (hash-chained audit trail) ──────────────────────────────────────

function reflog(entry) {
  const prev = readJSONL(V2.reflog, 1);
  const prevHash = prev.length ? (prev[prev.length - 1].hash || "genesis") : "genesis";
  entry.ts       = now();
  entry.prevHash = prevHash;
  entry.hash     = sha256(JSON.stringify(entry));
  appendJSONL(V2.reflog, entry);
}

// ── 4. Load closed V2 trades ───────────────────────────────────────────────

/**
 * Read journal.v2.jsonl, pair "pre" with "post" by trade_id.
 * Returns closed trades with realized stats.
 */
export function loadClosedV2(sinceTs = 0) {
  const entries = readJSONL(V2.journal, 6000);
  const preMap = new Map();
  const closed = [];

  for (const e of entries) {
    if (e.type === "pre") {
      preMap.set(e.trade_id, e);
    } else if (e.type === "post" && preMap.has(e.trade_id)) {
      const pre = preMap.get(e.trade_id);
      const tsClose = e.ts || 0;
      if (tsClose >= sinceTs) {
        closed.push({
          trade_id:     e.trade_id,
          symbol:       pre.symbol,
          market:       pre.market,
          strategy_id:  pre.strategy_id,
          setup_tag:    pre.setup_tag,
          regime:       pre.regime,
          side:         pre.side,
          exit_reason:  e.exit_reason,
          net_pnl:      e.net_pnl,
          realized_R:   e.realized_R,
          roi_on_margin: e.roi_on_margin,
          ts_close:     tsClose,
          hold_secs:    (tsClose - (pre.ts || 0)) / 1000,
        });
      }
    }
  }

  return closed;
}

// ── 5. Score strategies ────────────────────────────────────────────────────

/**
 * For every strategy: compute stats, run the DSR, apply lifecycle gates.
 * Writes strategies.json and hash-chains lifecycle changes into reflog.
 */
export function scoreStrategies() {
  const strategies = readJSON(V2.strategies, []);
  if (!strategies.length) return strategies;

  const closed  = loadClosedV2();
  const nTrials = strategies.length;
  const tNeed   = 3.0 + 0.25 * (nTrials - 1);

  for (const strat of strategies) {
    const trades = closed.filter((t) => t.strategy_id === strat.id);
    const rs = trades.map((t) => t.realized_R).filter((r) => isFinite(r));
    const stats = expectancyStats(rs);
    const dsr   = deflatedSharpe(rs, nTrials);

    // Recent window (last 30 trades)
    const recentRs    = rs.slice(-30);
    const recentStats = recentRs.length >= 5 ? expectancyStats(recentRs) : null;
    const recentPF    = recentRs.length >= 5 ? profitFactor(recentRs)    : null;

    const prevStatus = strat.status;

    // ── Lifecycle gate ──
    if (strat.status === "candidate") {
      if (
        stats.n >= 30 &&
        stats.wilsonLb > stats.breakevenWr &&
        stats.profitFactor >= 1.5 &&
        stats.sqn >= 1.5 &&
        stats.expectancyR > 0 &&
        stats.tStat > tNeed &&
        dsr.pass
      ) {
        strat.status = "active";
      }
    } else if (strat.status === "active" && recentStats) {
      if (recentPF < 1.2 || recentStats.expectancyR < 0 || recentStats.sqn < 1.0) {
        strat.status = "probation";
      }
    } else if (strat.status === "probation" && recentStats) {
      if (recentPF >= 1.5 && recentStats.expectancyR > 0) {
        strat.status = "active";
      } else if (recentPF < 1.0) {
        strat.status = "retired";
      }
    }

    // ── Kelly & confidence ──
    const kelly = strategyKelly(strat, rs);

    let confidence;
    if (strat.status === "active") {
      confidence = clamp(0.3 + dsr.dsr * 0.5, 0.3, 0.9);
    } else if (strat.status === "probation") {
      confidence = clamp((strat.learned?.confidence ?? 0.2) * 0.5, 0.05, 0.4);
    } else if (strat.status === "retired") {
      confidence = 0.05;
    } else {
      confidence = 0.2; // candidate
    }

    strat.learned = {
      n:            stats.n,
      expectancy_R: round(stats.expectancyR, 4),
      win_rate:     round(stats.winRate, 4),
      kelly:        round(kelly, 4),
      confidence:   round(confidence, 3),
    };

    // Reflog lifecycle transitions
    if (strat.status !== prevStatus) {
      reflog({
        type:        "lifecycle",
        strategy_id: strat.id,
        from:        prevStatus,
        to:          strat.status,
        stats: {
          n: stats.n, pf: round(stats.profitFactor, 2),
          sqn: round(stats.sqn, 2), dsr: dsr.dsr,
          tStat: round(stats.tStat, 2), tNeed: round(tNeed, 2),
        },
      });
    }
  }

  writeJSON(V2.strategies, strategies);
  return strategies;
}

// ── 6. ReasoningBank memory ────────────────────────────────────────────────

/** Append a memory to the bank. */
export function addMemory(entry) {
  appendJSONL(V2.memory, { ts: now(), ...entry });
}

/**
 * After an episode ends, distill the run's trades into weighted lessons.
 * Heavy blowup lessons, moderate loss lessons, lighter win lessons.
 */
export function distillEpisodeLessons(state, rec, closedThisEp) {
  if (!closedThisEp.length) {
    addMemory({
      type: "lesson", importance: 3,
      regime: state.regime,
      text: "No trades fired this episode. Consider broadening entry gates or checking data freshness.",
      episode: rec.episodeNum,
    });
    return;
  }

  // Group trades by strategy + regime
  const groups = {};
  for (const t of closedThisEp) {
    const key = `${t.strategy_id}|${t.regime || state.regime}`;
    if (!groups[key]) {
      groups[key] = {
        strategy_id: t.strategy_id,
        regime: t.regime || state.regime,
        trades: [], pnl: 0,
      };
    }
    groups[key].trades.push(t);
    groups[key].pnl += t.net_pnl || 0;
  }

  const groupList = Object.values(groups);
  groupList.sort((a, b) => a.pnl - b.pnl); // worst first

  // Blowup lesson (importance 10)
  if (rec.blownUp && groupList.length) {
    const worst = groupList[0];
    addMemory({
      type: "lesson", importance: 10,
      regime: worst.regime,
      strategy_id: worst.strategy_id,
      text: `BLOWUP: '${worst.strategy_id}' in '${worst.regime}' regime caused ` +
            `${worst.trades.length} losing trades (PnL: ${round(worst.pnl, 2)}). ` +
            `Reduce size or avoid this setup in '${worst.regime}'.`,
      episode: rec.episodeNum,
      corrective: "reduce_size_or_avoid",
    });
  }

  // Worst losing group (importance 7)
  if (groupList[0] && groupList[0].pnl < 0) {
    const worst = groupList[0];
    addMemory({
      type: "lesson", importance: 7,
      regime: worst.regime,
      strategy_id: worst.strategy_id,
      text: `Loss cluster: '${worst.strategy_id}' in '${worst.regime}' lost ` +
            `${round(worst.pnl, 2)} across ${worst.trades.length} trades.`,
      episode: rec.episodeNum,
    });
  }

  // Best winning group (importance 5)
  const best = groupList[groupList.length - 1];
  if (best && best.pnl > 0) {
    addMemory({
      type: "lesson", importance: 5,
      regime: best.regime,
      strategy_id: best.strategy_id,
      text: `Win cluster: '${best.strategy_id}' in '${best.regime}' gained ` +
            `${round(best.pnl, 2)} across ${best.trades.length} trades.`,
      episode: rec.episodeNum,
    });
  }
}

/**
 * Retrieve the most relevant lessons for the current regime.
 * Score = importance × recency (0.95^ageDays) × relevance (1 if same regime, else 0.4).
 */
export function retrieveLessons(regime, k = 4) {
  const memories = readJSONL(V2.memory, 500);
  if (!memories.length) return [];

  const nowTs = now();

  const scored = memories
    .filter((m) => m.type === "lesson")
    .map((m) => {
      const ageDays  = (nowTs - (m.ts || 0)) / (86400 * 1000);
      const recency  = Math.pow(0.95, ageDays);
      const relevance = m.regime === regime ? 1 : 0.4;
      const imp = m.importance || 2;
      return { ...m, score: imp * recency * relevance };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, k);
}

// ── 7. onEpisodeEnd ────────────────────────────────────────────────────────

/**
 * End-of-episode brain update:
 *  1. Score all strategies
 *  2. Distill lessons
 *  3. Adjust aggression based on real edge
 *  4. Bump generation
 */
export function onEpisodeEnd(state, rec, cfg) {
  // 1. Score strategies
  const strategies = scoreStrategies();

  // 2. Distill lessons from this episode's trades
  const closed = loadClosedV2(rec.startedAt);
  const closedThisEp = closed.filter((t) => t.ts_close >= rec.startedAt);
  distillEpisodeLessons(state, rec, closedThisEp);

  // 3. Measure edge
  const rs = closedThisEp.map((t) => t.realized_R).filter((r) => isFinite(r));
  const edge = rs.length ? mean(rs) : 0;

  const v2  = cfg.v2;
  const agg = state.aggression;

  // Survived well → unlock
  if (
    (rec.endReason === "goal" ||
     (rec.endReason === "time" && rec.returnPct > 0)) &&
    edge > 0
  ) {
    agg.unlockedLevel = (agg.unlockedLevel || 0) + 1;
    agg.kellyFraction += 0.07 * clamp(edge, 0.2, 1.2);
  }
  // Blew up → pull back
  else if (rec.blownUp) {
    agg.unlockedLevel = Math.max(0, (agg.unlockedLevel || 0) - 1);
    agg.kellyFraction -= 0.03;
  }

  agg.kellyFraction = clamp(
    agg.kellyFraction, 0.05, v2.aggression.kellyFractionMax
  );
  agg.leverageCap = clamp(
    v2.aggression.leverageStart + agg.unlockedLevel * v2.aggression.earnItUnlockStep,
    v2.aggression.leverageStart,
    agg.leverageCeiling
  );

  // 4. Bump generation
  state.generation += 1;

  const genSnapshot = {
    ts: now(),
    generation: state.generation,
    episodeNum: rec.episodeNum,
    endReason: rec.endReason,
    returnPct: round(rec.returnPct, 4),
    edge: round(edge, 4),
    unlockedLevel: agg.unlockedLevel,
    kellyFraction: round(agg.kellyFraction, 4),
    leverageCap: round(agg.leverageCap, 1),
    note: rec.blownUp
      ? `Blowup in ep${rec.episodeNum}. Pulled back aggression.`
      : rec.endReason === "goal"
        ? `Goal hit in ep${rec.episodeNum}! Edge=${round(edge, 3)}. Unlocking more.`
        : `Ep${rec.episodeNum} ended (${rec.endReason}). Edge=${round(edge, 3)}.`,
  };

  appendJSONL(V2.generations, genSnapshot);

  reflog({
    type: "episode_end",
    generation: state.generation,
    episodeNum: rec.episodeNum,
    endReason: rec.endReason,
    edge: round(edge, 4),
    unlockedLevel: agg.unlockedLevel,
    kellyFraction: round(agg.kellyFraction, 4),
    leverageCap: round(agg.leverageCap, 1),
  });

  return { strategies, edge, genSnapshot };
}

// ── 8. evolveTick (live-cadence earn-it dial) ──────────────────────────────

/**
 * Micro-adjust aggression between episodes based on live performance.
 * Needs 4+ closed trades. Returns true if a change was made.
 */
export function evolveTick(state, cfg) {
  const closed = loadClosedV2(state.startedAt);
  if (closed.length < 4) return false;

  const recentRs = closed.slice(-25).map((t) => t.realized_R).filter((r) => isFinite(r));
  if (!recentRs.length) return false;

  const edge = mean(recentRs);
  const v2   = cfg.v2;
  const agg  = state.aggression;
  const dd   = state.peakEquity > 0
    ? (state.peakEquity - state.equity) / state.peakEquity
    : 0;
  const prevLevel = agg.unlockedLevel;

  if (edge > 0.05 && state.equity > state.startingCapital && dd < 0.15) {
    agg.unlockedLevel = (agg.unlockedLevel || 0) + 0.5;
    agg.kellyFraction += 0.02;
  } else if (edge < -0.05 || dd >= 0.18) {
    agg.unlockedLevel = Math.max(0, (agg.unlockedLevel || 0) - 0.5);
    agg.kellyFraction -= 0.015;
  } else {
    return false; // no change
  }

  agg.kellyFraction = clamp(
    agg.kellyFraction, 0.05, v2.aggression.kellyFractionMax
  );
  agg.leverageCap = clamp(
    v2.aggression.leverageStart + agg.unlockedLevel * v2.aggression.earnItUnlockStep,
    v2.aggression.leverageStart,
    agg.leverageCeiling
  );

  if (agg.unlockedLevel !== prevLevel) {
    reflog({
      type: "evolve_tick",
      edge: round(edge, 4),
      drawdown: round(dd, 4),
      unlockedLevel: agg.unlockedLevel,
      kellyFraction: round(agg.kellyFraction, 4),
      leverageCap: round(agg.leverageCap, 1),
    });
  }

  return true;
}

// ── 9. Dashboard digest & helpers ──────────────────────────────────────────

/** Compact brain digest for the dashboard API. */
export function buildBrainV2(state, regimeStr) {
  const strategies  = readJSON(V2.strategies, []);
  const activeStrats = strategies.filter((s) => s.status === "active");
  const avoidList    = strategies.filter((s) => s.status === "retired").map((s) => s.id);
  const lessons      = retrieveLessons(regimeStr);
  const recentGens   = readJSONL(V2.generations, 10);

  return {
    generation:        state.generation,
    episode:           state.episodeNum,
    regime:            regimeStr || state.regime,
    aggression:        { ...state.aggression },
    importance:        state.importanceAccum || 0,
    lifetime:          { ...state.lifetime },
    strategies,
    activeCount:       activeStrats.length,
    avoid:             avoidList,
    lessons,
    recentGenerations: recentGens,
  };
}

/** Accrue importance after a position close. */
export function onClose(state, pos, reasonTag) {
  const imp = IMPORTANCE[reasonTag] ?? IMPORTANCE["default"];
  state.importanceAccum = (state.importanceAccum || 0) + imp;
}

/** Passthrough: read the world snapshot. */
export function collectWorldV2() {
  return readJSON(V2.world, null);
}
