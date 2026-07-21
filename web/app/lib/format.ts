/** Format helpers used across every dashboard component. */

const DASH = "—";

/** US dollar display: $1,234.56 or — for nullish values. */
export function usd(n: number | null | undefined, dp = 2): string {
  if (n == null || !isFinite(n)) return DASH;
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Percentage with sign: +12.3% or −4.1%. */
export function pct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return DASH;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

/** Signed dollar: +$5.23 or −$2.10. */
export function signed(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return DASH;
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Tailwind text colour class for gain / loss. */
export function tone(n: number | null | undefined): string {
  if (n == null) return "";
  return n >= 0 ? "text-upink" : "text-downink";
}

/** Price display: 4 decimals under $1, else 2. */
export function price(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return DASH;
  const dp = Math.abs(n) < 1 ? 4 : 2;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Human-friendly "5s ago", "3m ago", "2h ago", "1d ago". */
export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return DASH;
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
