// scripts/lib.mjs — FabInvests shared toolbox
// Pure Node ESM · zero third-party deps · keyless, free data only.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  readFileSync, writeFileSync, renameSync,
  mkdirSync, existsSync, appendFileSync,
} from "node:fs";
import { createHash } from "node:crypto";

// ── Paths ──────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
export const ROOT = join(__dirname, "..");
export const DATA = join(ROOT, "data");

export const PATHS = {
  config:   join(ROOT, "config.json"),
  state:    join(DATA, "state.json"),
  signals:  join(DATA, "signals.json"),
  prices:   join(DATA, "prices.json"),
  trades:   join(DATA, "trades.jsonl"),
  equity:   join(DATA, "equity.jsonl"),
  journal:  join(DATA, "journal.jsonl"),
  playbook: join(DATA, "playbook.json"),
  log:      join(DATA, "engine.log"),
};

// ── File helpers (atomic writes) ───────────────────────────────────────────
export function ensureData() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
}

export function readJSON(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJSON(path, obj) {
  ensureData();
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function appendJSONL(path, obj) {
  ensureData();
  appendFileSync(path, JSON.stringify(obj) + "\n", "utf8");
}

export function readJSONL(path, limit = 0) {
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l));
    return limit > 0 ? parsed.slice(-limit) : parsed;
  } catch {
    return [];
  }
}

export function log(msg) {
  const line = `[${iso(now())}] ${msg}`;
  console.log(line);
  try {
    ensureData();
    appendFileSync(PATHS.log, line + "\n", "utf8");
  } catch { /* ignore */ }
}

export function loadConfig() {
  return readJSON(PATHS.config);
}

export const now = () => Date.now();
export const iso = (t) => new Date(t).toISOString();

// ── Network helpers (keyless, free) ────────────────────────────────────────
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...opts.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function getText(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Yahoo Finance v8 chart URL builder (keyless). */
export function YH(sym, range = "1d", interval = "5m") {
  return (
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(sym)}?range=${range}&interval=${interval}`
  );
}

/**
 * Fetch a live quote for a symbol.
 * Primary: Yahoo Finance chart API (keyless).
 * Fallback for *-USD crypto: Coinbase public spot price.
 */
export async function fetchQuote(symbol) {
  try {
    const url = YH(symbol, "1d", "5m");
    const data = await getJSON(url);
    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const prevClose =
      meta.chartPreviousClose ?? meta.previousClose ?? price;
    const changePct = prevClose ? (price - prevClose) / prevClose : 0;
    return {
      symbol,
      price,
      prevClose,
      changePct,
      marketState: meta.marketState || "UNKNOWN",
      currency: meta.currency || "USD",
      sessionStart:
        meta.currentTradingPeriod?.regular?.start ?? null,
      ok: true,
    };
  } catch (err) {
    // Coinbase fallback for crypto (symbols ending with -USD)
    if (symbol.endsWith("-USD")) {
      try {
        const pair = symbol.replace("-", "-"); // keep as-is
        const data = await getJSON(
          `https://api.coinbase.com/v2/prices/${pair}/spot`
        );
        const price = parseFloat(data.data.amount);
        return {
          symbol,
          price,
          prevClose: price,
          changePct: 0,
          marketState: "REGULAR",
          currency: "USD",
          sessionStart: null,
          ok: true,
        };
      } catch { /* fall through */ }
    }
    return { symbol, ok: false };
  }
}

/**
 * Fetch daily close history for a symbol.
 * Returns an array of numeric closes (nulls filtered out).
 */
export async function fetchHistory(symbol, range = "6mo", interval = "1d") {
  try {
    const url = YH(symbol, range, interval);
    const data = await getJSON(url);
    const closes = data.chart.result[0].indicators.quote[0].close;
    return closes.filter((c) => c != null && isFinite(c));
  } catch {
    return [];
  }
}

/** USD → INR rate from Yahoo USDINR=X; fallback 83.0. */
export async function fetchFx() {
  try {
    const q = await fetchQuote("USDINR=X");
    if (q.ok && q.price > 0) return q.price;
  } catch { /* fallback */ }
  return 83.0;
}

// ── Indicators ─────────────────────────────────────────────────────────────
/** Simple moving average of the last n values. */
export function sma(arr, n) {
  if (arr.length < n) return NaN;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** Relative Strength Index over last n periods. */
export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return 50; // not enough data → neutral
  let gainSum = 0;
  let lossSum = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  const avgGain = gainSum / n;
  const avgLoss = lossSum / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Rate of change over n periods (fractional). */
export function momentum(closes, n = 10) {
  if (closes.length < n + 1) return 0;
  const prev = closes[closes.length - 1 - n];
  const curr = closes[closes.length - 1];
  return prev !== 0 ? (curr - prev) / prev : 0;
}

/** Composite indicator bundle from an array of daily closes. */
export function indicators(closes) {
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const r = rsi(closes);
  const mom = momentum(closes);
  const last = closes[closes.length - 1] ?? 0;

  let trend = "flat";
  if (!isNaN(sma20) && !isNaN(sma50)) {
    if (last > sma20 && sma20 > sma50) trend = "up";
    else if (last < sma20 && sma20 < sma50) trend = "down";
  } else if (!isNaN(sma20)) {
    trend = last > sma20 ? "up" : "down";
  }

  let bias = "neutral";
  if (r > 55 && mom > 0.02 && trend === "up") bias = "bullish";
  else if (r < 45 && mom < -0.02 && trend === "down") bias = "bearish";

  return { sma20, sma50, rsi: r, mom, trend, bias };
}

// ── Advanced indicators (for V2 strategies) ────────────────────────────────

/** Log returns: ln(close_t / close_t-1). */
export function logReturns(closes) {
  const lr = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) lr.push(Math.log(closes[i] / closes[i - 1]));
  }
  return lr;
}

