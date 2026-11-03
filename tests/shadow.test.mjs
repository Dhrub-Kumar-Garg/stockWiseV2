import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPaperState,paperTick} from '../scripts/v2/runtime.mjs';
import {queueShadowCandidates,updateShadowBooks,netCandidates} from '../scripts/v2/shadow.mjs';
import {createFlowCollector,flowDeltas} from '../scripts/v2/flow.mjs';
import {volumeVWAP,trueATR} from '../scripts/v2/features.mjs';
import {rsi} from '../scripts/lib.mjs';
import {validateConfig} from '../scripts/v2/config.mjs';
const cfg=validateConfig(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url))));
const at=Date.UTC(2026,0,1),quote=(ts,price=100)=>({'BTC-USD':{price,ok:true,currency:'USD',market:'crypto',sourceTs:ts,receivedAt:ts,dailyBars:[{closeTs:at-1}],closes:Array(250).fill(100)}});
const row=id=>({strategy_id:id,strategyHash:'fixture',symbol:'BTC-USD',side:'long',regime:'unknown',features:[0,0,0,0,0],reason:'raw_signal',signal:{side:'long',stopPct:.01,targetPct:.02}});
test('independent books fill next observation, costs settle, and portfolio cash is unchanged',()=>{
 const state=createPaperState(cfg,at),q=quote(at);queueShadowCandidates(state,[row('tsmom'),row('rsi2dip')],q,cfg,at);
 assert.equal(Object.keys(state.shadowBooks).length,2);updateShadowBooks(state,q,cfg,at+1);assert.ok(Object.values(state.shadowBooks).every(b=>!Object.keys(b.positions).length));
 updateShadowBooks(state,quote(at+1000),cfg,at+1000);assert.ok(Object.values(state.shadowBooks).every(b=>Object.keys(b.positions).length===1));
 const events=updateShadowBooks(state,quote(at+2000,98),cfg,at+2000);assert.equal(events.length,2);assert.ok(events.every(e=>e.label.net_pnl<0&&e.label.featuresAt<e.label.openedAt));assert.equal(state.walletBalance,100);assert.equal(state.closedTrades.length,0);
 const restarted=structuredClone(state);assert.equal(updateShadowBooks(restarted,quote(at+3000),cfg,at+3000).length,0);
});
test('same horizon cannot repeatedly reopen shadow entries and family duplication creates no capital',()=>{
 const state=createPaperState(cfg,at),q=quote(at);queueShadowCandidates(state,[row('tsmom')],q,cfg,at);state.shadowBooks['tsmom|BTC-USD'].pending=null;queueShadowCandidates(state,[row('tsmom')],q,cfg,at+1);assert.equal(state.shadowBooks['tsmom|BTC-USD'].pending,null);
 const r=(id,side,ev)=>({...row(id),side,calibration:{expectedNetRLower:ev}});
 assert.equal(netCandidates([r('tsmom','long',1),r('donchian','short',1)]),null);
 const plan=netCandidates([r('tsmom','long',2),r('donchian','long',1),r('rsi2dip','short',1)]);assert.equal(plan.side,'long');assert.ok(Math.abs(plan.sizeScale-1/3)<1e-12);
});
test('flow deltas require matched eight-minute horizons and expire after outage',async()=>{
 let ts=at,oi=100;const collector=createFlowCollector({clock:()=>ts,load:async()=>[{universe:[{name:'BTC'}]},[{openInterest:String(oi),markPx:'100',funding:'.0001'}]]});
 assert.equal((await collector()).flows['BTC-USD'],null);ts+=480000;oi=105;const snapshot=await collector();assert.ok(flowDeltas({flow:snapshot.flows['BTC-USD'],observedAt:ts}).oi>.04);
 assert.equal(flowDeltas({flow:snapshot.flows['BTC-USD'],observedAt:ts+120001}),null);
});
test('flat RSI is neutral; true range includes intrabar range and VWAP uses volume',()=>{
 assert.equal(rsi(Array(20).fill(100)),50);const bars=Array.from({length:31},(_,i)=>({h:i===30?200:100,l:i===30?200:100,c:i===30?200:100,v:i===30?1000:1}));
 assert.ok(volumeVWAP(bars).value>190);assert.ok(trueATR([...bars.slice(0,30),{h:110,l:90,c:100}],14)>1);assert.equal(volumeVWAP(bars.map(b=>({...b,v:0}))),null);
});
