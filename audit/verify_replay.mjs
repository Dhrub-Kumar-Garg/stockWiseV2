// Independent oracles for time boundaries, next-open fills, OHLC ambiguity,
// artifact integrity and net-cash conservation. Uses only local data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {sandbox, config, clone, declarations, ROOT} from './source_adapter.mjs';
import {statistics} from './backtest.mjs';

const source = fs.readFileSync(path.join(ROOT, 'audit/backtest.mjs'), 'utf8');
const BAR = 900_000, DAY = 86_400_000, start = Date.UTC(2024, 0, 1);
const results = [];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function check(name, f) { f(); results.push({name, status: 'PASS'}); }

check('Changing every future price leaves current signal features identical', () => {
  const data = {}, daily = {}, dailyCache = new Map(), h = sandbox();
  for (const sym of ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']) {
    const bars = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/data', sym + '_15m.json')));
    data[sym + '-USD'] = bars;
    daily[sym + '-USD'] = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/data', sym + '_1d.json'))).map(b => b[4]);
    for (let i = 95; i < bars.length; i += 96) daily[sym + '-USD'].push(bars[i][4]);
  }
  const body = source.slice(source.indexOf('function quotes('), source.indexOf('export function statistics'));
  const quote = new Function('data', 'daily', 'dailyCache', body + '\nreturn quotes;')(data, daily, dailyCache);
  const index = Math.floor((Date.UTC(2025, 6, 1, 12) - start) / BAR);
  const before = quote(index, h), day = Math.floor(index / 96);
  for (const sym of Object.keys(data)) {
    assert.equal(before[sym].closes.length, 365);
    assert.equal(before[sym].closes.at(-1), data[sym][day * 96 - 1][4]);
    for (let i = index + 1; i < data[sym].length; i++) data[sym][i] = data[sym][i].map((x, j) => j ? x * 100 : x);
    for (let i = 365 + day; i < daily[sym].length; i++) daily[sym][i] *= 100;
  }
  dailyCache.clear();
  assert.deepEqual(quote(index, h), before);
});

const simBody = source.slice(source.indexOf('export function simulate('), source.indexOf('\nfunction aggregate(')).replace('export ', '');
function toy(bars, stopPct = 0.5, targetPct = 1) {
  const data = {'BTC-USD': bars};
  const fakeSandbox = mode => {
    const h = sandbox(mode);
    let sent = false;
    h.runStrategies = () => {
      if (sent) return [];
      sent = true;
      return [{op: 'open', symbol: 'BTC-USD', side: 'long', leverage: 3, strategy_id: 'tsmom', stopPct, targetPct}];
    };
    h.sizeOrder = (state, o) => ({...o, marginUsd: 10});
    return h;
  };
  const quotes = i => ({'BTC-USD': {price: bars[i][4], closes: Array(365).fill(100), closesIntraday: [100]}});
  const simulate = new Function('sandbox', 'config', 'clone', 'declarations', 'data', 'quotes',
    'start', 'BAR', 'DAY', 'stress', 'heavySignals', 'assert', 'statistics', simBody + '\nreturn simulate;')(
    fakeSandbox, config, clone, declarations, data, quotes, start, BAR, DAY, false, new Map(), assert, statistics);
  return simulate(0, bars.length, 'TREND');
}
check('Signal on first close fills at next opening price, including a gap', () => {
  const run = toy([[start, 100, 100, 100, 100, 1], [start + BAR, 110, 110, 110, 110, 1],
    [start + 2 * BAR, 120, 120, 120, 120, 1]]);
  const qty = 30 / (110 * 1.0012), exit = 120 * 0.9988;
  assert.equal(run.trades.length, 1);
  assert.equal(run.trades[0].openedAt, start + BAR);
  near(run.trades[0].gross, (exit - 110 * 1.0012) * qty);
  near(run.metrics.finalEquity, 100 + run.trades[0].gross - 30 * 0.0005 - exit * qty * 0.0005);
});
check('Both stop and target touched: adverse stop wins', () => {
  const run = toy([[start, 100, 100, 100, 100, 1], [start + BAR, 100, 120, 80, 100, 1]], 0.05, 0.1);
  assert.equal(run.trades[0].reason, 'stop');
  assert.ok(run.trades[0].net < 0);
});
check('Gap through a stop fills at adverse open rather than stop price', () => {
  const run = toy([[start, 100, 100, 100, 100, 1], [start + BAR, 100, 101, 99, 100, 1],
    [start + 2 * BAR, 80, 81, 79, 80, 1]], 0.05, 0.1);
  assert.equal(run.trades[0].reason, 'stop');
  const entry = 100 * 1.0012, qty = 30 / entry;
  near(run.trades[0].gross, (80 * 0.9988 - entry) * qty);
});
check('Final trade is counted and net P&L reconciles to terminal cash', () => {
  const run = toy([[start, 100, 100, 100, 100, 1], [start + BAR, 100, 100, 100, 100, 1]]);
  assert.equal(run.metrics.tradeCount, 1);
  assert.equal(run.trades[0].reason, 'terminal');
  near(run.metrics.finalEquity - 100, run.trades[0].net);
});
check('Source adapters block external data APIs', () => {
  const h = sandbox();
  for (const name of ['fetchQuote', 'fetchFx', 'fetchHistory', 'getJSON', 'getText']) {
    assert.throws(() => h[name]('BTC-USD'), /Network data is unavailable/);
  }
});

