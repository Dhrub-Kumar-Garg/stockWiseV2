// Independent virtual books. Their cash and trades NEVER modify the portfolio ledger.
import * as P from './perp.mjs';
import * as A from './accounting.mjs';
import {strategyExit} from './strategies.mjs';
export function modelFamily(id){return ['tsmom','donchian','mom_trend','orb','ibreakout','atr_expand','vol_expand'].includes(id)?'trend':['oi_diverge','orderflow'].includes(id)?'flow':id==='pairs_trade'?'spread':id==='adaptive_regime'?'adaptive':'reversion';}
export function queueShadowCandidates(state,rows,quotes,cfg,at){
 state.shadowBooks||={};
 for(const row of rows){
  if(['unsupported_market','retired','market_disabled'].includes(row.reason))continue;
  const key=row.strategy_id+'|'+row.symbol,q=quotes[row.symbol];if(!q)continue;
  const book=state.shadowBooks[key]||={mode:'paper',accountingVersion:3,walletBalance:100,equity:100,positions:{},closedTrades:[],curve:[],family:modelFamily(row.strategy_id),strategy_id:row.strategy_id,symbol:row.symbol};
  const strat=state.strategies.find(s=>s.id===row.strategy_id),epoch=strat?.intraday?q.intradayBars?.at(-1)?.closeTs:q.dailyBars?.at(-1)?.closeTs;
  if(!Number.isFinite(epoch)||epoch>at||book.lastDecisionEpoch===epoch)continue;
  book.lastDecisionEpoch=epoch;book.lastReason=row.reason;
  if(!row.signal||Object.keys(book.positions).length||book.pending)continue;
  // Pair model remains a research-only joint book, never a naked BTC position.
  if(row.strategy_id==='pairs_trade'&&!quotes[row.signal?.hedgeSymbol||'ETH-USD']){book.lastReason='pair_leg_missing';continue;}
  book.pending={...structuredClone(row),decisionAt:at,sourceTs:q.sourceTs};
 }
}
export function updateShadowBooks(state,quotes,cfg,at){
 const events=[];
 for(const [key,book] of Object.entries(state.shadowBooks||{})){
  const p=book.pending,q=quotes[book.symbol],cost=(cfg.slippage[q?.market||'crypto']??.001)+(cfg.v2.halfSpread?.[q?.market||'crypto']??.0002);
  function closeAll(reason){
   if(Object.keys(book.positions).some(symbol=>!quotes[symbol]))return false;
   let net=0,risk=0;const main=Object.values(book.positions)[0];
   for(const [symbol,pos] of Object.entries(book.positions)){
    risk+=pos.riskUsd;const out=A.settleClose(book,pos,quotes[symbol].price*(1-P.sideSign(pos.side)*cost),cfg.v2.perpFees.taker,reason,at);net+=out.netPnl;delete book.positions[symbol];
   }
   const entry=book.entry;book.closedTrades=[];book.cashLedger=[];
   const label={id:entry.id,trade_id:entry.id,accountingVersion:3,strategy_id:book.strategy_id,strategyHash:entry.strategyHash,symbol:book.symbol,side:entry.side,regime:entry.regime,
     openedAt:main.openedAt,featuresAt:entry.featuresAt,closedAt:at,features:entry.features,costHash:entry.costHash,realized_R:risk>0?net/risk:0,net_pnl:net,reason,source:'shadow',family:book.family};
   book.tradeCount=(book.tradeCount||0)+1;book.netPnl=(book.netPnl||0)+net;book.lastClose=label;events.push({type:'shadow_close',id:label.id,label,ts:at});return true;
  }
  let exit=book.exitPending&&at>book.exitPending.at&&q?.sourceTs>book.exitPending.sourceTs?book.exitPending.reason:null;
  for(const [symbol,pos] of Object.entries(book.positions)){
   const quote=quotes[symbol];if(!quote)continue;pos.lastMark=quote.price;
   if(pos.market==='crypto')for(const ts of P.crossedFundingTimestamps(pos.lastFundingTs,at,cfg.v2.fundingHoursUTC))A.settleFunding(book,pos,cfg.v2.execution.modeledFundingRatePer8h,ts,quote.price,'modeled-shadow');
   else A.settleBorrow(book,pos,cfg.v2.leverage[pos.market]?.borrowAnnual||0,at,quote.price);
   const snap=P.markPosition(pos,quote.price),move=(quote.price/pos.entryPrice-1)*P.sideSign(pos.side);
   if(snap.liquidated)exit='liquidation';else if(move<=-pos.openMeta.stopPct)exit='stop';else if(move>=pos.openMeta.targetPct)exit='target';
   else if(at-pos.openedAt>=cfg.v2.aggression.maxHoldHours*3600000)exit='time';
   if(!exit&&!book.exitPending){const result=strategyExit(pos,quote,quotes,pos.openMeta.regime);if(result)book.exitPending={at,sourceTs:quote.sourceTs,reason:result.reason};}
  }
  if(exit&&closeAll(exit))book.exitPending=null;
  if(p&&q&&at>p.decisionAt&&q.sourceTs>p.sourceTs){
   book.pending=null;
   if(at-p.decisionAt>60000||Object.keys(book.positions).length||book.walletBalance<1)continue;
   const legs=[{symbol:book.symbol,side:p.side}];if(book.strategy_id==='pairs_trade')legs.push({symbol:p.signal.hedgeSymbol||'ETH-USD',side:p.side==='long'?'short':'long'});
   if(legs.some(l=>!quotes[l.symbol]))continue;
   const margin=Math.min(5,book.walletBalance*.1)/legs.length,id='shadow:'+key+':'+p.decisionAt;
   book.entry={...p,id,featuresAt:p.decisionAt};
   for(const leg of legs){const quote=quotes[leg.symbol],market=quote.market||'crypto';
    const pos=P.openPosition({symbol:leg.symbol,market,side:leg.side,entryMark:quote.price*(1+P.sideSign(leg.side)*cost),margin,leverage:1,tiers:cfg.v2.maintenanceTiers[market],meta:{trade_id:id+':'+leg.symbol,strategy_id:book.strategy_id,stopPct:p.signal.stopPct,targetPct:p.signal.targetPct,regime:p.regime}});
    Object.assign(pos,{openedAt:at,lastFundingTs:at,lastBorrowTs:at,lastMark:quote.price});A.recordEntry(book,pos,cfg.v2.perpFees.taker,at);book.positions[leg.symbol]=pos;
   }
  }
  A.equityAt(book,quotes);book.peak=Math.max(book.peak||100,book.equity);book.maxDrawdown=Math.max(book.maxDrawdown||0,1-book.equity/book.peak);const day=Math.floor(at/86400000),last=book.curve.at(-1);
  if(last?.day===day)last.equity=book.equity;else book.curve.push({day,ts:at,equity:book.equity});book.curve=book.curve.slice(-400);
 }
 return events;
}
// Equal family budgets prevent correlated confirmations multiplying capital.
export function netCandidates(rows){
 const groups=new Map();for(const row of rows){const f=modelFamily(row.strategy_id);if(!groups.has(f))groups.set(f,[]);groups.get(f).push(row);}
 const families=new Map();for(const [family,members] of groups){
  members.sort((a,b)=>b.calibration.expectedNetRLower-a.calibration.expectedNetRLower||a.strategy_id.localeCompare(b.strategy_id));const top=members[0];
  if(members.some(r=>r.side!==top.side&&Math.abs(r.calibration.expectedNetRLower-top.calibration.expectedNetRLower)<1e-12))continue;families.set(family,top);
 }
 const selected=[...families.values()].filter(Boolean),total=selected.reduce((s,r)=>s+r.calibration.expectedNetRLower,0);
 if(!(total>0))return null;
 const signed=selected.reduce((s,r)=>s+(r.side==='long'?1:-1)*r.calibration.expectedNetRLower,0)/total;
 if(Math.abs(signed)<1e-12)return null;const side=signed>0?'long':'short';
 const contributors=selected.filter(r=>r.side===side).sort((a,b)=>b.calibration.expectedNetRLower-a.calibration.expectedNetRLower||a.strategy_id.localeCompare(b.strategy_id));
 return {primary:contributors[0],contributors,sizeScale:Math.min(1,Math.abs(signed)),side};
}
export function shadowSummary(state){return Object.entries(state.shadowBooks||{}).map(([id,b])=>({id,strategy_id:b.strategy_id,symbol:b.symbol,family:b.family,equity:b.equity,tradeCount:b.tradeCount||0,netPnl:b.netPnl||0,pending:!!b.pending,lastReason:b.lastReason}));}

export function shadowCorrelations(state){
 const books=Object.entries(state.shadowBooks||{}),out=[];
 for(let i=0;i<books.length;i++)for(let j=i+1;j<books.length;j++){
  const returns=b=>new Map(b.curve.slice(1).map((r,k)=>[r.day,r.equity/b.curve[k].equity-1]));
  const a=returns(books[i][1]),b=returns(books[j][1]),pairs=[...a].filter(([day])=>b.has(day)).map(([day,v])=>[v,b.get(day)]);if(pairs.length<30)continue;
  const n=pairs.length,ma=pairs.reduce((s,p)=>s+p[0],0)/n,mb=pairs.reduce((s,p)=>s+p[1],0)/n;
  const cov=pairs.reduce((s,p)=>s+(p[0]-ma)*(p[1]-mb),0),den=Math.sqrt(pairs.reduce((s,p)=>s+(p[0]-ma)**2,0)*pairs.reduce((s,p)=>s+(p[1]-mb)**2,0));
  out.push({a:books[i][0],b:books[j][0],n,correlation:den?cov/den:null});
 }return out;
}
