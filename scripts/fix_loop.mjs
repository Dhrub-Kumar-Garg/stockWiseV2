#!/usr/bin/env node
// scripts/fix_loop.mjs — Fix the Episode 2 loop state on AWS / server
// Deduplicates episodes.jsonl, resets generations, resets strategies to baseline,
// and moves state cleanly to Episode 3.

import fs from "node:fs";
import { loadConfig, log, ensureData, now } from "./lib.mjs";
import { V2, readJSON, writeJSON, round } from "./v2/store.mjs";
import { SEED_STRATEGIES } from "./v2/strategies.mjs";

const cfg = loadConfig();
if (!cfg) {
  console.error("ERROR: config.json not found.");
  process.exit(1);
}

ensureData();

console.log("═══════════════════════════════════════════════════");
console.log("  Running StockWise V2 Loop Cleanup & Reset");
console.log("═══════════════════════════════════════════════════");

// 1. Deduplicate episodes.jsonl
if (fs.existsSync(V2.episodes)) {
  const content = fs.readFileSync(V2.episodes, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const seen = new Set();
  const kept = [];

  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (!seen.has(rec.episodeNum)) {
        seen.add(rec.episodeNum);
        kept.push(line);
      }
    } catch {
      // skip corrupted line
    }
  }

  fs.writeFileSync(V2.episodes, kept.join("\n") + (kept.length ? "\n" : ""));
  console.log(`✓ Deduplicated episodes.jsonl: kept ${kept.length} unique episodes (was ${lines.length} lines).`);
}

// 2. Clean generations.jsonl
if (fs.existsSync(V2.generations)) {
  const content = fs.readFileSync(V2.generations, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const seen = new Set();
  const kept = [];

  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      const ep = rec.episodeNum;
      if (ep && !seen.has(ep)) {
        seen.add(ep);
        kept.push(line);
      }
    } catch {}
  }

  fs.writeFileSync(V2.generations, kept.join("\n") + (kept.length ? "\n" : ""));
  console.log(`✓ Cleaned generations.jsonl: kept ${kept.length} real generation entries (was ${lines.length} lines).`);
}

// 3. Reset strategies.json so they can trade again
const strats = SEED_STRATEGIES.map((s) => ({
  ...s,
  learned: { n: 0, expectancy_R: 0, win_rate: 0, kelly: 0.12, confidence: 0.2 },
}));
writeJSON(V2.strategies, strats);
console.log(`✓ Reset ${strats.length} strategies to clean candidate baseline.`);

// 4. Advance state.v2.json to Episode 3 starting right now
const ts = now();
let oldState = readJSON(V2.state, {});

// Carry over capital from episode 2 if positive, else default startingCapital
const carryCapital = (oldState.equity && oldState.equity > 0 && !oldState.blownUp)
  ? round(oldState.equity, 2)
  : (cfg.v2?.startingCapital || 100);

const newState = {
  ...oldState,
  version: 2,
  episodeNum: 3,
  episodeId: `ep_${ts}_3`,
  startedAt: ts,
  updatedAt: ts,

  startingCapital: carryCapital,
  walletBalance: carryCapital,
  equity: carryCapital,
  peakEquity: carryCapital,
  maxDrawdownPct: 0,
  realizedPnlEpisode: 0,

  positions: {},
  riskState: "normal",
  regime: "mixed_chop",
  generation: 3,

  aggression: {
    kellyFraction: cfg.v2?.aggression?.kellyFractionStart ?? 0.10,
    leverageCap: cfg.v2?.aggression?.leverageStart ?? 5,
    leverageCeiling: cfg.v2?.aggression?.leverageCeiling ?? 12,
    unlockedLevel: 0,
  },

  goal: {
    target: cfg.v2?.episode?.goal?.target ?? 500,
    deadlineHours: cfg.v2?.episode?.goal?.deadlineHours ?? 24,
    startEquity: oldState.lifetime?.initialCapital || carryCapital,
    startedAt: ts,
  },

  blownUp: false,
};

writeJSON(V2.state, newState);
console.log(`✓ Advanced state to Episode 3 starting now with capital $${carryCapital}.`);
console.log("═══════════════════════════════════════════════════");
console.log("  All done! You can now restart your services.");
console.log("═══════════════════════════════════════════════════");
