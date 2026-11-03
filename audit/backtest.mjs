// Offline, source-linked conditional research replay. See EXPERIMENT_PLAN.md.
// Usage: node audit/backtest.mjs [--quick] [--stress]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { sandbox, config, clone, ROOT, declarations } from './source_adapter.mjs';

const DAY = 86_400_000, BAR = 900_000;
const symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
const input = path.join(ROOT, 'audit/data');
const out = path.join(ROOT, 'audit/results');
const start = Date.UTC(2024, 0, 1);
const at = date => Math.round((Date.parse(date) - start) / BAR);
const quick = process.argv.includes('--quick');
const stress = process.argv.includes('--stress');
const data = {}, daily = {}, dailyCache = new Map(), heavySignals = new Map();
const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json')));
for (const entry of manifest.files) {
  const payload = fs.readFileSync(path.join(input, entry.file));
  assert.equal(crypto.createHash('sha256').update(payload).digest('hex'), entry.sha256);
}
for (const symbol of symbols) {
  const bars = JSON.parse(fs.readFileSync(path.join(input, `${symbol}_15m.json`)));
  const days = JSON.parse(fs.readFileSync(path.join(input, `${symbol}_1d.json`))).map(b => b[4]);
  for (let i = 0; i < bars.length; i++) {
    assert.equal(bars[i][0], start + i * BAR, `Gap or duplicate: ${symbol}/${i}`);
    if (i % 96 === 95) days.push(bars[i][4]);
  }
  assert.equal(bars.length, 70176);
  data[`${symbol}-USD`] = bars;
  daily[`${symbol}-USD`] = days;
}

function quotes(i, h) {
  const day = Math.floor(i / 96), eq = {};
  for (const symbol of Object.keys(data)) {
    const key = symbol + '/' + day;
    let history = dailyCache.get(key);
    if (!history) {
      // Current day final close is intentionally excluded, including at 23:45.
      const closes = daily[symbol].slice(day, 365 + day);
      history = {closes, ...h.indicators(closes)};
      dailyCache.set(key, history);
    }
    eq[symbol] = {symbol, market: 'crypto', ok: true, stale: false,
      price: data[symbol][i][4], ...history,
      closesIntraday: data[symbol].slice(Math.max(0, i - 479), i + 1).map(b => b[4])};
  }
  return eq;
}

export function statistics(trades, curve, dailyReturns) {
  const pnls = trades.map(t => t.net), wins = pnls.filter(x => x > 0), losses = pnls.filter(x => x < 0);
  const mean = a => a.length ? a.reduce((a, b) => a + b, 0) / a.length : 0;
  const mu = mean(dailyReturns);
  const sd = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((a, b) => a + (b - mu) ** 2, 0) / (dailyReturns.length - 1)) : 0;
  let peak = curve[0] || 100, dd = 0;
  for (const equity of curve) { peak = Math.max(peak, equity); dd = Math.max(dd, (peak - equity) / peak); }
  const gains = wins.reduce((a, b) => a + b, 0), loss = -losses.reduce((a, b) => a + b, 0);
  return {sharpe: sd > 0 ? mu / sd * Math.sqrt(365) : null, maxDrawdown: dd,
    profitFactor: loss > 0 ? gains / loss : null, expectancyUsd: pnls.length ? mean(pnls) : null,
    tradeCount: trades.length, winRate: trades.length ? wins.length / trades.length : null,
    returnPct: curve.at(-1) / curve[0] - 1, finalEquity: curve.at(-1),
    feesUsd: trades.reduce((a, t) => a + t.fees, 0),
    signedFundingUsd: trades.reduce((a, t) => a + t.funding, 0),
    grossPnlUsd: trades.reduce((a, t) => a + t.gross, 0)};
}

