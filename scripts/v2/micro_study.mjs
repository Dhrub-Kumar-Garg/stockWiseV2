// Frozen, long/flat spot microprice hypothesis. Retrospective research only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {SequenceBook,QueuePaper,venueQuantity} from './microstructure.mjs';
import {PaperExecution} from './paper_execution.mjs';
import {metrics} from './evaluation.mjs';
export const MICRO_PROTOCOL=Object.freeze({id:'spot-micro-v1',imbalance:0.65,notional:10,holdMs:30000,latencyMs:100,queueMultiplier:2,entryTtlMs:1000,takerFee:.0005,makerFee:.0002,slippage:.0002,safetyMargin:.0002});
export function readRecording(file){
  const buffer=fs.readFileSync(file);if(buffer.length>25002000)throw new Error('Oversize capture');
  const lines=buffer.toString('utf8').trimEnd().split('\n'),rows=lines.map(l=>JSON.parse(l)),footer=rows.at(-1);
  const hash=createHash('sha256').update(lines.slice(0,-1).join('\n')+'\n').digest('hex');
  if(rows[0]?.protocol!==MICRO_PROTOCOL.id||footer?.type!=='footer'||!footer.complete||footer.sha256!==hash)throw new Error('Incomplete or corrupt capture');
  let previous=rows[0].startedAt;for(const row of rows){if(row.observedAt!=null){if(!Number.isFinite(row.observedAt)||row.observedAt<previous)throw new Error('Nonmonotonic observation clock');previous=row.observedAt;}}
  return rows;
}
export function simulateMicro(rows,{from,to,variant='baseline',latencyMs=MICRO_PROTOCOL.latencyMs,costScale=1}={}){
  const book=new SequenceBook(),queue=new QueuePaper({latencyMs,queueMultiplier:MICRO_PROTOCOL.queueMultiplier,ttlMs:MICRO_PROTOCOL.entryTtlMs}),taker=new PaperExecution({latencyMs,ttlMs:60000,participation:.1});
  let cash=100,qty=0,phase='flat',openedAt=0,entryCash=100,entryId,filters=[],lastQuote,sequence=0,gaps=0,rejections=0,submitted=0,unresolved=false;
  const quoteHistory=[],trades=[],curve=[{ts:from,equity:100}],fills=[],buffer=[];
  function apply(fill){
    const fee=fill.qty*fill.price*(fill.liquidity==='maker'?MICRO_PROTOCOL.makerFee:MICRO_PROTOCOL.takerFee)*costScale;
    if(fill.id.startsWith('entry:')){
      if(!qty){openedAt=fill.ts;entryCash=cash;}
      cash-=fill.qty*fill.price+fee;qty+=fill.qty;phase='enter';
    }else{
      cash+=fill.qty*fill.price-fee;qty=Math.max(0,qty-fill.qty);
      if(qty<1e-12){trades.push({net_pnl:cash-entryCash,openedAt,closedAt:fill.ts});qty=0;phase='flat';}
    }
    fills.push({...fill,fee});
  }
  function observe(at,trade){
    if(at<from||at>=to)return;
    const q=book.quote(at);if(!q){queue.cancelAll();return;}lastQuote=q;quoteHistory.push({ts:at,mid:q.mid});
    queue.expire(at);
    if(trade&&variant==='maker')for(const f of queue.trade(trade,at))apply(f);
    for(const f of taker.observe(q))apply({...f,price:f.price*(f.id.startsWith('entry:')?1+MICRO_PROTOCOL.slippage*costScale:1-MICRO_PROTOCOL.slippage*costScale)});
    const entry=taker.orders.get(entryId)||queue.orders.get(entryId);
    if(phase==='enter'&&entry&&['filled','expired','canceled'].includes(entry.status))phase=qty?'held':'flat';
    if(phase==='enter'&&at-(entry?.createdAt??entry?.at??at)>=MICRO_PROTOCOL.entryTtlMs){taker.cancel(entryId);queue.cancelAll();phase=qty?'held':'flat';}
    if(phase==='held'&&at-openedAt>=MICRO_PROTOCOL.holdMs){
      taker.cancel(entryId);queue.cancelAll();taker.submit({id:'exit:'+sequence++,type:'market',side:'sell',qty},at);phase='exit';
    }
    if(phase==='flat'&&q.imbalance>=MICRO_PROTOCOL.imbalance){
      const estimatedGross=q.microprice/q.mid-1,roundTrip=(variant==='maker'?MICRO_PROTOCOL.makerFee+MICRO_PROTOCOL.takerFee:2*MICRO_PROTOCOL.takerFee)*costScale+2*MICRO_PROTOCOL.slippage*costScale;
      if(variant==='cost_gate'&&estimatedGross<=roundTrip+MICRO_PROTOCOL.safetyMargin){rejections++;}
      else {
        const size=venueQuantity(MICRO_PROTOCOL.notional,q.ask,filters);
        if(!size||size*q.ask>cash*.2){rejections++;}
        else {entryId='entry:'+sequence++;submitted++;phase='enter';
          if(variant==='maker')queue.submit({id:entryId,qty:size,price:q.bid,queueAhead:q.bidSize},at);
          else taker.submit({id:entryId,type:'market',side:'buy',qty:size},at);
        }
      }
    }
    curve.push({ts:at,equity:cash+qty*q.bid});
  }
  for(const row of rows){
    if(row.type==='instrument')filters=row.filters;
    if(row.type==='snapshot'){
      book.snapshot(row.data);
      for(const old of buffer.splice(0))if(old.data.e==='depthUpdate'){try{book.update(old.data,row.observedAt);}catch{gaps++;}}
      observe(row.observedAt);
    }
    if(row.type!=='stream')continue;
    const m=row.data,at=row.observedAt;
    if(!Number.isFinite(at)||at>=to)break;
    if(!book.ready){if(buffer.length<2000)buffer.push(row);else gaps++;continue;}
    if(m.e==='depthUpdate'){try{book.update(m,at);}catch{gaps++;queue.cancelAll();}}
    observe(at,m.e==='aggTrade'?m:null);
  }
  // Explicit terminal taker liquidation assumption, flagged when no fresh quote exists.
  taker.cancel(entryId);queue.cancelAll();
  if(qty){
    if(lastQuote&&to-lastQuote.ts<=2000)apply({id:'terminal',qty,price:lastQuote.bid*(1-MICRO_PROTOCOL.slippage*costScale),ts:to,liquidity:'taker'});
    else unresolved=true;
  }
  curve.push({ts:to,equity:cash+qty*(lastQuote?.bid||0)});
  const markouts=fills.filter(f=>f.id.startsWith('entry:')).map(f=>{const future=quoteHistory.find(r=>r.ts>=f.ts+1000);return future?{ts:f.ts,latencyMs,oneSecondMidMarkoutBp:(future.mid/f.price-1)*10000}:null;}).filter(Boolean);
  const daily=new Map();for(const t of trades){const day=Math.floor(t.closedAt/86400000);daily.set(day,(daily.get(day)||0)+t.net_pnl);}
  const pnls=[...daily.values()],avg=pnls.length?pnls.reduce((s,v)=>s+v,0)/pnls.length:0,sd=pnls.length>1?Math.sqrt(pnls.reduce((s,v)=>s+(v-avg)**2,0)/(pnls.length-1)):0;
  const lowerDailyNet=pnls.length>=30?avg-(1.96+Math.sqrt(2*Math.log(3)))*sd/Math.sqrt(pnls.length):null;
  return {metrics:metrics(trades,curve),trades,lowerDailyNet,submitted,fillEvents:fills.length,filledOrders:new Set(fills.map(f=>f.id)).size,fillRatio:submitted?new Set(fills.filter(f=>f.id.startsWith('entry:')).map(f=>f.id)).size/submitted:null,
    rejections,gaps,unresolvedInventory:unresolved,markouts,limitations:['Long/flat spot hypothesis; no uncollateralized shorting','Queue size multiplier is conservative approximation, not actual queue priority','Terminal fresh-quote liquidation is modeled','Public fees are assumptions, not account-specific fee tiers']};
}
export function studyMicro(rows){
  const first=rows.find(r=>r.type==='header')?.startedAt,last=rows.at(-1)?.endedAt;
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)throw new Error('Chronological recording required');
  const span=last-first,windows=[['train',first,first+span*.6],['calibration',first+span*.6,first+span*.8],['test',first+span*.8,last]];
  const results=[];
  for(const [name,from,to] of windows)for(const variant of ['baseline','cost_gate','maker'])for(const stress of [false,true]){
    const result=simulateMicro(rows,{from,to,variant,latencyMs:stress?500:100,costScale:stress?2:1});results.push({window:name,from,to,variant,stress,...result});
  }
  const days=new Set(rows.filter(r=>r.type==='stream').map(r=>Math.floor(r.observedAt/86400000))).size;
  const qualified=results.filter(r=>r.window==='test'&&r.variant!=='baseline').filter(r=>{
    const b=results.find(x=>x.window==='test'&&x.variant==='baseline'&&x.stress===r.stress),m=r.metrics;
    return days>=30&&r.lowerDailyNet>0&&!r.gaps&&!r.unresolvedInventory&&m.tradeCount>=30&&m.expectancy>0&&m.profitFactor>1&&m.sharpe!=null&&b.metrics.sharpe!=null&&m.sharpe>b.metrics.sharpe&&m.maxDrawdown<=b.metrics.maxDrawdown;
  });
  return {protocol:MICRO_PROTOCOL,independentDays:days,durationMs:span,qualified:qualified.length===4,promotion:'disabled',results,
    conclusion:days<30?'Insufficient independent executable-quote history; do not activate frequent trading':'Retrospective feasibility only; require uncertainty analysis and forward paper validation'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const a=process.argv.slice(2),get=k=>{const i=a.indexOf(k);if(i<0)throw new Error();return a[i+1];};
    const rows=readRecording(get('--recording')),result=studyMicro(rows);fs.writeFileSync(get('--out'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({qualified:result.qualified,conclusion:result.conclusion}));
  }catch{console.error('Micro study requires a complete integrity-checked --recording and new --out file');process.exitCode=1;}
}
