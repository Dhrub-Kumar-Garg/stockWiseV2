// scripts/v2/world.mjs — World/senses layer (keyless, free, graceful)
// Polls free public sources with per-source TTL caching.
// Dead source → dash, never a made-up number. Never blocks the trade loop.

import {
  V2, readJSON, writeJSON, now, round, clamp,
} from "./store.mjs";
import { getJSON, getText, fetchQuote } from "../lib.mjs";
import {
  lexiconScore, fngBand, regimeScore, aggregateNews,
} from "../world/score.mjs";

const DASH = "—";

// ── Cache layer ────────────────────────────────────────────────────────────

const _cache = {};

/** Fetch with TTL cache; fall back to last good value on failure. */
async function cached(key, ttlMs, fetchFn) {
  const c = _cache[key];
  if (c && (now() - c.ts) < ttlMs) return c.data;
  try {
    const data = await fetchFn();
    if (data != null) {
      _cache[key] = { ts: now(), data };
      return data;
    }
  } catch { /* graceful degrade */ }
  return c?.data ?? null; // last known or null
}

// ── RSS helper ─────────────────────────────────────────────────────────────

/** Extract <title> texts from inside <item> blocks. */
function parseTitles(xml) {
  const titles = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRe.exec(xml))) {
    const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
    const tm = titleRe.exec(itemMatch[0]);
    if (tm) {
      const t = tm[1].trim().replace(/<[^>]+>/g, "");
      if (t.length > 5) titles.push(t);
    }
  }
  return titles;
}

// ── Individual source fetchers ─────────────────────────────────────────────

/** Yahoo macro quotes: VIX, 10Y yield, dollar, oil, gold. */
async function fetchMacro() {
  const syms = ["^TNX", "^VIX", "DX-Y.NYB", "CL=F", "GC=F"];
  const out = {};
  for (const s of syms) {
    try {
      const q = await fetchQuote(s);
      if (q.ok) out[s] = { price: q.price, changePct: q.changePct };
    } catch { /* skip */ }
  }
  return Object.keys(out).length ? out : null;
}

/** Crypto Fear & Greed from alternative.me (0–100). */
async function fetchCryptoFng() {
  const data = await getJSON("https://api.alternative.me/fng/?limit=1");
  const v = parseInt(data?.data?.[0]?.value, 10);
  return isFinite(v) ? v : null;
}

/** CNN/Money Fear & Greed for stocks (0–100). */
async function fetchCnnFng() {
  try {
    const data = await getJSON(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    );
    const v = data?.fear_and_greed?.score;
    return isFinite(v) ? Math.round(v) : null;
  } catch {
    return null;
  }
}

/**
 * CBOE put/call ratio from daily CSV.
 * HONESTLY: reject any row older than ~6 days → stale shows a dash.
 */
