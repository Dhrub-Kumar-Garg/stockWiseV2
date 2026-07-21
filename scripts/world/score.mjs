// scripts/world/score.mjs — Pure sentiment & macro scoring (no I/O, no deps)

import { mean, stdev } from "../lib.mjs";

// ── Sentiment lexicon ──────────────────────────────────────────────────────

const POS = {
  surge: 1.5,  rally: 1.5,   jump: 1.2,   gain: 1.0,    beat: 1.2,
  upgrade: 1.3, bullish: 1.5, record: 1.3, growth: 1.0,  breakout: 1.5,
  adoption: 1.2, approval: 1.3, inflows: 1.2, rebound: 1.3, soar: 1.8,
  outperform: 1.2, boom: 1.5, highs: 1.3,  recovery: 1.0, momentum: 1.0,
  optimism: 0.8, profit: 0.8, dividend: 0.5, earnings: 0.5,
  accumulation: 0.8, partnership: 0.5, innovation: 0.7, milestone: 0.8,
  launch: 0.5,  buy: 0.8,  strong: 0.7,  positive: 0.6, upbeat: 0.8,
  rise: 0.8,    rises: 0.8, climbing: 0.8, surges: 1.5,  jumps: 1.2,
  rallies: 1.5, surpass: 1.0, boost: 0.8,  soars: 1.8,   upside: 0.7,
  outpace: 0.8, prosperity: 0.6, confidence: 0.5, bullrun: 2.0,
};

const NEG = {
  crash: -2.5,  plunge: -2.0, plummet: -2.0, slump: -1.5,  miss: -1.2,
  downgrade: -1.3, bearish: -1.5, selloff: -1.8, hack: -2.0,  fraud: -2.5,
  scam: -2.5,   liquidation: -2.0, recession: -2.0, bankruptcy: -2.5,
  panic: -2.0,  decline: -1.0, loss: -1.0, default: -2.0,  layoff: -1.2,
  inflation: -0.8, warning: -1.0, correction: -1.2, bubble: -1.5,
  outflows: -1.0, contagion: -1.8, exploit: -2.0, ban: -1.5,
  investigation: -1.3, collapse: -2.5, sell: -0.8, weak: -0.7,
  negative: -0.6, fears: -1.0, fear: -0.8,  drops: -1.0,  drop: -1.0,
  falls: -1.0,  fall: -0.8,  tumble: -1.5, sinks: -1.3,  plunges: -2.0,
  crashes: -2.5, slides: -1.0, downside: -0.7, turmoil: -1.5,
  volatility: -0.5, uncertainty: -0.6, risk: -0.4, debt: -0.8,
  sanctions: -1.2, shutdown: -1.0,
};

const NEGATORS = new Set([
  "not", "no", "never", "without", "despite", "hardly", "barely",
]);

// ── Public scoring functions ───────────────────────────────────────────────

/**
 * Score a text string using the finance sentiment lexicon.
 * Negators (not, no, never…) flip the next word to -0.7× its weight.
 * Returns a value in [-1, 1]; 0 if no sentiment words hit.
 */
export function lexiconScore(text) {
  if (!text) return 0;
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  let sum = 0, hits = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let weight = POS[w] || NEG[w] || 0;
    if (weight === 0) continue;

    // Negator flip: "not bullish" → −0.7 × 1.5
    if (i > 0 && NEGATORS.has(words[i - 1])) {
      weight *= -0.7;
    }
    sum += weight;
    hits++;
  }

  if (hits === 0) return 0;
  return Math.max(-1, Math.min(1, sum / 3));
}

/** Map a 0–100 Fear & Greed value to a human band. */
export function fngBand(v) {
  if (v == null || !isFinite(v)) return "unknown";
  if (v <= 24) return "extreme_fear";
  if (v <= 44) return "fear";
  if (v <= 55) return "neutral";
  if (v <= 74) return "greed";
  return "extreme_greed";
}

/**
 * Score macro conditions from Yahoo macro quotes.
 * Each entry in `m` is { price, changePct }.
 * Returns { label, score, posture, drivers }.
 */
export function regimeScore(m) {
  const drivers = [];
  let score = 0;

  const vix  = m?.["^VIX"];
  const tnx  = m?.["^TNX"];
  const dxy  = m?.["DX-Y.NYB"];
  const oil  = m?.["CL=F"];
  const gold = m?.["GC=F"];

  // VIX: fear gauge
  if (vix?.price != null) {
    if      (vix.price > 30) { score -= 0.4;  drivers.push(`VIX elevated (${vix.price.toFixed(1)})`); }
    else if (vix.price > 20) { score -= 0.15; drivers.push("VIX moderate"); }
    else                     { score += 0.2;  drivers.push(`VIX calm (${vix.price.toFixed(1)})`); }
  }

  // Dollar: strong dollar = risk off
  if (dxy?.changePct != null) {
    if      (dxy.changePct > 0.005)  { score -= 0.2;  drivers.push("Dollar strengthening"); }
    else if (dxy.changePct < -0.005) { score += 0.15; drivers.push("Dollar weakening"); }
  }

  // 10Y yield: spiking yields = tighter money
  if (tnx?.changePct != null) {
    if      (tnx.changePct > 0.03)  { score -= 0.2;  drivers.push("Yields spiking"); }
    else if (tnx.changePct < -0.03) { score += 0.15; drivers.push("Yields falling"); }
  }

  // Gold: bid = fear hedge
  if (gold?.changePct != null) {
    if (gold.changePct > 0.01) { score -= 0.1; drivers.push("Gold bid (fear hedge)"); }
  }

  // Oil: spike = inflationary headwind
  if (oil?.changePct != null) {
    if      (oil.changePct > 0.03)  { score -= 0.1;  drivers.push("Oil spiking"); }
    else if (oil.changePct < -0.03) { score += 0.05; drivers.push("Oil falling"); }
  }

  score = Math.max(-1, Math.min(1, score));

  const label = score > 0.2 ? "risk_on" : score < -0.2 ? "risk_off" : "neutral";
  let posture;
  if      (score > 0.4)  posture = "aggressive";
  else if (score > 0.1)  posture = "normal";
  else if (score > -0.2) posture = "cautious";
  else                    posture = "defensive";

  return { label, score: Math.round(score * 100) / 100, posture, drivers };
}

/**
 * Aggregate an array of news items (each { title }) into a sentiment read.
 * Returns { mean_s, dispersion, volume, impact, n, top, mixed }.
 * mixed=true when dispersion > 0.45 — headlines disagree, don't trust avg.
 */
export function aggregateNews(items) {
  if (!items?.length) {
    return { mean_s: 0, dispersion: 0, volume: 0, impact: "—", n: 0, top: [], mixed: false };
  }

  const scores = items.map((it) => ({
    title: it.title || it,
    score: lexiconScore(it.title || it),
  }));

  const vals = scores.map((s) => s.score);
  const m  = mean(vals);
  const sd = vals.length > 1 ? stdev(vals) : 0;

  let impact = "neutral";
  if (m > 0.2)  impact = "bullish";
  if (m < -0.2) impact = "bearish";

  const top = scores
    .filter((s) => Math.abs(s.score) > 0.1)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);

  return {
    mean_s:     Math.round(m * 1000) / 1000,
    dispersion: Math.round(sd * 1000) / 1000,
    volume:     items.length,
    impact,
    n:          items.length,
    top,
    mixed:      sd > 0.45,
  };
}
