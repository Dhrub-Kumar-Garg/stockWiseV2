# Follow-up experiment plan — 2026-11-03

Written before downloading or evaluating the additional 2026 candles. Source
remains 50360996451ddc7ad742372bff398b7938ae0029; no runtime modifications.

Questions: does the fixed confidence asymmetry hurt net performance; does
running all strategy pools improve selection rather than simply add turnover?

Use additional public Binance spot 15m BTC/ETH/SOL/XRP/DOGE candles,
2026-01-01 through 2026-09-30. All archives checksum-verified. Completed
2025 daily bars provide 365-day warmup; first five days of January supply
intraday warmup. Evaluate Jan6–Mar31, Apr1–Jun30 and Jul1–Sep30 as separate
$100-start chronological tests. No historical AI/news/OI fabrication. This
period was not used by the preceding audit experiments, but the source author
may have seen it before the October2026 source revision. It is not a genuine
future or provably unseen developer holdout.

Same source functions, frozen seed learning, fixed neutral TREND and REVERT
scenarios, and common conservative execution as the original audit harness.
Cost baseline: 5bp fee +10bp slippage +2bp half-spread per side; signed1bp/8h
modeled funding. Stress: 5bp fee +24bp price concession per side and3bp/8h
funding. No threshold search and no production edits.

Four variants, frozen now:

- baseline: unchanged selection and signal confidence.
- symmetric_confidence: give a short the same heuristic confidence as its
  long counterpart: tsmom .62; donchian/rsi2dip .60; ORB .55; adaptive_regime
  .58 trend/.55 reversion; oi_diverge .60 confirmed/.52 divergence;
  atr_expand/vol_expand .58. Already symmetric functions unchanged.
  These numbers remain uncalibrated; experiment is a routing diagnostic.
- all_pools: change all seed pools to both in memory. Preserve signals,
  thresholds, confluence, costs and caps; cannot supply missing ORB/OI inputs.
- symmetric_all_pools: combine those two changes to measure interaction.

Primary advancement requires higher marked-daily Sharpe and total return,
PF>=baseline and>1, positive net expectancy, no higher DD, >=30 trades, and
positive net expectancy in at least2/3 test quarters and under stress.
Baseline and each candidate must use identical data/execution. Report each
mode, quarter, costs and directional/strategy participation. Reject failed
profit ideas; keep source defects and observability proposals separately.

This does not test minute-scale alpha, calibrated high-probability selection,
news-prediction edge, fill queues or production AI bias. Those need recorded
point-in-time inputs and a further untouched chronological/forward paper test.
