import WebSocket from 'ws';
// Public combined streams only. ws automatically answers control-frame pings.
export class CryptoFeed {
  constructor(symbols,onTick,{socket=url=>new WebSocket(url,{maxPayload:262144}),clock=Date.now,staleMs=15000}={}) {
    if(!symbols.length||symbols.length>20||symbols.some(s=>! /^[A-Z0-9]+-USD$/.test(s)))throw new Error('Invalid feed symbols');
    Object.assign(this,{symbols,onTick,socket,clock,staleMs,quotes:{},attempt:0,stopped:true});this.allowed=new Set(symbols.map(s=>s.replace('-USD','USDT')));
  }
  connect(){if(!this.stopped)return;this.stopped=false;this.open();this.watchdog=setInterval(()=>{if(this.clock()-this.lastMessage>this.staleMs)this.ws?.terminate();},Math.min(5000,this.staleMs));this.watchdog.unref?.();}
  open(){
    if(this.stopped)return;
    const streams=[...this.allowed].map(s=>s.toLowerCase()+'@kline_1m').join('/');
    const ws=this.ws=this.socket('wss://stream.binance.com:9443/stream?streams='+streams);this.lastMessage=this.clock();
    ws.on('message',d=>this.receive(d));ws.on('error',()=>ws.terminate());
    ws.on('close',()=>{if(this.stopped||this.ws!==ws)return;clearTimeout(this.retry);this.retry=setTimeout(()=>this.open(),Math.min(30000,500*2**Math.min(6,this.attempt++)));this.retry.unref?.();});
  }
  receive(data){try{
    if(Buffer.byteLength(data)>262144)return;
    const raw=JSON.parse(data.toString()),m=raw.data??raw,at=this.clock();
    if(m.e!=='kline'||!this.allowed.has(m.s)||!Number.isFinite(m.E)||m.E>at+1000||at-m.E>this.staleMs)return;
    const price=Number(m.k?.c),symbol=m.s.replace(/USDT$/,'-USD');
    if(!(price>0)||!Number.isFinite(price)||this.quotes[symbol]?.sourceTs>=m.E)return;
    this.quotes[symbol]={price,sourceTs:m.E,receivedAt:at,currency:'USD',quoteCurrency:'USDT',ok:true,closed:m.k.x===true};
    this.lastMessage=at;this.attempt=0;this.onTick(symbol,price,{...this.quotes[symbol]});
  }catch{this.parseErrors=(this.parseErrors||0)+1;}}
  getQuotes(){const at=this.clock();return Object.fromEntries(Object.entries(this.quotes).map(([s,q])=>[s,{...q,stale:at-q.sourceTs>this.staleMs,ok:at-q.sourceTs<=this.staleMs}]));}
  getPrices(){return Object.fromEntries(Object.entries(this.getQuotes()).filter(([,q])=>q.ok).map(([s,q])=>[s,q.price]));}
  close(){this.stopped=true;clearTimeout(this.retry);clearInterval(this.watchdog);this.ws?.terminate();}
}
