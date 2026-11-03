import test from 'node:test';
import assert from 'node:assert/strict';
import {closedBars, quoteUsable, toUsd, alignPair, parseYahooBars} from '../scripts/v2/market_data.mjs';
const bar = ts => ({ts, closeTs: ts+1000, o: 100, h: 102, l: 99, c: 101});
test('forming candles excluded; future prices cannot alter completed features', () => {
  const bars = [bar(0), bar(1000), bar(2000)];
  assert.equal(closedBars(bars, {asOf: 2000, intervalMs: 1000}).length, 2);
  bars[2] = {...bars[2], o: 1000, h: 1002, l: 999, c: 1001};
  assert.deepEqual(closedBars(bars, {asOf: 2000, intervalMs: 1000}), [bar(0),bar(1000)]);
});
test('gaps/duplicates/null OHLC fail closed rather than compressing history', () => {
  for (const bars of [[bar(0),bar(2000)], [bar(0),bar(0)], [{...bar(0), c: null}]]) assert.throws(() => closedBars(bars,{asOf: 5000, intervalMs: 1000}));
});
test('quote timestamps must be fresh, positive and not future', () => {
  const q = {ok: true, price: 100, sourceTs: 1000, receivedAt: 1000};
  assert.equal(quoteUsable(q,2000), true); assert.equal(quoteUsable(q,40000),false);
  assert.equal(quoteUsable({...q, stale:true},2000),false); assert.equal(quoteUsable({...q, sourceTs:5000},2000),false);
});
test('INR uses explicit as-of FX; missing/stale FX blocks', () => {
  const q = {price: 8400, currency:'INR'};
  assert.equal(toUsd(q,{price:84,ts:1000},2000).price,100);
  assert.equal(toUsd(q,null,2000).ok,false); assert.equal(toUsd(q,{price:83,ts:1},86400002).ok,false);
});
test('pair alignment is by event timestamp, never last-array index', () => {
  assert.equal(alignPair([bar(0),bar(1000)],[bar(1000),bar(2000)],2).length,0);
  assert.equal(alignPair([bar(0),bar(1000)],[bar(1000),bar(2000)],1)[0][0].ts,1000);
});
test('Yahoo adjustment preserves split-consistent OHLC and rejects missing data', () => {
  const data={chart:{result:[{timestamp:[0],indicators:{quote:[{open:[200],high:[220],low:[180],close:[200],volume:[10]}],adjclose:[{adjclose:[100]}]}}]}};
  assert.equal(parseYahooBars(data,{asOf:1000,intervalMs:1000})[0].o,100);
  assert.throws(()=>parseYahooBars({}));
});
