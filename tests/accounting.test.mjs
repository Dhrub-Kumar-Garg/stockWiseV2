import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../scripts/v2/accounting.mjs';
import * as P from '../scripts/v2/perp.mjs';
const near = (x, y) => assert.ok(Math.abs(x-y) < 1e-9, `${x} != ${y}`);
const tiers = [{floor: 0, cap: 1e9, maxLev: 5, mmr: 0.004}];
function fixture(side = 'long') {
  const state = {mode: 'paper', accountingVersion: 3, walletBalance: 100, equity: 100, positions: {}};
  const pos = P.openPosition({symbol: 'BTC-USD', market: 'crypto', side, entryMark: 100, margin: 10, leverage: 3, tiers, meta: {stopPct: 0.03, trade_id: 'fixture'}});
  A.recordEntry(state, pos, 0.0005, 1); state.positions[pos.symbol] = pos;
  return {state, pos};
}
for (const side of ['long', 'short']) test(`${side}: both fees reconcile to cash and stop-risk R`, () => {
  const {state, pos} = fixture(side), out = A.settleClose(state, pos, 100, 0.0005, 'manual', 2);
  near(out.netPnl, -0.03); near(state.walletBalance, 99.97); near(out.realizedR, -0.03/0.9); near(out.roiOnMargin, -0.003);
  assert.throws(() => A.settleClose(state, pos, 100, 0.0005, 'manual', 2), /already closed/);
});
for (const side of ['long', 'short']) for (const rate of [-0.01, 0.01]) test(`${side}: signed funding ${rate} settles once and affects marked equity`, () => {
  const {state, pos} = fixture(side), expected = -P.sideSign(side) * 30 * rate;
  near(A.settleFunding(state, pos, rate, 1000, 100), expected);
  near(A.settleFunding(state, pos, rate, 1000, 100), 0);
  near(A.equityAt(state, {'BTC-USD': 100}).equity, 99.985 + expected);
  const restored = structuredClone({state, pos});
  near(A.settleFunding(restored.state, restored.pos, rate, 1000, 100), 0);
  const out = A.settleClose(state, pos, 100, 0.0005, 'manual', 2);
  near(out.netPnl, expected - 0.03); near(state.walletBalance, 100 + out.netPnl);
});
test('isolated liquidation cannot consume unrelated free wallet', () => {
  const {state, pos} = fixture(), free = state.walletBalance;
  const out = A.settleClose(state, pos, 1, 0.0005, 'liquidation');
  near(state.walletBalance, free); near(out.netPnl, -10.015); assert.ok(out.isolationAdjustment > 0);
});
test('exit fee uses current notional; invalid state/inputs fail closed', () => {
  const {state, pos} = fixture(); const out = A.settleClose(state, pos, 110, 0.0005, 'manual');
  near(out.exitFee, 33 * 0.0005); near(state.walletBalance - 100, out.netPnl);
  assert.throws(() => A.assertPaperAccount({walletBalance: 100}), /migration/);
  assert.throws(() => A.finite(NaN, 'fixture'));
});
