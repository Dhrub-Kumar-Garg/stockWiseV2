// Atomic snapshot/order/event commits in local SQLite. Paper only; no remote services.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDTO} from './dashboard.mjs';
import {unrealizedPnl} from './perp.mjs';
function finiteTree(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite state cannot be persisted');
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
}
export class PaperStore {
  constructor(directory, {clock = Date.now, leaseMs = 120000, failpoint = () => {}} = {}) {
    this.directory=path.resolve(directory); this.clock=clock; this.leaseMs=leaseMs; this.failpoint=failpoint; this.token=randomUUID();
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.directory,'paper.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS snapshot(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_time ON events(ts);
      CREATE INDEX IF NOT EXISTS orders_status ON orders(status);`);
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  acquire() {
    this.atomic(()=>{
      const row=this.db.prepare('SELECT token,expires FROM lease WHERE id=1').get();
      if (row && row.token!==this.token && row.expires>this.clock()) throw new Error('Another paper engine owns this store');
      this.db.prepare('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires').run(this.token,this.clock()+this.leaseMs);
    }); return this;
  }
  assertLease() {
    const row=this.db.prepare('SELECT token,expires FROM lease WHERE id=1').get();
    if (!row || row.token!==this.token || row.expires<=this.clock()) throw new Error('Paper writer lease lost');
    this.db.prepare('UPDATE lease SET expires=? WHERE id=1 AND token=?').run(this.clock()+this.leaseMs,this.token);
  }
  load() {
    const row=this.db.prepare('SELECT revision,body FROM snapshot WHERE id=1').get();
    if (!row) return null;
    const state=JSON.parse(row.body);
    if (state.mode!=='paper' || state.accountingVersion!==3) throw new Error('Nonpaper or legacy snapshot refused');
    finiteTree(state); return {revision:row.revision,state};
  }
  persist(state, revision, publicBody) {
    finiteTree(state);
    if (state.mode!=='paper' || state.accountingVersion!==3) throw new Error('Paper snapshot v3 required');
    if (state.walletBalance<0) throw new Error('Negative paper cash refused');
    const expected=state.walletBalance+Object.values(state.positions || {}).reduce((sum,p)=>
      sum+p.isolatedMargin+unrealizedPnl(p.side,p.entryPrice,p.lastMark ?? p.entryPrice,p.qty),0);
    if (!Number.isFinite(expected) || Math.abs(expected-state.equity)>1e-7*Math.max(1,Math.abs(expected))) throw new Error('Unreconciled paper snapshot refused');
    const body=JSON.stringify(state); if (Buffer.byteLength(body)>25000000) throw new Error('Paper snapshot capacity exceeded; archive required');
    this.db.prepare('INSERT INTO snapshot VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(revision,body);
    if (publicBody) this.db.prepare('INSERT INTO dashboard VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(publicBody));
  }
  initialize(state, publicBody) {
    return this.atomic(()=>{this.assertLease(); if (this.load()) throw new Error('Paper store already initialized'); this.persist(state,1,publicBody);});
  }
  enqueue(intent) {
    if (!intent || typeof intent.id!=='string' || intent.id.length>160 || !intent.id || !['open','close','pause','resume'].includes(intent.op)) throw new Error('Valid unique paper command required');
    if (['open','close'].includes(intent.op) && (typeof intent.symbol!=='string' || !/^[A-Za-z0-9^=.\-]{1,32}$/.test(intent.symbol))) throw new Error('Valid paper symbol required');
    const at=this.clock();
    intent={decisionAt:at,decisionSourceTs:at,expiresAt:at+60000,...intent};
    if (!Number.isFinite(intent.decisionAt) || intent.decisionAt>at || !Number.isFinite(intent.expiresAt) || intent.expiresAt<=intent.decisionAt) throw new Error('Invalid paper command timestamp');
    if (intent.op==='open' && (!['long','short'].includes(intent.side) || ![intent.stopPct,intent.targetPct].every(x=>Number.isFinite(x)&&x>0) || intent.stopPct>=1)) throw new Error('Valid side and stop/target required');
    return this.atomic(()=>{
      const found=this.db.prepare('SELECT status FROM orders WHERE id=?').get(intent.id);
      if (found) return {duplicate:true,status:found.status};
      const snapshot=this.load(); if (!snapshot) throw new Error('Initialize paper account first');
      const size=this.db.prepare('SELECT count(*) AS n FROM orders').get().n;
      if (size>=1000000 && intent.op==='open') throw new Error('Order archive capacity reached; opens blocked');
      this.db.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(intent.id,'pending',JSON.stringify(intent),this.clock());
      snapshot.state.intents.push(intent);
      this.persist(snapshot.state,snapshot.revision+1);
      return {duplicate:false,status:'pending'};
    });
  }
  transact(fn, publish) {
    return this.atomic(()=>{
      this.assertLease(); const snapshot=this.load(); if (!snapshot) throw new Error('Initialize paper account first');
      const state=snapshot.state;
      state.risk ||= {};
      state.risk.historyCapacityLocked=this.db.prepare('SELECT count(*) AS n FROM orders').get().n>=1000000;
      state.intents=(state.intents || []).filter(intent=>{
        const row=this.db.prepare('SELECT status FROM orders WHERE id=?').get(intent.id);
        if (row && row.status!=='pending') return false;
        if (!row) this.db.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(intent.id,'pending',JSON.stringify(intent),this.clock());
        return true;
      });
      const events=fn(state) || [];
      this.failpoint('after_economic_effect');
      for (const event of events) {
        const orderId=event.requestId || event.id;
        if (orderId && !this.db.prepare('SELECT id FROM orders WHERE id=?').get(orderId)) {
          this.db.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(orderId,event.type==='reject'?'rejected':'completed',JSON.stringify(event),this.clock());
        }
        if (orderId) this.db.prepare('UPDATE orders SET status=?,updated=? WHERE id=?').run(event.type==='reject'?'rejected':'completed',this.clock(),orderId);
        const eventId=event.type==='close'?`close:${event.trade_id}`:`${event.type}:${event.id || createHash('sha256').update(JSON.stringify(event)).digest('hex')}`;
        this.db.prepare('INSERT INTO events(event_id,ts,body) VALUES(?,?,?)').run(eventId,event.ts || event.closedAt || this.clock(),JSON.stringify(event));
      }
      state.intents=state.intents.filter(intent=>{
        const row=this.db.prepare('SELECT status FROM orders WHERE id=?').get(intent.id);
        if (row && row.status!=='pending') {delete state.orderReservations?.[intent.id]; return false;}
        if (!row) this.db.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(intent.id,'pending',JSON.stringify(intent),this.clock());
        return true;
      });
      this.failpoint('before_snapshot');
      this.persist(state,snapshot.revision+1,publish?.(state));
      return {state,events,revision:snapshot.revision+1};
    });
  }
  close() {
    if (!this.db) return;
    this.db.prepare('DELETE FROM lease WHERE id=1 AND token=?').run(this.token);
    this.db.close(); this.db=null;
  }
}
export function readDashboard(directory) {
  const file=path.join(path.resolve(directory),'paper.sqlite');
  if (!fs.existsSync(file)) return dashboardDTO({signals:{ts:0,mode:'paper'}});
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const row=db.prepare('SELECT body FROM dashboard WHERE id=1').get();
    return row?dashboardDTO(JSON.parse(row.body).v2):dashboardDTO({});
  } finally {db.close();}
}
