// Focused audit fixtures; unchanged source, memory-only orders, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sandbox, declarations, config, clone, ROOT} from './source_adapter.mjs';
import * as score from '../scripts/world/score.mjs';

const output = [];
async function check(name, fn) {
  const evidence = await fn();
  output.push({name, status: 'PASS', evidence});
}
const quote = {symbol: 'BTC-USD', market: 'crypto', price: 100, closes: Array(250).fill(100)};
function router({mode = 'TREND', bias = 'NEUTRAL', news = 0, signals = {}} = {}) {
  const h = sandbox(mode), cfg = clone(config), state = h.freshV2State(cfg);
  const {SEED_STRATEGIES, SIGNAL_FN, ...deps} = h;
  const dispatch = declarations('strategies', {...deps,
    readAnalystDecision: () => ({mode, direction_bias: bias, aggression: 0.4, ts: 0})},
    ['runStrategies', 'SIGNAL_FN']);
  const evaluated = [];
  for (const id of Object.keys(dispatch.SIGNAL_FN)) dispatch.SIGNAL_FN[id] = (q, s) => {
    evaluated.push(id);
    return signals[id] ? {...signals[id], stopPct: s.stopPct, targetPct: s.targetPct, baseLev: s.baseLev, reason: 'fixture'} : null;
  };
  h.writeJSON(h.V2.world, {newsMood: {mean_s: news}, fearGreedCrypto: {value: 50}});
  const orders = dispatch.runStrategies(state, {'BTC-USD': quote}, cfg).filter(o => o.op === 'open');
  return {orders, evaluated};
}
function evaluate(name, deps, exposed) {
  assert.ok(['world', 'analyst'].includes(name));
  const text = fs.readFileSync(path.join(ROOT, 'scripts/v2', name + '.mjs'), 'utf8')
    .replace(/^import\s[\s\S]*?;\s*$/gm, '').replace(/^export /gm, '');
  const blocked = () => { throw new Error('Network blocked in source fixture'); };
  const all = {fetch: blocked, ...deps};
  return new Function(...Object.keys(all), '"use strict";\n' + text + `\nreturn {${exposed.join(',')}};`)(...Object.values(all));
}

