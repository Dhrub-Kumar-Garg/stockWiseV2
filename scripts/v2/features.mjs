export function trueATR(bars,n=14){
 if(!Array.isArray(bars)||bars.length<n+1)return NaN;let sum=0;
 for(let i=bars.length-n;i<bars.length;i++){const b=bars[i],prev=bars[i-1];if(![b.h,b.l,prev.c].every(Number.isFinite)||b.h<b.l)return NaN;sum+=Math.max(b.h-b.l,Math.abs(b.h-prev.c),Math.abs(b.l-prev.c));}return sum/n;
}
export function volumeVWAP(bars){
 const rows=(bars||[]).slice(-48);if(rows.length<30||rows.some(b=>![b.h,b.l,b.c,b.v].every(Number.isFinite)||b.v<0))return null;
 const volume=rows.reduce((s,b)=>s+b.v,0);if(volume<=0)return null;
 const value=rows.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0)/volume;
 const sd=Math.sqrt(rows.reduce((s,b)=>s+b.v*((b.h+b.l+b.c)/3-value)**2,0)/volume);return {value,sd};
}
