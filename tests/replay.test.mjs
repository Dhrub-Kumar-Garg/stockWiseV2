import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {replayPaper} from '../scripts/v2/backtest.mjs';
import {validateConfig} from '../scripts/v2/config.mjs';
const cfg=validateConfig(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url))));cfg.watchlist=cfg.watchlist.filter(w=>w.symbol==='BTC-USD');
const BAR=900000,DAY=86400000,start=Date.UTC(2025,0,1);
test('future candle perturbation leaves all prior causal shadow decisions/outcomes unchanged',()=>{
 const daily=Array.from({length:365},(_,i)=>[start-(365-i)*DAY,100,101,99,100,10]),bars=Array.from({length:384},(_,i)=>[start+i*BAR,100+i/100,101+i/100,99+i/100,100+i/100,10]);
 const source=[{symbol:'BTC-USD',daily,bars}],future=structuredClone(source);for(let i=288;i<384;i++)future[0].bars[i]=[bars[i][0],500,1000,1,600,100];
 const a=replayPaper(source,cfg,{from:start,to:start+384*BAR}),b=replayPaper(future,cfg,{from:start,to:start+384*BAR});
 assert.deepEqual(a.shadowLabels.filter(r=>r.closedAt<start+288*BAR),b.shadowLabels.filter(r=>r.closedAt<start+288*BAR));assert.equal(a.metrics.tradeCount,0);assert.equal(a.metrics.sharpe,null);
 assert.throws(()=>replayPaper(source,cfg,{from:start,to:start}),/chronological/);
});
