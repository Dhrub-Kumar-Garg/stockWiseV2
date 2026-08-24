"use client";

import { useState } from "react";
import { usd, pct, signed, tone, price, timeAgo } from "../lib/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { Mascot } from "./visuals";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════════

function compactNum(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function bandColor(band: string): string {
  const m: Record<string, string> = {
    extreme_fear: "text-downink", fear: "text-down",
    neutral: "text-gold", greed: "text-up", extreme_greed: "text-upink",
  };
  return m[band] || "text-inksoft";
}

function bandLabel(band: string): string {
  return (band || "unknown").replace(/_/g, " ");
}

function stripUSD(sym: string): string {
  return (sym || "").replace(/-USD$/i, "");
}

// ════════════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

function EquityChart({ data, startCap }: { data: any[]; startCap: number }) {
  const [range, setRange] = useState<"1D" | "3D" | "1W" | "1M" | "ALL">("1D");

  if (!data || data.length < 2) return null;

  const start = startCap || 100;

  // Filter data by time range
  const nowMs = Date.now();
  const rangeMs: Record<string, number> = {
    "1D": 24 * 60 * 60 * 1000,
    "3D": 3 * 24 * 60 * 60 * 1000,
    "1W": 7 * 24 * 60 * 60 * 1000,
    "1M": 30 * 24 * 60 * 60 * 1000,
    "ALL": Infinity,
  };
  const cutoff = range === "ALL" ? 0 : nowMs - rangeMs[range];

  const points = data
    .filter((d: any) => d.equity != null && isFinite(d.equity) && (d.ts || 0) >= cutoff)
    .map((d: any) => ({
      ts: d.ts,
      equity: d.equity,
      profit: d.equity >= start ? d.equity : start,
      loss: d.equity < start ? d.equity : start,
    }));

  if (points.length < 2) return null;

  const minEq = Math.min(...points.map((p: any) => p.equity));
  const maxEq = Math.max(...points.map((p: any) => p.equity));
  const domainMin = Math.min(minEq, start) * 0.995;
  const domainMax = Math.max(maxEq, start) * 1.005;

  const firstTs = points[0]?.ts || 0;

  const fmtTime = (ts: number) => {
    // Show elapsed time relative to the start of the graph (00:00)
    const elapsedMs = Math.max(0, ts - firstTs);
    const totalMinutes = Math.floor(elapsedMs / 60000);
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  };

  const fmtDate = (ts: number) => {
    return fmtTime(ts); // For episodes, relative elapsed time is best
  };

  // Show date on X axis for ranges > 1D
  const fmtXAxis = range === "1D" ? fmtTime : (ts: number) => {
    const d = new Date(ts);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  const lastEq = points[points.length - 1].equity;
  const pnl = lastEq - start;
  const isUp = pnl >= 0;

  const ranges: Array<"1D" | "3D" | "1W" | "1M" | "ALL"> = ["1D", "3D", "1W", "1M", "ALL"];

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5 text-[10px] text-inksoft">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(31,157,98,0.25)" }} />
          Profit zone
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(229,86,111,0.25)" }} />
          Loss zone
        </span>
        <span className="ml-auto flex items-center gap-1">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                range === r
                  ? "bg-sakura text-white shadow-sm"
                  : "bg-cream2 text-inksoft hover:bg-sakurasoft"
              }`}
            >
              {r}
            </button>
          ))}
        </span>
      </div>
      <div style={{ width: "100%", height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-up)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-up)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradLoss" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-down)" stopOpacity={0.05} />
                <stop offset="100%" stopColor="var(--color-down)" stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="ts"
              tickFormatter={fmtXAxis}
              tick={{ fontSize: 9, fill: "var(--color-inksoft)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              tick={{ fontSize: 9, fill: "var(--color-inksoft)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={38}
            />
            <ReferenceLine
              y={start}
              stroke="var(--color-inksoft)"
              strokeDasharray="4 3"
              strokeOpacity={0.5}
            />
            <Tooltip
              content={({ active, payload }: any) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                const eq = d.equity;
                const diff = eq - start;
                return (
                  <div className="card-quiet px-3 py-2 text-xs shadow-lg">
                    <p className="font-medium tnum">{usd(eq)}</p>
                    <p className={diff >= 0 ? "text-upink" : "text-downink"}>
                      {signed(diff)} ({((diff / start) * 100).toFixed(1)}%)
                    </p>
                    <p className="text-inksoft text-[10px]">{fmtDate(d.ts)}</p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="profit"
              stroke="var(--color-up)"
              strokeWidth={1.5}
              fill="url(#gradProfit)"
              baseValue={start}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="loss"
              stroke="var(--color-down)"
              strokeWidth={1.5}
              fill="url(#gradLoss)"
              baseValue={start}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke={isUp ? "var(--color-up)" : "var(--color-down)"}
              strokeWidth={1.8}
              fill="none"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function GoalBar({ goal, equity, startCap }: { goal: any; equity: number; startCap: number }) {
  if (!goal) return null;
  const target = goal.target || 500;
  const start = goal.startEquity || startCap;
  const prog = target > start ? Math.max(0, Math.min(1, (equity - start) / (target - start))) : 0;
  const longDeadline = (goal.deadlineHours || 0) >= 1000;
  const hoursLeft = Math.max(0, (goal.deadlineHours || 0) - ((Date.now() - (goal.startedAt || 0)) / 3.6e6));

  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs text-inksoft mb-1.5">
        <span>Goal · {usd(target, 0)}</span>
        <span>{longDeadline ? "no deadline, fast as it can" : `${Math.floor(hoursLeft)}h left`}</span>
      </div>
      <div className="w-full h-3 rounded-full bg-cream2 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${prog * 100}%`, background: "linear-gradient(90deg, var(--color-sakura), var(--color-gold), var(--color-up))" }} />
      </div>
      <div className="text-right text-xs text-inksoft mt-1">{(prog * 100).toFixed(1)}%</div>
    </div>
  );
}

