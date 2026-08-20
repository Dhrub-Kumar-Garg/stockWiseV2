// scripts/v2/engine_ws.mjs — Phase 3: WebSocket + Limit Order Execution
import { V2, readJSON, writeJSON, now, clamp } from "./store.mjs";
import { CryptoFeed } from "./ws_feed.mjs";
import { runStrategies } from "./strategies.mjs";
import { sizeOrder } from "./sizing.mjs";
import * as P from "./perp.mjs";

console.log("🚀 Starting Institutional WebSocket Engine (StockWise V4)");

// Track pending Limit Orders (Maker)
const limitOrders = {}; // symbol -> { side, limitPrice, size, strategy_id }
let state = readJSON(V2.state, null) || { positions: {} };
const eq = {}; // Local memory quote database

function processTick(symbol, price) {
  // Update local memory
  if (!eq[symbol]) eq[symbol] = { symbol, price, market: "crypto" };
  eq[symbol].price = price;

  // 1. Manage Active Limit Orders
  const order = limitOrders[symbol];
  if (order) {
    // If the price crosses our limit order, it gets filled!
    const filled = (order.side === "long" && price <= order.limitPrice) ||
                   (order.side === "short" && price >= order.limitPrice);
                   
    if (filled) {
      console.log(`✅ Limit Order Filled: ${order.side.toUpperCase()} ${symbol} @ $${order.limitPrice}`);
      state.positions[symbol] = P.openPosition({
        symbol, market: "crypto", side: order.side,
        entryMark: order.limitPrice, margin: order.margin, leverage: order.leverage, tiers: [], meta: order.meta
      });
      delete limitOrders[symbol];
    } else {
      // Trail the limit order dynamically to capture the spread
      // If we are buying, we trail the bid. We'll simulate the bid as (price * 0.9995)
      const bid = price * 0.9995;
      const ask = price * 1.0005;
      
      const newLimit = order.side === "long" ? bid : ask;
      if (Math.abs(order.limitPrice - newLimit) / newLimit > 0.001) {
        console.log(`🔄 Trailing ${order.side} Limit Order for ${symbol} to $${newLimit.toFixed(2)}`);
        order.limitPrice = newLimit;
      }
    }
  }

  // 2. Manage Liquidations & Stops (Tick-by-tick)
  const pos = state.positions[symbol];
  if (pos) {
    const snap = P.markPosition(pos, price);
    if (snap.liquidated) {
      console.log(`☠️ LIQUIDATED: ${symbol} @ $${price}`);
      delete state.positions[symbol];
    } else {
      const sign = pos.side === "long" ? 1 : -1;
      const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * sign;
      
      if (pnlPct <= -(pos.openMeta.stopPct || 0.05)) {
        console.log(`🛑 Stop Loss Triggered: ${symbol} @ $${price}`);
        delete state.positions[symbol];
      } else if (pnlPct >= (pos.openMeta.targetPct || 0.1)) {
        console.log(`💰 Take Profit Triggered: ${symbol} @ $${price}`);
        delete state.positions[symbol];
      }
    }
  }
}

const feed = new CryptoFeed(["BTC-USD", "ETH-USD"], processTick);
feed.connect();

// Run Strategy Generation every 15 minutes
setInterval(() => {
  console.log("🧠 Evaluating Strategies...");
  // In a real live environment we'd fetch 15m closes here and populate eq[symbol].closes
  // const orders = runStrategies(state, eq, cfg, {});
  // For each order, we place it in `limitOrders` instead of immediate execution.
  // Example dummy trigger:
  if (!limitOrders["BTC-USD"] && !state.positions["BTC-USD"]) {
    // limitOrders["BTC-USD"] = { side: "long", limitPrice: feed.prices["BTC-USD"] * 0.9995, margin: 100, leverage: 5 };
  }
}, 15 * 60 * 1000);
