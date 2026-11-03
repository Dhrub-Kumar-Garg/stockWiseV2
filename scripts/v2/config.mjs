export function validateConfig(input) {
  const cfg = structuredClone(input);
  if (!cfg?.v2 || !Array.isArray(cfg.watchlist) || !cfg.watchlist.length) throw new Error('V2 config/watchlist required');
  if (cfg.v2.execution?.mode && cfg.v2.execution.mode !== 'paper') throw new Error('Only paper execution is supported');
  if (!Number.isFinite(cfg.v2.startingCapital) || cfg.v2.startingCapital <= 0) throw new Error('Positive paper starting capital required');
  const seen = new Set();
  for (const w of cfg.watchlist) {
    if (typeof w.symbol !== 'string' || !/^[A-Za-z0-9^=.\-]{1,32}$/.test(w.symbol) || seen.has(w.symbol) || !['crypto','us','india'].includes(w.market)) throw new Error('Invalid or duplicate watchlist instrument');
    seen.add(w.symbol);
  }
  cfg.v2.execution = {mode:'paper', orderTtlMs:60000, modeledFundingRatePer8h:0.0001, ...cfg.v2.execution};
  for (const value of [cfg.v2.perpFees?.taker, ...Object.values(cfg.slippage || {})]) if (!Number.isFinite(value) || value < 0 || value > 0.1) throw new Error('Invalid cost configuration');
  const loop = cfg.v2.strategies?.loopSeconds;
  if (!Number.isFinite(loop) || loop < 1 || loop > 300) throw new Error('Loop interval must be 1–300 seconds');
  if (cfg.v2.analyst?.groqApiKey) throw new Error('Remove embedded analyst credentials from configuration; use optional environment settings');
  if(cfg.v2.learning?.kellyFraction!=null&&(!Number.isFinite(cfg.v2.learning.kellyFraction)||cfg.v2.learning.kellyFraction<0||cfg.v2.learning.kellyFraction>.25))throw new Error('Kelly must be zero to quarter Kelly');
  return cfg;
}
