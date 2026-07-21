import { NextResponse } from "next/server";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Data directory: one level up from web/ ─────────────────────────────────
const ROOT = path.resolve(process.cwd(), "..");
const DATA = path.join(ROOT, "data");

// ── Safe readers ───────────────────────────────────────────────────────────

function readJson(filePath: string, fallback: unknown = null): unknown {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath: string, limit = 0): unknown[] {
  try {
    if (!existsSync(filePath)) return [];
    const lines = readFileSync(filePath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l));
    return limit > 0 ? parsed.slice(-limit) : parsed;
  } catch {
    return [];
  }
}

/** Downsample an array to at most `max` evenly-spaced points. */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  // Always include the very last point
  if (out[out.length - 1] !== arr[arr.length - 1]) {
    out.push(arr[arr.length - 1]);
  }
  return out;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET() {
  const config = readJson(path.join(ROOT, "config.json"), {});

  // V2 signals: prefer signals.v2.json, fall back to signals.json if version 2
  let signals = readJson(path.join(DATA, "signals.v2.json"), null);
  if (!signals) {
    const legacy = readJson(path.join(DATA, "signals.json"), null) as Record<string, unknown> | null;
    if (legacy && (legacy as { version?: number }).version === 2) {
      signals = legacy;
    }
  }

  const state      = readJson(path.join(DATA, "state.v2.json"), null);
  const strategies = readJson(path.join(DATA, "strategies.json"), []);

  const episodes    = readJsonl(path.join(DATA, "episodes.jsonl"), 40);
  const generations = readJsonl(path.join(DATA, "generations.jsonl"), 30).reverse();
  const memory      = readJsonl(path.join(DATA, "memory.jsonl"), 20).reverse();
  const tradesRaw   = readJsonl(path.join(DATA, "trades.v2.jsonl"), 60);
  const trades      = tradesRaw.reverse();

  // Equity curve — downsample to max 320 points for the chart
  const equityRaw = readJsonl(path.join(DATA, "equity.v2.jsonl"));
  const equity    = downsample(equityRaw, 320);

  const body = {
    v2: {
      signals:     signals ?? {},
      state:       state ?? {},
      strategies:  strategies ?? [],
      episodes,
      generations,
      memory,
      equity,
      trades,
      config,
      serverTs:    Date.now(),
    },
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
