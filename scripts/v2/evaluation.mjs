// Calendar-return metrics; undefined statistics remain null, and flat cash cannot pass an alpha gate.
export function metrics(trades,curve) {
  if (!curve.length) throw new Error('Nonempty marked equity curve required');
  const pnls=trades.map(t=>t.net_pnl ?? t.net), n=pnls.length;
  if (!pnls.every(Number.isFinite) || !curve.every(r=>Number.isFinite(r.ts)&&Number.isFinite(r.equity))) throw new Error('Invalid evaluation observations');
  let peak=curve[0].equity,dd=0; const days=new Map();
  for (const row of curve) {peak=Math.max(peak,row.equity); dd=Math.max(dd,peak>0?1-row.equity/peak:0); days.set(new Date(row.ts).toISOString().slice(0,10),row.equity);}
  let previous=curve[0].equity; const returns=[];
  for (const equity of days.values()) {returns.push(previous>0?equity/previous-1:0); previous=equity;}
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0, mean=avg(returns);
  const sd=returns.length>1?Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/(returns.length-1)):0;
  const gain=pnls.filter(x=>x>0).reduce((s,x)=>s+x,0), loss=-pnls.filter(x=>x<0).reduce((s,x)=>s+x,0);
  return {sharpe:sd>0?mean/sd*Math.sqrt(365):null,maxDrawdown:dd,profitFactor:loss>0?gain/loss:null,
    expectancy:n?avg(pnls):null,tradeCount:n,winRate:n?pnls.filter(x=>x>0).length/n:null,
    returnPct:curve[0].equity>0?curve.at(-1).equity/curve[0].equity-1:null};
}
export function walkForwardSplits({start,testStart,end,stepMs,embargoMs=0}) {
  if (![start,testStart,end,stepMs,embargoMs].every(Number.isFinite)||start>=testStart||testStart>=end||stepMs<=0||embargoMs<0) throw new Error('Invalid chronological splits');
  const folds=[];
  for(let from=testStart;from<end;from+=stepMs) folds.push({trainStart:start,trainEnd:from-embargoMs,testStart:from,testEnd:Math.min(end,from+stepMs)});
  if(folds.some(f=>f.trainEnd<=start)) throw new Error('Embargo consumes training window');
  return folds;
}
export function profitGate(candidate,baseline) {
  return Boolean(candidate.tradeCount>=30&&candidate.sharpe!=null&&baseline.sharpe!=null&&candidate.sharpe>baseline.sharpe&&
    candidate.profitFactor>1&&candidate.expectancy>0&&candidate.maxDrawdown<=baseline.maxDrawdown&&candidate.returnPct>baseline.returnPct);
}
