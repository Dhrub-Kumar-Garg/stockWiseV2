#!/usr/bin/env node
// scripts/v2/init.mjs — Initialise a fresh FabInvests V2 episode
// Usage:  node scripts/v2/init.mjs          (safe — refuses if state exists)
//         node scripts/v2/init.mjs --force  (wipes and restarts)

import { V2, readJSON, writeJSON } from "./store.mjs";
import { loadConfig, ensureData, log } from "../lib.mjs";
import { freshV2State } from "./episode.mjs";
import { ensureStrategies } from "./strategies.mjs";

const force = process.argv.includes("--force");
const cfg   = loadConfig();
if (!cfg) { console.error("config.json not found."); process.exit(1); }

ensureData();

// ── Guard: existing state ──────────────────────────────────────────────────
const existing = readJSON(V2.state, null);
if (existing && !force) {
  console.log("V2 state already exists:");
  console.log(`  Episode  ${existing.episodeNum}  |  Gen ${existing.generation}`);
  console.log(`  Equity   $${existing.equity}`);
  console.log(`  Wallet   $${existing.walletBalance}`);
  console.log(`  Positions ${Object.keys(existing.positions).length}`);
  console.log(`  Risk     ${existing.riskState}  |  Regime ${existing.regime}`);
  console.log(`  Started  ${new Date(existing.startedAt).toISOString()}`);
  console.log("");
  console.log("  Use --force to wipe and restart.");
  process.exit(0);
}

// ── Fresh state ────────────────────────────────────────────────────────────
const state  = freshV2State(cfg);
writeJSON(V2.state, state);

const strats = ensureStrategies();
writeJSON(V2.pending, []);           // empty pending-order queue

const v = cfg.v2;
log("Episode 1 started.");
log(`  Starting collateral : $${state.startingCapital}`);
log(`  Leverage start      : ${v.aggression.leverageStart}x`);
log(`  Leverage ceiling    : ${v.aggression.leverageCeiling}x`);
log(`  Kelly fraction      : ${state.aggression.kellyFraction}`);
log(`  Goal                : $${state.goal.target} in ${state.goal.deadlineHours}h`);
log(`  Strategies          : ${strats.length} (${strats.map((s) => s.id).join(", ")})`);
