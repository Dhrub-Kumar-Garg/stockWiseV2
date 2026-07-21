// scripts/v2/telegram.mjs — Telegram notifications + remote kill/start switch
// Zero dependencies — uses built-in fetch.
// Commands: /status, /kill, /start, /positions, /close_all, /equity, /help

import { V2, readJSON, writeJSON, now, round } from "./store.mjs";

// ── Config ─────────────────────────────────────────────────────────────────
const BOT_TOKEN = "8900210959:AAEuT4stCOPiAAOi71HAxyA5jD6wFR-UG-8";
const CHAT_ID   = "7315608180";
const API       = `https://api.telegram.org/bot${BOT_TOKEN}`;

let _lastUpdateId = 0;

// ── Send a message ─────────────────────────────────────────────────────────

export async function notify(text, opts = {}) {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...opts,
      }),
    });
  } catch (err) {
    console.error("[telegram] send failed:", err.message);
  }
}

// ── Notification formatters ────────────────────────────────────────────────

export function notifyOpen(order, pos) {
  const side = order.side.toUpperCase();
  const sym  = (order.symbol || "").replace(/-USD$/i, "");
  const icon = side === "LONG" ? "🟢" : "🔴";
  notify(
    `${icon} <b>OPEN ${side}</b> ${sym}\n` +
    `├ Entry: <code>${round(pos.entryPrice, 4)}</code>\n` +
    `├ Margin: <code>$${round(pos.isolatedMargin, 2)}</code> @ ${order.leverage}x\n` +
    `├ Notional: <code>$${round(pos.notional, 2)}</code>\n` +
    `├ Liq: <code>${round(pos.liqPrice, 4)}</code>\n` +
    `├ Strategy: ${order.strategy_id || "manual"}\n` +
    `└ ${order.reason || ""}`
  );
}

export function notifyClose(symbol, pos, reasonTag, netPnl, realizedR) {
  const sym  = (symbol || "").replace(/-USD$/i, "");
  const icon = netPnl >= 0 ? "✅" : "❌";
  const sign = netPnl >= 0 ? "+" : "";
  notify(
    `${icon} <b>CLOSE ${pos.side.toUpperCase()}</b> ${sym}\n` +
    `├ PnL: <code>${sign}$${round(netPnl, 4)}</code> (${round(realizedR * 100, 1)}%R)\n` +
    `├ Reason: ${reasonTag}\n` +
    `├ Entry → Exit: <code>${round(pos.entryPrice, 4)} → mark</code>\n` +
    `└ Strategy: ${pos.openMeta?.strategy_id || "?"}`
  );
}

export function notifyEpisodeEnd(state, reason) {
  const icon = reason === "goal" ? "🎯" : reason === "blown_up" ? "💀" : "⏱";
  notify(
    `${icon} <b>Episode ${state.episodeNum} ended: ${reason}</b>\n` +
    `├ Final equity: <code>$${round(state.equity, 2)}</code>\n` +
    `├ Started: <code>$${round(state.startingCapital, 2)}</code>\n` +
    `├ Return: <code>${round(((state.equity / state.startingCapital) - 1) * 100, 1)}%</code>\n` +
    `├ Max DD: <code>${round(state.maxDrawdownPct * 100, 1)}%</code>\n` +
    `└ Gen ${state.generation}`
  );
}

export function notifyStartup(state) {
  notify(
    `🤖 <b>StockWise V2 engine started</b>\n` +
    `├ Episode: ${state.episodeNum}\n` +
    `├ Gen: ${state.generation}\n` +
    `├ Equity: <code>$${round(state.equity, 2)}</code>\n` +
    `├ Leverage: ${state.aggression.leverageCap}x → ${state.aggression.leverageCeiling}x\n` +
    `└ Positions: ${Object.keys(state.positions).length}`
  );
}

// ── Remote commands ────────────────────────────────────────────────────────

const HELP_TEXT =
  `🤖 <b>StockWise V2 Commands</b>\n\n` +
  `/status — Equity, positions, risk state\n` +
  `/positions — Open position details\n` +
  `/equity — Equity curve (last 10 ticks)\n` +
  `/kill — 🛑 HALT all trading (emergency kill)\n` +
  `/start — ▶️ Resume trading\n` +
  `/close_all — Close every open position\n` +
  `/help — This message`;

