import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {estimateEdge} from '../scripts/v2/learning.mjs';
import {sizeOrder} from '../scripts/v2/sizing.mjs';
const cfg = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
const at = Date.UTC(2026, 0, 1), observations = Array.from({length: 100}, (_, i) => ({trade_id: 't'+i, accountingVersion: 3, closedAt: at-1000+i, realized_R: i%5 ? 2 : -1}));
const state = () => ({mode: 'paper', accountingVersion: 3, equity: 100, walletBalance: 100, positions: {}, aggression: {leverageCap: 2, leverageCeiling: 2}});
const order = {op: 'open', symbol: 'BTC-USD', side: 'long', strategy_id: 'tsmom', leverage: 2, stopPct: 0.04, targetPct: 0.12};
const quotes = {'BTC-USD': {price: 100, closes: Array(30).fill(100)}};
const options = {now: at, observations, ledger: [{id: 'tsmom', status: 'candidate', learned: {kelly: 0.9}}]};
test('positive cost-net observations produce bounded quarter Kelly; unproven/negative edge zero', () => {
  const edge = estimateEdge(observations, {cutoff: at}); assert.ok(edge.eligible && edge.kelly > 0 && edge.kelly <= 0.25);
  assert.equal(estimateEdge(observations.slice(0, 10), {cutoff: at}).kelly, 0);
  assert.equal(estimateEdge(observations.map(t => ({...t, realized_R: -1})), {cutoff: at}).kelly, 0);
  assert.equal(estimateEdge(observations, {cutoff: at, fraction: 0}).kelly, 0);
});
test('future, duplicate, legacy and nonfinite outcomes cannot inflate evidence', () => {
  const base = estimateEdge(observations, {cutoff: at});
  const invalid = [...observations, ...observations, {trade_id: 'future', closedAt: at, accountingVersion: 3, realized_R: 100}, {trade_id: 'legacy', closedAt: at-1, accountingVersion: 2, realized_R: 100}, {trade_id: 'nan', closedAt: at-1, accountingVersion: 3, realized_R: NaN}];
  assert.deepEqual(estimateEdge(invalid, {cutoff: at}), base);
});
test('array/nested ledger is read correctly without any positive-risk fallback', () => {
  const good = sizeOrder(state(), order, quotes, cfg, options); assert.ok(good.marginUsd > 0 && good.riskBudgetUsd <= 0.5+1e-9);
  assert.equal(sizeOrder(state(), order, quotes, cfg, {...options, observations: []}).marginUsd, 0);
  assert.equal(sizeOrder(state(), order, quotes, cfg, {...options, ledger: []}).marginUsd, 0);
});
test('goal chasing and explicit margin cannot exceed evidence-based risk size', () => {
  const baseline = sizeOrder(state(), order, quotes, cfg, options);
  const s = state(); s.goal = {target: 500, startEquity: 1};
  const explicit = sizeOrder(s, {...order, marginUsd: 1000}, quotes, cfg, options);
  assert.equal(explicit.marginUsd, baseline.marginUsd);
});
test('valid nested learned Kelly zero explicitly disables a proven strategy', () => {
  const ledger = [{id: 'tsmom', status: 'active', learned: {n: 100, accountingVersion: 3, asOf: at-1, kelly: 0}}];
  assert.equal(sizeOrder(state(), order, quotes, cfg, {...options, ledger}).marginUsd, 0);
});
