import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {budgetOrder, alignedCorrelation, rankOrders} from '../scripts/v2/portfolio.mjs';
const cfg = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
const at = Date.UTC(2026, 0, 1);
const state = () => ({mode: 'paper', accountingVersion: 3, equity: 100, walletBalance: 100, positions: {}, aggression: {leverageCap: 12, leverageCeiling: 12}});
const order = symbol => ({op: 'open', symbol, side: 'long', marginUsd: 100, leverage: 12, stopPct: 0.04, targetPct: 0.12});
const quotes = Object.fromEntries(cfg.watchlist.map(w => [w.symbol, {price: 100}]));
test('every open including explicit margin is capped by leverage, stop risk and reserved cash', () => {
  const s = state(), o = budgetOrder(s, order('BTC-USD'), quotes, cfg, at);
  assert.ok(o.leverage <= 2); assert.ok(o.riskBudgetUsd <= 0.5+1e-10);
  assert.ok(o.marginUsd+o.entryFee <= 90); assert.ok(o.notional <= 50);
});
test('five concurrent candidate reservations cannot overspend portfolio loss budget', () => {
  const s = state(); s.orderReservations = {};
  for (const symbol of ['BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD']) {
    const o = budgetOrder(s, order(symbol), quotes, cfg, at);
    if (o.marginUsd) s.orderReservations[symbol] = {...o, status: 'reserved'};
  }
  const rs = Object.values(s.orderReservations);
  assert.ok(rs.reduce((n, r) => n+r.riskBudgetUsd, 0) <= 2+1e-9);
  assert.ok(rs.reduce((n, r) => n+r.notional, 0) <= 50+1e-9);
  assert.equal(budgetOrder(s, order('BTC-USD'), quotes, cfg, at).marginUsd, 0);
});
test('disabled markets, malformed amounts and halt fail closed', () => {
  const s = state(); s.riskState = 'halt'; assert.equal(budgetOrder(s, order('BTC-USD'), quotes, cfg, at).marginUsd, 0);
  assert.equal(budgetOrder(state(), {...order('BTC-USD'), marginUsd: NaN}, quotes, cfg, at).marginUsd, 0);
});
test('correlation aligns timestamps, reports unknown when insufficient', () => {
  const a = Array.from({length: 80}, (_, i) => ({ts: i, value: Math.sin(i)}));
  assert.ok(alignedCorrelation(a, a) > 0.99999);
  assert.equal(alignedCorrelation(a, a.slice(0, 10)), null);
  assert.equal(alignedCorrelation(a, a.map(x => ({...x, ts: x.ts+100}))), null);
});
test('allocation ordering is invariant to watchlist order', () => {
  const orders = ['SOL-USD','BTC-USD','ETH-USD'].map(order);
  assert.deepEqual(rankOrders(orders), rankOrders([...orders].reverse()));
});
test('tier leverage reductions cannot increase margin past its cap', () => {
  const settings = structuredClone(cfg); settings.v2.maintenanceTiers.crypto[0].maxLev = 1;
  const o = budgetOrder(state(), {...order('BTC-USD'), stopPct: 0.0001}, quotes, settings, at);
  assert.equal(o.leverage, 1); assert.ok(o.marginUsd <= 20); assert.ok(o.marginUsd+o.entryFee <= 90);
});
