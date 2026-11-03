// Versioned evaluation of the CURRENT paper runtime; original audit is pinned separately.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateConfig} from './config.mjs';
import {createPaperState,paperTick} from './runtime.mjs';
import {indicators} from '../lib.mjs';
import {metrics} from './evaluation.mjs';
const BAR=900000, DAY=86400000, ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function replayPaper(dataset,cfg,{from,to,mode='TREND',initialEvidence=[]}={}) {
  const state=createPaperState(cfg,from); state.closedTrades=structuredClone(initialEvidence.filter(t=>t.closedAt<from));
  const curve=[{ts:from,equity:state.equity}], cache=new Map();
  function quotes(index,priceIndex,at,sourceTs) {
    return Object.fromEntries(dataset.map(d=>{
      const b=d.bars[index], day=Math.floor(b[0]/DAY), key=d.symbol+':'+day;
      if(!cache.has(key)) {
        const history=d.daily.filter(r=>r[0]+DAY<=at).slice(-365).map(r=>r[4]);
        cache.set(key,{closes:history,...indicators(history),dailyBars:d.daily.filter(r=>r[0]+DAY<=at).slice(-365).map(r=>({ts:r[0],closeTs:r[0]+DAY,c:r[4]}))});
      }
      return [d.symbol,{...cache.get(key),symbol:d.symbol,market:'crypto',currency:'USD',ok:true,marketState:'REGULAR',
        price:b[priceIndex],sourceTs,receivedAt:at,closesIntraday:d.bars.slice(Math.max(0,index-479),index+(priceIndex===1?0:1)).map(r=>r[4])}];
    }));
  }
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to||!dataset.length||dataset.some(d=>d.bars.length!==dataset[0].bars.length||d.bars.some((b,i)=>b[0]!==dataset[0].bars[i][0]))) throw new Error('Aligned chronological dataset required');
  const first=dataset[0].bars.findIndex(b=>b[0]>=from), stop=dataset[0].bars.findIndex(b=>b[0]>=to);
  if(first<0) throw new Error('Test start outside dataset');
  for(let i=first;i<(stop<0?dataset[0].bars.length:stop);i++) {
    const ts=dataset[0].bars[i][0];
    paperTick(state,quotes(i,1,ts+1,ts),cfg,{at:ts+1,evaluate:()=>[]});
    // Conservative OHLC path: adverse excursion first for each existing position.
    // Unknown intrabar sequencing cannot credit a target before a touched stop.
    if(Object.keys(state.positions).length) {
      const adverse=quotes(i,4,ts+BAR/3,ts+BAR/3-1), favorable=quotes(i,4,ts+BAR*2/3,ts+BAR*2/3-1);
      for(const d of dataset) {
        const pos=state.positions[d.symbol]; if(!pos) continue;
        adverse[d.symbol].price=d.bars[i][pos.side==='long'?3:2];
        favorable[d.symbol].price=d.bars[i][pos.side==='long'?2:3];
      }
      paperTick(state,adverse,cfg,{at:ts+BAR/3,evaluate:()=>[]}); curve.push({ts:ts+BAR/3,equity:state.equity});
      paperTick(state,favorable,cfg,{at:ts+BAR*2/3,evaluate:()=>[]}); curve.push({ts:ts+BAR*2/3,equity:state.equity});
    }
    const at=ts+BAR, eq=quotes(i,4,at,at-1);
    paperTick(state,eq,cfg,{at,context:{analyst:{mode,direction_bias:'NEUTRAL'}}});
    curve.push({ts:at,equity:state.equity});
  }
  // Terminal cash realization is explicit, uses fresh last mark plus adverse fills and fees.
  const last=curve.at(-1).ts;
  for(const [symbol,pos] of Object.entries(state.positions)) state.intents.push({id:`terminal:${symbol}:${last}`,op:'close',symbol,
    reason:'terminal',decisionAt:last,decisionSourceTs:last-1,expiresAt:last+60000});
  const marks=Object.fromEntries(dataset.map(d=>{const b=d.bars.filter(b=>b[0]<to).at(-1);return[d.symbol,{price:b[4],currency:'USD',ok:true,sourceTs:last,receivedAt:last+1}];}));
  paperTick(state,marks,cfg,{at:last+1,evaluate:()=>[]}); curve.push({ts:last+1,equity:state.equity});
  const trades=state.closedTrades.filter(t=>t.closedAt>=from);
  return {metrics:metrics(trades,curve),curve,trades,accountingVersion:3,mode:'paper',limitations:['Conservative adverse-first OHLC excursion; fills at excursion marks, not precise stop quotes','OHLC opening quote plus1ms latency assumption','No production AI/news/OI history','Unvalidated models allocate zero']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2), get=flag=>args[args.indexOf(flag)+1];
    if(!args.includes('--data-dir')||!args.includes('--out-dir')||!args.includes('--from')||!args.includes('--to')) throw new Error('Explicit data/out directories and chronological from/to required');
    const cfg=validateConfig(JSON.parse(fs.readFileSync(path.join(ROOT,'config.example.json')))), dataDir=path.resolve(get('--data-dir'));
    cfg.watchlist=cfg.watchlist.filter(w=>w.market==='crypto');
    const dataset=cfg.watchlist.map(w=>{
      const raw=fs.readFileSync(path.join(dataDir,w.symbol.replace('-USD','')+'_15m.json')),
        warm=JSON.parse(fs.readFileSync(path.join(dataDir,w.symbol.replace('-USD','')+'_1d.json'))),bars=JSON.parse(raw),daily=[...warm];
      for(let i=95;i<bars.length;i+=96) daily.push([bars[i-95][0],0,0,0,bars[i][4],0]);
      if(bars.some((b,i)=>i&&b[0]-bars[i-1][0]!==BAR)) throw new Error('Dataset gaps/duplicates');
      return {symbol:w.symbol,bars,daily,sha256:createHash('sha256').update(raw).digest('hex')};
    });
    const result=replayPaper(dataset,cfg,{from:Date.parse(get('--from')),to:Date.parse(get('--to')),mode:(args.includes('--mode')?get('--mode'):'TREND')});
    const out=path.resolve(get('--out-dir')); fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'runtime-v3.json'),JSON.stringify({...result,inputHashes:dataset.map(d=>({symbol:d.symbol,sha256:d.sha256}))},null,2));
    console.log(JSON.stringify(result.metrics));
  } catch {console.error('Evaluation failed; explicit valid chronological input is required');process.exitCode=1;}
}
