// scripts/v2/perp.mjs — Perpetual-contract leverage & liquidation math
// PURE functions, no file access. Mechanically correct to real exchanges.
// Money and life-or-death run on MARK price (smoothed index), never last tick.

export const sideSign = (side) => (side === "short" ? -1 : 1);
export const imr = (leverage) => 1 / leverage;

export function tierFor(notional, tiers) {
  const n = Math.abs(notional);
  let t = tiers[0];
  for (const cand of tiers) { if (n >= cand.floor && n < cand.cap) { t = cand; break; } t = cand; }
  return t;
}
export function maintenanceMargin(notional, tier) {
  return Math.abs(notional) * tier.mmr - (tier.deduction || 0);
}
export function maxLeverageAt(notional, tiers) { return tierFor(notional, tiers).maxLev; }

export function liqPrice(side, entry, leverage, mmr) {
  const s = sideSign(side);
  return entry * (1 - s * (1 / leverage) + s * mmr);
}
export function bankruptcyPrice(side, entry, leverage) {
  const s = sideSign(side);
  return entry * (1 - s * (1 / leverage));
}

export function unrealizedPnl(side, entry, mark, qty) {
  return (mark - entry) * qty * sideSign(side);
}
export function positionEquity(isolatedMargin, uPnl) { return isolatedMargin + uPnl; }
export function isLiquidated(side, mark, lqPrice) {
  return side === "short" ? mark >= lqPrice : mark <= lqPrice;
}

export function sizeFromMargin(margin, leverage, entryPrice) {
  const notional = margin * leverage;
  return { notional, qty: notional / entryPrice };
}
export function marginForNotional(notional, leverage) { return Math.abs(notional) / leverage; }

export function emaUpdate(prev, price, alpha) {
  if (prev == null || !isFinite(prev)) return price;
  return alpha * price + (1 - alpha) * prev;
}

export function tradeFee(notional, rate) { return Math.abs(notional) * rate; }

export function fundingPayment(notional, rate, side) {
  return -sideSign(side) * Math.abs(notional) * rate;
}
export function crossedFundingTimestamps(lastTs, nowTs, fundingHoursUTC = [0, 8, 16]) {
  if (!lastTs || nowTs <= lastTs) return [];
  const out = [];
  const start = new Date(lastTs); start.setUTCMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= nowTs; t += 3600 * 1000) {
    if (t <= lastTs) continue;
    const h = new Date(t).getUTCHours();
    if (fundingHoursUTC.includes(h)) out.push(t);
  }
  return out;
}

export function slippageFraction(orderNotionalUsd, volFrac = 0.02, depthProxyUsd = 2000000, k = 0.6) {
  const ratio = Math.max(0, orderNotionalUsd) / Math.max(1, depthProxyUsd);
  return k * Math.max(0.0005, volFrac) * Math.sqrt(ratio);
}
export function fillPrice(refPrice, side, halfSpreadFrac, slipFrac) {
  const s = sideSign(side);
  return refPrice * (1 + s * (halfSpreadFrac + slipFrac));
}

// ── Builder helpers ────────────────────────────────────────────────────────

/**
 * Build a full position object from order parameters.
 * entryMark is the mark price at entry (which becomes the fill price).
 */
export function openPosition({ symbol, market, side, entryMark, margin, leverage, tiers, meta }) {
  const { notional, qty } = sizeFromMargin(margin, leverage, entryMark);
  const tier = tierFor(notional, tiers);
  const mmrVal = tier.mmr;
  const lq = liqPrice(side, entryMark, leverage, mmrVal);
  const bk = bankruptcyPrice(side, entryMark, leverage);
  const ts = Date.now();

  return {
    symbol,
    market,
    side,
    entryPrice: entryMark,
    qty,
    notional,
    leverage,
    isolatedMargin: margin,
    mmr: mmrVal,
    maintDeduction: tier.deduction || 0,
    liqPrice: lq,
    bankruptcyPrice: bk,
    fundingAccrued: 0,
    feesPaid: 0,
    realizedPnl: 0,
    peakUPnl: 0,
    openedAt: ts,
    lastFundingTs: ts,
    openMeta: meta || {},
  };
}

/**
 * Mark-to-market a position. Returns current risk snapshot.
 */
export function markPosition(pos, mark) {
  const uPnl = unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  const equity = positionEquity(pos.isolatedMargin, uPnl);
  const maintMargin = maintenanceMargin(pos.notional, {
    mmr: pos.mmr,
    deduction: pos.maintDeduction,
  });
  const liquidated = isLiquidated(pos.side, mark, pos.liqPrice);

  return { mark, uPnl, equity, maintMargin, liquidated };
}
