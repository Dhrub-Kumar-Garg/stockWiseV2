import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fitCalibration,calibratedDecision,costFingerprint,expiringContext} from '../scripts/v2/calibration.mjs';
import {validateConfig} from '../scripts/v2/config.mjs';
const cfg=validateConfig(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url)))),DAY=86400000;
const rows=Array.from({length:210},(_,i)=>({id:'t'+i,strategyHash:'synthetic-test-only',accountingVersion:3,strategy_id:'tsmom',symbol:'BTC-USD',side:'long',regime:'unknown',openedAt:i*DAY+10,featuresAt:i*DAY,closedAt:i*DAY+20,features:[i%5?1:-1,0,0,0,0],realized_R:i%5?2:-1}));
const options={trainEnd:70*DAY,calibrationEnd:140*DAY,testEnd:210*DAY,costHash:costFingerprint(cfg)};
test('test-label changes cannot fit weights; same-scope overlapping labels are rejected',()=>{
 const a=fitCalibration(rows,options),b=fitCalibration(rows.map((r,i)=>({...r,realized_R:i>=140?-r.realized_R:r.realized_R})),options);
 assert.deepEqual(a.weights,b.weights);assert.deepEqual(a.bins,b.bins);assert.equal(a.testCount,70);assert.equal(b.eligible,false);
 assert.throws(()=>fitCalibration([...rows,{...rows[0],id:'other'}],options),/Overlapping/);
});
test('calibration requires held-out positive net edge and rejects expired/tampered/cost-changed artifacts',()=>{
 const model=fitCalibration(rows,options),row={...rows[0],features:[1,0,0,0,0]},at=options.testEnd+1;
 assert.equal(model.eligible,true);assert.equal(calibratedDecision(model,row,cfg,at).eligible,true);
 assert.equal(calibratedDecision({...model,eligible:false},row,cfg,at).eligible,false);
 assert.equal(calibratedDecision(model,row,cfg,model.validUntil).eligible,false);
 const expensive=structuredClone(cfg);expensive.slippage.crypto*=2;assert.equal(calibratedDecision(model,row,expensive,at).eligible,false);
 assert.equal(calibratedDecision(model,{...row,side:'short'},cfg,at).eligible,false);
 assert.equal(calibratedDecision(model,row,cfg,model.testEnd).eligible,false);
});
test('stale/future analyst context expires without direction or aggression carry-over',()=>{
 assert.equal(expiringContext({ts:100,mode:'TREND'},100).stale,false);assert.equal(expiringContext({ts:101,mode:'TREND'},100).stale,true);
 assert.equal(expiringContext({ts:1,direction_bias:'SHORT'},2000000).direction_bias,'NEUTRAL');
});
