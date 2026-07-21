"use client";

import { useEffect, useState } from "react";
import { Sakura, Mascot } from "./visuals";
import DashboardV2 from "./DashboardV2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

export default function Root() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) { setData(json); setError(false); }
      } catch {
        if (mounted) setError(true);
      }
    }

    poll();
    const id = setInterval(poll, 6000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // ── Loading / error state ──────────────────────────────────────────────
  if (!data) {
    return (
      <>
        <Sakura />
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4">
          <Mascot size={140} mood="asleep" />
          <h1 className="font-display text-4xl text-ink font-semibold tracking-tight">
            FabInvests
          </h1>
          <p className="text-inksoft text-lg">
            {error
              ? "Engine offline — waiting for data…"
              : "Waking up the bot…"}
          </p>
          <div className="flex gap-2 mt-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-sakurasoft"
                style={{
                  animation: "floaty 1.2s ease-in-out infinite",
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────
  return (
    <>
      <Sakura />
      <DashboardV2 data={data} />
    </>
  );
}
