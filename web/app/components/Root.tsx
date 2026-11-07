"use client";

import { useEffect, useState } from "react";
import { Sakura, Mascot } from "./visuals";
import DashboardV2 from "./DashboardV2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

export default function Root() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("stockwise_token");
      if (saved) setToken(saved);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController;

    async function poll() {
      active = new AbortController();
      const deadline = setTimeout(() => active.abort(), 5000);
      try {
        const res = await fetch("/api/state", { cache: "no-store", signal: active.signal, headers: {Authorization: `Bearer ${token}`} });
        if (res.status === 401 || res.status === 503) {
          if (mounted) {
            setAuthError(res.status === 503 ? "Dashboard access has not been configured on the server." : "Access token was rejected.");
            setToken("");
            if (typeof window !== "undefined") localStorage.removeItem("stockwise_token");
            setData(null);
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) { setData(json); setError(false); }
      } catch {
        if (mounted) setError(true);
      } finally {
        clearTimeout(deadline);
        if (mounted) timer = setTimeout(poll, 6000);
      }
    }

    poll();
    return () => { mounted = false; clearTimeout(timer); active?.abort(); };
  }, [token]);

  if (!token) return <main className="min-h-screen flex items-center justify-center p-6">
    <form className="card p-6 space-y-4 max-w-sm w-full" onSubmit={e => {
      e.preventDefault();
      setAuthError("");
      setToken(input);
      if (typeof window !== "undefined") localStorage.setItem("stockwise_token", input);
      setInput("");
    }}>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">StockWise dashboard</h1>
        <span className="text-[11px] text-inksoft/80 bg-cream2 px-2.5 py-0.5 rounded-full border border-sakurasoft/50">
          Still Improving this bot
        </span>
      </div>
      <label className="block text-sm">Dashboard access token
        <input type="password" autoComplete="off" required value={input} onChange={e => setInput(e.target.value)} className="block w-full border rounded p-2 mt-2" />
      </label>
      {authError && <p role="alert">{authError}</p>}
      <button type="submit" className="pill px-4 py-2">Open dashboard</button>
    </form>
  </main>;

  // ── Loading / error state ──────────────────────────────────────────────
  if (!data) {
    return (
      <>
        <Sakura />
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4 text-center">
          <Mascot size={140} mood="asleep" />
          <h1 className="font-display text-4xl text-ink font-semibold tracking-tight">
            FabInvests
          </h1>
          <p className="text-inksoft text-lg">
            {error
              ? "Engine offline — waiting for data…"
              : "Waking up the bot…"}
          </p>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 border border-sakurasoft/60 text-xs text-inksoft font-medium shadow-xs">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            <span>Still Improving this bot</span>
          </div>
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
      {error && <p role="alert" className="card p-4">Connection lost. Displayed data may be stale.</p>}
      <DashboardV2 data={data} connectionError={error} />
    </>
  );
}
