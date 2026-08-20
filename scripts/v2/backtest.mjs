// scripts/v2/backtest.mjs — Backtesting Engine for V4 (Stat-Arb Edition)
import fs from "fs/promises";
import path from "path";
import { DATA } from "../lib.mjs";
import { SEED_STRATEGIES, SIGNAL_FN, strategyExit } from "./strategies.mjs";

const HIST_DIR = path.join(DATA, "hist");

async function loadData(symbol) {
  const fpath = path.join(HIST_DIR, `${symbol}_15m.json`);
  const raw = await fs.readFile(fpath, "utf-8");
  return JSON.parse(raw);
}

function calculateDrawdown(equityCurve) {
  let peak = 0;
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

async function runPairsBacktest() {
  console.log(`\n=== Running Pairs Backtest (BTC / ETH) ===`);
  const btc = await loadData("BTC-USD");
  const eth = await loadData("ETH-USD");

  // Align timestamps
  const aligned = [];
  let i = 0, j = 0;
  while (i < btc.length && j < eth.length) {
    if (btc[i].ts === eth[j].ts) {
      aligned.push({ ts: btc[i].ts, btc: btc[i], eth: eth[j] });
      i++; j++;
    } else if (btc[i].ts < eth[j].ts) {
      i++;
    } else {
      j++;
    }
  }
  
  if (aligned.length === 0) return;
  console.log(`Aligned ${aligned.length} 15m candles.`);

  const strategy = SEED_STRATEGIES.find(s => s.id === "pairs_trade");
  
  let equity = 10000;
  const equityCurve = [equity];
  let position = null; // null or { side, entryPriceBtc, stopPct, targetPct, margin, leverage }
  let trades = { count: 0, wins: 0, losses: 0 };

  for (let k = 250; k < aligned.length; k++) {
    const window = aligned.slice(k - 200, k + 1);
    const curr = window[window.length - 1];
    
    // Build eq object
    const eq = {
      "BTC-USD": {
        symbol: "BTC-USD", market: "crypto",
        price: curr.btc.c,
        closes: window.map(d => d.btc.c)
      },
      "ETH-USD": {
        symbol: "ETH-USD", market: "crypto",
        price: curr.eth.c,
        closes: window.map(d => d.eth.c)
      }
    };

    // 1. Process Exits
    if (position) {
      const sign = position.side === "long" ? 1 : -1;
      const pctChange = ((curr.btc.c - position.entryPriceBtc) / position.entryPriceBtc) * sign;
      
      let closeReason = null;
      if (pctChange <= -position.stopPct) closeReason = "Stop Loss";
      else if (pctChange >= position.targetPct) closeReason = "Take Profit";
      
      if (closeReason) {
        const pnl = position.margin * position.leverage * pctChange;
        equity += pnl;
        equityCurve.push(equity);
        
        if (pnl > 0) trades.wins++;
        else trades.losses++;
        trades.count++;
        
        position = null;
      }
    }

    // 2. Process Entries
    if (!position) {
      const sigFn = SIGNAL_FN["pairs_trade"];
      const sig = sigFn(eq["BTC-USD"], strategy, eq);
      if (sig) {
        const margin = equity * 0.10; // 10% Kelly for StatArb
        position = {
          side: sig.side,
          entryPriceBtc: curr.btc.c,
          stopPct: sig.stopPct,
          targetPct: sig.targetPct,
          leverage: sig.baseLev || strategy.baseLev,
          margin
        };
      }
    }
  }

  // Close open position at end
  if (position) {
    const sign = position.side === "long" ? 1 : -1;
    const pctChange = ((aligned[aligned.length-1].btc.c - position.entryPriceBtc) / position.entryPriceBtc) * sign;
    equity += position.margin * position.leverage * pctChange;
    equityCurve.push(equity);
  }

  const winRate = trades.count > 0 ? (trades.wins / trades.count) * 100 : 0;
  const returnPct = ((equity - 10000) / 10000) * 100;
  const maxDd = calculateDrawdown(equityCurve) * 100;

  console.log(`Starting Equity: $10,000`);
  console.log(`Final Equity:    $${equity.toFixed(2)} (${returnPct.toFixed(2)}%)`);
  console.log(`Total Trades:    ${trades.count}`);
  console.log(`Win Rate:        ${winRate.toFixed(1)}%`);
  console.log(`Max Drawdown:    ${maxDd.toFixed(1)}%`);
}

runPairsBacktest().catch(console.error);