function FnGGauge({ data, label }: { data: any; label: string }) {
  const isDash = !data || data === "—";
  const val = isDash ? null : data.value;
  const band = isDash ? "unknown" : data.band;

  return (
    <div className="card-quiet p-4 text-center flex-1">
      <div className="text-xs text-inksoft mb-1">{label}</div>
      <div className="text-3xl font-display tnum">{val ?? "—"}</div>
      <div className={`text-xs font-medium capitalize mt-0.5 ${bandColor(band)}`}>{bandLabel(band)}</div>
      {val != null && (
        <div className="relative w-full h-2 rounded-full mt-3" style={{ background: "linear-gradient(90deg, var(--color-down), var(--color-gold), var(--color-up))" }}>
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-ink shadow-sm transition-all"
            style={{ left: `calc(${val}% - 6px)` }} />
        </div>
      )}
    </div>
  );
}

function RunwayBar({ pos }: { pos: any }) {
  const mark = pos.mark || pos.entry;
  const liq = pos.liqPrice;
  if (!mark || !liq) return null;
  const distPct = Math.abs(mark - liq) / mark * 100;
  const barPct = Math.min(100, distPct * 4);
  const danger = distPct < 4;
  const watch = distPct < 12;
  const color = danger ? "bg-down" : watch ? "bg-gold" : "bg-up";
  const tag = danger ? "danger" : watch ? "watch" : "safe";
  const tagClr = danger ? "text-down" : watch ? "text-gold" : "text-up";

  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-inksoft">Liq runway</span>
        <span className={`font-medium ${tagClr}`}>{distPct.toFixed(1)}% · {tag}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-cream2">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const m: Record<string, string> = {
    active: "bg-up/15 text-upink border-up/30",
    candidate: "bg-lavsoft/40 text-lav border-lavsoft",
    probation: "bg-gold/15 text-gold border-gold/30",
    retired: "bg-down/10 text-downink border-down/20",
  };
  const cls = m[status] || "bg-cream2 text-inksoft border-cream2";
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${cls}`}>{status}</span>;
}

function SidePill({ side }: { side: string }) {
  const long = side === "long";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wider uppercase ${long ? "bg-up/15 text-upink" : "bg-down/12 text-downink"}`}>
      {side}
    </span>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-semibold mb-1">{title}</h2>
      {intro && <p className="text-sm text-inksoft mb-4 max-w-2xl">{intro}</p>}
      {children}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="card-quiet p-8 flex flex-col items-center gap-3 text-center">
      <Mascot size={72} mood="asleep" />
      <p className="text-sm text-inksoft">{text}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  OVERVIEW TAB