/** Average True Range approximated from closes only (|close_i - close_i-1|). */
export function atr(closes, n = 14) {
  if (closes.length < n + 1) return NaN;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    sum += Math.abs(closes[i] - closes[i - 1]);
  }
  return sum / n;
}

/** Bollinger Bands: { upper, lower, middle, bandwidth }. */
export function bollingerBands(closes, n = 20, k = 2) {
  if (closes.length < n) return null;
  const window = closes.slice(-n);
  const mid = window.reduce((a, b) => a + b, 0) / n;
  const variance = window.reduce((s, v) => s + (v - mid) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const upper = mid + k * sd;
  const lower = mid - k * sd;
  const bandwidth = mid > 0 ? (upper - lower) / mid : 0;
  return { upper, lower, middle: mid, bandwidth, sd };
}

/** Percentile rank of value within arr (0–1). */
export function percentileRank(value, arr) {
  if (!arr.length) return 0.5;
  let below = 0;
  for (const v of arr) { if (v < value) below++; }
  return below / arr.length;
}

/** Rolling standard deviation with given window size. Returns array. */
export function rollingStdev(arr, window) {
  const result = [];
  for (let i = window - 1; i < arr.length; i++) {
    const slice = arr.slice(i - window + 1, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / window;
    const v = slice.reduce((s, x) => s + (x - m) ** 2, 0) / (window - 1 || 1);
    result.push(Math.sqrt(v));
  }
  return result;
}

/** Donchian channel: { hi, lo } over last n closes (excluding current). */
export function donchianChannel(closes, n = 20) {
  if (closes.length < n + 1) return null;
  const window = closes.slice(-(n + 1), -1);
  return { hi: Math.max(...window), lo: Math.min(...window) };
}

// ── Stats helpers (pure) ───────────────────────────────────────────────────
/** First 16 hex chars of SHA-256. */
export function sha256(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function mean(a) {
  if (!a.length) return 0;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** Sample standard deviation. */
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  const variance = a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(variance);
}

/** Wilson lower-bound confidence interval for win rate. */
export function wilsonLB(wins, n, z = 1.96) {
  if (n === 0) return 0;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return (centre - spread) / denom;
}

/** System Quality Number = sqrt(n) * mean / stdev. */
export function sqnOf(rs) {
  if (!rs.length) return 0;
  const s = stdev(rs);
  if (s === 0) return 0;
  return (Math.sqrt(rs.length) * mean(rs)) / s;
}

/** Sum of wins / |sum of losses|. */
export function profitFactor(rs) {
  const gains = rs.filter((r) => r > 0).reduce((s, v) => s + v, 0);
  const losses = Math.abs(
    rs.filter((r) => r < 0).reduce((s, v) => s + v, 0)
  );
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

/** Full expectancy stats from an array of R-multiple returns. */
export function expectancyStats(rs) {
  const n = rs.length;
  if (n === 0)
    return {
      n: 0, wins: 0, losses: 0, winRate: 0, avgWinR: 0, avgLossR: 0,
      expectancyR: 0, profitFactor: 0, sqn: 0, wilsonLb: 0,
      breakevenWr: 0, tStat: 0,
    };

  const winRs  = rs.filter((r) => r > 0);
  const lossRs = rs.filter((r) => r <= 0);
  const wins   = winRs.length;
  const losses = lossRs.length;
  const winRate    = wins / n;
  const avgWinR    = wins   ? mean(winRs)          : 0;
  const avgLossR   = losses ? Math.abs(mean(lossRs)) : 0;
  const expectancyR = mean(rs);
  const pf       = profitFactor(rs);
  const sqn      = sqnOf(rs);
  const wilsonLb = wilsonLB(wins, n);
  const breakevenWr = avgLossR > 0 ? avgLossR / (avgWinR + avgLossR) : 0;
  const s      = stdev(rs);
  const tStat  = s > 0 ? expectancyR / (s / Math.sqrt(n)) : 0;

  return {
    n, wins, losses, winRate, avgWinR, avgLossR,
    expectancyR, profitFactor: pf, sqn, wilsonLb, breakevenWr, tStat,
  };
}

// ── Regime ──────────────────────────────────────────────────────────────────
/**
 * Deterministic market-mood label from key index trends.
 * Inputs: quotes = { "BTC-USD": { trend, rsi, ... }, "^GSPC": ..., "^NSEI": ... }
 *         riskState = { halt: bool, ... }
 */
export function regime(quotes, riskState) {
  if (riskState?.halt) return "risk_off";

  const btc  = quotes?.["BTC-USD"];
  const sp   = quotes?.["^GSPC"];
  const nsei = quotes?.["^NSEI"];

  const btcUp   = btc?.trend === "up";
  const btcDown = btc?.trend === "down";
  const spUp    = sp?.trend  === "up";
  const spDown  = sp?.trend  === "down";
  const nseiUp  = nsei?.trend === "up";

  // High vol = RSI at extremes
  const highVol = btc?.rsi != null && (btc.rsi > 75 || btc.rsi < 25);

  if (btcUp && spUp && nseiUp) return "broad_up";
  if (btcDown && highVol)      return "crypto_down_highvol";
  if (btcDown)                 return "crypto_down";
  if (spDown)                  return "us_down";
  return "mixed_chop";
}
