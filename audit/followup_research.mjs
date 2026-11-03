// Additional-period routing ablations. Research only; no runtime writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {sandbox, config, clone, declarations, ROOT} from './source_adapter.mjs';
import {statistics} from './backtest.mjs';

const BAR = 900_000, DAY = 86_400_000, start = Date.UTC(2026, 0, 1);
const input = path.join(ROOT, 'audit/data'), output = path.join(ROOT, 'audit/results');
const manifest = JSON.parse(fs.readFileSync(path.join(input, 'followup_manifest.json')));
const data = {}, daily = {}, dailyCache = new Map();
for (const item of manifest.files) {
  const payload = fs.readFileSync(path.join(input, item.file));
  assert.equal(crypto.createHash('sha256').update(payload).digest('hex'), item.sha256);
  const symbol = item.file.split('_')[0], key = symbol + '-USD';
  data[key] = JSON.parse(payload);
  assert.equal(data[key].length, 26208);
  for (let i = 0; i < data[key].length; i++) assert.equal(data[key][i][0], start + i * BAR);
  const previous = JSON.parse(fs.readFileSync(path.join(input, symbol + '_15m.json')));
  daily[key] = previous.filter(b => b[0] >= Date.UTC(2025, 0, 1) && b[0] % DAY === DAY - BAR).map(b => b[4]);
  assert.equal(daily[key].length, 365);
  for (let i = 95; i < data[key].length; i += 96) daily[key].push(data[key][i][4]);
}
const harness = fs.readFileSync(path.join(ROOT, 'audit/backtest.mjs'), 'utf8');
const original = JSON.parse(fs.readFileSync(path.join(output, 'backtest.json')));
const harnessLf = harness.replace(/\r\n/g, '\n');
assert.ok([harness, harnessLf, harnessLf.replace(/\n/g, '\r\n')].some(text =>
  crypto.createHash('sha256').update(text).digest('hex') === original.sourceHashes['audit/backtest.mjs']));
const quoteBody = harness.slice(harness.indexOf('function quotes('), harness.indexOf('export function statistics'));
const quotes = new Function('data', 'daily', 'dailyCache', quoteBody + '\nreturn quotes;')(data, daily, dailyCache);
const simBody = harness.slice(harness.indexOf('export function simulate('), harness.indexOf('\nfunction aggregate(')).replace('export ', '');
const variants = ['baseline', 'symmetric_confidence', 'all_pools', 'symmetric_all_pools'];
const folds = [['2026Q1_partial', '2026-01-06', '2026-04-01'],
  ['2026Q2', '2026-04-01', '2026-07-01'], ['2026Q3', '2026-07-01', '2026-10-01']];
const index = date => (Date.parse(date) - start) / BAR;

function makeSimulator(variant, stress) {
  const adapted = mode => {
    const h = sandbox(mode);
    if (variant.includes('all_pool')) for (const seed of h.SEED_STRATEGIES) seed.pool = 'both';
    if (variant.startsWith('symmetric')) {
      const values = {tsmom: 0.62, donchian: 0.6, rsi2dip: 0.6, orb: 0.55, atr_expand: 0.58, vol_expand: 0.58};
      for (const [id, fn] of Object.entries(h.SIGNAL_FN)) h.SIGNAL_FN[id] = (q, strat, eq) => {
        const signal = fn(q, strat, eq);
        if (!signal || signal.side !== 'short') return signal;
        if (id === 'adaptive_regime') return {...signal, confidence: signal.reason.includes('trend-short') ? 0.58 : 0.55};
        return values[id] == null ? signal : {...signal, confidence: values[id]};
      };
    }
    return h;
  };
  return new Function('sandbox', 'config', 'clone', 'declarations', 'data', 'quotes', 'start', 'BAR', 'DAY',
    'stress', 'heavySignals', 'assert', 'statistics', simBody + '\nreturn simulate;')(
    adapted, config, clone, declarations, data, quotes, start, BAR, DAY, stress, new Map(), assert, statistics);
}
function aggregate(runs) {
  const curve = [100], trades = [], returns = [];
  for (const run of runs) {
    const scale = curve.at(-1) / 100;
    curve.push(...run.curve.slice(1).map(x => x * scale));
    trades.push(...run.trades); returns.push(...run.dailyReturns);
  }
  return statistics(trades, curve, returns);
}
function coverage(trades) {
  const result = {};
  for (const t of trades) {
    result[t.id] ||= {long: 0, short: 0, netUsd: 0};
    result[t.id][t.side]++; result[t.id].netUsd += t.net;
  }
  return result;
}
const results = {};
for (const stress of [false, true]) {
  const scenario = stress ? 'stress' : 'base';
  results[scenario] = {};
  for (const mode of ['TREND', 'REVERT']) {
    results[scenario][mode] = {};
    for (const variant of variants) {
      const simulate = makeSimulator(variant, stress), runs = [], quarter = [];
      for (const [name, from, to] of folds) {
        const run = simulate(index(from), index(to), mode);
        runs.push(run);
        quarter.push({name, from, to, metrics: run.metrics, participation: coverage(run.trades)});
        console.log(scenario, mode, variant, name, JSON.stringify(run.metrics));
      }
      results[scenario][mode][variant] = {aggregate: aggregate(runs), folds: quarter,
        participation: coverage(runs.flatMap(r => r.trades))};
      fs.writeFileSync(path.join(output, `followup-${scenario}-${mode}-${variant}-trades.json`),
        JSON.stringify(runs.flatMap((r, i) => r.trades.map(t => ({...t, fold: folds[i][0]})))));
    }
  }
}
for (const mode of ['TREND', 'REVERT']) {
  const baseline = results.base[mode].baseline.aggregate;
  for (const variant of variants.slice(1)) {
    const item = results.base[mode][variant], m = item.aggregate;
    item.profitScreenPassed = m.tradeCount >= 30 && m.sharpe > baseline.sharpe &&
      m.returnPct > baseline.returnPct && m.profitFactor > 1 && m.profitFactor >= baseline.profitFactor &&
      m.expectancyUsd > 0 && m.maxDrawdown <= baseline.maxDrawdown &&
      item.folds.filter(f => f.metrics.expectancyUsd > 0).length >= 2 &&
      results.stress[mode][variant].aggregate.expectancyUsd > 0;
  }
}
const sources = ['audit/followup_research.mjs', 'audit/FOLLOWUP_EXPERIMENT_PLAN.md', 'audit/backtest.mjs',
  'audit/source_adapter.mjs', 'scripts/v2/strategies.mjs'];
const report = {kind: 'ADDITIONAL HISTORICAL PERIOD; CONDITIONAL ROUTING ABLATIONS, NOT LIVE OR SUB-MINUTE PERFORMANCE',
  sourceCommit: original.sourceCommit, manifest, folds,
  sourceHashes: Object.fromEntries(sources.map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex')])),
  results};
fs.writeFileSync(path.join(output, 'followup-research.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Saved audit/results/followup-research.json');
