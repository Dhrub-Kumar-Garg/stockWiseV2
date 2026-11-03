// Isolated-margin PAPER cash accounting, version 3. No broker interaction.
import {unrealizedPnl, fundingPayment} from './perp.mjs';
export function finite(value, label, {positive = false, nonnegative = false} = {}) {
  if (!Number.isFinite(value) || (positive && value <= 0) || (nonnegative && value < 0)) throw new Error(`Invalid ${label}`);
  return value;
}
export function assertPaperAccount(state) {
  if (state.mode !== 'paper' || state.accountingVersion !== 3) throw new Error('Paper accounting v3 required; legacy state requires explicit migration');
  finite(state.walletBalance, 'wallet', {nonnegative: true});
}
function record(state, event) {
  state.cashLedger ||= [];
  state.cashLedger.push(event);
  state.cashLedger = state.cashLedger.slice(-2000);
}
export function recordEntry(state, pos, rate, at = Date.now()) {
  assertPaperAccount(state);
  const margin = finite(pos.isolatedMargin, 'margin', {positive: true});
  const fee = finite(pos.notional, 'notional', {positive: true}) * finite(rate, 'fee rate', {nonnegative: true});
  if (margin + fee > state.walletBalance + 1e-10) throw new Error('Insufficient unreserved cash including fees');
  pos.accountingVersion = 3; pos.initialMargin = margin; pos.entryFee = fee; pos.feesPaid = fee;
  pos.riskUsd = pos.notional * finite(pos.openMeta?.stopPct ?? 0.04, 'stop risk', {positive: true});
  pos.fundingPayments = {}; pos.fundingAccrued = 0; pos.borrowAccrued = 0;
  state.walletBalance = Math.max(0, state.walletBalance - margin - fee);
  record(state, {type: 'entry', id: pos.openMeta?.trade_id, cash: -margin - fee, fee, ts: at});
  return fee;
}
export function settleFunding(state, pos, rate, timestamp, mark, venue = 'paper') {
  assertPaperAccount(state);
  if (pos.accountingVersion !== 3 || pos.closed) throw new Error('Invalid funding position version');
  finite(timestamp, 'funding timestamp', {positive: true}); finite(mark, 'funding mark', {positive: true}); finite(rate, 'funding rate');
  const id = `${venue}:${pos.symbol}:${timestamp}`;
  if (Object.hasOwn(pos.fundingPayments, id)) return 0;
  const payment = fundingPayment(pos.qty * mark, rate, pos.side);
  pos.fundingPayments[id] = payment;
  pos.fundingAccrued += payment;
  pos.isolatedMargin += payment; // signed flow settles into collateral immediately
  pos.lastFundingTs = Math.max(pos.lastFundingTs || 0, timestamp);
  record(state, {type: 'funding', id, symbol: pos.symbol, cash: 0, collateral: payment, ts: timestamp});
  return payment;
}
export function settleBorrow(state, pos, annualRate, timestamp, mark) {
  assertPaperAccount(state);
  finite(annualRate, 'borrow rate', {nonnegative: true});
  const from = pos.lastBorrowTs ?? pos.openedAt;
  if (timestamp <= from || annualRate === 0) return 0;
  const borrowed = Math.max(0, pos.qty * mark - pos.initialMargin);
  const payment = -borrowed * annualRate * (timestamp - from) / (365 * 86400000);
  pos.borrowAccrued += payment; pos.isolatedMargin += payment; pos.lastBorrowTs = timestamp;
  record(state, {type: 'borrow', symbol: pos.symbol, collateral: payment, ts: timestamp});
  return payment;
}
export function settleClose(state, pos, exitFill, rate, reason, at = Date.now()) {
  assertPaperAccount(state);
  if (pos.accountingVersion !== 3 || pos.closed) throw new Error('Legacy or already closed position');
  finite(exitFill, 'exit fill', {positive: true}); finite(rate, 'exit fee', {nonnegative: true});
  const rawPnl = unrealizedPnl(pos.side, pos.entryPrice, exitFill, pos.qty);
  const exitFee = pos.qty * exitFill * rate;
  const rawRecovery = pos.isolatedMargin + rawPnl - exitFee;
  const recovery = reason === 'liquidation' ? 0 : Math.max(0, rawRecovery);
  const netPnl = recovery - pos.initialMargin - pos.entryFee;
  const fees = pos.entryFee + exitFee, funding = pos.fundingAccrued || 0, borrow = pos.borrowAccrued || 0;
  // Explicit paper-isolated bankruptcy writeoff / forfeited collateral, never a hidden wallet debit.
  const isolationAdjustment = netPnl - (rawPnl + funding + borrow - fees);
  state.walletBalance += recovery;
  state.realizedPnlEpisode = (state.realizedPnlEpisode || 0) + netPnl;
  state.closedTrades ||= [];
  state.closedTrades.push({trade_id: pos.openMeta?.trade_id, strategy_id: pos.openMeta?.strategy_id, symbol: pos.symbol, side: pos.side,
    accountingVersion: 3, closedAt: at, net_pnl: netPnl, realized_R: pos.riskUsd > 0 ? netPnl/pos.riskUsd : 0,
    regime: pos.openMeta?.regime || state.regime || 'unknown'});
  state.closedTrades = state.closedTrades.slice(-6000);
  pos.closed = true;
  record(state, {type: 'close', id: pos.openMeta?.trade_id, cash: recovery, netPnl, fees, funding, borrow, isolationAdjustment, ts: at});
  return {rawPnl, exitFee, fees, funding, borrow, netPnl, isolationAdjustment,
    realizedR: pos.riskUsd > 0 ? netPnl / pos.riskUsd : 0,
    roiOnMargin: netPnl / pos.initialMargin};
}
export function equityAt(state, marks = {}) {
  assertPaperAccount(state);
  let margin = 0, uPnl = 0;
  for (const [symbol, pos] of Object.entries(state.positions)) {
    if (pos.closed) throw new Error('Closed position retained in account');
    const mark = marks[symbol]?.price ?? marks[symbol] ?? pos.lastMark ?? pos.entryPrice;
    finite(mark, 'mark', {positive: true});
    margin += pos.isolatedMargin; uPnl += unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  }
  state.equity = state.walletBalance + margin + uPnl;
  return {margin, uPnl, equity: state.equity};
}