await check('TREND crypto routes 9 of 13 strategies before signal checks', () => {
  const r = router(); assert.equal(r.evaluated.length, 9);
  assert.ok(!r.evaluated.includes('rsi2dip') && !r.evaluated.includes('orb'));
  return r.evaluated;
});
await check('REVERT crypto routes 6 of 13 strategies before signal checks', () => {
  const r = router({mode: 'REVERT'}); assert.equal(r.evaluated.length, 6);
  return r.evaluated;
});
await check('SLEEP routes only pairs but confidence cap prevents a single entry', () => {
  const r = router({mode: 'SLEEP', signals: {pairs_trade: {side: 'long', confidence: 1}}});
  assert.deepEqual(r.evaluated, ['pairs_trade']); assert.equal(r.orders.length, 0);
  return {evaluated: r.evaluated, opens: 0};
});
await check('Hard SHORT analyst bias vetoes a 0.99 long signal', () => {
  const r = router({bias: 'SHORT', signals: {tsmom: {side: 'long', confidence: 0.99}}});
  assert.equal(r.orders.length, 0); return {opens: 0};
});
await check('Hard LONG analyst bias vetoes a 0.99 short signal', () => {
  const r = router({bias: 'LONG', signals: {tsmom: {side: 'short', confidence: 0.99}}});
  assert.equal(r.orders.length, 0); return {opens: 0};
});
await check('Equal confluence counts favor two weak longs over two strong shorts', () => {
  const r = router({signals: {tsmom: {side: 'long', confidence: 0.4}, donchian: {side: 'long', confidence: 0.4},
    adaptive_regime: {side: 'short', confidence: 0.99}, pairs_trade: {side: 'short', confidence: 0.99}}});
  assert.equal(r.orders[0].side, 'long');
  return {chosenSide: 'long', chosenConfidence: r.orders[0].confidence};
});
await check('0.62 single long qualifies while 0.55 single short is blocked', () => {
  const long = router({signals: {tsmom: {side: 'long', confidence: 0.62}}});
  const short = router({signals: {tsmom: {side: 'short', confidence: 0.55}}});
  assert.equal(long.orders.length, 1); assert.equal(short.orders.length, 0);
  return {longOpens: 1, shortOpens: 0};
});
await check('Positive news changes an actual router decision from no entry to long', () => {
  const signals = {vwap_revert: {side: 'long', confidence: 0.52}};
  const neutral = router({mode: 'REVERT', signals}), bullish = router({mode: 'REVERT', news: 0.5, signals});
  assert.equal(neutral.orders.length, 0); assert.equal(bullish.orders[0].side, 'long');
  return {neutralOpens: 0, bullishNewsOpens: 1, adjustedConfidence: bullish.orders[0].confidence};
});
await check('Negative news changes an actual router decision from no entry to short', () => {
  const signals = {vwap_revert: {side: 'short', confidence: 0.52}};
  const neutral = router({mode: 'REVERT', signals}), bearish = router({mode: 'REVERT', news: -0.5, signals});
  assert.equal(neutral.orders.length, 0); assert.equal(bearish.orders[0].side, 'short');
  return {neutralOpens: 0, bearishNewsOpens: 1, adjustedConfidence: bearish.orders[0].confidence};
});
await check('A year-old analyst decision is returned without expiration', () => {
  const h = sandbox(); h.writeJSON('data/analyst.v2.json', {mode: 'TREND', direction_bias: 'SHORT', ts: 0});
  const a = evaluate('analyst', {...h, join: path.posix.join, DATA: 'data'}, ['readAnalystDecision']);
  const actual = a.readAnalystDecision();
  assert.equal(actual.direction_bias, 'SHORT'); assert.equal(actual.ts, 0);
  return actual;
});
await check('Fed headlines are collected separately but omitted from analyst prompt', () => {
  const h = sandbox(), a = evaluate('analyst', {...h, join: path.posix.join, DATA: 'data'}, ['buildPrompt']);
  const prompt = a.buildPrompt({equity: 100}, {headlines: ['CRYPTO_FIXTURE'], fed: ['FED_FIXTURE']});
  assert.ok(prompt.includes('CRYPTO_FIXTURE')); assert.ok(!prompt.includes('FED_FIXTURE'));
  return {cryptoHeadlineIncluded: true, fedHeadlineIncluded: false};
});
await check('The first crypto feed can consume all 20 retained headline slots', async () => {
  const h = sandbox();
  const xml = (prefix, count) => '<rss><channel>' + Array.from({length: count}, (_, i) => `<item><title>${prefix}_${i}</title></item>`).join('') + '</channel></rss>';
  const world = evaluate('world', {...h, ...score,
    getText: async url => xml(url.includes('cointelegraph') ? 'FIRST_FEED' : 'SECOND_FEED', 30)},
    ['fetchCryptoNews']);
  const items = await world.fetchCryptoNews();
  assert.equal(items.length, 20); assert.ok(items.every(x => x.startsWith('FIRST_FEED')));
  return {retained: 20, firstFeed: 20, secondFeed: 0};
});
await check('RSS parsing discards dates and does not support Atom entries', () => {
  const h = sandbox(), world = evaluate('world', {...h, ...score}, ['parseTitles']);
  const old = world.parseTitles('<rss><item><title>Old rally fixture</title><pubDate>Sat, 01 Jan 2000 00:00:00 GMT</pubDate></item></rss>');
  const atom = world.parseTitles('<feed><entry><title>Fresh rally fixture</title></entry></feed>');
  assert.deepEqual(old, ['Old rally fixture']); assert.deepEqual(atom, []);
  return {oldHeadlineRetained: true, timestampRetained: false, atomTitles: 0};
});
await check('World cache keeps old news through a subsequent fetch failure without age marker', async () => {
  const h = sandbox(), world = evaluate('world', {...h, ...score}, ['cached']);
  await world.cached('news', 1, async () => ['OLD_FIXTURE']);
  h.setClock(Date.UTC(2026, 10, 3));
  const value = await world.cached('news', 1, async () => { throw new Error('fixture outage'); });
  assert.deepEqual(value, ['OLD_FIXTURE']); return {oldHeadlineRetained: true, ageMarker: false};
});
await check('Current headline fetch is after current strategy decisions in newer engine', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'scripts/v2/engine.mjs'), 'utf8');
  const body = engine.slice(engine.indexOf('async function cycle('));
  assert.ok(body.indexOf('runStrategies(state, eq, cfg)') < body.indexOf('await collectWorld(state, cfg)'));
  assert.ok(body.indexOf('await collectWorld(state, cfg)') < body.indexOf('await runAnalyst(state, worldDigest, cfg)'));
  return {currentCycleUsesPreviousWorldAndAnalyst: true};
});
await check('npm daemon does not refresh analyst or populate OI snapshots', () => {
  const text = fs.readFileSync(path.join(ROOT, 'scripts/daemon.mjs'), 'utf8');
  assert.doesNotMatch(text, /runAnalyst|cacheOiSnapshot/);
  return {analystRefresh: false, oiCachePopulation: false};
});

fs.writeFileSync(path.join(ROOT, 'audit/results/routing-news-checks.json'), JSON.stringify(output, null, 2) + '\n');
for (const row of output) console.log(row.status, row.name, JSON.stringify(row.evidence));
