// Timestamp and currency validation shared by paper execution/research.
const positive = x => Number.isFinite(x) && x > 0;
export function quoteUsable(q, at = Date.now(), maxAgeMs = 30000) {
  return Boolean(q && q.ok !== false && !q.stale && positive(q.price) && Number.isFinite(q.sourceTs) &&
    Number.isFinite(q.receivedAt) && q.sourceTs <= at+1000 && q.receivedAt <= at+1000 &&
    at-q.sourceTs <= maxAgeMs && at-q.receivedAt <= maxAgeMs);
}
export function closedBars(bars, {asOf = Date.now(), intervalMs, continuous = true} = {}) {
  if (!Array.isArray(bars) || !positive(intervalMs)) throw new Error('Timestamped bars and interval required');
  const result = []; let previous = -Infinity;
  for (const b of bars) {
    if (![b.ts, b.closeTs, b.o, b.h, b.l, b.c].every(Number.isFinite) || ![b.o,b.h,b.l,b.c].every(positive) ||
      b.l > Math.min(b.o,b.c) || b.h < Math.max(b.o,b.c) || b.closeTs !== b.ts+intervalMs || b.ts <= previous) throw new Error('Malformed, duplicate or out-of-order candle');
    previous = b.ts;
    if (b.closeTs > asOf) continue;
    if (continuous && result.length && b.ts-result.at(-1).ts !== intervalMs) throw new Error('History gap');
    result.push({...b});
  }
  return result;
}
export function parseYahooBars(payload, {asOf = Date.now(), intervalMs = 86400000, continuous = false} = {}) {
  const result = payload?.chart?.result?.[0], quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(result?.timestamp) || !quote) throw new Error('Invalid history response');
  const adjusted = result.indicators.adjclose?.[0]?.adjclose;
  const bars = result.timestamp.map((ts, i) => {
    const factor = positive(adjusted?.[i]) && positive(quote.close[i]) ? adjusted[i]/quote.close[i] : 1;
    return {ts: ts*1000, closeTs: ts*1000+intervalMs, o: quote.open[i]*factor, h: quote.high[i]*factor,
      l: quote.low[i]*factor, c: quote.close[i]*factor, v: quote.volume?.[i] ?? 0, adjusted: Boolean(adjusted)};
  });
  return closedBars(bars, {asOf, intervalMs, continuous});
}
export function toUsd(q, fx, at = Date.now(), maxFxAgeMs = 86400000) {
  if (q.currency === 'USD' || q.currency === 'USDT') return {...q, localPrice: q.price, quoteCurrency: q.currency, currency: 'USD', fx: 1};
  if (q.currency !== 'INR' || !fx || !positive(fx.price) || !Number.isFinite(fx.ts) || fx.ts > at || at-fx.ts > maxFxAgeMs) return {...q, ok: false, rejection: 'missing_fresh_currency_conversion'};
  return {...q, localPrice: q.price, price: q.price/fx.price, quoteCurrency: 'INR', currency: 'USD', fx: fx.price, fxAsOf: fx.ts};
}
export function timestampedReturns(bars) {
  return bars.slice(1).map((b, i) => ({ts: b.closeTs, value: Math.log(b.c/bars[i].c)}));
}
export function alignPair(a, b, minimum = 50) {
  const other = new Map((b || []).map(x => [x.closeTs, x]));
  const pairs = (a || []).filter(x => other.has(x.closeTs)).map(x => [x, other.get(x.closeTs)]);
  return pairs.length >= minimum ? pairs.slice(-minimum) : [];
}
