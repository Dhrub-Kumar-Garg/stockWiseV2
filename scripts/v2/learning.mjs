// Cost-net, causally available observations only. Heuristic signal scores are not probabilities.
export function estimateEdge(observations, {cutoff = Date.now(), minTrades = 30, fraction = 0.25} = {}) {
  const seen = new Set();
  const trades = (observations || []).filter(t => {
    const id = t.trade_id ?? t.id;
    if (!id || seen.has(id) || t.accountingVersion !== 3 || !Number.isFinite(t.closedAt ?? t.ts_close) || (t.closedAt ?? t.ts_close) >= cutoff || !Number.isFinite(t.realized_R)) return false;
    seen.add(id); return true;
  }).slice(-200);
  const rs = trades.map(t => t.realized_R), n = rs.length, wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0);
  const average = a => a.length ? a.reduce((s, x) => s+x, 0)/a.length : 0;
  const expectedNetR = average(rs), sd = n > 1 ? Math.sqrt(rs.reduce((s, r) => s+(r-expectedNetR)**2, 0)/(n-1)) : 0;
  const p = n ? wins.length/n : 0, z = 1.96;
  const lowerWinRate = n ? (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n) : 0;
  const payoff = losses.length && average(losses) < 0 ? average(wins)/-average(losses) : 0;
  const lowerNetR = n ? expectedNetR-z*sd/Math.sqrt(n) : 0;
  const eligible = n >= minTrades && wins.length >= 5 && losses.length >= 5 && payoff > 0 && expectedNetR > 0 && lowerNetR > 0;
  const kelly = eligible ? Math.max(0, lowerWinRate-(1-lowerWinRate)/payoff) : 0;
  return {accountingVersion: 3, n, asOf: cutoff, win_rate: p, lowerWinRate, payoff, expectedNetR, lowerNetR,
    kelly: Math.min(0.25, Math.max(0, fraction)*kelly), eligible: eligible && kelly > 0};
}
export function strategyObservations(state, strategyId, side) {
  return (state.closedTrades || []).filter(t => t.strategy_id === strategyId && (!side || t.side === side));
}