// ════════════════════════════════════════════════════════════════════════════

function OverviewTab({ sig, episodes, equity: eqCurve, world }: any) {
  const lastEp = episodes?.length ? episodes[episodes.length - 1] : null;

  return (
    <div className="space-y-5">
      {/* While you were away */}
      <div className="card-quiet p-4">
        {lastEp ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-lg">{lastEp.blownUp ? "💀" : lastEp.endReason === "goal" ? "🎯" : "✨"}</span>
            <span className="font-medium">Run {lastEp.episodeNum}</span>
            <span className={tone(lastEp.returnPct)}>{pct(lastEp.returnPct)}</span>
            <span className="text-inksoft">· {timeAgo(lastEp.endedAt)}</span>
            <span className="text-inksoft ml-auto text-xs">
              Gen {lastEp.generation ?? "?"} · {sig.aggression?.leverageCap}x · Kelly {((sig.aggression?.kellyFraction ?? 0) * 100).toFixed(0)}%
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-inksoft">
            <span className="text-lg">🌱</span>
            <span>Run 1 in progress — the bot is learning from scratch.</span>
          </div>
        )}
      </div>

      {/* Equity Card */}
      <div className="card p-6">
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <p className="text-xs text-inksoft mb-1">Account Equity · Episode {sig.episodeNum ?? "?"}</p>
            <p className="font-display text-5xl font-bold tnum">{usd(sig.equity)}</p>
            <p className="mt-1 text-sm">
              <span className={tone(sig.totalPnl)}>{signed(sig.totalPnl)} ({pct(sig.totalPnlPct)})</span>
              <span className="text-inksoft"> this run · from {usd(sig.startingCapital, 0)}</span>
            </p>
          </div>
          <div className="text-right text-sm space-y-0.5">
            <p className="text-inksoft">Gross leverage <span className="tnum font-medium text-ink">{sig.grossLeverage?.toFixed(1) ?? "0"}x</span></p>
            <p className="text-inksoft">Max drawdown <span className="tnum font-medium text-down">{((sig.maxDrawdownPct || 0) * 100).toFixed(1)}%</span></p>
          </div>
        </div>
        <div className="mt-3">
          <EquityChart data={eqCurve || []} startCap={sig.startingCapital || 100} />
        </div>
        <GoalBar goal={sig.goal} equity={sig.equity || 0} startCap={sig.startingCapital || 100} />
      </div>

      {/* The Bot + Positions + World row */}
      {/* AI Analyst Card */}
      {sig.analyst && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🧠</span>
            <span className="text-xs font-medium">AI Market Analyst</span>
            <span className={`ml-auto text-[10px] px-2.5 py-1 rounded-full font-bold tracking-wider uppercase ${
              sig.analyst.mode === "TREND" ? "bg-up/15 text-upink border border-up/30" :
              sig.analyst.mode === "REVERT" ? "bg-lavsoft/40 text-lav border border-lavsoft" :
              "bg-down/10 text-downink border border-down/20"
            }`}>{sig.analyst.mode || "SLEEP"}</span>
          </div>
          <div className="flex gap-3 text-xs text-inksoft mb-3">
            <span>Bias: <span className={`font-medium ${
              sig.analyst.direction_bias === "LONG" ? "text-upink" :
              sig.analyst.direction_bias === "SHORT" ? "text-downink" :
              "text-inksoft"
            }`}>{sig.analyst.direction_bias || "NEUTRAL"}</span></span>
            <span>Aggression: <span className="font-medium text-ink">{((sig.analyst.aggression || 0) * 100).toFixed(0)}%</span></span>
            {sig.analyst.ts && <span className="ml-auto">{timeAgo(sig.analyst.ts)}</span>}
          </div>
          {sig.analyst.reasoning && (
            <p className="text-[11px] text-inksoft leading-relaxed bg-cream2/50 rounded-lg px-3 py-2">
              {sig.analyst.reasoning}
            </p>
          )}
        </div>
      )}

      {/* The Bot + Positions + World row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* The Bot */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-up live-dot" />
            <span className="text-xs font-medium">The Bot</span>
          </div>
          <div className="flex items-center gap-3">
            <Mascot size={56} mood="happy" />
            <div className="text-xs space-y-0.5 text-inksoft">
              <p>Generation <span className="font-medium text-ink">{sig.generation ?? 1}</span></p>
              <p>{sig.lifetime?.episodes ?? 1} runs · {sig.lifetime?.totalBlowups ?? 0} blow-ups</p>
              <p>Best run <span className={tone(sig.lifetime?.bestEpisodeReturnPct)}>{pct(sig.lifetime?.bestEpisodeReturnPct)}</span></p>
              <p>Last tick {timeAgo(sig.ts)}</p>
            </div>
          </div>
          {/* Aggression dial */}
          <div className="pt-2 border-t border-white/40">
            <p className="text-[10px] text-inksoft mb-1">Aggression · earned leverage</p>
            <div className="flex items-center gap-2">
              <span className="text-sm tnum font-medium">{sig.aggression?.leverageCap ?? 0}x</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "linear-gradient(90deg, var(--color-up), var(--color-gold), var(--color-down))" }}>
                <div className="h-full bg-white/80 rounded-full transition-all" style={{ width: `${100 - ((sig.aggression?.leverageCap || 1) / (sig.aggression?.leverageCeiling || 40)) * 100}%`, marginLeft: "auto" }} />
              </div>
              <span className="text-[10px] text-inksoft">{sig.aggression?.leverageCeiling ?? 40}x</span>
            </div>
            <div className="flex justify-between text-[10px] text-inksoft mt-1">
              <span>Kelly {((sig.aggression?.kellyFraction ?? 0) * 100).toFixed(0)}%</span>
              <span>Unlock lvl {sig.aggression?.unlockedLevel ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Open Positions (compact) */}
        <div className="card p-5 lg:col-span-1">
          <p className="text-xs font-medium mb-3">Open Positions</p>
          {(!sig.positions || sig.positions.length === 0) ? (
            <p className="text-xs text-inksoft py-4 text-center">No open positions</p>
          ) : (
            <div className="space-y-2.5 max-h-60 overflow-y-auto">
              {sig.positions.map((p: any) => (
                <div key={p.symbol} className="card-quiet p-2.5 text-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <SidePill side={p.side} />
                    <span className="font-medium">{stripUSD(p.symbol)}</span>
                    <span className="text-inksoft">{p.leverage}x</span>
                    <span className={`ml-auto tnum font-medium ${tone(p.uPnl)}`}>{signed(p.uPnl)}</span>
                  </div>
                  <RunwayBar pos={p} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* World mini */}
        <div className="card p-5">
          <p className="text-xs font-medium mb-3">World</p>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-inksoft">Regime</span><span className="font-medium capitalize">{sig.regime || "—"}</span></div>
            <div className="flex justify-between"><span className="text-inksoft">Crypto F&G</span>
              <span className={`font-medium ${bandColor(world?.fearGreedCrypto?.band)}`}>
                {world?.fearGreedCrypto?.value ?? "—"} · {bandLabel(world?.fearGreedCrypto?.band || "unknown")}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-inksoft">Risk</span><span className={`font-medium capitalize ${sig.riskState === "halt" ? "text-down" : sig.riskState === "caution" ? "text-gold" : "text-up"}`}>{sig.riskState || "normal"}</span></div>
          </div>
          {world?.thesis && (
            <p className="text-[10px] text-inksoft mt-3 leading-relaxed line-clamp-3">{world.thesis}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  POSITIONS TAB
// ════════════════════════════════════════════════════════════════════════════

function PositionsTab({ sig }: any) {
  const positions = sig.positions || [];

  return (
    <Section title="Positions">
      {positions.length === 0 ? (
        <EmptyNote text="No open positions right now." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {positions.map((p: any) => (
              <div key={p.symbol} className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <SidePill side={p.side} />
                  <span className="font-display text-lg font-semibold">{stripUSD(p.symbol)}</span>
                  <span className="text-xs text-inksoft">{p.leverage}x</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cream2 text-inksoft">{p.strategy_id}</span>
                </div>
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <p className={`text-2xl tnum font-display font-bold ${tone(p.uPnl)}`}>{signed(p.uPnl)}</p>
                    <p className={`text-sm tnum ${tone(p.roiPct)}`}>{p.roiPct?.toFixed(1) ?? "0"}% ROI</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="card-quiet p-2"><p className="text-inksoft">Entry</p><p className="tnum font-medium">{price(p.entry)}</p></div>
                  <div className="card-quiet p-2"><p className="text-inksoft">Mark</p><p className="tnum font-medium">{price(p.mark)}</p></div>
                  <div className="card-quiet p-2"><p className="text-inksoft">Notional</p><p className="tnum font-medium">{usd(p.notional, 0)}</p></div>
                </div>
                <RunwayBar pos={p} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-inksoft mt-4 leading-relaxed max-w-xl">
            Liquidation is computed on a smoothed mark price, with real fees + funding + slippage. The bar shows how close each position is to being wiped out.
          </p>
        </>
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  EPISODES TAB
// ════════════════════════════════════════════════════════════════════════════

function EpisodesTab({ episodes, sig }: any) {
  const eps = (episodes || []) as any[];
  const hasEnough = eps.length >= 3;
  const maxAbs = Math.max(...eps.map((e: any) => Math.abs(e.returnPct || 0)), 0.01);

  return (
    <Section title="Episodes" intro="Each run goes until it hits the goal, runs out of time, or blows up, then resets and tries again, sharper.">
      {/* Bar timeline */}
      {hasEnough ? (
        <div className="card p-5 mb-5 overflow-x-auto">
          <div className="flex items-end gap-1.5 min-w-[400px] h-28">
            {eps.map((e: any, i: number) => {
              const h = Math.max(8, (Math.abs(e.returnPct || 0) / maxAbs) * 90);
              const blew = e.blownUp;
              const won = e.endReason === "goal";
              const clr = blew ? "bg-down" : won ? "bg-up" : "bg-gold";
              return (
                <div key={i} className="flex flex-col items-center flex-1 gap-0.5">
                  {blew && <span className="text-[9px]">💀</span>}
                  <div className={`w-full rounded-t-md ${clr} transition-all`} style={{ height: `${h}%` }} title={`Run ${e.episodeNum}: ${(e.returnPct * 100).toFixed(1)}%`} />
                  <span className="text-[8px] text-inksoft">{e.episodeNum}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card-quiet p-6 text-center text-sm text-inksoft mb-5">
          <span className="text-lg mr-1">⏳</span>
          Episode {sig?.episodeNum ?? 1} in progress — timeline appears after 3 finished runs.
        </div>
      )}

      {/* Finished runs list */}
      {eps.length > 0 ? (
        <div className="card p-5">
          <p className="text-xs font-medium mb-3">Finished Runs</p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {[...eps].reverse().map((e: any) => (
              <div key={e.episodeNum} className="card-quiet p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-medium">Run {e.episodeNum}</span>
                <span className="capitalize">{e.endReason === "blowup" ? "💀 blow-up" : e.endReason === "goal" ? "🎯 goal" : "⏱ time"}</span>
                <span className="text-inksoft">Peak {usd(e.peakEquity)}</span>
                <span className="text-inksoft">DD {((e.maxDrawdownPct || 0) * 100).toFixed(1)}%</span>
                <span className={`ml-auto tnum font-medium ${tone(e.returnPct)}`}>{pct(e.returnPct)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyNote text="No finished runs yet. The first episode is still running." />
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  EVOLUTION TAB
// ════════════════════════════════════════════════════════════════════════════

function EvolutionTab({ generations }: any) {
  const gens = (generations || []) as any[];

  return (
    <Section title="Evolution · Level-Ups" intro="Every finished run banks a lesson and may promote or retire a strategy, retune Kelly, and unlock (or claw back) leverage.">
      {gens.length === 0 ? (
        <EmptyNote text="No level-ups yet. The bot needs to finish at least one run." />
      ) : (
        <div className="space-y-3">
          {gens.map((g: any, i: number) => (
            <div key={i} className="card p-5">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-display text-lg font-semibold">Gen {g.generation}</span>
                <span className="text-xs text-inksoft">after run #{g.afterEpisode}</span>
              </div>
              <div className="flex gap-4 text-xs text-inksoft mb-2">
                <span>Leverage <span className="font-medium text-ink">{g.leverageCap}x</span></span>
                <span>Kelly <span className="font-medium text-ink">{((g.kellyFraction || 0) * 100).toFixed(0)}%</span></span>
                <span>Unlock lvl <span className="font-medium text-ink">{g.unlockedLevel ?? 0}</span></span>
              </div>
              {g.note && <p className="text-sm text-inksoft leading-relaxed">{g.note}</p>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  STRATEGIES TAB
// ════════════════════════════════════════════════════════════════════════════

function StrategiesTab({ strategies }: any) {
  const strats = (strategies || []) as any[];
  const allEarly = strats.every((s: any) => s.status === "candidate" && (!s.learned || s.learned.n < 5));

  return (
    <Section title="Strategy Book" intro="A strategy only earns active after it proves a real edge (statistical gates + Deflated Sharpe). Losers get retired.">
      {allEarly && (
        <div className="card-quiet p-4 text-sm text-inksoft mb-4 flex items-center gap-2">
          <span>🔍</span>
          <span>All strategies are still in early evaluation — none have enough trades to be promoted or retired yet.</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strats.map((s: any) => {
          const l = s.learned || {};
          return (
            <div key={s.id} className="card p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium">{s.name}</span>
                <StatusPill status={s.status} />
              </div>
              <p className="text-xs text-inksoft mb-3">{s.text}</p>
              <div className="flex gap-3 text-xs text-inksoft mb-3">
                <span>n = <span className="tnum text-ink">{l.n ?? 0}</span></span>
                <span>Kelly <span className="tnum text-ink">{((l.kelly || 0) * 100).toFixed(0)}%</span></span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="card-quiet p-2">
                  <p className="text-inksoft text-[10px]">Exp R</p>
                  <p className={`tnum font-medium ${tone(l.expectancy_R)}`}>{(l.expectancy_R ?? 0).toFixed(2)}</p>
                </div>
                <div className="card-quiet p-2">
                  <p className="text-inksoft text-[10px]">PF</p>
                  <p className="tnum font-medium">{(l.pf ?? l.profitFactor ?? 0).toFixed(2)}</p>
                </div>
                <div className="card-quiet p-2">
                  <p className="text-inksoft text-[10px]">DSR</p>
                  <p className="tnum font-medium">{(l.dsr ?? 0).toFixed(2)}</p>
                </div>
                <div className="card-quiet p-2">
                  <p className="text-inksoft text-[10px]">Conf</p>
                  <p className="tnum font-medium">{(l.confidence ?? 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  WORLD TAB
// ════════════════════════════════════════════════════════════════════════════

function WorldTab({ world }: any) {
  const w = world || {};
  const macro = w.macro || {};
  const mood = w.newsMood || {};
  const headlines = Array.isArray(w.headlines) ? w.headlines : [];
  const fedLines = Array.isArray(w.fed) ? w.fed : [];

  return (
    <Section title="World">
      {/* Fear & Greed gauges */}
      <div className="flex gap-4 mb-5">
        <FnGGauge data={w.fearGreedCrypto} label="Crypto Fear & Greed" />
        <FnGGauge data={w.fearGreedStocks} label="Stock Fear & Greed" />
      </div>

      {/* Macro & Flow */}
      <div className="card p-5 mb-5">
        <p className="text-xs font-medium mb-3">Macro & Flow</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div className="card-quiet p-3"><p className="text-inksoft">Regime</p><p className="font-medium capitalize">{macro.label || w.regime || "—"}</p></div>
          <div className="card-quiet p-3"><p className="text-inksoft">Funding 8h</p><p className="tnum font-medium">{w.fundingRate != null && w.fundingRate !== "—" ? `${w.fundingRate}%` : "—"}</p></div>
          <div className="card-quiet p-3"><p className="text-inksoft">Crypto OI</p><p className="tnum font-medium">{w.oiUsd && w.oiUsd !== "—" ? compactNum(w.oiUsd) : "—"}</p></div>
          <div className="card-quiet p-3"><p className="text-inksoft">Whales</p><p className="font-medium capitalize">{w.whaleCrowd && w.whaleCrowd !== "—" ? w.whaleCrowd.replace(/_/g, " ") : "—"}</p></div>
          <div className="card-quiet p-3"><p className="text-inksoft">News mood</p><p className="font-medium capitalize">{mood.impact || "—"}</p></div>
          <div className="card-quiet p-3"><p className="text-inksoft">Put/Call</p><p className="tnum font-medium">{typeof w.putCall === "object" && w.putCall?.ratio ? w.putCall.ratio : "—"}</p></div>
        </div>
        {macro.drivers?.length > 0 && (
          <p className="text-xs text-inksoft mt-3">{macro.drivers.join(" · ")}</p>
        )}
      </div>

      {/* Thesis */}
      {w.thesis && (
        <div className="card-quiet p-5 mb-5">
          <div className="flex items-start gap-2">
            <span className="text-base mt-0.5">🌸</span>
            <p className="text-sm text-inksoft leading-relaxed">{w.thesis}</p>
          </div>
        </div>
      )}

      {/* Headlines */}
      {(headlines.length > 0 || fedLines.length > 0) && (
        <div className="card p-5">
          <p className="text-xs font-medium mb-3">Headlines</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {fedLines.slice(0, 3).map((h: string, i: number) => (
              <p key={`fed-${i}`} className="text-xs text-inksoft leading-relaxed">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-lavsoft/40 text-lav mr-1.5">Fed</span>
                {h.length > 120 ? h.slice(0, 120) + "…" : h}
              </p>
            ))}
            {headlines.map((h: string, i: number) => (
              <p key={`news-${i}`} className="text-xs text-inksoft leading-relaxed">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sakurasoft/50 text-inksoft mr-1.5">News</span>
                {h.length > 120 ? h.slice(0, 120) + "…" : h}
              </p>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  LESSONS TAB
// ════════════════════════════════════════════════════════════════════════════

function LessonsTab({ memory }: any) {
  const lessons = (memory || []) as any[];

  return (
    <Section title="Lessons Banked" intro="The bot learns harder from blow-ups than wins. Each is tagged to a market regime.">
      {lessons.length === 0 ? (
        <EmptyNote text="No lessons banked yet. The bot needs to close trades before it can learn." />
      ) : (
        <div className="space-y-3">
          {lessons.map((l: any, i: number) => {
            const kindCls = l.kind === "blowup" ? "bg-down/12 text-downink" : l.kind === "win" ? "bg-up/12 text-upink" : "bg-gold/12 text-gold";
            return (
              <div key={i} className="card p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">{l.title || "Lesson"}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${kindCls}`}>{l.kind || "note"}</span>
                </div>
                {l.lesson && <p className="text-xs text-inksoft mb-2 leading-relaxed">{l.lesson}</p>}
                <div className="flex gap-3 text-[10px] text-inksoft">
                  <span>Regime: <span className="capitalize">{l.regime || "—"}</span></span>
                  <span>Importance: <span className="tnum">{l.importance ?? "—"}</span></span>
                  {l.ts && <span className="ml-auto">{timeAgo(l.ts)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TRADES TAB
// ════════════════════════════════════════════════════════════════════════════

function TradesTab({ trades }: any) {
  const fills = (trades || []) as any[];

  return (
    <Section title="Recent Fills">
      {fills.length === 0 ? (
        <EmptyNote text="No trades yet." />
      ) : (
        <div className="card p-5">
          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
            {fills.map((t: any, i: number) => {
              const isOpen = t.type === "fill";
              const isClose = !!t.exit_reason;
              return (
                <div key={i} className="card-quiet p-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isClose ? "bg-down/10 text-downink" : "bg-up/10 text-upink"}`}>
                    {isClose ? "close" : "open"}
                  </span>
                  <SidePill side={t.side} />
                  <span className="font-medium">{stripUSD(t.symbol)}</span>
                  <span className="text-inksoft">{t.leverage}x</span>
                  <span className="text-inksoft capitalize">{t.exit_reason || t.strategy_id || ""}</span>
                  <span className={`ml-auto tnum font-medium ${isClose ? tone(t.net_pnl) : "text-ink"}`}>
                    {isClose ? signed(t.net_pnl) : usd(t.margin)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  NAV CONFIG
// ════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "overview", label: "Overview", icon: "◎" },
  { id: "positions", label: "Positions", icon: "◫" },
  { id: "episodes", label: "Episodes", icon: "▸" },
  { id: "evolution", label: "Evolution", icon: "↗" },
  { id: "strategies", label: "Strategies", icon: "✦" },
  { id: "world", label: "World", icon: "⊕" },
  { id: "lessons", label: "Lessons", icon: "✎" },
  { id: "trades", label: "Trades", icon: "⇄" },
];

// ════════════════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════════════════

export default function DashboardV2({ data }: { data: any }) {
  const [tab, setTab] = useState("overview");

  const v2 = data.v2 || {};
  const sig = v2.signals || {};
  const episodes = v2.episodes || [];
  const generations = v2.generations || [];
  const strategies = v2.strategies || [];
  const memory = v2.memory || [];
  const equity = v2.equity || [];
  const trades = v2.trades || [];
  const world = sig.world || {};

  const renderTab = () => {
    switch (tab) {
      case "overview": return <OverviewTab sig={sig} episodes={episodes} equity={equity} world={world} />;
      case "positions": return <PositionsTab sig={sig} />;
      case "episodes": return <EpisodesTab episodes={episodes} sig={sig} />;
      case "evolution": return <EvolutionTab generations={generations} />;
      case "strategies": return <StrategiesTab strategies={strategies} />;
      case "world": return <WorldTab world={world} />;
      case "lessons": return <LessonsTab memory={memory} />;
      case "trades": return <TradesTab trades={trades} />;
      default: return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
      {/* ── Desktop sidebar ──────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 card p-5 sticky top-6 self-start max-h-[calc(100vh-3rem)]">
        {/* Badge */}
        <div className="flex items-center gap-3 mb-4">
          <img src="/avatar.png" alt="Dhrub Garg" className="w-11 h-11 rounded-full object-cover shadow-md border-2 border-white/60" />
          <div>
            <p className="text-sm font-medium leading-tight">Dhrub Garg</p>
            <p className="text-[10px] text-inksoft">StockWise v2</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 flex-1">
          {TABS.map((t) => (
            <button key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-all ${tab === t.id
                  ? "bg-sakurasoft/50 text-ink font-medium shadow-sm"
                  : "text-inksoft hover:bg-white/40 hover:text-ink"
                }`}>
              <span className="w-4 text-center text-xs">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Bottom note */}
        <p className="text-[9px] text-inksoft/70 leading-relaxed mt-4 pt-3 border-t border-white/30">
          Simulation on real live prices. Fake money, real lessons. Honest by design, it can lose everything, it never lies.
        </p>
      </aside>

      {/* ── Mobile pill bar ──────────────────────────────────────────── */}
      <nav className="lg:hidden flex overflow-x-auto gap-2 pb-2 -mx-4 px-4 scrollbar-hide">
        {TABS.map((t) => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            className={`pill px-4 py-2 text-sm whitespace-nowrap shrink-0 transition-all ${tab === t.id
                ? "bg-sakurasoft/60 text-ink font-medium shadow-sm"
                : "text-inksoft hover:bg-white/50"
              }`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        {renderTab()}
      </main>
    </div>
  );
}