async function fetchCboePutCall() {
  try {
    const urls = [
      "https://cdn.cboe.com/data/us/options/market_statistics/daily/equity_put_call_ratio.csv",
      "https://cdn.cboe.com/api/global/us_options/market_statistics/daily/equity_put_call_ratio.csv",
    ];
    for (const url of urls) {
      try {
        const text = await getText(url);
        const lines = text.trim().split("\n").filter(Boolean);
        if (lines.length < 2) continue;

        const last = lines[lines.length - 1];
        const parts = last.split(",");
        const dateStr = parts[0]?.trim();
        // Find the first numeric column that looks like a ratio (0.5 – 2.0)
        let ratio = NaN;
        for (let i = 1; i < parts.length; i++) {
          const v = parseFloat(parts[i]);
          if (isFinite(v) && v > 0.2 && v < 5) { ratio = v; break; }
        }
        if (!isFinite(ratio)) continue;

        // Staleness gate: reject if > 6 days old
        const rowDate = new Date(dateStr);
        if (isNaN(rowDate.getTime())) continue;
        const ageDays = (now() - rowDate.getTime()) / (86400 * 1000);
        if (ageDays > 6) return null; // honest rejection

        return { ratio: round(ratio, 3), date: dateStr, ageDays: round(ageDays, 1) };
      } catch { continue; }
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Hyperliquid perp data: funding, OI, mark for BTC/ETH/SOL.
 * POST api — no key needed.
 */
async function fetchHyperliquid() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();

    const universe = data?.[0]?.universe;
    const ctxs     = data?.[1];
    if (!universe || !ctxs) return null;

    const want = new Set(["BTC", "ETH", "SOL"]);
    const out = {};
    for (let i = 0; i < universe.length && i < ctxs.length; i++) {
      const name = universe[i].name;
      if (!want.has(name)) continue;
      const c = ctxs[i];
      out[name] = {
        funding:      parseFloat(c.funding)      || 0,
        openInterest: parseFloat(c.openInterest) || 0,
        markPx:       parseFloat(c.markPx)       || 0,
      };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** StockTwits bull/bear counts for a single symbol. */
async function fetchStocktwits(sym) {
  try {
    const data = await getJSON(
      `https://api.stocktwits.com/api/2/streams/symbol/${sym}.json`
    );
    let bulls = 0, bears = 0;
    for (const msg of (data?.messages || [])) {
      const s = msg?.entities?.sentiment?.basic;
      if (s === "Bullish")  bulls++;
      if (s === "Bearish")  bears++;
    }
    const total = bulls + bears;
    return total > 0 ? { bulls, bears, total, bullPct: round(bulls / total, 2) } : null;
  } catch {
    return null;
  }
}

/** Federal Reserve press release RSS titles. */
async function fetchFedHeadlines() {
  try {
    const xml = await getText("https://www.federalreserve.gov/feeds/press_all.xml");
    const titles = parseTitles(xml);
    return titles.length ? titles.slice(0, 6) : null;
  } catch {
    return null;
  }
}

/** Crypto news from Cointelegraph + Decrypt RSS. */
async function fetchCryptoNews() {
  const titles = [];
  const feeds = [
    "https://cointelegraph.com/rss",
    "https://decrypt.co/feed",
  ];
  for (const url of feeds) {
    try {
      const xml = await getText(url);
      titles.push(...parseTitles(xml));
    } catch { /* skip dead feed */ }
  }
  return titles.length ? titles.slice(0, 20) : null;
}

/** GDELT tone for "stock market" headlines (last 24h). */
async function fetchGdeltTone() {
  try {
    const url =
      "https://api.gdeltproject.org/api/v2/doc/doc" +
      "?query=%22stock+market%22&mode=ToneChart&format=json&timespan=24h";
    const data = await getJSON(url);
    if (!Array.isArray(data) || !data.length) return null;
    const tones = data.map((d) => d.tone ?? d.Tone ?? 0).filter(isFinite);
    if (!tones.length) return null;
    return round(tones.reduce((a, b) => a + b, 0) / tones.length, 2);
  } catch {
    return null;
  }
}

// ── Thesis builder ─────────────────────────────────────────────────────────

function buildThesis(regime, cryptoFng, fundingRate, newsMood, gdelt) {
  const parts = [];

  parts.push(`Macro: ${regime.label} (${regime.posture}).`);

  if (regime.drivers.length) {
    parts.push(`Drivers: ${regime.drivers.join("; ")}.`);
  }

  if (cryptoFng != null) {
    parts.push(`Crypto F&G: ${fngBand(cryptoFng)} (${cryptoFng}/100).`);
  }

  if (fundingRate !== DASH && isFinite(fundingRate)) {
    if (fundingRate > 0.02)       parts.push("Longs paying high funding — crowded.");
    else if (fundingRate < -0.01) parts.push("Shorts paying funding — bearish crowd.");
    else                          parts.push("Funding balanced.");
  }

  if (newsMood && newsMood.impact !== "—") {
    parts.push(`News: ${newsMood.impact} (${newsMood.mean_s}).`);
    if (newsMood.mixed) parts.push("Headlines disagree — don't trust the average.");
  }

  if (gdelt != null) {
    parts.push(`GDELT tone: ${gdelt > 0 ? "positive" : "negative"} (${gdelt}).`);
  }

  return parts.join(" ") || "Insufficient data for thesis.";
}

// ── Main collector ─────────────────────────────────────────────────────────

/**
 * Poll all free sources, cache with per-source TTL, write world.v2.json.
 * Dead source → DASH, never a fake number. Never blocks.
 */
export async function collectWorld(state, cfg) {
  // ── Fetch all sources (each with its own TTL) ──
  const macro     = await cached("macro",      5  * 60_000, fetchMacro);
  const cryptoFng = await cached("cryptoFng",  10 * 60_000, fetchCryptoFng);
  const cnnFng    = await cached("cnnFng",     15 * 60_000, fetchCnnFng);
  const putCall   = await cached("cboePutCall", 60 * 60_000, fetchCboePutCall);
  const hl        = await cached("hyperliquid", 5  * 60_000, fetchHyperliquid);
  const fed       = await cached("fed",        30 * 60_000, fetchFedHeadlines);
  const newsRaw   = await cached("cryptoNews", 10 * 60_000, fetchCryptoNews);
  const gdelt     = await cached("gdeltTone",  30 * 60_000, fetchGdeltTone);

  // StockTwits for key symbols
  const social = {};
  for (const sym of ["AAPL", "NVDA", "TSLA"]) {
    social[sym] = await cached(
      `stocktwits_${sym}`, 15 * 60_000, () => fetchStocktwits(sym)
    );
  }

  // ── Score macro regime ──
  const regime = macro
    ? regimeScore(macro)
    : { label: "neutral", score: 0, posture: "cautious", drivers: [] };

  // ── Compute Hyperliquid derivatives ──
  let fundingRate = DASH;
  let whaleCrowd  = DASH;
  let oiUsd       = DASH;

  if (hl) {
    const rates = Object.values(hl).map((a) => a.funding).filter(isFinite);
    if (rates.length) {
      // Average 8-hour funding rate as a percentage
      fundingRate = round(
        (rates.reduce((a, b) => a + b, 0) / rates.length) * 100, 4
      );
    }

    const totalOi = Object.values(hl).reduce(
      (s, a) => s + (a.openInterest || 0) * (a.markPx || 0), 0
    );
    if (totalOi > 0) oiUsd = round(totalOi, 0);

    // Positive funding = longs pay shorts = longs crowded
    if (isFinite(fundingRate)) {
      whaleCrowd = fundingRate > 0.01
        ? "longs_crowded"
        : fundingRate < -0.01
          ? "shorts_crowded"
          : "balanced";
    }
  }

  // Set live funding on state
  if (state && isFinite(fundingRate)) {
    state.fundingRate = fundingRate;
  }

  // ── Aggregate news ──
  const newsMood = newsRaw
    ? aggregateNews(newsRaw.map((t) => ({ title: t })))
    : null;

  // ── Build compact digest ──
  const digest = {
    regime:           regime.label,
    risk_posture:     regime.posture,
    macro:            regime,
    crypto:           hl || DASH,
    fearGreedCrypto:  cryptoFng != null
      ? { value: cryptoFng, band: fngBand(cryptoFng) }
      : DASH,
    fearGreedStocks:  cnnFng != null
      ? { value: cnnFng, band: fngBand(cnnFng) }
      : DASH,
    putCall:          putCall ?? DASH,
    fundingRate,
    whaleCrowd,
    oiUsd,
    fed:              fed?.length ? fed : DASH,
    headlines:        newsRaw?.slice(0, 5) || DASH,
    newsMood:         newsMood || DASH,
    social:           Object.values(social).some(Boolean) ? social : DASH,
    thesis:           buildThesis(regime, cryptoFng, fundingRate, newsMood, gdelt),
    deep_due:         now(),
  };

  // Persist to disk
  writeJSON(V2.world, digest);

  return digest;
}
