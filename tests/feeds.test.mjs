import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublic,SnapshotWorker} from '../scripts/v2/http.mjs';
import {CryptoFeed} from '../scripts/v2/ws_feed.mjs';
import {PaperExecution} from '../scripts/v2/paper_execution.mjs';
test('deadline covers hung body; oversize and HTTP failures are explicit',async()=>{
  await assert.rejects(readPublic('https://example.com',{timeoutMs:20,fetcher:async()=>({ok:true,body:new ReadableStream({start(){}})})}),/deadline/);
  await assert.rejects(readPublic('https://example.com',{maxBytes:2,fetcher:async()=>new Response('123')}),/Oversize/);
  let calls=0;assert.equal(await readPublic('https://example.com',{fetcher:async()=>++calls===1?new Response('',{status:503}):new Response('ok')}),'ok');assert.equal(calls,2);
});
test('slow single-flight provider leaves synchronous snapshots available',async()=>{
  let complete,calls=0,at=100;const worker=new SnapshotWorker(()=>{calls++;return new Promise(r=>complete=r);},{clock:()=>at});
  const pending=worker.refresh();worker.refresh();assert.equal(worker.snapshot().value,null);
  await Promise.resolve();assert.equal(calls,1);complete({a:1});await pending;
  const copy=worker.snapshot();copy.value.a=99;assert.equal(worker.snapshot().value.a,1);at=20000;assert.equal(worker.snapshot().stale,true);
});
test('raw/combined frames, first tick, stale/duplicate/malformed symbols are handled',()=>{
  let at=100000;const ticks=[],feed=new CryptoFeed(['BTC-USD'],(...x)=>ticks.push(x),{clock:()=>at});
  const frame={e:'kline',s:'BTCUSDT',E:at,k:{c:'100',x:false}};
  feed.receive(Buffer.from(JSON.stringify({stream:'btcusdt@kline_1m',data:frame})));assert.equal(ticks.length,1);
  feed.receive(Buffer.from(JSON.stringify(frame)));feed.receive(Buffer.from('{'));assert.equal(ticks.length,1);
  at+=20000;assert.deepEqual(feed.getPrices(),{});assert.equal(feed.getQuotes()['BTC-USD'].ok,false);feed.close();
});
test('paper lifecycle: latency, partial fills, duplicate retry/event, cancel, expiry and passive touch',()=>{
  const sim=new PaperExecution({latencyMs:10,participation:0.5,ttlMs:100});
  sim.submit({id:'a',type:'market',side:'buy',qty:2},0);sim.submit({id:'a',type:'market',side:'buy',qty:99},0);
  const q={id:'q',ts:11,sourceTs:11,bid:99,ask:100,bidSize:2,askSize:2};
  assert.equal(sim.observe({...q,ts:5}).length,0);q.id='next';assert.equal(sim.observe(q)[0].qty,1);assert.equal(sim.observe(q).length,0);
  assert.equal(sim.observe({...q,id:'q2',ts:12})[0].remaining,0);
  sim.submit({id:'b',type:'limit',side:'buy',qty:1,price:99},12);assert.equal(sim.observe({...q,id:'q3',ts:30}).length,0);
  sim.cancel('b');assert.equal(sim.orders.get('b').status,'canceled');
  sim.submit({id:'c',type:'market',side:'sell',qty:1},0);sim.observe({...q,id:'q4',ts:101});assert.equal(sim.orders.get('c').status,'expired');
});
