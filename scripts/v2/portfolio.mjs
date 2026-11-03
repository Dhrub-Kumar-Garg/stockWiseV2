import {canOpen} from './risk.mjs';
import {tierFor, sideSign} from './perp.mjs';
const valid = x => Number.isFinite(x) && x > 0;
export function alignedCorrelation(a, b, minimum = 60) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const other = new Map(b.filter(x => Number.isFinite(x.ts) && Number.isFinite(x.value)).map(x => [x.ts, x.value]));
  const pairs = a.filter(x => Number.isFinite(x.value) && other.has(x.ts)).map(x => [x.value, other.get(x.ts)]).slice(-90);
  if (pairs.length < minimum) return null;
  const x = pairs.reduce((s, p) => s+p[0], 0)/pairs.length, y = pairs.reduce((s, p) => s+p[1], 0)/pairs.length;
  let covariance = 0, vx = 0, vy = 0;
  for (const [a, b] of pairs) { covariance += (a-x)*(b-y); vx += (a-x)**2; vy += (b-y)**2; }
  return vx > 0 && vy > 0 ? covariance / Math.sqrt(vx*vy) : null;
}
export function rankOrders(orders) {
  return [...orders].sort((a, b) => (b.netExpectedReturn ?? b.expectedNetRLower ?? 0)-(a.netExpectedReturn ?? a.expectedNetRLower ?? 0) || a.symbol.localeCompare(b.symbol) || String(a.strategy_id || '').localeCompare(String(b.strategy_id || '')));
}
export function budgetOrder(state, order, quotes, cfg, at = Date.now()) {
  const reject = reason => ({...order, marginUsd: 0, rejected: reason});
  if (!canOpen(state, cfg, at)) return reject('risk_locked');
  if (!order || order.op !== 'open' || !['long', 'short'].includes(order.side)) return reject('invalid_order');
  const item = cfg.watchlist.find(w => w.symbol === order.symbol), q = quotes[order.symbol];
  if (!item || !cfg.v2.leverage?.[item.market]?.enabled || !valid(q?.price) || !valid(order.stopPct) || !valid(order.targetPct) || !valid(order.marginUsd)) return reject('invalid_market_or_amount');
  if (state.positions[order.symbol]) return reject('position_exists');
  const safety = cfg.v2.safety || {}, equity = state.equity;
  if (!valid(equity)) return reject('invalid_equity');
  const positions = Object.values(state.positions), reservations = Object.values(state.orderReservations || {}).filter(r => r.status === 'reserved');
  if (positions.length + reservations.length >= (cfg.v2.strategies.maxConcurrentPositions ?? 5) || reservations.some(r => r.symbol === order.symbol)) return reject('position_slots_reserved');
  const fee = cfg.v2.perpFees?.taker ?? 0.0005;
  const cost = 2 * (fee + (cfg.slippage?.[item.market] ?? 0.001) + (cfg.v2.halfSpread?.[item.market] ?? 0.0002));
  const cashReserved = reservations.reduce((s, r) => s+r.marginUsd+r.entryFee, 0);
  const exposures = [...positions.map(p => ({symbol: p.symbol, market: p.market,
    notional: p.qty * (quotes[p.symbol]?.price ?? p.lastMark ?? p.entryPrice), side: p.side,
    risk: p.riskBudgetUsd ?? p.notional*((p.openMeta?.stopPct ?? 0.04)+cost)})),
    ...reservations.map(r => ({...r, risk: r.riskBudgetUsd}))];
  const gross = exposures.reduce((s, p) => s+p.notional, 0), net = exposures.reduce((s, p) => s+sideSign(p.side)*p.notional, 0);
  const totalRisk = exposures.reduce((s, p) => s+p.risk, 0);
  const cluster = exposures.filter(p => p.market === item.market).reduce((s, p) => s+p.notional, 0);
  const correlated = exposures.filter(p => {
    const rho = alignedCorrelation(q.returns, quotes[p.symbol]?.returns);
    return rho == null || Math.abs(rho) >= (safety.correlationThreshold ?? 0.75);
  }).reduce((s, p) => s+p.notional, 0);
  let leverage = Math.min(order.leverage || 1, state.aggression?.leverageCap ?? 2,
    state.aggression?.leverageCeiling ?? 2, cfg.v2.leverage[item.market].maxLeverage, safety.maxPositionLeverage ?? 2);
  if (!valid(leverage) || leverage < 1) return reject('invalid_leverage');
  let notional = Math.min(order.marginUsd * leverage,
    equity * Math.min(safety.maxPositionMarginPct ?? 0.2, cfg.risk?.maxPositionPct ?? 0.3) * leverage,
    equity * (safety.maxGrossLeverage ?? 1.5) - gross,
    equity * (safety.maxNetLeverage ?? 1) - sideSign(order.side) * net,
    equity * (safety.maxClusterGross ?? 0.8) - cluster,
    equity * (safety.maxCorrelatedGross ?? 0.5) - correlated,
    equity * (safety.maxRiskPerTrade ?? 0.005) / (order.stopPct+cost),
    (equity * (safety.maxPortfolioRisk ?? 0.02) - totalRisk) / (order.stopPct+cost),
    (state.walletBalance-cashReserved-equity*(safety.minCashPct ?? 0.10)) / (1/leverage+fee));
  if (!valid(notional)) return reject('exposure_budget_exhausted');
  const tier = tierFor(notional, cfg.v2.maintenanceTiers[item.market]);
  leverage = Math.min(leverage, tier.maxLev);
  notional = Math.min(notional, order.marginUsd*leverage,
    equity*Math.min(safety.maxPositionMarginPct ?? 0.2, cfg.risk?.maxPositionPct ?? 0.3)*leverage,
    (state.walletBalance-cashReserved-equity*(safety.minCashPct ?? 0.10))/(1/leverage+fee));
  if (notional < (cfg.v2.strategies.minNotionalUsd ?? 2)) return reject('below_minimum_notional');
  return {...order, leverage, marginUsd: notional/leverage, notional, entryFee: notional*fee,
    riskBudgetUsd: notional*(order.stopPct+cost), market: item.market};
}
