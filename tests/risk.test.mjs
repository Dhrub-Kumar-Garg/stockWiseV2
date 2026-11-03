import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRisk, canOpen, operatorPause, acknowledgeDrawdownReset} from '../scripts/v2/risk.mjs';
import {nextEpisode} from '../scripts/v2/episode.mjs';
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
const at = Date.UTC(2026, 0, 1);
const fixture = () => ({mode: 'paper', equity: 100, walletBalance: 100, peakEquity: 100, positions: {}, riskState: 'normal', lifetime: {initialCapital: 100, episodes: 1}, goal: {target: 500}, episodeNum: 1});
test('manual pause survives restart, resume clears only operator pause', () => {
  const s = fixture(); evaluateRisk(s, cfg, at); operatorPause(s);
  const restored = structuredClone(s); assert.equal(canOpen(restored, cfg, at+1), false);
  operatorPause(restored, false); assert.equal(canOpen(restored, cfg, at+2), true);
});
test('daily loss is UTC latched even if equity recovers; next day unlocks daily only', () => {
  const s = fixture(); evaluateRisk(s, cfg, at); s.equity = 97;
  assert.equal(evaluateRisk(s, cfg, at+1000).flatten, true);
  s.equity = 100; assert.equal(canOpen(s, cfg, at+2000), false);
  assert.equal(canOpen(s, cfg, at+86400000), true);
});
test('drawdown lock survives recovery, UTC day, episode and operator resume', () => {
  const s = fixture(); evaluateRisk(s, cfg, at); s.equity = 89; evaluateRisk(s, cfg, at+1);
  s.equity = 110; operatorPause(s, false); nextEpisode(s, cfg);
  assert.equal(canOpen(s, cfg, at+86400000), false);
  acknowledgeDrawdownReset(s, 'ACKNOWLEDGE_PAPER_RISK_RESET', at+86400001);
  assert.equal(canOpen(s, cfg, at+86400002), true);
});
test('blowup reset never replenishes money or forgets locks', () => {
  const s = fixture(); evaluateRisk(s, cfg, at); s.equity = 0; s.blownUp = true; evaluateRisk(s, cfg, at+1);
  nextEpisode(s, cfg); assert.equal(s.walletBalance, 0); assert.equal(canOpen(s, cfg, at+86400000), false);
  assert.throws(() => acknowledgeDrawdownReset(s, 'ACKNOWLEDGE_PAPER_RISK_RESET'));
});
test('invalid equity fails closed, including pending-open guard', () => {
  const s = fixture(); s.equity = NaN; assert.equal(canOpen(s, cfg, at), false);
  assert.ok(s.risk.reasons.includes('dataError'));
});
test('exact configured loss boundaries trigger, without floating-point slippage', () => {
  for (const equity of [98, 90]) { const s = fixture(); evaluateRisk(s, cfg, at); s.equity = equity;
    assert.equal(canOpen(s, cfg, at+1), false); }
});

test('unpriced open exposure blocks new allocations without pretending it can flatten',()=>{
 const s={mode:'paper',equity:100,startingCapital:100,dataRiskPaused:true};
 const result=evaluateRisk(s,cfg,Date.UTC(2026,0,1));assert.equal(result.blocked,true);assert.ok(result.reasons.includes('stalePositions'));assert.equal(result.flatten,false);
 s.dataRiskPaused=false;assert.equal(evaluateRisk(s,cfg,Date.UTC(2026,0,1)+1000).blocked,false);
});
