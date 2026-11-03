import {NextResponse} from "next/server";
import path from "node:path";
import {readFileSync} from "node:fs";
import {dashboardAccess, dashboardDTO} from "../../../../scripts/v2/dashboard.mjs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) {
  const access = dashboardAccess(request.headers);
  if (!access.ok) return NextResponse.json({error: access.error}, {status: access.status, headers: {"Cache-Control": "no-store"}});
  const data = process.env.STOCKWISE_DATA_DIR || path.resolve(process.cwd(), "../data/paper");
  const read = (name: string, fallback: unknown = null): unknown => {
    try { return JSON.parse(readFileSync(path.join(data, name), "utf8")); } catch { return fallback; }
  };
  const lines = (name: string, limit: number): unknown[] => {
    try { return readFileSync(path.join(data, name), "utf8").trim().split("\n").slice(-limit).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }); } catch { return []; }
  };
  return NextResponse.json(dashboardDTO({signals: read("signals.v2.json", {}), strategies: read("strategies.json", []),
    episodes: lines("episodes.jsonl", 40), generations: lines("generations.jsonl", 30), memory: lines("memory.jsonl", 20),
    trades: lines("trades.v2.jsonl", 100), equity: lines("equity.v2.jsonl", 2000)}),
    {headers: {"Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff"}});
}
