import {createFlowCollector} from './flow.mjs';
import {createWorldCollector} from './world.mjs';
import {SnapshotWorker} from './http.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaperStore} from './paper_store.mjs';
import {dashboardDTO} from './dashboard.mjs';
import {validateConfig} from './config.mjs';
import {createPaperState,paperTick,signalsFor} from './runtime.mjs';
import {fetchQuote,fetchFxSnapshot,fetchHistoryBars,indicators} from '../lib.mjs';
import {toUsd,timestampedReturns} from './market_data.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const historyCache=new Map();
async function history(symbol,range,interval,at) {
  const key=symbol+interval, row=historyCache.get(key), ttl=interval==='1d'?3600000:60000;
  if(row&&at-row.at<ttl)return row.value;
  const value=await fetchHistoryBars(symbol,range,interval,at);historyCache.set(key,{at,value});return value;
}
export async function collectQuotes(cfg, at = Date.now(), mock = false) {
  if (mock) return Object.fromEntries(cfg.watchlist.map(w => [w.symbol,{symbol:w.symbol,market:w.market,currency:'USD',price:100,
    ok:true,sourceTs:at,receivedAt:at,marketState:'REGULAR',closes:Array(365).fill(100),closesIntraday:Array(480).fill(100),dailyBars:[],returns:[]}]));
  const fxPromise=fetchFxSnapshot().catch(()=>null), entries=[], pending=[...cfg.watchlist];
  await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{ while(pending.length) {const w=pending.shift();entries.push(await (async()=>{
    try {
      const [raw,daily,intraday] = await Promise.all([fetchQuote(w.symbol),history(w.symbol,'1y','1d',at),
        history(w.symbol,'5d','15m',at)]);
      const q = toUsd(raw,await fxPromise,Date.now()), closes = daily.map(b=>b.c/(q.fx || 1));
      return [w.symbol,{...q,...indicators(closes),symbol:w.symbol,market:w.market,closes,dailyBars:daily,returns:timestampedReturns(daily),intradayBars:intraday.map(b=>({...b,o:b.o/(q.fx||1),h:b.h/(q.fx||1),l:b.l/(q.fx||1),c:b.c/(q.fx||1)})),closesIntraday:intraday.map(b=>b.c/(q.fx || 1))}];
    } catch { return [w.symbol,{symbol:w.symbol,ok:false,stale:true}]; }
  })());}}));
  return Object.fromEntries(entries);
}
export async function runCLI(args = process.argv.slice(2)) {
  if (!args.includes('--paper') || args.includes('--live') || args.includes('--force')) throw new Error('Explicit --paper required; live/force modes are unsupported');
  const value = flag => {const i=args.indexOf(flag); return i>=0?args[i+1]:null;};
  const cfg = validateConfig(JSON.parse(fs.readFileSync(path.resolve(value('--config') || path.join(ROOT,'config.json')),'utf8')));
  const models=value('--models')?JSON.parse(fs.readFileSync(path.resolve(value('--models')),'utf8')):[];
  if(!Array.isArray(models)||models.length>1000)throw new Error('Bounded reviewed model artifact array required');
  const dir = path.resolve(value('--data-dir') || path.join(ROOT,'data','paper'));
  fs.mkdirSync(dir,{recursive:true});
  const store = new PaperStore(dir,{leaseMs:Math.max(120000,cfg.v2.strategies.loopSeconds*3000)}).acquire();
  const publish = state => dashboardDTO({signals:signalsFor(state,cfg),strategies:state.strategies,
    trades:state.fills,equity:state.equityHistory,episodes:[],generations:[],memory:[]});
  try {
    if (!store.load()) {
      if (fs.existsSync(path.join(ROOT,'data','state.v2.json')) || fs.existsSync(path.join(dir,'state.v3.json'))) throw new Error('Legacy snapshot detected; explicit reconciliation required');
      const initial=createPaperState(cfg); store.initialize(initial,publish(initial));
    } else if (args.includes('--initialize')) throw new Error('Paper store exists; initialization never overwrites');
    if (args.includes('--initialize')) return;
    const feed=new SnapshotWorker(()=>collectQuotes(cfg,Date.now(),args.includes('--mock')),{ttlMs:10000});
    if(args.includes('--once'))await feed.refresh();
    let nextDecision=0,lastWorld=0,lastFlow=0;
    const flowWorker=new SnapshotWorker(createFlowCollector(),{ttlMs:60000});
    const worldWorker=new SnapshotWorker(createWorldCollector(),{ttlMs:600000});
    do {
      const began=Date.now(); feed.refresh();
      const snapshot=feed.snapshot(), quotes=snapshot.value || {};
      if(!args.includes('--mock')){worldWorker.refresh();flowWorker.refresh();}
      const flow=flowWorker.snapshot();
      if(flow.updatedAt>lastFlow){store.archiveObservation('public_flow',flow.value,flow.updatedAt);lastFlow=flow.updatedAt;}
      for(const [symbol,q] of Object.entries(quotes))q.flow=flow.value?.flows?.[symbol]||null;
      const worldSnapshot=worldWorker.snapshot();
      if(worldSnapshot.updatedAt>lastWorld){store.archiveObservation('world',worldSnapshot.value,worldSnapshot.updatedAt);lastWorld=worldSnapshot.updatedAt;}
      const result=store.transact(state=>{state.world=worldSnapshot.value||{};return paperTick(state,quotes,cfg,{at:Date.now(),context:{world:state.world,models},...(began<nextDecision?{evaluate:()=>[]}:{})});},publish);
      if(began>=nextDecision)nextDecision=began+cfg.v2.strategies.loopSeconds*1000;
      const state=result.state;
      console.log(JSON.stringify({mode:'paper',cycle:state.cycles,equity:state.equity,risk:state.riskState,health:state.health.status}));
      if (args.includes('--once')) break;
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,1000-(Date.now()-began))));
    } while (true);
  } finally {store.close();}
}
