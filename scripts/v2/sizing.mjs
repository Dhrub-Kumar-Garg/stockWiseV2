// scripts/v2/sizing.mjs — Position sizing (Kelly-based, vol-adjusted)
// Turns a raw open order into concrete { leverage, marginUsd }.
// Bets bigger only after a strategy proves it works. Never chases losses.

import { V2, readJSON, clamp } from "./store.mjs";

function dailyVol(closes) {
  if (!closes || closes.length < 15) return 0.03;
  const c = closes.slice(-15); const r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
  return clamp(v, 0.005, 0.15);
}

export function sizeOrder(state, o, eq, cfg) {
  if (!o || o.op !== "open") return o;
  const V = cfg.v2;
  const market = (cfg.watchlist.find((w) => w.symbol === o.symbol) || {}).market || "crypto";
  const marketMax = V.leverage[market]?.maxLeverage || 1;

  let lev = o.leverage || state.aggression.leverageCap;
  lev = clamp(lev, 1, Math.min(state.aggression.leverageCap, state.aggression.leverageCeiling, marketMax));

  const explicit = o.marginUsd != null;
  let marginUsd = o.marginUsd;
  if (!explicit) {
    let base;
    if (o.strategy_id) {
      const lib = readJSON(V2.strategies) || { strategies: [] };
      const st = (lib.strategies || []).find((s) => s.id === o.strategy_id);
      const acctMult = clamp(state.aggression.kellyFraction / V.aggression.kellyFractionStart, 0.4, 1.6);
      base = clamp((Number.isFinite(st?.kelly) ? st.kelly : 0.1) * acctMult, 0.02, 0.40);
    } else {
      base = o.sizePct != null ? o.sizePct : (state.aggression.kellyFraction ?? 0.25) * 0.5;
    }
    marginUsd = base * state.equity;

    const volTargetDaily = (V.aggression.volTargetAnnual ?? 0.8) / Math.sqrt(365);
    const v = dailyVol(eq[o.symbol]?.closes);
    marginUsd *= clamp(volTargetDaily / v, 0.25, 1.7);

    const g = state.goal;
    if (g && g.target > g.startEquity) {
      const progress = (state.equity - g.startEquity) / (g.target - g.startEquity);
      if (progress > 0 && progress < 1) marginUsd *= 1 + clamp(0.55 * (1 - progress), 0, 0.55);
    }
  }

  marginUsd = clamp(marginUsd, 0, Math.max(0, state.walletBalance * 0.98));
  return { ...o, leverage: lev, marginUsd };
}
