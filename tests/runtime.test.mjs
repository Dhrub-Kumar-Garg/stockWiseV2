import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateConfig} from '../scripts/v2/config.mjs';
import {createPaperState,paperTick,signalsFor} from '../scripts/v2/runtime.mjs';
const cfg=validateConfig(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url))));
const at=Date.UTC(2026,0,1), q=ts=>({'BTC-USD':{symbol:'BTC-USD',currency:'USD',price:100,ok:true,sourceTs:ts,receivedAt:ts,closes:Array(365).fill(100),market:'crypto'}});
test('all runtime execution is explicitly paper and cold evidence stays in cash',()=>{
  const s=createPaperState(cfg,at);
  const evaluate=()=>[{op:'open',symbol:'BTC-USD',side:'long',strategy_id:'tsmom',stopPct:0.04,targetPct:0.12,leverage:2}];
  paperTick(s,q(at),cfg,{at,evaluate}); assert.equal(Object.keys(s.positions).length,0);
  paperTick(s,q(at+1000),cfg,{at:at+1000,evaluate:()=>[]});
  assert.equal(s.walletBalance,100); assert.ok(s.fills.some(e=>e.type==='reject'));
  assert.throws(()=>paperTick(s,q(at),{...cfg,v2:{...cfg.v2,execution:{mode:'live'}}},{at}));
});
test('same observation cannot fill queued signal; next observation uses its executable price',()=>{
  const s=createPaperState(cfg,at); s.closedTrades=Array.from({length:100},(_,i)=>({trade_id:'t'+i,strategy_id:'tsmom',side:'long',accountingVersion:3,closedAt:at-1000+i,realized_R:i%5?2:-1}));
  const evaluate=()=>[{op:'open',symbol:'BTC-USD',side:'long',strategy_id:'tsmom',stopPct:0.04,targetPct:0.12,leverage:2}];
  paperTick(s,q(at),cfg,{at,evaluate}); paperTick(s,q(at),cfg,{at:at+1,evaluate:()=>[]}); assert.equal(Object.keys(s.positions).length,0);
  const next=q(at+1000); next['BTC-USD'].price=110; paperTick(s,next,cfg,{at:at+1000,evaluate:()=>[]});
  assert.ok(s.positions['BTC-USD'].entryPrice>110); assert.equal(s.positions['BTC-USD'].openedAt,at+1000);
});
test('public signal P&L excludes deposits and stale data is explicit',()=>{
  const s=createPaperState(cfg,at); s.cashflows.push({id:'deposit2',amount:50,ts:at+1}); s.walletBalance=150; s.equity=150;
  paperTick(s,{},cfg,{at:at+2,evaluate:()=>[]}); assert.equal(signalsFor(s,cfg).totalNetPnl,0); assert.equal(s.health.status,'waiting_data');
});
