import test from 'node:test';
import assert from 'node:assert/strict';
import {metrics,walkForwardSplits,profitGate} from '../scripts/v2/evaluation.mjs';
test('metrics include floating drawdown, terminal P&L and undefined flat Sharpe',()=>{
  const m=metrics([{net:10},{net:-5}],[{ts:0,equity:100},{ts:86400000,equity:110},{ts:86400001,equity:80},{ts:172800000,equity:105}]);
  assert.equal(m.profitFactor,2);assert.equal(m.expectancy,2.5);assert.ok(Math.abs(m.maxDrawdown-30/110)<1e-9);
  const flat=metrics([],[{ts:0,equity:100},{ts:86400000,equity:100}]);assert.equal(flat.sharpe,null);assert.equal(profitGate(flat,m),false);
});
test('walk-forward fitting ends before test/embargo and folds do not overlap',()=>{
  const folds=walkForwardSplits({start:0,testStart:100,end:300,stepMs:50,embargoMs:5});
  assert.equal(folds.length,4);for(const f of folds) assert.ok(f.trainEnd<f.testStart);
  assert.equal(folds[0].testEnd,folds[1].testStart);
});
