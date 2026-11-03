import {readPublic} from './http.mjs';
// Public info endpoint only; matched mark/OI observation horizons, no trading keys.
export function createFlowCollector({load=()=>readPublic('https://api.hyperliquid.xyz/info',{publicBody:{type:'metaAndAssetCtxs'},json:true,timeoutMs:5000,retries:0}),clock=Date.now}={}){
 const history=new Map();return async()=>{
  const result=await load(),at=clock(),universe=result?.[0]?.universe,contexts=result?.[1];if(!Array.isArray(universe)||!Array.isArray(contexts)||universe.length!==contexts.length)throw new Error('Malformed public flow');
  const output={};for(let i=0;i<universe.length;i++){
   const asset=universe[i].name;if(!['BTC','ETH','SOL','XRP','DOGE'].includes(asset))continue;
   const c=contexts[i],row={ts:at,oi:Number(c.openInterest),price:Number(c.markPx),fundingHourly:Number(c.funding),venue:'hyperliquid',timeQuality:'received_only'};
   if(![row.oi,row.price].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(row.fundingHourly))continue;
   const rows=history.get(asset)||[];if(!rows.length||at-rows.at(-1).ts>=30000)rows.push(row);while(rows.length&&at-rows[0].ts>3600000)rows.shift();history.set(asset,rows);
   const prior=rows.filter(r=>at-r.ts>=480000&&at-r.ts<=540000).at(-1);output[asset+'-USD']=prior?{prior,current:row}:null;
  }return {ts:at,flows:output};
 };
}
export function flowDeltas(q,at=q.observedAt??Date.now()){
 const f=q.flow;if(!f||f.current.venue!==f.prior.venue||f.current.ts>at||at-f.current.ts>120000||f.current.ts-f.prior.ts<480000||f.current.ts-f.prior.ts>540000)return null;
 return {price:f.current.price/f.prior.price-1,oi:f.current.oi/f.prior.oi-1,funding:f.current.fundingHourly};
}
