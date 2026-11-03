// Persistent paper risk state. Resume clears only operator pause, never loss locks.
export function evaluateRisk(state, cfg, at = Date.now()) {
  const limits = cfg.v2?.safety || {};
  const maxDrawdown = limits.maxDrawdown ?? 0.10, maxDailyLoss = limits.maxDailyLoss ?? 0.02;
  if (![maxDrawdown, maxDailyLoss].every(x => Number.isFinite(x) && x > 0 && x < 1)) throw new Error('Invalid loss limits');
  const day = new Date(at).toISOString().slice(0, 10);
  state.risk ||= {operatorPaused: state.riskState === 'halt', lifetimePeak: state.equity, day, dayStartEquity: state.equity};
  const risk = state.risk;
  if (risk.day !== day) { risk.day = day; risk.dayStartEquity = risk.lastEquity ?? state.equity; risk.dailyLossLocked = false; }
  risk.dataError = !Number.isFinite(state.equity);
  if (!risk.dataError) {
    risk.lifetimePeak = Math.max(risk.lifetimePeak || 0, state.equity);
    risk.drawdown = risk.lifetimePeak > 0 ? Math.max(0, 1 - state.equity / risk.lifetimePeak) : 0;
    risk.dailyLoss = risk.dayStartEquity > 0 ? Math.max(0, 1 - state.equity / risk.dayStartEquity) : 0;
    risk.drawdownLocked ||= state.equity <= risk.lifetimePeak * (1 - maxDrawdown);
    risk.dailyLossLocked ||= state.equity <= risk.dayStartEquity * (1 - maxDailyLoss);
    risk.insolvent ||= state.equity <= 0;
    risk.lastEquity = state.equity;
    state.peakEquity = Math.max(state.peakEquity || 0, risk.lifetimePeak);
    state.maxDrawdownPct = Math.max(state.maxDrawdownPct || 0, risk.drawdown);
  }
  risk.reasons = ['operatorPaused', 'drawdownLocked', 'dailyLossLocked', 'insolvent', 'dataError', 'historyCapacityLocked'].filter(k => risk[k]);
  risk.blocked = risk.reasons.length > 0;
  risk.flatten = Boolean(risk.drawdownLocked || risk.dailyLossLocked || risk.insolvent || (risk.operatorPaused && limits.flattenOnPause));
  state.riskState = risk.blocked ? 'halt' : risk.drawdown >= maxDrawdown / 2 ? 'caution' : 'normal';
  return risk;
}
export function canOpen(state, cfg, at = Date.now()) { return !evaluateRisk(state, cfg, at).blocked; }
export function operatorPause(state, paused = true) {
  state.risk ||= {};
  state.risk.operatorPaused = paused;
  if (paused) { state.risk.blocked = true; state.riskState = 'halt'; }
}
export function acknowledgeDrawdownReset(state, acknowledgement, at = Date.now()) {
  if (acknowledgement !== 'ACKNOWLEDGE_PAPER_RISK_RESET' || state.mode !== 'paper' || Object.keys(state.positions || {}).length || state.equity <= 0) throw new Error('Explicit flat paper-account risk reset required');
  state.risk ||= {};
  state.risk.drawdownLocked = false; state.risk.lifetimePeak = state.equity; state.risk.resetAt = at;
  // Daily loss/operator locks remain intact. No capital is injected.
}
