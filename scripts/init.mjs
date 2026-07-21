#!/usr/bin/env node
// scripts/init.mjs — Initialize FabInvests V2
// Creates fresh state, seeds strategies, confirms everything is ready.

import { loadConfig, log, ensureData } from "./lib.mjs";
import { V2, readJSON, writeJSON } from "./v2/store.mjs";
import { freshV2State } from "./v2/episode.mjs";
import { ensureStrategies } from "./v2/strategies.mjs";
import { existsSync } from "node:fs";

const cfg = loadConfig();
if (!cfg) {
  console.error("ERROR: config.json not found in project root.");
  process.exit(1);
}

ensureData();

// Don't overwrite existing state — protect live data
if (existsSync(V2.state)) {
  const existing = readJSON(V2.state);
  log("State already exists:");
  log(`  Episode ${existing.episodeNum} | Gen ${existing.generation} | Equity $${existing.equity}`);
  log("  Delete data/state.v2.json to start fresh, or run: npm run daemon");
  process.exit(0);
}

// Create fresh state
const state = freshV2State(cfg);
writeJSON(V2.state, state);

// Seed strategies
const strats = ensureStrategies();

log("╔══════════════════════════════════════════╗");
log("║        FabInvests V2  — initialized      ║");
log("╚══════════════════════════════════════════╝");
log(`  Capital:      $${state.startingCapital}`);
log(`  Goal:         $${cfg.v2.episode.goal.target} in ${cfg.v2.episode.goal.deadlineHours}h`);
log(`  Watchlist:    ${cfg.watchlist.length} symbols across 3 markets`);
log(`  Strategies:   ${strats.length} (${strats.map((s) => s.id).join(", ")})`);
log(`  Episode:      ${state.episodeId}`);
log(`  Kelly:        ${state.aggression.kellyFraction}`);
log(`  Leverage cap: ${state.aggression.leverageCap}x → ceiling ${state.aggression.leverageCeiling}x`);
log("");
log("  Run:  npm run daemon        (continuous loop)");
log("  Or:   npm run cycle         (single cycle, then exit)");