for (const file of ['backtest.json', 'stress.json']) {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/results', file)));
  check(file + ': source SHA256 content matches (LF/CRLF checkout differences allowed)', () => {
    for (const [name, hash] of Object.entries(report.sourceHashes)) {
      const raw = fs.readFileSync(path.join(ROOT, name), 'utf8');
      const lf = raw.replace(/\r\n/g, '\n');
      const candidates = [raw, lf, lf.replace(/\n/g, '\r\n')].map(text => crypto.createHash('sha256').update(text).digest('hex'));
      assert.ok(candidates.includes(hash), name);
    }
  });
  check(file + ': training/test dates do not overlap and final holdout starts later', () => {
    let previousEnd = null;
    for (const [name, from, to] of report.folds) {
      assert.ok(Date.parse(from) < Date.parse(to));
      if (previousEnd) assert.equal(from, previousEnd);
      for (const mode of Object.keys(report.results)) assert.ok(report.training[mode][from]);
      previousEnd = to;
    }
    assert.equal(previousEnd, '2025-07-01');
  });
  check(file + ': every holdout trade ledger reconciles to reported metrics', () => {
    const prefix = file === 'stress.json' ? 'stress-' : '';
    for (const [mode, variants] of Object.entries(report.results)) {
      for (const [variant, r] of Object.entries(variants)) {
        const trades = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/results', `${prefix}${mode}-${variant}-holdout-trades.json`)));
        const pnl = trades.reduce((s, t) => s + t.net, 0);
        near(100 + pnl, r.holdout.finalEquity);
        assert.equal(trades.length, r.holdout.tradeCount);
        if (trades.length) near(pnl / trades.length, r.holdout.expectancyUsd);
        const bySymbol = {};
        for (const trade of [...trades].sort((a, b) => a.openedAt - b.openedAt)) {
          assert.ok(trade.openedAt >= Date.UTC(2025, 6, 1) && trade.closedAt <= Date.UTC(2026, 0, 1));
          assert.ok(trade.closedAt >= trade.openedAt);
          assert.equal(trade.openedAt % BAR, 0);
          assert.ok(!bySymbol[trade.symbol] || trade.openedAt >= bySymbol[trade.symbol]);
          bySymbol[trade.symbol] = trade.closedAt;
          if (trade.reason !== 'liquidation') near(trade.net, trade.gross - trade.fees + trade.funding);
        }
      }
    }
  });
}
fs.writeFileSync(path.join(ROOT, 'audit/results/replay-checks.json'), JSON.stringify(results, null, 2) + '\n');
for (const r of results) console.log(r.status, r.name);
