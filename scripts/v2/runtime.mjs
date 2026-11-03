// Synchronous paper cycle, with injectable signals/clock and no network or filesystem writes.
import * as P from './perp.mjs';
import * as A from './accounting.mjs';
import {freshV2State} from './episode.mjs';
import {evaluateRisk} from './risk.mjs';
import {budgetOrder, rankOrders} from './portfolio.mjs';
import {sizeOrder} from './sizing.mjs';
import {SEED_STRATEGIES, runStrategies} from './strategies.mjs';
import {quoteUsable} from './market_data.mjs';

export function createPaperState(cfg, at = Date.now()) {
  const state = freshV2State(cfg);
  Object.assign(state, {startedAt:at, updatedAt:at, intents:[], fills:[], equityHistory:[], closedTrades:[],
    cashflows:[{id:'initial', type:'deposit', amount:cfg.v2.startingCapital, ts:at}],
    strategies: SEED_STRATEGIES.map(s => ({...s, learned:{n:0,kelly:0,confidence:0}}))});
  return state;
}
export function paperTick(state, quotes, cfg, {at = Date.now(), evaluate = runStrategies, context = {}} = {}) {
  A.assertPaperAccount(state);
  if (cfg.v2.execution?.mode !== 'paper') throw new Error('Paper execution mode required');
  const events = [], valid = Object.fromEntries(Object.entries(quotes).filter(([,q]) => q.currency === 'USD' && quoteUsable(q,at,cfg.v2.data?.maxQuoteAgeMs ?? 30000)));
  state.updatedAt = at; state.cycles = (state.cycles || 0)+1;
  function close(symbol, reason) {
    const pos = state.positions[symbol], q = valid[symbol];
    if (!pos || !q) return false;
    const cost = (cfg.slippage[pos.market] ?? 0.001)+(cfg.v2.halfSpread?.[pos.market] ?? 0.0002);
    const exit = q.price*(1-P.sideSign(pos.side)*cost);
    const out = A.settleClose(state,pos,exit,cfg.v2.perpFees.taker,reason,at);
    const event = {type:'close', trade_id:pos.openMeta.trade_id, symbol, strategy_id:pos.openMeta.strategy_id, side:pos.side,
      entryPrice:pos.entryPrice, exitPrice:exit, margin:pos.initialMargin, leverage:pos.leverage, net_pnl:out.netPnl,
      realized_R:out.realizedR, roi_on_margin:out.roiOnMargin, fees:out.fees, funding:out.funding, borrow:out.borrow,
      isolationAdjustment:out.isolationAdjustment, accountingVersion:3, openedAt:pos.openedAt, closedAt:at, exit_reason:reason};
    events.push(event); state.lastClosed ||= {}; state.lastClosed[symbol] = at;
    delete state.positions[symbol]; return true;
  }
  for (const [symbol,pos] of Object.entries(state.positions)) {
    const q = valid[symbol]; if (!q) continue;
    pos.lastMark = q.price;
    if (pos.market === 'crypto') for (const ts of P.crossedFundingTimestamps(pos.lastFundingTs,at,cfg.v2.fundingHoursUTC)) {
      A.settleFunding(state,pos,cfg.v2.execution.modeledFundingRatePer8h,ts,q.price,'modeled-paper-8h');
    }
    else A.settleBorrow(state,pos,cfg.v2.leverage[pos.market]?.borrowAnnual || 0,at,q.price);
    const snap = P.markPosition(pos,q.price), move = (q.price/pos.entryPrice-1)*P.sideSign(pos.side);
    const previousPeak = pos.peakUPnl || 0; pos.peakUPnl = Math.max(previousPeak,snap.uPnl);
    if (snap.liquidated) close(symbol,'liquidation');
    else if (move <= -pos.openMeta.stopPct) close(symbol,'stop-loss');
    else if (move >= pos.openMeta.targetPct) close(symbol,'take-profit');
    else if (at-pos.openedAt >= cfg.v2.aggression.maxHoldHours*3600000) close(symbol,'time-exit');
    else if (previousPeak/pos.initialMargin >= cfg.v2.aggression.trailActivateRoi && snap.uPnl/pos.initialMargin <= previousPeak/pos.initialMargin-cfg.v2.aggression.trailGiveRoi) close(symbol,'trailing-stop');
  }
  A.equityAt(state,valid);
  let risk = evaluateRisk(state,cfg,at);
  if (risk.flatten) { for (const symbol of Object.keys(state.positions)) close(symbol,'risk-lock'); A.equityAt(state,valid); }
  const pending = state.intents || []; state.intents = [];
  for (const intent of rankOrders(pending)) {
    const q = valid[intent.symbol];
    if (intent.expiresAt <= at) { events.push({type:'reject',id:intent.id,reason:'expired',ts:at}); continue; }
    if (!q || at <= intent.decisionAt || q.sourceTs <= intent.decisionSourceTs) { state.intents.push(intent); continue; }
    if (intent.op === 'close') { if (!close(intent.symbol,intent.reason || 'strategy-exit')) state.intents.push(intent); continue; }
    if (risk.blocked) { events.push({type:'reject',id:intent.id,reason:'risk_locked',ts:at}); continue; }
    const sized = sizeOrder(state,intent,valid,cfg,{now:at,ledger:state.strategies});
    const order = budgetOrder(state,sized,valid,cfg,at);
    if (!order.marginUsd) { events.push({type:'reject',id:intent.id,reason:order.rejected || sized.rejected,ts:at}); continue; }
    const market = order.market, cost = (cfg.slippage[market] ?? 0.001)+(cfg.v2.halfSpread?.[market] ?? 0.0002);
    const pos = P.openPosition({symbol:order.symbol,market,side:order.side,entryMark:q.price*(1+P.sideSign(order.side)*cost),
      margin:order.marginUsd,leverage:order.leverage,tiers:cfg.v2.maintenanceTiers[market],meta:{...order,trade_id:order.id,regime:state.regime}});
    pos.openedAt = at; pos.lastFundingTs = at; pos.lastBorrowTs = at; pos.lastMark = q.price; pos.riskBudgetUsd = order.riskBudgetUsd;
    A.recordEntry(state,pos,cfg.v2.perpFees.taker,at); state.positions[order.symbol] = pos;
    events.push({type:'fill',id:order.id,trade_id:order.id,symbol:order.symbol,side:order.side,strategy_id:order.strategy_id,
      price:pos.entryPrice,margin:pos.initialMargin,notional:pos.notional,leverage:pos.leverage,fee:pos.entryFee,ts:at});
    A.equityAt(state,valid); risk = evaluateRisk(state,cfg,at);
  }
  const orders = evaluate(state,valid,cfg,{...context,strategies:state.strategies,now:at,analyst:context.analyst || {mode:'SLEEP',direction_bias:'NEUTRAL',aggression:0}});
  for (const order of orders) {
    const q = valid[order.symbol]; if (!q || (risk.blocked && order.op === 'open')) continue;
    if (state.intents.some(i => i.symbol === order.symbol && i.op === order.op)) continue;
    const id = order.trade_id || `${order.strategy_id || 'manual'}:${order.op}:${order.symbol}:${at}`;
    state.intents.push({...order,id,decisionAt:at,decisionSourceTs:q.sourceTs,expiresAt:at+cfg.v2.execution.orderTtlMs});
  }
  A.equityAt(state,valid); evaluateRisk(state,cfg,at);
  state.fills = [...(state.fills || []),...events].slice(-1000);
  const external = state.cashflows.filter(f => f.id !== 'initial' && f.ts <= at).reduce((s,f)=>s+f.amount,0);
  state.equityHistory = [...(state.equityHistory || []),{ts:at,equity:state.equity,netEquity:state.equity-external,
    wallet:state.walletBalance,dd:state.risk.drawdown,riskState:state.riskState}].slice(-20000);
  state.health = {status:Object.keys(valid).length ? 'healthy':'waiting_data',validQuotes:Object.keys(valid).length,totalQuotes:Object.keys(quotes).length,lastTick:at};
  return events;
}
export function signalsFor(state, cfg, at = Date.now()) {
  const deposits = (state.cashflows || []).reduce((s,f)=>s+f.amount,0);
  const positions = Object.values(state.positions).map(p => ({symbol:p.symbol,market:p.market,side:p.side,leverage:p.leverage,
    margin:p.initialMargin,notional:p.qty*p.lastMark,entry:p.entryPrice,mark:p.lastMark,liqPrice:p.liqPrice,
    uPnl:P.unrealizedPnl(p.side,p.entryPrice,p.lastMark,p.qty),strategy_id:p.openMeta.strategy_id}));
  return {version:3,mode:'paper',ts:state.updatedAt,episodeNum:state.episodeNum,equity:state.equity,walletBalance:state.walletBalance,
    startingCapital:state.startingCapital,totalPnl:state.equity-deposits,totalNetPnl:state.equity-deposits,
    totalPnlPct:deposits>0?(state.equity-deposits)/deposits:0,peakEquity:state.peakEquity,maxDrawdownPct:state.maxDrawdownPct,
    riskState:state.riskState,regime:state.regime,generation:state.generation,aggression:state.aggression,lifetime:state.lifetime,
    grossLeverage:state.equity>0?positions.reduce((s,p)=>s+p.notional,0)/state.equity:0,health:state.health,positions,
    analyst:state.analyst || {mode:'SLEEP',direction_bias:'NEUTRAL',stale:true},world:state.world || {}};
}
