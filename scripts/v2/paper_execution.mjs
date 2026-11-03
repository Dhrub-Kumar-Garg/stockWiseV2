// Pure executable-quote simulator; no broker or network client.
export class PaperExecution {
  constructor({latencyMs=100,ttlMs=10000,participation=0.1}={}) {
    if(latencyMs<0||ttlMs<=0||participation<=0||participation>1)throw new Error('Invalid paper assumptions');
    Object.assign(this,{latencyMs,ttlMs,participation,orders:new Map(),events:new Set()});
  }
  submit(order,at){
    if(this.orders.has(order.id))return structuredClone(this.orders.get(order.id));
    if(!order.id||!['buy','sell'].includes(order.side)||!['market','limit'].includes(order.type)||!(order.qty>0)||!Number.isFinite(order.qty)||order.type==='limit'&&!(order.price>0))throw new Error('Invalid paper intent');
    const row={...order,createdAt:at,filled:0,status:'pending'};this.orders.set(order.id,row);return structuredClone(row);
  }
  cancel(id){const row=this.orders.get(id);if(row&&!['filled','expired'].includes(row.status))row.status='canceled';}
  observe(q){
    if(!q.id||this.events.has(q.id)||!Number.isFinite(q.ts)||!(q.bid>0&&q.ask>=q.bid))return [];
    this.events.add(q.id);const fills=[];
    for(const o of this.orders.values()){
      if(['filled','expired','canceled'].includes(o.status))continue;
      if(q.ts>=o.createdAt+this.ttlMs){o.status='expired';continue;}
      if(q.ts<o.createdAt+this.latencyMs||q.sourceTs<o.createdAt)continue;
      const buy=o.side==='buy',price=buy?q.ask:q.bid;
      // Passive touch is NOT a maker fill: only executable marketable limits fill here.
      if(o.type==='limit'&&(buy?o.price<q.ask:o.price>q.bid))continue;
      const available=Number(buy?q.askSize:q.bidSize)*this.participation;
      if(!Number.isFinite(available)||available<=0)continue;
      const qty=Math.min(o.qty-o.filled,available);o.filled+=qty;o.status=o.filled>=o.qty?'filled':'partial';
      fills.push({id:o.id,event:q.id,qty,price,ts:q.ts,liquidity:'taker',remaining:o.qty-o.filled});
    }return fills;
  }
}