function trainingEstimates(trades) {
  const estimates = {};
  for (const id of new Set(trades.map(t => t.id))) {
    const ts = trades.filter(t => t.id === id);
    const wins = ts.filter(t => t.net > 0), losses = ts.filter(t => t.net <= 0);
    const avg = a => a.length ? a.reduce((x, t) => x + t.riskReturn, 0) / a.length : 0;
    const p = wins.length / ts.length, b = losses.length ? avg(wins) / -avg(losses) : 0;
    const netMean = ts.reduce((x, t) => x + t.net, 0) / ts.length;
    estimates[id] = {n: ts.length, p, payoff: b, netMean,
      riskFraction: ts.length >= 30 && b > 0 && netMean > 0 ? Math.min(0.005, 0.25 * Math.max(0, p - (1 - p) / b)) : 0};
  }
  return estimates;
}

export const variants = ['baseline', 'ledger_wiring', 'fractional_kelly', 'exposure_cap',
  'kill_switch', 'no_unhedged_pairs', 'mtf_filter', 'hold_24h', 'cooldown_4h'];

export function simulate(from, to, mode, variant = 'baseline', estimates = {}) {
  const h = sandbox(mode), cfg = clone(config);
  cfg.watchlist = cfg.watchlist.filter(w => w.market === 'crypto');
  cfg.v2.analyst.enabled = false;
  h.setClock(start + from * BAR);
  const state = h.freshV2State(cfg);
  let currentIndex = from;
  for (const id of ['adaptive_regime', 'vol_expand']) {
    const original = h.SIGNAL_FN[id];
    h.SIGNAL_FN[id] = (q, s, eq) => {
      const key = `${id}/${q.symbol}/${currentIndex}`;
      if (!heavySignals.has(key)) heavySignals.set(key, original(q, s, eq));
      return heavySignals.get(key);
    };
  }
  if (variant === 'no_unhedged_pairs') h.SIGNAL_FN.pairs_trade = () => null;
  const ledgerSizer = declarations('sizing', {...h, readJSON: (p, fallback) => {
    const value = h.readJSON(p, fallback);
    return p === h.V2.strategies ? {strategies: value.map(s => ({...s, kelly: s.learned.kelly}))} : value;
  }}, ['sizeOrder']).sizeOrder;
  const cost = stress ? 0.0024 : 0.0012, feeRate = 0.0005, fundingRate = stress ? 0.0003 : 0.0001;
  const trades = [], curve = [100], dailyReturns = [], lastClosed = {};
  let queued = [], pendingCloses = [], day = -1, dailyStart = 100, lifetimePeak = 100;
  let episodePeak = 100, dailyLock = false, lifetimeLock = false;
  const equityAt = prices => state.walletBalance + Object.entries(state.positions).reduce((sum, [s, p]) =>
    sum + p.isolatedMargin + (prices[s] - p.entryPrice) * p.qty * h.P.sideSign(p.side), 0);
  function close(symbol, ref, reason, timestamp) {
    const pos = state.positions[symbol];
    if (!pos) return;
    const sign = h.P.sideSign(pos.side), exit = ref * (1 - sign * cost);
    const gross = (exit - pos.entryPrice) * pos.qty * sign, exitFee = exit * pos.qty * feeRate;
    // Isolated liquidation forfeits collateral; cannot debit unrelated cash.
    const returned = reason === 'liquidation' ? 0 : Math.max(0, pos.isolatedMargin + gross - exitFee);
    state.walletBalance += returned;
    const net = returned - pos.isolatedMargin - pos.feesPaid + pos.funding;
    trades.push({symbol, id: pos.openMeta.strategy_id, side: pos.side, openedAt: pos.openedAt,
      closedAt: timestamp, reason, net, gross, fees: pos.feesPaid + exitFee, funding: pos.funding,
      riskReturn: net / (pos.notional * pos.openMeta.stopPct), margin: pos.isolatedMargin});
    state.recentTradeResults = [...(state.recentTradeResults || []), net].slice(-20);
    state.lastTradeCloseTs = timestamp;
    lastClosed[symbol] = timestamp;
    delete state.positions[symbol];
  }
  function fill(order, ref, timestamp) {
    if (state.positions[order.symbol] || dailyLock || lifetimeLock || state.riskState === 'halt') return;
    const side = h.P.sideSign(order.side), entry = ref * (1 + side * cost);
    const leverage = variant === 'exposure_cap' ? Math.min(2, order.leverage) : order.leverage;
    let margin = order.marginUsd;
    if (variant === 'exposure_cap') {
      const currentGross = Object.values(state.positions).reduce((sum, p) => sum + p.notional, 0);
      margin = Math.min(margin, Math.max(0, state.equity * 1.5 - currentGross) / leverage);
    }
    margin = Math.min(margin, Math.max(0, state.walletBalance * 0.98), state.walletBalance / (1 + leverage * feeRate));
    if (margin < cfg.v2.strategies.minNotionalUsd || Object.keys(state.positions).length >= 5) return;
    const pos = h.P.openPosition({symbol: order.symbol, market: 'crypto', side: order.side,
      entryMark: entry, margin, leverage, tiers: cfg.v2.maintenanceTiers.crypto,
      meta: {strategy_id: order.strategy_id, stopPct: order.stopPct, targetPct: order.targetPct}});
    pos.openedAt = timestamp;
    pos.peakUPnl = 0;
    pos.feesPaid = pos.notional * feeRate;
    pos.funding = 0;
    state.walletBalance -= margin + pos.feesPaid;
    state.positions[order.symbol] = pos;
  }
  for (let i = from; i < to; i++) {
    currentIndex = i;
    const ts = start + i * BAR;
    const currentDay = Math.floor(ts / DAY);
    const opens = Object.fromEntries(Object.entries(data).map(([s, bs]) => [s, bs[i][1]]));
    if (day !== currentDay) {
      day = currentDay;
      dailyLock = false;
      dailyStart = state.equity;
      // Production episodes reset their risk peak every 24h. No cash injections.
      episodePeak = state.equity;
      state.startingCapital = Math.round(state.equity * 100) / 100;
      state.riskState = lifetimeLock ? 'halt' : 'normal';
    }
    // Funding is paid at the UTC boundary by positions held before it, not new fills.
    if (ts % (8 * 3600_000) === 0) {
      for (const [symbol, pos] of Object.entries(state.positions)) {
        const payment = -h.P.sideSign(pos.side) * pos.qty * opens[symbol] * fundingRate;
        pos.funding += payment;
        state.walletBalance += payment;
      }
    }
    for (const order of pendingCloses) close(order.symbol, opens[order.symbol], order.reason, ts);
    pendingCloses = [];
    state.equity = equityAt(opens);
    for (const order of queued) fill(order, opens[order.symbol], ts);
    queued = [];
    for (const [symbol, pos] of Object.entries(state.positions)) {
      const [, o, high, low, c] = data[symbol][i], sign = h.P.sideSign(pos.side);
      const stop = pos.entryPrice * (1 - sign * pos.openMeta.stopPct);
      const target = pos.entryPrice * (1 + sign * pos.openMeta.targetPct);
      const adverse = pos.side === 'long' ? low : high;
      const stopHit = pos.side === 'long' ? low <= stop : high >= stop;
      const targetHit = pos.side === 'long' ? high >= target : low <= target;
      if (h.P.isLiquidated(pos.side, o, pos.liqPrice)) { close(symbol, o, 'liquidation', ts); continue; }
      if (stopHit) { close(symbol, pos.side === 'long' ? Math.min(o, stop) : Math.max(o, stop), 'stop', ts + BAR); continue; }
      if (h.P.isLiquidated(pos.side, adverse, pos.liqPrice)) { close(symbol, pos.liqPrice, 'liquidation', ts + BAR); continue; }
      if (targetHit) { close(symbol, target, 'target', ts + BAR); continue; }
      const pnl = (c - pos.entryPrice) * pos.qty * sign;
      const priorPeak = pos.peakUPnl;
      pos.peakUPnl = Math.max(pos.peakUPnl, pnl);
      if (ts + BAR - pos.openedAt >= (variant === 'hold_24h' ? 24 : 2) * 3600_000) { close(symbol, c, 'time', ts + BAR); continue; }
      // Trailing uses only peaks observed at previous closes, avoiding H/L path inference.
      if (priorPeak / pos.isolatedMargin >= 0.5 && pnl / pos.isolatedMargin <= priorPeak / pos.isolatedMargin - 0.25) {
        close(symbol, c, 'trail', ts + BAR);
      }
    }
    const eq = quotes(i, h), closes = Object.fromEntries(Object.entries(eq).map(([s, q]) => [s, q.price]));
    state.equity = equityAt(closes);
    lifetimePeak = Math.max(lifetimePeak, state.equity);
    episodePeak = Math.max(episodePeak, state.equity);
    if (variant === 'kill_switch') {
      dailyLock ||= state.equity <= dailyStart * 0.98;
      lifetimeLock ||= state.equity <= lifetimePeak * 0.9;
      if (dailyLock || lifetimeLock) {
        for (const s of Object.keys(state.positions)) close(s, closes[s], 'kill', ts + BAR);
        state.equity = equityAt(closes);
      }
    }
    const dd = episodePeak > 0 ? (episodePeak - state.equity) / episodePeak : 1;
    state.riskState = lifetimeLock || dailyLock || dd >= 0.2 ? 'halt' : dd >= 0.12 ? 'caution' : 'normal';
    h.setClock(ts + BAR);
    if (state.riskState !== 'halt' && i < to - 1) {
      const orders = h.runStrategies(state, eq, cfg);
      pendingCloses = orders.filter(o => o.op === 'close');
      for (const order of orders.filter(o => o.op === 'open')) {
        if (variant === 'cooldown_4h' && ts + BAR - (lastClosed[order.symbol] || 0) < 4 * 3600_000) continue;
        if (variant === 'mtf_filter') {
          const q = eq[order.symbol], sign = h.P.sideSign(order.side);
          if (sign * (q.price - h.sma(q.closes, 200)) <= 0 || sign * (q.price - h.sma(q.closesIntraday, 48)) <= 0) continue;
        }
        let sized = (variant === 'ledger_wiring' ? ledgerSizer : h.sizeOrder)(state, order, eq, cfg);
        if (variant === 'fractional_kelly') {
          sized.marginUsd = state.equity * (estimates[order.strategy_id]?.riskFraction || 0) / (sized.leverage * order.stopPct);
        }
        if (sized.marginUsd > 0) queued.push(sized);
      }
    }
    if (i === to - 1) {
      for (const s of Object.keys(state.positions)) close(s, closes[s], 'terminal', ts + BAR);
      state.equity = equityAt(closes);
    }
    assert.ok(Number.isFinite(state.equity) && state.walletBalance > -1e-8, 'Invalid accounting state');
    curve.push(state.equity);
    if ((i + 1) % 96 === 0 || i === to - 1) dailyReturns.push(state.equity / dailyStart - 1);
  }
  assert.ok(Math.abs(100 + trades.reduce((sum, t) => sum + t.net, 0) - state.equity) < 1e-7,
    'Net trade P&L must reconcile exactly to wallet equity');
  return {metrics: statistics(trades, curve, dailyReturns), trades, curve, dailyReturns};
}

