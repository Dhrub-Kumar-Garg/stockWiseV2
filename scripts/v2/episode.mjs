// scripts/v2/episode.mjs — Episode lifecycle: start → run → reset → learn
// The bot runs in rounds. Capital resets; learning never does.

import { now, iso, writeJSON, appendJSONL, V2 } from "./store.mjs";

// ── Fresh state ────────────────────────────────────────────────────────────

/**
 * Build a brand-new V2 bot state from config.
 * This is the genesis state — episode 1, generation 1, no history.
 */
export function freshV2State(cfg) {
  const v = cfg.v2;
  const capital = v.startingCapital;
  const ts = now();

  return {
    version: 2,
    episodeNum: 1,
    episodeId: `ep_${ts}_1`,
    startedAt: ts,
    updatedAt: ts,

    startingCapital: capital,
    walletBalance: capital,
    equity: capital,
    peakEquity: capital,
    maxDrawdownPct: 0,
    realizedPnlEpisode: 0,

    positions: {},
    riskState: "normal",
    regime: "mixed_chop",
    generation: 1,

    aggression: {
      kellyFraction: v.aggression.kellyFractionStart,
      leverageCap: v.aggression.leverageStart,
      leverageCeiling: v.aggression.leverageCeiling,
      unlockedLevel: 0,
    },

    goal: {
      target: v.episode.goal.target,
      deadlineHours: v.episode.goal.deadlineHours,
      startEquity: capital,
      startedAt: ts,
    },

    importanceAccum: 0,
    closesSinceDeep: 0,
    lastDeepReflectTs: 0,
    cycles: 0,
    blownUp: false,

    lifetime: {
      episodes: 1,
      totalBlowups: 0,
      bestEpisodeReturnPct: 0,
      bestEquityEver: capital,
      careerStartedAt: ts,
    },

    lastWorldDeepTs: 0,
    lastWorldRegime: "neutral",
  };
}

// ── Equity tracking ────────────────────────────────────────────────────────

/**
 * Update peak equity and drawdown tracking.
 * Returns the current drawdown fraction (0 = at peak, 0.15 = 15% below peak).
 */
export function recordEquityPeak(state) {
  if (state.equity > state.peakEquity) {
    state.peakEquity = state.equity;
  }

  const dd =
    state.peakEquity > 0
      ? (state.peakEquity - state.equity) / state.peakEquity
      : 0;

  if (dd > state.maxDrawdownPct) {
    state.maxDrawdownPct = dd;
  }

  if (state.equity > state.lifetime.bestEquityEver) {
    state.lifetime.bestEquityEver = state.equity;
  }

  return dd;
}

// ── Episode end detection ──────────────────────────────────────────────────

/**
 * Check if this episode should end.
 * Returns "blowup" | "goal" | "time" | null.
 */
export function episodeEndReason(state, cfg, nowTs = now()) {
  // Blowup: equity at or below the floor (default 0)
  if (state.equity <= cfg.v2.episode.blowupEquity) return "blowup";

  // Goal reached
  if (state.equity >= state.goal.target) return "goal";

  // Time limit
  const hoursElapsed = (nowTs - state.startedAt) / (3600 * 1000);
  if (hoursElapsed >= cfg.v2.episode.maxHoursPerEpisode) return "time";

  return null;
}

// ── Finalize ───────────────────────────────────────────────────────────────

/**
 * Close out an episode: compute stats, persist the record, update lifetime.
 * Returns the episode record.
 */
export function finalizeEpisode(state, reason, extra = {}) {
  const endedAt = now();
  const durationHours =
    (endedAt - state.startedAt) / (3600 * 1000);
  const returnPct =
    state.startingCapital > 0
      ? (state.equity - state.startingCapital) / state.startingCapital
      : 0;

  const record = {
    episodeNum: state.episodeNum,
    episodeId: state.episodeId,
    startedAt: state.startedAt,
    endedAt,
    durationHours,
    startingCapital: state.startingCapital,
    finalEquity: state.equity,
    peakEquity: state.peakEquity,
    returnPct,
    maxDrawdownPct: state.maxDrawdownPct,
    blownUp: reason === "blowup",
    endReason: reason,
    generation: state.generation,
    ...extra,
  };

  // Persist to episodes log
  appendJSONL(V2.episodes, record);

  // Update lifetime stats
  if (reason === "blowup") {
    state.lifetime.totalBlowups += 1;
  }
  if (returnPct > state.lifetime.bestEpisodeReturnPct) {
    state.lifetime.bestEpisodeReturnPct = returnPct;
  }
  state.blownUp = reason === "blowup";

  return record;
}

// ── Next episode ───────────────────────────────────────────────────────────

/**
 * Reset for the next run.
 * Capital, positions, and drawdown reset.
 * Generation, aggression, and all learning files PERSIST.
 */
export function nextEpisode(state, cfg) {
  const capital = cfg.v2.startingCapital;
  const ts = now();

  state.episodeNum += 1;
  state.episodeId = `ep_${ts}_${state.episodeNum}`;
  state.startedAt = ts;
  state.updatedAt = ts;

  state.startingCapital = capital;
  state.walletBalance = capital;
  state.equity = capital;
  state.peakEquity = capital;
  state.maxDrawdownPct = 0;
  state.realizedPnlEpisode = 0;

  state.positions = {};
  state.riskState = "normal";
  state.blownUp = false;

  state.goal = {
    target: cfg.v2.episode.goal.target,
    deadlineHours: cfg.v2.episode.goal.deadlineHours,
    startEquity: capital,
    startedAt: ts,
  };

  state.lifetime.episodes += 1;

  // generation, aggression, lifetime stats, learning files → untouched

  return state;
}

// ── Goal setter ────────────────────────────────────────────────────────────

/**
 * Replace the current goal mid-episode.
 * Uses current equity as the new starting point.
 */
export function setGoal(state, target, deadlineHours) {
  state.goal = {
    target,
    deadlineHours,
    startEquity: state.equity,
    startedAt: now(),
  };
}
