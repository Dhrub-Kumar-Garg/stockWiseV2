// Bounded public market-data capture. Never submits or signs orders.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import WebSocket from 'ws';
import {readPublic} from './http.mjs';
import {SequenceBook} from './microstructure.mjs';
export async function recordPublic({symbol,durationMs,out}){
  if(!/^[A-Z0-9]{2,12}USDT$/.test(symbol)||!Number.isFinite(durationMs)||durationMs<1000||durationMs>300000)throw new Error('Bounded symbol/duration required');
  fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});const fd=fs.openSync(out,'wx'),hash=createHash('sha256');let bytes=0,count=0;
  function write(row){const line=JSON.stringify(row)+'\n';if(bytes+Buffer.byteLength(line)>25000000)throw new Error('Capture capacity');bytes+=Buffer.byteLength(line);count++;fs.writeSync(fd,line);hash.update(line);}
  write({type:'header',protocol:'spot-micro-v1',symbol,venue:'binance-spot',startedAt:Date.now(),assumptions:'Received-time observation; no broker orders'});
  const book=new SequenceBook(),buffer=[];let ready=false,ws,timer,watchdog,done=false,last=Date.now();
  return new Promise(resolve=>{
    function finish(complete,reason){if(done)return;done=true;clearTimeout(timer);clearInterval(watchdog);ws?.terminate();const footer={type:'footer',complete,reason,endedAt:Date.now(),records:count,bytes,sha256:hash.digest('hex')};fs.writeSync(fd,JSON.stringify(footer)+'\n');fs.closeSync(fd);resolve(footer);}
    timer=setTimeout(()=>finish(ready&&book.valid,'duration_or_connect_deadline'),durationMs);
    watchdog=setInterval(()=>{if(Date.now()-last>10000)finish(false,'stale_socket');},1000);
    ws=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${symbol.toLowerCase()}@depth@100ms/${symbol.toLowerCase()}@aggTrade`,{maxPayload:262144,handshakeTimeout:5000});
    ws.on('error',()=>finish(false,'public_socket_error'));ws.on('close',()=>finish(false,'public_socket_closed'));
    ws.on('open',async()=>{
      try{
        const [snapshot,info]=await Promise.all([
          readPublic(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=1000`,{json:true,retries:0,timeoutMs:5000}),
          readPublic(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`,{json:true,retries:0,timeoutMs:5000})]);
        if(done)return;const filters=info.symbols?.find(s=>s.symbol===symbol)?.filters;if(!filters)throw new Error('Missing instrument filters');
        write({type:'instrument',observedAt:Date.now(),filters});write({type:'snapshot',observedAt:Date.now(),data:snapshot});book.snapshot(snapshot);
        for(const row of buffer)if(row.data.e==='depthUpdate')book.update(row.data,Date.now());ready=true;
      }catch{finish(false,'snapshot_or_sequence_failure');}
    });
    ws.on('message',data=>{
      if(done)return;
      try{
        const m=JSON.parse(data.toString()).data,at=Date.now();if(!m||m.s!==symbol||!['depthUpdate','aggTrade'].includes(m.e))return;
        last=at;const row={type:'stream',observedAt:at,data:m};write(row);
        if(ready&&m.e==='depthUpdate')book.update(m,at);
        else if(!ready){if(buffer.length>=2000)throw new Error('Capture buffer capacity');buffer.push(row);}
      }catch{finish(false,'malformed_or_gapped_feed');}
    });
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const a=process.argv.slice(2),get=k=>a[a.indexOf(k)+1];if(!a.includes('--paper')||!a.includes('--symbol')||!a.includes('--out')||!a.includes('--seconds'))throw new Error();
    const result=await recordPublic({symbol:get('--symbol'),durationMs:Number(get('--seconds'))*1000,out:get('--out')});console.log(JSON.stringify(result));if(!result.complete)process.exitCode=2;
  }catch{console.error('Public capture requires --paper --symbol BTCUSDT --seconds 1..300 --out NEW.jsonl');process.exitCode=1;}
}
