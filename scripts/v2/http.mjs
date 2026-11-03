// Public GET only. Deadline includes response body; provider URLs never logged.
export async function readPublic(url,{fetcher=fetch,timeoutMs=6000,maxBytes=2000000,retries=1,json=false,publicBody=null}={}) {
  const u=new URL(url); if(u.protocol!=='https:'||u.username||u.password)throw new Error('Public HTTPS required');
  for(let attempt=0;attempt<=retries;attempt++) {
    const c=new AbortController(); let timer;
    try {
      const work=(async()=>{
        const res=await fetcher(url,{signal:c.signal,method:publicBody?'POST':'GET',body:publicBody?JSON.stringify(publicBody):undefined,headers:{'User-Agent':'Stockwise-Paper-Research/3',...(publicBody?{'Content-Type':'application/json'}:{})}});
        if(!res.ok){await res.body?.cancel();const e=new Error('Provider HTTP failure');e.retry=res.status===429||res.status>=500;throw e;}
        const reader=res.body.getReader(),chunks=[];let bytes=0;
        try {for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw new Error('Oversize response');chunks.push(Buffer.from(value));}}
        finally {reader.cancel().catch(()=>{});}
        const text=Buffer.concat(chunks).toString('utf8');return json?JSON.parse(text):text;
      })();
      return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(new Error('Provider deadline'));},timeoutMs);})]);
    } catch(e) {if(!e.retry||attempt===retries)throw e;await new Promise(r=>setTimeout(r,Math.min(2000,250*2**attempt)));}
    finally {clearTimeout(timer);c.abort();}
  }
}
export class SnapshotWorker {
  constructor(load,{ttlMs=10000,clock=Date.now}={}) {Object.assign(this,{load,ttlMs,clock,value:null,updatedAt:0,nextAttempt:0,running:null,errors:0});}
  refresh() {
    if(this.running||this.clock()<this.nextAttempt)return this.running;
    this.running=Promise.resolve().then(this.load).then(v=>{this.value=structuredClone(v);this.updatedAt=this.clock();this.errors=0;},()=>{this.errors++;})
      .finally(()=>{this.nextAttempt=this.clock()+Math.min(60000,this.ttlMs*2**Math.min(4,this.errors));this.running=null;});return this.running;
  }
  snapshot(){return {value:structuredClone(this.value),updatedAt:this.updatedAt,stale:!this.updatedAt||this.clock()-this.updatedAt>this.ttlMs,errors:this.errors};}
}
