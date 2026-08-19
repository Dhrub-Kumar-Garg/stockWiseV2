// scripts/v2/analyst.mjs — AI Market Analyst (Groq/Llama)
// Runs every N minutes, calls Groq free-tier API to assess macro conditions,
// and outputs a trading mode decision: TREND / REVERT / SLEEP.
// The engine reads this decision each cycle to route strategies accordingly.

import { V2, readJSON, writeJSON, now, log } from "./store.mjs";
import { join } from "node:path";
import { DATA } from "../lib.mjs";

const ANALYST_FILE = join(DATA, "analyst.v2.json");

/** Default decision when no analyst data is available. */
const DEFAULT_DECISION = {
  mode: "SLEEP",
  direction_bias: "NEUTRAL",
  aggression: 0.3,
  reasoning: "No analyst data yet — defaulting to conservative SLEEP mode.",
  ts: 0,
};

/**
 * Call the Groq API with a market context prompt.
 * Returns parsed JSON decision or null on failure.
 */
async function callGroq(apiKey, model, prompt) {
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: `You are a senior quantitative macro analyst for an algorithmic crypto trading bot. 
Your ONLY job is to assess current market conditions and output a JSON decision.
You must respond with ONLY valid JSON, no markdown, no explanation outside the JSON.

The JSON must have exactly these fields:
{
  "mode": "TREND" or "REVERT" or "SLEEP",
  "direction_bias": "LONG" or "SHORT" or "NEUTRAL",
  "aggression": 0.1 to 1.0,
  "reasoning": "One sentence explaining your decision"
}

Rules:
- TREND mode: Use when there is a clear, sustained directional move. Momentum strategies will activate.
- REVERT mode: Use when the market is ranging/choppy but not dangerous. Mean-reversion strategies will buy dips and sell rips.
- SLEEP mode: Use during extreme uncertainty, major news events, or when you genuinely cannot read the market. No trades will be placed.
- direction_bias LONG: The higher-timeframe trend favors longs (e.g., price above key MAs, bullish structure).
- direction_bias SHORT: The higher-timeframe trend favors shorts.
- direction_bias NEUTRAL: No clear directional edge.
- aggression 0.1-0.3: Very conservative (small positions). Use after recent losses or uncertain conditions.
- aggression 0.4-0.6: Moderate. Standard conditions.
- aggression 0.7-1.0: Aggressive. Only when conditions are very favorable and you have high conviction.

Be honest. If you're uncertain, say SLEEP. It's better to miss a trade than lose money.`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      log(`Analyst API error (${res.status}): ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Strip <think>...</think> reasoning tags (Qwen 3.6 outputs these)
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*?"mode"[\s\S]*?\}/);
    if (!jsonMatch) {
      log(`Analyst: Could not extract JSON from response: ${content.slice(0, 150)}`);
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate fields
    const validModes = ["TREND", "REVERT", "SLEEP"];
    const validBias = ["LONG", "SHORT", "NEUTRAL"];
    if (!validModes.includes(parsed.mode)) parsed.mode = "SLEEP";
    if (!validBias.includes(parsed.direction_bias)) parsed.direction_bias = "NEUTRAL";
    parsed.aggression = Math.max(0.1, Math.min(1.0, Number(parsed.aggression) || 0.3));

    return parsed;
  } catch (err) {
    log(`Analyst API exception: ${err.message}`);
    return null;
  }
}

/**
 * Build the context prompt from current market data.
 */
function buildPrompt(state, worldDigest, recentTrades) {
  const w = worldDigest || {};
  const crypto = w.crypto || {};

  // Fear & Greed
  const fng = w.fearGreedCrypto
    ? `Crypto Fear & Greed Index: ${w.fearGreedCrypto.value} (${w.fearGreedCrypto.band})`
    : "Crypto Fear & Greed: unavailable";

  // Funding rates
  const fundingLines = [];
  for (const [sym, data] of Object.entries(crypto)) {
    if (data?.funding != null) {
      fundingLines.push(`  ${sym}: funding=${data.funding}%, OI=${data.openInterest ? `$${(data.openInterest / 1e9).toFixed(2)}B` : "N/A"}`);
    }
  }
  const fundingStr = fundingLines.length
    ? `Funding Rates & Open Interest:\n${fundingLines.join("\n")}`
    : "Funding data: unavailable";

  // Regime
  const regime = state.regime || "unknown";

  // Recent performance
  const recentResults = (state.recentTradeResults || []).slice(-10);
  const wins = recentResults.filter(r => r > 0).length;
  const losses = recentResults.filter(r => r <= 0).length;
  const totalPnl = recentResults.reduce((a, b) => a + b, 0);

  // Bot state
  const equity = state.equity?.toFixed(2) || "?";
  const dd = ((state.maxDrawdownPct || 0) * 100).toFixed(1);

  // News headlines
  const headlines = Array.isArray(w.headlines) ? w.headlines.slice(0, 5).join("\n  ") : "No recent headlines";

  return `CURRENT MARKET CONDITIONS (${new Date().toISOString()}):

${fng}

${fundingStr}

Current Regime (from our quant model): ${regime}

Bot Performance (last 10 trades):
  Wins: ${wins}, Losses: ${losses}, Net PnL: $${totalPnl.toFixed(2)}
  Current Equity: $${equity}
  Max Drawdown this episode: ${dd}%

Recent Headlines:
  ${headlines}

Based on ALL the above data, what trading mode should the bot use right now?
Remember: respond with ONLY valid JSON.`;
}

/**
 * Read the current analyst decision from disk.
 */
export function readAnalystDecision() {
  const decision = readJSON(ANALYST_FILE, null);
  if (!decision) return { ...DEFAULT_DECISION };
  return decision;
}

/**
 * Run the analyst: build prompt, call Groq, save decision.
 * Returns the new decision.
 */
export async function runAnalyst(state, worldDigest, cfg) {
  const analystCfg = cfg.v2?.analyst;
  if (!analystCfg?.enabled) return readAnalystDecision();

  const apiKey = analystCfg.groqApiKey;
  if (!apiKey) {
    log("Analyst: No Groq API key configured — skipping.");
    return readAnalystDecision();
  }

  const model = analystCfg.model || "llama-3.1-8b-instant";
  const prompt = buildPrompt(state, worldDigest);

  log("🧠 Analyst: Calling Groq API...");
  const decision = await callGroq(apiKey, model, prompt);

  if (decision) {
    const result = {
      ...decision,
      ts: now(),
      model,
    };
    writeJSON(ANALYST_FILE, result);
    log(`🧠 Analyst: mode=${result.mode}, bias=${result.direction_bias}, aggression=${result.aggression}`);
    log(`🧠 Reasoning: ${result.reasoning}`);
    return result;
  }

  // On failure, keep the last decision
  log("🧠 Analyst: API call failed — keeping previous decision.");
  return readAnalystDecision();
}