function aggregate(runs) {
  const curve = [100], trades = [], returns = [];
  for (const run of runs) {
    const scale = curve.at(-1) / run.curve[0];
    curve.push(...run.curve.slice(1).map(x => x * scale));
    trades.push(...run.trades);
    returns.push(...run.dailyReturns);
  }
  return statistics(trades, curve, returns);
}

function beats(candidate, baseline) {
  return candidate.tradeCount >= 30 && candidate.sharpe != null && baseline.sharpe != null &&
    candidate.sharpe > baseline.sharpe && candidate.profitFactor > 1 &&
    candidate.profitFactor >= baseline.profitFactor && candidate.expectancyUsd > 0 &&
    candidate.returnPct > baseline.returnPct && candidate.maxDrawdown <= baseline.maxDrawdown;
}

function main() {
  fs.mkdirSync(out, {recursive: true});
  const folds = quick ? [['smoke', '2024-07-01', '2024-07-08']] : [
    ['2024Q3', '2024-07-01', '2024-10-01'], ['2024Q4', '2024-10-01', '2025-01-01'],
    ['2025Q1', '2025-01-01', '2025-04-01'], ['2025Q2', '2025-04-01', '2025-07-01']];
  const report = {kind: 'CONDITIONAL RESEARCH, NOT DEPLOYED BOT PERFORMANCE', stress,
    sourceCommit: '50360996451ddc7ad742372bff398b7938ae0029', manifest, folds,
    sourceHashes: Object.fromEntries(['scripts/lib.mjs', 'scripts/v2/strategies.mjs', 'scripts/v2/sizing.mjs',
      'scripts/v2/engine.mjs', 'scripts/v2/brain.mjs', 'scripts/v2/episode.mjs', 'scripts/v2/perp.mjs',
      'audit/backtest.mjs', 'audit/source_adapter.mjs', 'audit/EXPERIMENT_PLAN.md'].map(p =>
      [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex')])),
    training: {},
    costs: {takerFeePerSide: 0.0005, slippagePlusHalfSpreadPerSide: stress ? 0.0024 : 0.0012,
      modeledFundingPer8h: stress ? 0.0003 : 0.0001}, results: {}};
  const modeRuns = {};
  for (const mode of ['TREND', 'REVERT']) {
    modeRuns[mode] = {};
    for (const variant of variants) modeRuns[mode][variant] = [];
    const trainingByEnd = {};
    for (const [name, from, to] of folds) {
      if (!quick) {
        console.log(`TRAIN ${mode} through ${from}`, new Date().toISOString());
        trainingByEnd[from] = trainingEstimates(simulate(0, at(from), mode).trades);
      }
      for (const variant of variants) {
        const result = simulate(at(from), at(to), mode, variant, trainingByEnd[from] || {});
        modeRuns[mode][variant].push(result);
        console.log(`${mode} ${name} ${variant}`, JSON.stringify(result.metrics));
      }
    }
    report.training[mode] = trainingByEnd;
    report.results[mode] = Object.fromEntries(variants.map(v => [v, {
      aggregate: aggregate(modeRuns[mode][v]),
      folds: modeRuns[mode][v].map((r, i) => ({name: folds[i][0], ...r.metrics})),
    }]));
    // Parameters are never changed after development folds. Evaluate every candidate.
    if (!quick) {
      console.log(`FINAL HOLDOUT ${mode}`, new Date().toISOString());
      const train = trainingEstimates(simulate(0, at('2025-07-01'), mode).trades);
      report.training[mode]['2025-07-01'] = train;
      for (const variant of variants) {
        const run = simulate(at('2025-07-01'), at('2026-01-01'), mode, variant, train);
        report.results[mode][variant].holdout = run.metrics;
        fs.writeFileSync(path.join(out, `${stress ? 'stress-' : ''}${mode}-${variant}-holdout-trades.json`), JSON.stringify(run.trades));
        console.log(`${mode} HOLDOUT ${variant}`, JSON.stringify(run.metrics));
      }
      const baseline = report.results[mode].baseline;
      for (const variant of variants.slice(1)) {
        const item = report.results[mode][variant];
        item.quartersBeaten = item.folds.filter((f, i) => beats(f, baseline.folds[i])).length;
        item.screenPassed = beats(item.aggregate, baseline.aggregate) && beats(item.holdout, baseline.holdout) && item.quartersBeaten >= 3;
      }
    }
  }
  const name = quick ? 'smoke.json' : stress ? 'stress.json' : 'backtest.json';
  fs.writeFileSync(path.join(out, name), JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved audit/results/${name}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'audit/backtest.mjs')) main();