async function handleCommand(cmd, state) {
  const c = cmd.trim().toLowerCase();

  if (c === "/help" || c === "/start" && !state) {
    await notify(HELP_TEXT);
    return;
  }

  if (!state) {
    await notify("⚠️ Engine state not loaded yet.");
    return;
  }

  if (c === "/status") {
    const posCount = Object.keys(state.positions).length;
    const dd = round((state.maxDrawdownPct || 0) * 100, 1);
    await notify(
      `📊 <b>Status</b>\n` +
      `├ Equity: <code>$${round(state.equity, 2)}</code>\n` +
      `├ Wallet: <code>$${round(state.walletBalance, 2)}</code>\n` +
      `├ Positions: ${posCount}\n` +
      `├ Max DD: <code>${dd}%</code>\n` +
      `├ Risk: <b>${state.riskState}</b>\n` +
      `├ Regime: ${state.regime}\n` +
      `├ Episode: ${state.episodeNum} | Gen ${state.generation}\n` +
      `└ Cycles: ${state.cycles || 0}`
    );
    return;
  }

  if (c === "/positions") {
    const entries = Object.entries(state.positions);
    if (!entries.length) {
      await notify("📭 No open positions.");
      return;
    }
    let msg = `📋 <b>Open Positions (${entries.length})</b>\n\n`;
    for (const [sym, pos] of entries) {
      const mark = pos.emaMark || pos.entryPrice;
      const sideSign = pos.side === "long" ? 1 : -1;
      const uPnl = (mark - pos.entryPrice) * pos.qty * sideSign;
      const roi = pos.isolatedMargin > 0 ? (uPnl / pos.isolatedMargin * 100) : 0;
      const icon = uPnl >= 0 ? "🟢" : "🔴";
      msg += `${icon} <b>${pos.side.toUpperCase()} ${sym.replace(/-USD$/, "")}</b> ${pos.leverage}x\n`;
      msg += `  Entry: ${round(pos.entryPrice, 4)} → Mark: ${round(mark, 4)}\n`;
      msg += `  PnL: <code>${uPnl >= 0 ? "+" : ""}$${round(uPnl, 3)}</code> (${round(roi, 1)}%)\n`;
      msg += `  Liq: ${round(pos.liqPrice, 4)}\n\n`;
    }
    await notify(msg);
    return;
  }

  if (c === "/equity") {
    const { readJSONL } = await import("./store.mjs");
    const rows = readJSONL(V2.equity, 10);
    if (!rows.length) { await notify("📭 No equity data yet."); return; }
    let msg = `📈 <b>Equity (last ${rows.length} ticks)</b>\n\n`;
    for (const r of rows) {
      const t = new Date(r.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      msg += `<code>${t}</code>  $${round(r.equity, 2)}  DD:${round((r.dd || 0) * 100, 1)}%  ${r.riskState}\n`;
    }
    await notify(msg);
    return;
  }

  if (c === "/kill") {
    state.riskState = "halt";
    writeJSON(V2.state, state);
    await notify(
      `🛑 <b>KILL SWITCH ACTIVATED</b>\n\n` +
      `Trading is HALTED. No new positions will open.\n` +
      `Existing positions remain (with stops/liq active).\n\n` +
      `Send /start to resume.`
    );
    return;
  }

  if (c === "/start") {
    if (state.riskState === "halt") {
      state.riskState = "normal";
      writeJSON(V2.state, state);
      await notify(
        `▶️ <b>Trading RESUMED</b>\n\n` +
        `Risk state: normal. Bot will look for new entries.\n` +
        `Equity: <code>$${round(state.equity, 2)}</code>`
      );
    } else {
      await notify(`ℹ️ Already running. Risk state: <b>${state.riskState}</b>`);
    }
    return;
  }

  if (c === "/close_all") {
    // Queue close orders via the pending file
    const posSymbols = Object.keys(state.positions);
    if (!posSymbols.length) {
      await notify("📭 No positions to close.");
      return;
    }
    const pending = posSymbols.map((sym) => ({
      op: "close",
      symbol: sym,
      reason: "telegram-close-all",
    }));
    writeJSON(V2.pending, pending);
    await notify(
      `⚡ <b>CLOSE ALL queued</b>\n\n` +
      `${posSymbols.length} position(s) will close on next cycle:\n` +
      posSymbols.map((s) => `  • ${s.replace(/-USD$/, "")}`).join("\n")
    );
    return;
  }

  await notify(`❓ Unknown command. Send /help for options.`);
}

// ── Poll for commands ──────────────────────────────────────────────────────

export async function checkCommands(state) {
  try {
    const url = `${API}/getUpdates?offset=${_lastUpdateId + 1}&timeout=0&allowed_updates=["message"]`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      _lastUpdateId = update.update_id;
      const msg = update.message;
      if (!msg || !msg.text) continue;
      // Only accept commands from the owner
      if (String(msg.chat.id) !== CHAT_ID) continue;
      if (msg.text.startsWith("/")) {
        await handleCommand(msg.text, state);
      }
    }
  } catch (err) {
    // Silent fail — don't crash the engine for a telegram poll error
  }
}
