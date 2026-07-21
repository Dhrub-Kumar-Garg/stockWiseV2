// scripts/v2/store.mjs — V2 data-file paths and tiny helpers
// Re-exports everything from lib so downstream modules only need one import.

export * from "../lib.mjs";
import { DATA } from "../lib.mjs";
import { join } from "node:path";

/** All V2 data-file paths (everything lives inside DATA). */
export const V2 = {
  state:         join(DATA, "state.v2.json"),
  signals:       join(DATA, process.env.FAB_SIGNALS || "signals.v2.json"),
  episodes:      join(DATA, "episodes.jsonl"),
  generations:   join(DATA, "generations.jsonl"),
  strategies:    join(DATA, "strategies.json"),
  memory:        join(DATA, "memory.jsonl"),
  pending:       join(DATA, "pending.v2.json"),
  backtestStats: join(DATA, "backtest_stats.json"),
  trades:        join(DATA, "trades.v2.jsonl"),
  equity:        join(DATA, "equity.v2.jsonl"),
  prices:        join(DATA, "prices.v2.json"),
  log:           join(DATA, "engine.v2.log"),
  journal:       join(DATA, "journal.v2.jsonl"),
  playbook:      join(DATA, "playbook.json"),
  reflog:        join(DATA, "reflog.v2.jsonl"),
  calib:         join(DATA, "calibration.json"),
  world:         join(DATA, "world.v2.json"),
  worldThesis:   join(DATA, "world_thesis.v2.json"),
  worldCache:    join(DATA, "world_cache_v2"),     // folder
};

/** Round to d decimal places. */
export function round(x, d = 2) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Clamp x into [lo, hi]. */
export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
