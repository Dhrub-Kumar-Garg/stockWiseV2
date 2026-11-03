// Frozen train/calibration/test protocol. Artifacts are evidence, never a profit guarantee.
import {createHash} from 'node:crypto';
import {lexiconScore} from '../world/score.mjs';
export const CALIBRATION_PROTOCOL='paper-v3-logistic-1';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function scopeKey(r){return [r.strategy_id,r.symbol,r.side,r.regime||'unknown'].join('|');}
export function strategyFingerprint(s){return hash({id:s.id,stop:s.stopPct,target:s.targetPct,intraday:s.intraday,baseLev:s.baseLev,definition:CALIBRATION_PROTOCOL});}
export function costFingerprint(cfg){return hash({protocol:CALIBRATION_PROTOCOL,fees:cfg.v2.perpFees,slippage:cfg.slippage,spread:cfg.v2.halfSpread,funding:cfg.v2.execution.modeledFundingRatePer8h});}
export function candidateFeatures(q,world,symbol,at){
 const c=q.closes||[],avg=mean(c.slice(-200)),returns=c.slice(-21).slice(1).map((v,i)=>v/c.slice(-21)[i]-1),m=mean(returns),vol=Math.sqrt(mean(returns.map(x=>(x-m)**2)));
 const asset=symbol.replace('-USD',''),news=(world?.news||[]).filter(n=>n.observedAt<=at&&n.publishedAt<=at&&at-n.publishedAt<86400000&&(n.assets?.includes(asset)||n.assets?.includes('MACRO')||q.market!=='crypto'&&n.assets?.includes('EQUITY')));
 return [Math.max(-1,Math.min(1,avg?q.price/avg-1:0)),Math.max(-1,Math.min(1,c.length>28?c.at(-1)/c.at(-29)-1:0)),Math.min(1,vol*10),news.length?Math.max(-1,Math.min(1,mean(news.map(n=>lexiconScore(n.title))))):0,news.length?1:0];
}
function prediction(weights,x){return sigmoid(weights[0]+x.reduce((s,v,i)=>s+v*weights[i+1],0));}
function lowerMean(rows,trials=1){const a=rows.map(r=>r.realized_R),m=mean(a),sd=a.length>1?Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1)):0;return a.length?m-(1.96+Math.sqrt(2*Math.log(Math.max(1,trials))))*sd/Math.sqrt(a.length):-Infinity;}
export function reliability(rows,predict){
 const bins=Array.from({length:5},(_,i)=>({lo:i/5,hi:(i+1)/5,n:0,p:0,wins:0}));let brier=0;
 for(const r of rows){const p=predict(r.features),y=r.realized_R>0?1:0,b=bins[Math.min(4,Math.floor(p*5))];b.n++;b.p+=p;b.wins+=y;brier+=(p-y)**2;}
 return {brier:rows.length?brier/rows.length:null,bins:bins.map(b=>({...b,p:b.n?b.p/b.n:null,winRate:b.n?b.wins/b.n:null}))};
}
export function fitCalibration(input,{trainEnd,calibrationEnd,testEnd,costHash,validForMs=7*86400000,trials=1}={}){
 if(![trainEnd,calibrationEnd,testEnd].every(Number.isFinite)||!(trainEnd<calibrationEnd&&calibrationEnd<testEnd)||!costHash)throw new Error('Frozen chronological boundaries and costs required');
 const seen=new Set(),rows=input.filter(r=>{if(!r.id||seen.has(r.id))return false;seen.add(r.id);return r.accountingVersion===3&&typeof r.strategyHash==='string'&&Number.isFinite(r.openedAt)&&Number.isFinite(r.featuresAt)&&r.featuresAt<=r.openedAt&&Number.isFinite(r.closedAt)&&r.closedAt>r.openedAt&&r.features?.length===5&&r.features.every(Number.isFinite)&&Number.isFinite(r.realized_R);}).sort((a,b)=>a.openedAt-b.openedAt);
 if(rows.some((r,i)=>i&&r.openedAt<rows[i-1].closedAt))throw new Error('Overlapping labels cannot be independent trials');
 if(!rows.length||new Set(rows.map(scopeKey)).size!==1)throw new Error('Exactly one strategy/asset/side/regime scope per artifact');
 // Trades crossing boundaries are purged rather than relabeled into another window.
 const train=rows.filter(r=>r.closedAt<trainEnd),cal=rows.filter(r=>r.openedAt>=trainEnd&&r.closedAt<calibrationEnd),test=rows.filter(r=>r.openedAt>=calibrationEnd&&r.closedAt<testEnd);
 const weights=Array(6).fill(0);for(let step=0;step<300;step++){
  const gradient=Array(6).fill(0);for(const r of train){const err=prediction(weights,r.features)-(r.realized_R>0?1:0);gradient[0]+=err;for(let i=0;i<5;i++)gradient[i+1]+=err*r.features[i];}
  for(let i=0;i<6;i++)weights[i]-=.3*(gradient[i]/Math.max(1,train.length)+(i?.01*weights[i]:0));
 }
 // Calibrate intercept only on calibration window; test outcomes never fit parameters.
 for(let step=0;step<100;step++)weights[0]-=.1*mean(cal.map(r=>prediction(weights,r.features)-(r.realized_R>0?1:0)));
 const predict=x=>prediction(weights,x),base=mean(train.map(r=>r.realized_R>0?1:0)),calReport=reliability(cal,predict),testReport=reliability(test,predict),baselineTestBrier=mean(test.map(r=>(base-(r.realized_R>0?1:0))**2));
 const bins=Array.from({length:5},(_,i)=>{const members=cal.filter(r=>Math.min(4,Math.floor(predict(r.features)*5))===i);return {n:members.length,lowerNetR:members.length?lowerMean(members,trials):null};});
 const days=new Set(test.map(r=>Math.floor(r.openedAt/86400000))).size,loss=-test.filter(r=>r.realized_R<0).reduce((s,r)=>s+r.realized_R,0),gain=test.filter(r=>r.realized_R>0).reduce((s,r)=>s+r.realized_R,0);
 const eligible=train.length>=30&&cal.length>=30&&test.length>=30&&days>=30&&loss>0&&gain/loss>1&&lowerMean(test,trials)>0&&testReport.brier<baselineTestBrier;
 const artifact={strategyHash:rows[0].strategyHash,protocol:CALIBRATION_PROTOCOL,scope:scopeKey(rows[0]),weights,bins,trainEnd,calibrationEnd,testEnd,validUntil:testEnd+validForMs,costHash,trials,
  eligible,trainCount:train.length,calibrationCount:cal.length,testCount:test.length,testDays:days,testLowerNetR:test.length?lowerMean(test,trials):null,
  calibration:calReport,test:testReport,baselineTestBrier,dataHash:hash(rows),evidence:test.map(r=>({trade_id:r.id,strategy_id:r.strategy_id,symbol:r.symbol,side:r.side,regime:r.regime,closedAt:r.closedAt,realized_R:r.realized_R,accountingVersion:3}))};
 return {...artifact,artifactHash:hash(artifact)};
}
export function calibratedDecision(model,row,cfg,at){
 if(!model)return {eligible:false,reason:'calibration_missing'};
 const {artifactHash,...body}=model;
 if(artifactHash!==hash(body)||model.protocol!==CALIBRATION_PROTOCOL||model.costHash!==costFingerprint(cfg)||model.scope!==scopeKey(row)||model.strategyHash!==row.strategyHash||!row.features?.length||row.features.length!==5||!row.features.every(Number.isFinite)||!model.eligible||model.testEnd>=at||model.validUntil<=at||!model.weights?.every(Number.isFinite))return {eligible:false,reason:'calibration_invalid_or_expired'};
 const p=prediction(model.weights,row.features),bin=model.bins[Math.min(4,Math.floor(p*5))];
 if(!bin||bin.n<20||!(bin.lowerNetR>0))return {eligible:false,reason:'net_edge_uncertain',probability:p};
 return {eligible:true,probability:p,expectedNetRLower:bin.lowerNetR,evidence:model.evidence,artifactHash};
}
export function expiringContext(value,at,maxAgeMs=1800000){return value&&Number.isFinite(value.ts)&&value.ts<=at&&at-value.ts<=maxAgeMs?{...value,stale:false}:{mode:'SLEEP',direction_bias:'NEUTRAL',stale:true};}
