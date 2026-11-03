import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateConfig} from './config.mjs';
import {createPaperState,paperTick,signalsFor} from './runtime.mjs';
import {fetchQuote,fetchFxSnapshot,fetchHistoryBars,indicators} from '../lib.mjs';
import {toUsd,timestampedReturns} from './market_data.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function collectQuotes(cfg, at = Date.now(), mock = false) {
  if (mock) return Object.fromEntries(cfg.watchlist.map(w => [w.symbol,{symbol:w.symbol,market:w.market,currency:'USD',price:100,
    ok:true,sourceTs:at,receivedAt:at,marketState:'REGULAR',closes:Array(365).fill(100),closesIntraday:Array(480).fill(100),dailyBars:[],returns:[]}]));
  const fx = await fetchFxSnapshot().catch(()=>null), entries = await Promise.all(cfg.watchlist.map(async w => {
    try {
      const [raw,daily,intraday] = await Promise.all([fetchQuote(w.symbol),fetchHistoryBars(w.symbol,'1y','1d',at),
        w.market === 'crypto' ? fetchHistoryBars(w.symbol,'5d','15m',at) : []]);
      const q = toUsd(raw,fx,at), closes = daily.map(b=>b.c/(q.fx || 1));
      return [w.symbol,{...q,...indicators(closes),symbol:w.symbol,market:w.market,closes,dailyBars:daily,returns:timestampedReturns(daily),closesIntraday:intraday.map(b=>b.c/(q.fx || 1))}];
    } catch { return [w.symbol,{symbol:w.symbol,ok:false,stale:true}]; }
  }));
  return Object.fromEntries(entries);
}
export async function runCLI(args = process.argv.slice(2)) {
  if (!args.includes('--paper') || args.includes('--live') || args.includes('--force')) throw new Error('Explicit --paper required; live/force modes are unsupported');
  const value = flag => {const i=args.indexOf(flag); return i>=0?args[i+1]:null;};
  const cfg = validateConfig(JSON.parse(fs.readFileSync(path.resolve(value('--config') || path.join(ROOT,'config.json')),'utf8')));
  const dir = path.resolve(value('--data-dir') || path.join(ROOT,'data','paper'));
  fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir,'state.v3.json');
  if (!fs.existsSync(file) && fs.existsSync(path.join(ROOT,'data','state.v2.json'))) throw new Error('Legacy state detected; explicit migration required');
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : createPaperState(cfg);
  if (state.mode !== 'paper' || state.accountingVersion !== 3) throw new Error('Refusing legacy/nonpaper state');
  const write = (name,body) => {const dest=path.join(dir,name), tmp=dest+`.${process.pid}.tmp`; fs.writeFileSync(tmp,JSON.stringify(body)+'\n'); fs.renameSync(tmp,dest);};
  if (args.includes('--initialize')) { if (fs.existsSync(file)) throw new Error('State exists; initialization never overwrites it'); write('state.v3.json',state); return; }
  do {
    const began=Date.now(), quotes=await collectQuotes(cfg,began,args.includes('--mock'));
    paperTick(state,quotes,cfg,{at:Date.now()});
    write('state.v3.json',state); write('signals.v2.json',signalsFor(state,cfg)); write('strategies.json',state.strategies);
    for (const [name,rows] of [['trades.v2.jsonl',state.fills],['equity.v2.jsonl',state.equityHistory]]) fs.writeFileSync(path.join(dir,name),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
    console.log(JSON.stringify({mode:'paper',cycle:state.cycles,equity:state.equity,risk:state.riskState,health:state.health.status}));
    if (args.includes('--once')) break;
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,cfg.v2.strategies.loopSeconds*1000-(Date.now()-began))));
  } while (true);
}
