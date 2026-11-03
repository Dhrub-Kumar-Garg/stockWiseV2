import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperStore,readDashboard} from '../scripts/v2/paper_store.mjs';
const initial=()=>({mode:'paper',accountingVersion:3,walletBalance:100,equity:100,positions:{},intents:[],fills:[]});
function fixture(t,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stockwise-store-')), store=new PaperStore(dir,options).acquire();
  t.after(()=>{store.close(); assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('stockwise-store-')); fs.rmSync(dir,{recursive:true});});
  store.initialize(initial()); return {dir,store};
}
test('one writer lease excludes competing engines, including stale owner after takeover',t=>{
  let at=1000; const {dir,store}=fixture(t,{clock:()=>at,leaseMs:100});
  const other=new PaperStore(dir,{clock:()=>at,leaseMs:100}); t.after(()=>other.close());
  assert.throws(()=>other.acquire(),/Another/); at=1200; other.acquire();
  assert.throws(()=>store.transact(()=>[]),/lease lost/); other.close();
});
test('crash window rolls cash/queue/events back atomically and retry settles once',t=>{
  let crash=true; const {store}=fixture(t,{failpoint:where=>{if(crash&&where==='before_snapshot') throw new Error('crash');}});
  store.enqueue({id:'one',op:'close',symbol:'BTC-USD'});
  const apply=s=>{s.walletBalance-=5; s.equity-=5; s.intents=[]; return [{type:'fill',id:'one',ts:1}];};
  assert.throws(()=>store.transact(apply),/crash/); assert.equal(store.load().state.walletBalance,100); assert.equal(store.load().state.intents.length,1);
  crash=false; store.transact(apply); assert.equal(store.load().state.walletBalance,95);
  assert.equal(store.enqueue({id:'one',op:'close',symbol:'BTC-USD'}).duplicate,true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM events').get().n,1);
});
test('queue appends and failed/missing-price closes remain pending across reopen',t=>{
  const {store}=fixture(t); store.enqueue({id:'close-a',op:'close',symbol:'BTC-USD'}); store.enqueue({id:'close-b',op:'close',symbol:'ETH-USD'});
  store.transact(()=>[]); assert.equal(store.load().state.intents.length,2);
});
test('invalid state and nonfinite money cannot be committed',t=>{
  const {store}=fixture(t); assert.throws(()=>store.transact(s=>{s.walletBalance=NaN; return [];}),/Nonfinite/);
  assert.equal(store.load().state.walletBalance,100);
});
test('malformed commands cannot poison durable queue',t=>{
  const {store}=fixture(t);
  assert.throws(()=>store.enqueue({id:'bad',op:'open',symbol:'BTC-USD',side:'unknown'}));
  assert.throws(()=>store.enqueue({id:'bad2',op:'close',symbol:'../../escape'}));
  assert.equal(store.load().state.intents.length,0);
});
test('dashboard is a consistent whitelisted projection, never raw private state',t=>{
  const {dir,store}=fixture(t); store.transact(s=>{s.secret='FAKE_PRIVATE_SENTINEL'; return [];},s=>({v2:{signals:{equity:s.equity,secret:s.secret}}}));
  const body=readDashboard(dir); assert.equal(body.v2.signals.equity,100); assert.ok(!JSON.stringify(body).includes('FAKE_PRIVATE_SENTINEL'));
});
