// scripts/v2/fetch_hist.mjs — Download historical OHLCV data for backtesting
import fs from "fs/promises";
import path from "path";
import { DATA } from "../lib.mjs";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SPY"];
const HIST_DIR = path.join(DATA, "hist");

async function fetchYahooOhlcv(symbol, range = "730d", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart.result[0];

  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  
  const ohlcv = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue;
    ohlcv.push({
      ts: timestamps[i] * 1000,
      o: quote.open[i],
      h: quote.high[i],
      l: quote.low[i],
      c: quote.close[i],
      v: quote.volume[i],
    });
  }
  return ohlcv;
}

async function main() {
  await fs.mkdir(HIST_DIR, { recursive: true });

  for (const sym of SYMBOLS) {
    console.log(`Fetching 1D history for ${sym}...`);
    try {
      const data1d = await fetchYahooOhlcv(sym, "730d", "1d");
      await fs.writeFile(
        path.join(HIST_DIR, `${sym}_1d.json`),
        JSON.stringify(data1d)
      );
      console.log(`  -> Saved ${data1d.length} 1D candles.`);
    } catch (err) {
      console.error(`  -> Failed 1D: ${err.message}`);
    }

    console.log(`Fetching 15m history for ${sym}...`);
    try {
      // Yahoo max range for 15m is 60d
      const data15m = await fetchYahooOhlcv(sym, "60d", "15m");
      await fs.writeFile(
        path.join(HIST_DIR, `${sym}_15m.json`),
        JSON.stringify(data15m)
      );
      console.log(`  -> Saved ${data15m.length} 15m candles.`);
    } catch (err) {
      console.error(`  -> Failed 15m: ${err.message}`);
    }
  }
}

main().catch(console.error);
