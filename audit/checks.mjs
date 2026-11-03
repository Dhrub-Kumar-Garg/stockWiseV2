// Deterministic reproductions against unchanged application source. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, config, clone, ROOT } from './source_adapter.mjs';

const results = [];
function check(name, fn) {
  try { results.push({name, status: 'PASS', evidence: fn()}); }
  catch (error) { results.push({name, status: 'FAIL', error: error.message}); }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);
const order = {op: 'open', symbol: 'BTC-USD', side: 'long', leverage: 3,
  marginUsd: 10, stopPct: 0.03, targetPct: 0.06, strategy_id: 'pairs_trade', trade_id: 'fixture'};
function setup() {
  const h = sandbox(), cfg = clone(config);
  cfg.slippage.crypto = 0;
  const state = h.freshV2State(cfg);
  return {h, cfg, state};
}

check('Entry fee missing from reported net P&L', () => {
  const {h, cfg, state} = setup();
  h.doOpen(state, order, {price: 100}, cfg);
  const result = h.doClose(state, 'BTC-USD', 100, 'fixture', cfg);
  near(state.walletBalance, 99.97);
  near(result.netPnl, -0.015);
  assert.notEqual(state.walletBalance - 100, result.netPnl);
  return {actualWalletPnl: state.walletBalance - 100, reportedNetPnl: result.netPnl};
});
check('Signed funding is reversed in net P&L and omitted from wallet', () => {
  const {h, cfg, state} = setup();
  h.doOpen(state, order, {price: 100}, cfg);
  const pos = state.positions['BTC-USD'];
  pos.fundingAccrued = h.P.fundingPayment(pos.notional, 0.01, 'long');
  const result = h.doClose(state, 'BTC-USD', 100, 'fixture', cfg);
  near(result.netPnl, 0.285);
  near(state.walletBalance, 99.97);
  return {signedFunding: -0.3, actualWalletPnl: state.walletBalance - 100,
    reportedNetPnl: result.netPnl, expectedAllCostNet: -0.33};
});
check('Learned Kelly changes do not change source sizing', () => {
  const {h, cfg, state} = setup();
  const eq = {'BTC-USD': {closes: Array.from({length: 30}, (_, i) => 100 + i)}};
  const raw = {...order}; delete raw.marginUsd;
  const original = h.sizeOrder(state, raw, eq, cfg).marginUsd;
  const strats = h.readJSON(h.V2.strategies);
  strats.find(s => s.id === 'pairs_trade').learned.kelly = 0;
  h.writeJSON(h.V2.strategies, strats);
  const zero = h.sizeOrder(state, raw, eq, cfg).marginUsd;
  near(original, zero);
  return {before: original, afterLearnedKellyZero: zero};
});
check('SLEEP entries are blocked indirectly by confidence threshold', () => {
  const h = sandbox('SLEEP'), cfg = clone(config), state = h.freshV2State(cfg);
  const other = Array.from({length: 250}, (_, i) => 100 + i * 0.1);
  const own = other.map((v, i) => v * (i === 249 ? 0.6 : 2));
  const eq = {'BTC-USD': {symbol: 'BTC-USD', market: 'crypto', price: own.at(-1), closes: own},
    'ETH-USD': {symbol: 'ETH-USD', market: 'crypto', price: other.at(-1), closes: other}};
  h.writeJSON(h.V2.world, {newsMood: {mean_s: 0.5}, fearGreedCrypto: {value: 20}});
  const opens = h.runStrategies(state, eq, cfg).filter(o => o.op === 'open');
  assert.equal(opens.length, 0);
  const pair = h.SIGNAL_FN.pairs_trade(eq['BTC-USD'], h.SEED_STRATEGIES.find(s => s.id === 'pairs_trade'), eq);
  assert.ok(pair);
  return {openOrders: 0, rawPairConfidence: pair.confidence,
    maximumSleepConfidence: 0.5, requiredSingleSignalConfidence: 0.6};
});
check('Stale quote passes dispatcher entry guard', () => {
  const h = sandbox(), cfg = clone(config), state = h.freshV2State(cfg);
  const closes = Array.from({length: 250}, (_, i) => 100 + i);
  const eq = {'BTC-USD': {symbol: 'BTC-USD', market: 'crypto', price: 400, closes, stale: true}};
  const orders = h.runStrategies(state, eq, cfg);
  assert.ok(orders.some(o => o.op === 'open'));
  return {openOrdersWithStaleQuote: orders.filter(o => o.op === 'open').length};
});
check('Pending opens can call doOpen while halted and leverage-disabled', () => {
  const {h, cfg, state} = setup();
  state.riskState = 'halt'; cfg.v2.leverage.crypto.enabled = false;
  h.doOpen(state, order, {price: 100, stale: true}, cfg);
  assert.ok(state.positions['BTC-USD']);
  return {positionsAfterHaltedOpen: Object.keys(state.positions).length};
});
check('Isolated liquidation can debit unrelated wallet beyond margin', () => {
  const {h, cfg, state} = setup();
  h.doOpen(state, {...order, leverage: 5}, {price: 100}, cfg);
  h.doClose(state, 'BTC-USD', 1, 'liquidation', cfg);
  assert.ok(state.walletBalance < 90);
  return {walletAfterGapLiquidation: state.walletBalance, isolatedMargin: 10};
});
check('EMA mark retains a position already through its raw-price stop', () => {
  const {h, cfg, state} = setup();
  h.doOpen(state, {...order, stopPct: 0.04}, {price: 100}, cfg);
  h.markAndManage(state, {'BTC-USD': {price: 90}}, cfg);
  assert.ok(state.positions['BTC-USD']);
  near(state.positions['BTC-USD'].emaMark, 97.5);
  return {rawPrice: 90, emaMark: 97.5, stop: 96, stillOpen: true};
});
check('Episode reset discards halt and injects fresh capital after blowup', () => {
  const {h, cfg, state} = setup();
  cfg.v2.episode.autoResetOnBlowup = false;
  state.equity = -1; state.blownUp = true; state.riskState = 'halt';
  h.nextEpisode(state, cfg);
  near(state.walletBalance, 100); assert.equal(state.riskState, 'normal');
  return {walletAfterReset: state.walletBalance, riskState: state.riskState, autoResetSetting: false};
});
check('Broken empty maintenance tier used by engine_ws throws', () => {
  const h = sandbox();
  assert.throws(() => h.P.openPosition({symbol: 'BTC-USD', market: 'crypto', side: 'long',
    entryMark: 100, margin: 10, leverage: 3, tiers: []}));
  return 'TypeError reproduced without starting WebSocket engine';
});
check('Exposure is not bounded by configured maxPositionPct', () => {
  const {h, cfg, state} = setup();
  h.doOpen(state, {...order, marginUsd: 90}, {price: 100}, cfg);
  assert.ok(state.positions['BTC-USD'].isolatedMargin / 100 > cfg.risk.maxPositionPct);
  return {marginPct: 0.9, configuredMax: cfg.risk.maxPositionPct};
});
check('Zero/invalid price is not rejected by execution builder', () => {
  const h = sandbox();
  const p = h.P.openPosition({symbol: 'BTC-USD', market: 'crypto', side: 'bogus',
    entryMark: 0, margin: 10, leverage: 3, tiers: config.v2.maintenanceTiers.crypto});
  assert.equal(p.qty, Infinity);
  return {quantityFinite: Number.isFinite(p.qty)};
});
check('R28 uses 29 daily intervals', () => {
  const h = sandbox();
  const c = [50, ...Array(29).fill(100)];
  const sig = h.SIGNAL_FN.tsmom({closes: c, price: 100}, h.SEED_STRATEGIES[0]);
  assert.ok(sig); assert.ok(sig.reason.includes('100.0%'));
  return {actual28IntervalReturn: 0, sourceSignal: sig.side};
});
check('Flat RSI returns 100 rather than neutral', () => {
  const h = sandbox(); near(h.rsi(Array(20).fill(100)), 100);
  return {rsi: 100};
});
check('API serializes full config without redaction/authentication', () => {
  const source = fs.readFileSync(path.join(ROOT, 'web/app/api/state/route.ts'), 'utf8');
  assert.match(source, /config,\s*serverTs/);
  assert.doesNotMatch(source, /authorization|authenticate|redact/i);
  return 'Static data-flow check: config.json -> v2.config -> public GET';
});
check('Telegram manual kill overwritten by drawdown assignment', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/v2/engine.mjs'), 'utf8');
  const state = {riskState: 'halt'}, dd = 0;
  // Execute the exact risk-state block from the source with deterministic dd.
  const block = source.slice(source.indexOf('  if (dd >= (cfg.risk?.ddHalt'), source.indexOf('  const endReason = episodeEndReason'));
  new Function('state', 'dd', 'cfg', block)(state, dd, config);
  assert.equal(state.riskState, 'normal');
  return {before: 'halt', after: state.riskState};
});
check('Replay metrics include marked drawdown and all completed trades', async () => {
  // Formula oracle, independent of implementation details in strategy code.
  const {statistics} = await import('./backtest.mjs');
  const metrics = statistics([{net: 10, fees: 1, funding: -1, gross: 12},
    {net: -5, fees: 1, funding: 0, gross: -4}], [100, 110, 80, 105], [0.1, -0.05]);
  near(metrics.maxDrawdown, 30 / 110); near(metrics.profitFactor, 2);
  near(metrics.expectancyUsd, 2.5); assert.equal(metrics.tradeCount, 2);
  return {maxDrawdown: metrics.maxDrawdown, profitFactor: 2};
});

// The asynchronous metric oracle is awaited explicitly below; all other checks
// are synchronous so failures cannot be hidden by Promise serialization.
for (const row of results) {
  if (row.evidence instanceof Promise) {
    try { row.evidence = await row.evidence; }
    catch (error) { row.status = 'FAIL'; row.error = error.message; delete row.evidence; }
  }
}
fs.mkdirSync(path.join(ROOT, 'audit/results'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'audit/results/checks.json'), JSON.stringify(results, null, 2) + '\n');
for (const row of results) console.log(row.status, row.name, JSON.stringify(row.evidence || row.error));
if (results.some(row => row.status !== 'PASS')) process.exitCode = 1;
