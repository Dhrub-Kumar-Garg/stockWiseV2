// Spot executable-quote research only. No authenticated API or order transport.
export class SequenceBook {
  constructor(){this.valid=false;this.lastId=0;this.bids=new Map();this.asks=new Map();}
  snapshot(data){
    if(!Number.isSafeInteger(data.lastUpdateId)||!Array.isArray(data.bids)||!Array.isArray(data.asks))throw new Error('Invalid depth snapshot');
    this.bids.clear();this.asks.clear();this.levels(this.bids,data.bids);this.levels(this.asks,data.asks);this.lastId=data.lastUpdateId;this.ready=true;this.valid=false;
  }
  levels(side,rows){
    if(!Array.isArray(rows)||rows.length>5000)throw new Error('Invalid depth levels');
    for(const [p,q] of rows){const price=Number(p),qty=Number(q);if(!(price>0)||!Number.isFinite(price)||!Number.isFinite(qty)||qty<0)throw new Error('Invalid depth level');if(qty===0)side.delete(price);else side.set(price,qty);}
    if(side.size>10000)throw new Error('Depth capacity exceeded');
  }
  update(m,observedAt){
    if(!this.ready)return false;
    if(!Number.isSafeInteger(m.U)||!Number.isSafeInteger(m.u)||m.u<m.U||!Number.isFinite(m.E)||m.E>observedAt+1000||observedAt-m.E>2000){this.valid=false;throw new Error('Invalid/stale depth event');}
    if(m.u<=this.lastId)return false;
    if(m.U>this.lastId+1){this.valid=false;this.ready=false;throw new Error('Depth sequence gap: fresh snapshot required');}
    this.levels(this.bids,m.b);this.levels(this.asks,m.a);this.lastId=m.u;this.valid=true;this.at=observedAt;this.sourceTs=m.E;
    if(!this.quote(observedAt)){this.valid=false;throw new Error('Crossed/empty book');}return true;
  }
  quote(at){
    if(!this.valid||at-this.at>2000)return null;
    const bid=Math.max(...this.bids.keys()),ask=Math.min(...this.asks.keys());if(!(bid>0&&ask>bid&&Number.isFinite(ask)))return null;
    const bidSize=this.bids.get(bid),askSize=this.asks.get(ask),mid=(bid+ask)/2;
    return {id:'depth:'+this.lastId,ts:at,sourceTs:this.sourceTs,bid,ask,bidSize,askSize,mid,imbalance:bidSize/(bidSize+askSize),microprice:(ask*bidSize+bid*askSize)/(bidSize+askSize)};
  }
}
export class QueuePaper {
  constructor({latencyMs=100,queueMultiplier=2,ttlMs=1000}={}){
    if(!Number.isFinite(latencyMs)||latencyMs<0||queueMultiplier<1||ttlMs<=0)throw new Error('Invalid queue assumptions');
    Object.assign(this,{latencyMs,queueMultiplier,ttlMs,orders:new Map(),seen:new Set()});
  }
  submit({id,qty,price,queueAhead},at){
    if(this.orders.has(id))return this.orders.get(id);
    if(!id||![qty,price,queueAhead].every(Number.isFinite)||qty<=0||price<=0||queueAhead<0)throw new Error('Invalid queue intent');
    const row={id,qty,price,filled:0,ahead:queueAhead*this.queueMultiplier,at,status:'pending'};this.orders.set(id,row);return row;
  }
  cancelAll(){for(const o of this.orders.values())if(o.status==='pending'||o.status==='partial')o.status='canceled';}
  expire(at){for(const o of this.orders.values())if(at-o.at>=this.ttlMs&&['pending','partial'].includes(o.status))o.status='expired';}
  trade(m,observedAt){
    this.expire(observedAt);if(!Number.isSafeInteger(m.a)||this.seen.has(m.a)||m.m!==true||!Number.isFinite(m.T)||m.T>observedAt+1000||observedAt-m.T>2000)return [];
    const price=Number(m.p),volume=Number(m.q);if(!(price>0&&volume>0)||!Number.isFinite(price)||!Number.isFinite(volume))return [];
    this.seen.add(m.a);const fills=[];let remaining=volume;
    for(const o of this.orders.values()){
      if(!['pending','partial'].includes(o.status)||observedAt<o.at+this.latencyMs||m.T<o.at+this.latencyMs||price!==o.price)continue;
      const ahead=Math.min(o.ahead,remaining);o.ahead-=ahead;remaining-=ahead;
      const qty=Math.min(o.qty-o.filled,remaining);if(qty<=0)continue;
      o.filled+=qty;remaining-=qty;o.status=o.filled>=o.qty?'filled':'partial';fills.push({id:o.id,qty,price,ts:observedAt,liquidity:'maker'});
    }return fills;
  }
}
export function venueQuantity(notional,price,filters){
  const lot=filters?.find(f=>f.filterType==='LOT_SIZE'),min=filters?.find(f=>['NOTIONAL','MIN_NOTIONAL'].includes(f.filterType));
  if(!lot||!min||!(Number(lot.stepSize)>0))return 0;
  const step=Number(lot.stepSize),qty=Math.floor(notional/price/step+1e-9)*step;
  return qty>=Number(lot.minQty)&&qty<=Number(lot.maxQty)&&qty*price>=Number(min.minNotional)?qty:0;
}
