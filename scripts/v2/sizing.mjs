// scripts/v2/sizing.mjs — Position sizing (Kelly-based, vol-adjusted)
// Turns a raw open order into concrete { leverage, marginUsd }.
// Bets bigger only after a strategy proves it works. Never chases losses.

import { V2, readJSON, clamp } from "./store.mjs";
import {estimateEdge, strategyObservations} from './learning.mjs';
import {budgetOrder} from './portfolio.mjs';

function dailyVol(closes) {
  if (!closes || closes.length < 15) return 0.03;
  const c = closes.slice(-15); const r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
  return clamp(v, 0.005, 0.15);
}

export function sizeOrder(state, o, eq, cfg, options = {}) {
  if (!o || o.op !== "open") return o;
  const V = cfg.v2;
  const at = options.now ?? Date.now();
  const ledger = options.ledger ?? readJSON(V2.strategies, []);
  const strategies = Array.isArray(ledger) ? ledger : ledger?.strategies || [];
  const strategy = strategies.find(s => s.id === o.strategy_id);
  const observations = options.observations ?? strategyObservations(state, o.strategy_id, o.side);
  const edge = estimateEdge(observations, {cutoff: at, minTrades: V.learning?.minTrades ?? 30, fraction: V.learning?.kellyFraction ?? 0.25});
  if (!strategy || strategy.status === 'retired' || !edge.eligible) return {...o, marginUsd: 0, rejected: 'insufficient_cost_net_edge', edge};
  const market = (cfg.watchlist.find((w) => w.symbol === o.symbol) || {}).market || "crypto";
  const marketMax = V.leverage[market]?.maxLeverage || 1;

  let lev = o.leverage || state.aggression.leverageCap;
  lev = clamp(lev, 1, Math.min(state.aggression.leverageCap, state.aggression.leverageCeiling, marketMax));

  const costs = 2*((V.perpFees?.taker ?? 0.0005)+(cfg.slippage?.[market] ?? 0.001)+(V.halfSpread?.[market] ?? 0.0002));
  if (!Number.isFinite(o.stopPct) || o.stopPct <= 0) return {...o, marginUsd: 0, rejected: "invalid_stop"};
  const learned = strategy.learned;
  const learnedCap = learned?.accountingVersion === 3 && learned.n >= 30 && learned.asOf < at && Number.isFinite(learned.kelly)
    ? Math.max(0, learned.kelly) : edge.kelly;
  const riskFraction = Math.min(V.safety?.maxRiskPerTrade ?? 0.005, edge.kelly, learnedCap);
  const volatilityScale = Math.min(1, (V.aggression.volTargetAnnual ?? 0.6)/Math.sqrt(365)/dailyVol(eq[o.symbol]?.closes));
  const sizeScale=o.sizeScale==null?1:Math.max(0,Math.min(1,Number.isFinite(o.sizeScale)?o.sizeScale:0));
  const maximum = sizeScale*Math.max(0, state.equity*riskFraction*volatilityScale/(lev*(o.stopPct+costs)));
  const marginUsd = o.marginUsd == null ? maximum : Math.min(Math.max(0, o.marginUsd), maximum);
  return {...budgetOrder(state, {...o, leverage: lev, marginUsd}, eq, cfg, at), edge};
}
