import test from 'node:test';
import assert from 'node:assert/strict';
import {SequenceBook,QueuePaper,venueQuantity} from '../scripts/v2/microstructure.mjs';
import {studyMicro,simulateMicro} from '../scripts/v2/micro_study.mjs';
const snapshot={lastUpdateId:10,bids:[['99','2']],asks:[['101','1']]};
const diff=(id,ts=100)=>({e:'depthUpdate',U:id,u:id,E:ts,b:[],a:[]});
test('depth snapshot needs first bridge, ignores duplicates and invalidates on sequence gaps',()=>{
 const b=new SequenceBook();b.snapshot(snapshot);assert.equal(b.quote(100),null);assert.equal(b.update(diff(11),100),true);assert.equal(b.quote(100).bid,99);assert.equal(b.update(diff(11),101),false);
 assert.throws(()=>b.update(diff(13),102),/gap/);assert.equal(b.quote(102),null);b.snapshot({...snapshot,lastUpdateId:20});b.update(diff(21),100);assert.equal(b.quote(2101),null);
 assert.throws(()=>b.update({...diff(22),b:[['102','1']]},101),/Crossed/);
});
test('passive price touches never fill, matching trades consume queue, partial fills cannot duplicate',()=>{
 const q=new QueuePaper({latencyMs:10,queueMultiplier:2});q.submit({id:'a',qty:2,price:99,queueAhead:1},100);
 assert.deepEqual(q.trade({a:1,m:true,p:'99',q:'100',T:105},105),[]);
 assert.deepEqual(q.trade({a:2,m:false,p:'99',q:'100',T:111},111),[]);
 assert.deepEqual(q.trade({a:3,m:true,p:'99',q:'2',T:112},112),[]);
 const trade={a:4,m:true,p:'99',q:'1',T:113};assert.equal(q.trade(trade,113)[0].qty,1);assert.deepEqual(q.trade(trade,113),[]);
 q.cancelAll();assert.deepEqual(q.trade({a:5,m:true,p:'99',q:'5',T:114},114),[]);
});
test('venue minimum and quantity increments reject undersized tickets',()=>{
 const filters=[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'100'},{filterType:'MIN_NOTIONAL',minNotional:'5'}];
 assert.equal(venueQuantity(4,100,filters),0);assert.equal(venueQuantity(10.9,100,filters),.1);assert.equal(venueQuantity(10,100,[]),0);
});
test('short executable-quote sample cannot pass profitability gate even when mechanics succeed',()=>{
 const rows=[{type:'header',startedAt:0},{type:'instrument',filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'100'},{filterType:'MIN_NOTIONAL',minNotional:'5'}]},{type:'snapshot',observedAt:1,data:snapshot}];
 for(let i=1;i<=120;i++)rows.push({type:'stream',observedAt:i*500,data:{...diff(10+i,i*500),b:[['99.99','10']],a:[['100.01','1']]}});
 rows.push({type:'footer',endedAt:61000});const report=studyMicro(rows);assert.equal(report.qualified,false);assert.equal(report.promotion,'disabled');assert.equal(report.results.length,18);
 const costly=simulateMicro(rows,{from:0,to:61000,variant:'cost_gate'});assert.equal(costly.submitted,0);assert.ok(costly.rejections>0);
});
