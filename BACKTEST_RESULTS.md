# Backtest results and verification boundary

**No proposed change established positive out-of-sample edge. All eight profit candidates failed the preregistered screen in both fixed analyst modes.** Safety/accounting repairs remain valid proposals; they are not profit claims.

This is a **conditional source-linked research replay**, not measured production or live returns. It uses source revision `50360996451ddc7ad742372bff398b7938ae0029` and the unchanged strategy functions, dispatcher, strategy exits and baseline sizing rule. Source-backed bug proofs are separate.

## Data and causal protocol

- Five preselected symbols: BTC, ETH, SOL, XRP, DOGE. Binance **spot** USDT as USD proxy, 70,176 fifteen-minute bars per symbol from 2024-01-01 through 2025-12-31; 365 daily warmup bars in 2023. 350,880 intraday + 1,825 daily rows, 180 publisher-checksummed archives. No gaps/duplicates. 2025 microseconds normalized to milliseconds. No private data APIs or credentials.
- Every fold starts with $100. Completed daily closes only (last365, excludes current day), completed intraday closes only (last480). Decisions at candle close; entries and strategy exits at next candle open. No same-close signal fills. Stop-first if stop and target both touch; gap stops use adverse opening price. All terminal positions close and count as trades.
- Common executable-price simulator for every candidate: 5bp taker fee + 10bp slippage + 2bp half-spread **per side** (about34bp round trip), plus modeled signed1bp/8h funding. Stress: slippage+spread24bp per side and funding3bp/8h; fee remains5bp. These are explicit cost assumptions, not observed bid/ask or historical funding.
- Expanding training starts 2024-01-01. Test quarters: 2024Q3, 2024Q4, 2025Q1, 2025Q2. Each train set stops before its test. Final temporal holdout: 2025-07-01 through 2025-12-31. No threshold/symbol/variant tuning after seeing results. The final period was run after development folds. Source strategies were authored by2026: we cannot verify the developer never saw2024-25 data.
- Fixed neutral TREND and REVERT scenarios evaluated separately; neutral/missing news/F&G, no fabricated OI. Zero-observation seed confidence/learning is frozen. Empirical Kelly alone estimates p/payoff from **training** closed trades; requires30 observations and positive cost-net expectancy.
- Source-style daily episode risk-peak reset in baseline; no fresh deposits on ruin. All variants share corrected cash settlement, fees and financing. This deliberately prevents accounting bugs or EMA fills from masquerading as returns. It does not replay the whole deployed engine.

## Metrics and decision rule

Sharpe = mean(daily marked simple returns) / sample SD × sqrt365, risk-free0. DD uses **every15m equity mark**, including unrealized P&L. PF = total positive net trade P&L / absolute negative net trade P&L. Expectancy is **net USD/trade** at each fold’s $100 starting balance. Win rate counts net positive trades. N/A means no trades/variance/loss denominator, not a measured0 Sharpe. Development returns and curve are concatenated/rebased across independently initialized folds; trade dollars are pooled at equal initial capital. This is an evaluation construct, not a continuously traded $100 account; DD locks reset at each new fold.

A profit candidate had to have higher Sharpe and return, PF>=baseline and>1, positive expectancy, no higher DD, >=30 trades in aggregate development and holdout, plus improvement in>=3/4 quarters. Cost-stress expectancy must remain positive. None passed even before the stress gate. No parameter search, significance or maximized-profit claim is made.

## TREND: Walk-forward tests combined

| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | -13.11 | 99.68% | 0.45 | -0.0592 | 5,078 | 30.0% | -99.66% | Reference |
| Ledger wiring | -12.68 | 99.88% | 0.45 | -0.0659 | 4,872 | 30.0% | -99.87% | Correctness only; sizing alone worsens losses |
| Empirical quarter Kelly | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | No eligible edge; zero trades |
| Leverage/gross caps | -16.71 | 97.24% | 0.44 | -0.0291 | 7,946 | 31.4% | -97.18% | Safety only; fails profit gate |
| Loss kill-switch | -3.52 | 34.41% | 0.60 | -0.0735 | 456 | 35.1% | -29.67% | Safety only; fails profit gate |
| Remove one-legged pairs | -12.74 | 99.68% | 0.44 | -0.0619 | 4,854 | 30.5% | -99.67% | Reject profit claim |
| Daily + intraday confirmation | -13.17 | 98.95% | 0.49 | -0.0611 | 4,360 | 31.1% | -98.90% | Reject profit claim |
| 24h max hold | -2.56 | 87.57% | 0.80 | -0.0933 | 1,459 | 37.1% | -83.04% | Reject profit claim |
| 4h post-exit cooldown | -12.92 | 96.40% | 0.44 | -0.0669 | 3,299 | 32.1% | -96.28% | Reject profit claim |

## TREND: 2025-H2 temporal holdout

| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | -9.05 | 81.21% | 0.46 | -0.0570 | 1,424 | 29.0% | -81.15% | Reference |
| Ledger wiring | -8.61 | 84.26% | 0.47 | -0.0616 | 1,367 | 30.1% | -84.19% | Correctness only; sizing alone worsens losses |
| Empirical quarter Kelly | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | No eligible edge; zero trades |
| Leverage/gross caps | -12.80 | 75.28% | 0.43 | -0.0245 | 3,073 | 31.3% | -75.25% | Safety only; fails profit gate |
| Loss kill-switch | -3.47 | 10.22% | 0.20 | -0.1051 | 95 | 28.4% | -9.99% | Safety only; fails profit gate |
| Remove one-legged pairs | -8.83 | 81.13% | 0.46 | -0.0576 | 1,407 | 29.0% | -81.08% | Reject profit claim |
| Daily + intraday confirmation | -10.87 | 79.15% | 0.46 | -0.0562 | 1,408 | 29.4% | -79.10% | Reject profit claim |
| 24h max hold | -1.13 | 66.63% | 0.87 | -0.0604 | 702 | 44.4% | -42.38% | Reject profit claim |
| 4h post-exit cooldown | -10.45 | 73.73% | 0.43 | -0.0594 | 1,239 | 31.0% | -73.57% | Reject profit claim |

## REVERT: Walk-forward tests combined

| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | -13.55 | 97.51% | 0.34 | -0.0519 | 4,603 | 30.0% | -97.49% | Reference |
| Ledger wiring | -13.58 | 98.83% | 0.34 | -0.0571 | 4,663 | 30.2% | -98.82% | Correctness only; sizing alone worsens losses |
| Empirical quarter Kelly | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | No eligible edge; zero trades |
| Leverage/gross caps | -13.77 | 92.03% | 0.35 | -0.0372 | 4,992 | 30.6% | -92.00% | Safety only; fails profit gate |
| Loss kill-switch | -5.17 | 34.26% | 0.25 | -0.0818 | 487 | 26.1% | -34.26% | Safety only; fails profit gate |
| Remove one-legged pairs | -12.38 | 94.67% | 0.36 | -0.0506 | 4,098 | 32.4% | -94.64% | Reject profit claim |
| Daily + intraday confirmation | -11.86 | 78.94% | 0.35 | -0.0553 | 2,330 | 29.7% | -78.93% | Reject profit claim |
| 24h max hold | -4.61 | 69.50% | 0.61 | -0.0777 | 1,301 | 30.3% | -69.04% | Reject profit claim |
| 4h post-exit cooldown | -11.97 | 77.72% | 0.32 | -0.0662 | 1,884 | 30.8% | -77.71% | Reject profit claim |

## REVERT: 2025-H2 temporal holdout

| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | -10.98 | 73.23% | 0.28 | -0.0443 | 1,651 | 29.2% | -73.19% | Reference |
| Ledger wiring | -11.13 | 79.18% | 0.29 | -0.0483 | 1,637 | 28.6% | -79.08% | Correctness only; sizing alone worsens losses |
| Empirical quarter Kelly | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | No eligible edge; zero trades |
| Leverage/gross caps | -11.81 | 64.16% | 0.29 | -0.0313 | 2,047 | 29.9% | -64.07% | Safety only; fails profit gate |
| Loss kill-switch | -4.48 | 10.06% | 0.35 | -0.0601 | 166 | 33.7% | -9.98% | Safety only; fails profit gate |
| Remove one-legged pairs | -10.63 | 71.80% | 0.28 | -0.0448 | 1,599 | 28.6% | -71.70% | Reject profit claim |
| Daily + intraday confirmation | -11.11 | 59.70% | 0.25 | -0.0497 | 1,200 | 26.5% | -59.64% | Reject profit claim |
| 24h max hold | -3.23 | 37.64% | 0.65 | -0.0677 | 464 | 34.3% | -31.43% | Reject profit claim |
| 4h post-exit cooldown | -9.80 | 49.80% | 0.31 | -0.0544 | 905 | 30.9% | -49.23% | Reject profit claim |

## Baseline by development quarter

| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| TREND 2024Q3 | -13.93 | 80.78% | 0.43 | -0.0617 | 1,293 | 28.3% | -79.83% | Reference |
| TREND 2024Q4 | -14.03 | 78.20% | 0.37 | -0.0605 | 1,287 | 29.0% | -77.89% | Reference |
| TREND 2025Q1 | -9.51 | 63.31% | 0.56 | -0.0499 | 1,265 | 34.5% | -63.19% | Reference |
| TREND 2025Q2 | -14.99 | 79.94% | 0.40 | -0.0646 | 1,233 | 28.1% | -79.59% | Reference |
| REVERT 2024Q3 | -13.60 | 59.18% | 0.27 | -0.0596 | 990 | 28.8% | -58.96% | Reference |
| REVERT 2024Q4 | -15.75 | 69.39% | 0.26 | -0.0530 | 1,308 | 25.5% | -69.38% | Reference |
| REVERT 2025Q1 | -11.33 | 53.24% | 0.48 | -0.0434 | 1,223 | 36.1% | -53.12% | Reference |
| REVERT 2025Q2 | -13.49 | 57.88% | 0.31 | -0.0531 | 1,082 | 29.6% | -57.46% | Reference |

## Cost stress: final holdout

| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| TREND Baseline | -7.99 | 82.34% | 0.27 | -0.0925 | 890 | 21.7% | -82.28% | Negative expectancy |
| TREND Ledger wiring | -7.78 | 85.54% | 0.27 | -0.1012 | 845 | 21.7% | -85.48% | Negative expectancy |
| TREND Empirical quarter Kelly | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | No trades |
| TREND Leverage/gross caps | -11.93 | 80.73% | 0.22 | -0.0442 | 1,824 | 19.6% | -80.71% | Negative expectancy |
| TREND Loss kill-switch | -3.37 | 10.16% | 0.08 | -0.1808 | 55 | 14.5% | -9.95% | Negative expectancy |
| TREND Remove one-legged pairs | -7.69 | 81.09% | 0.27 | -0.0942 | 860 | 22.3% | -81.04% | Negative expectancy |
| TREND Daily + intraday confirmation | -9.18 | 81.11% | 0.25 | -0.1061 | 764 | 20.9% | -81.06% | Negative expectancy |
| TREND 24h max hold | -2.97 | 78.68% | 0.73 | -0.1108 | 613 | 39.3% | -67.93% | Negative expectancy |
| TREND 4h post-exit cooldown | -11.14 | 80.56% | 0.22 | -0.1088 | 740 | 19.1% | -80.51% | Negative expectancy |
| REVERT Baseline | -10.65 | 78.63% | 0.14 | -0.0674 | 1,167 | 17.9% | -78.61% | Negative expectancy |
| REVERT Ledger wiring | -10.62 | 83.70% | 0.14 | -0.0744 | 1,125 | 18.0% | -83.69% | Negative expectancy |
| REVERT Empirical quarter Kelly | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | No trades |
| REVERT Leverage/gross caps | -12.02 | 74.79% | 0.13 | -0.0489 | 1,530 | 17.1% | -74.78% | Negative expectancy |
| REVERT Loss kill-switch | -3.78 | 10.06% | 0.16 | -0.0877 | 114 | 23.7% | -9.99% | Negative expectancy |
| REVERT Remove one-legged pairs | -10.29 | 77.56% | 0.14 | -0.0678 | 1,143 | 17.7% | -77.55% | Negative expectancy |
| REVERT Daily + intraday confirmation | -11.12 | 70.96% | 0.09 | -0.0759 | 935 | 14.8% | -70.96% | Negative expectancy |
| REVERT 24h max hold | -5.05 | 50.09% | 0.51 | -0.0937 | 487 | 29.8% | -45.62% | Negative expectancy |
| REVERT 4h post-exit cooldown | -11.08 | 62.76% | 0.15 | -0.0800 | 784 | 20.5% | -62.73% | Negative expectancy |

## What limits returns in these scenarios

Costs and repeated short-horizon entries matter, and the signal/exit rules do not establish a sufficiently large net edge. Baseline exit counts below show daily signals mostly churn through the2h time stop; fixed targets/trailing do little at this horizon. This is measured conditional evidence, not causal proof for an unobserved production run.

| Holdout baseline | Mid-reference gross $ | Modeled slippage+spread $ | Fees $ | Signed funding $ | Net $ | Time exits / all exits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TREND | 27.980 | 76.654 | 31.939 | -0.537 | -81.150 | 1415/1424 |
| REVERT | -5.250 | 47.745 | 19.894 | -0.297 | -73.186 | 1517/1651 |

The mid-reference gross attribution holds the **same executed quantities and trade path** fixed and removes modeled price concessions and fees. It is not a new zero-cost strategy backtest; removing costs could change subsequent sizing/selection and equity. Training-only Kelly estimates find no eligible positive net edge in either mode. The baseline bankroll also shrinks below minimum margin, limiting later training observations and causing activity to stop; unchanged training sample counts are retained rather than silently replenishing money. This is a limitation of capital-constrained edge estimates.

24h holding improves relative loss rates but PF remains<1 and expectancy negative; drop it as a profit recommendation. MTF/cooldown/pair-removal alone also fail. The ledger-only correction raises seed base allocation from.10 to.12 and increases loss. Neither increasing Kelly nor unlocking leverage creates evidence of edge.

A latched loss breaker limits individual final holdout DD to about10% under this model; it is checked every15m and close costs/gaps can overshoot the threshold. Combined development DD can exceed10% because each independent fold resets its initial capital and lock. Reduced leverage can prolong trading through more negative-edge trades, reducing losses while worsening Sharpe. Retain risk controls only as safety/capital limits, never as proven alpha.

## What these numbers cannot establish

- Historical production baseline: no private run config, trades/equity, AI decisions, timestamped news/sentiment, actual financing or30s quotes were provided. Source-engine behavior differs between npm and deploy entrypoints; neither was started.
- Full13-strategy edge: ORB needs a US session dataset; orderflow/OI divergence need matched timestamped OI/funding. Some available strategies rarely win confluence, so their independent edge is not estimated. US/India equities, calendars, FX, splits and borrow require separate historical datasets. These are **unverified**, not successful backtests.
- Actual perpetual fills: spot-USDT prices differ from USD quotes/perpetual marks; constant funding/spreads are assumptions. There are no orderbook/partial-fill/latency recordings. Minute-path uncertainty inside15m candles remains. Stop-first is conservative but cannot reconstruct liquidation/slippage in a real outage.
- Genuine forward validation: strategies may have been selected using these historical dates; fixed current survivor symbols, correlated strategies/trades and multiple experiments prevent treating ordinary trade counts as independent statistical proof. No fresh holdout beyond 2025 or forward paper run was claimed. Do not promote a discovered winner without another untouched chronological test and prospective paper observations.

## Evidence, checks and reproduction

- `node audit/checks.mjs`:17 passing deterministic/static checks, mostly successful reproductions of source defects. `node audit/verify_replay.mjs`:12 passing independent replay checks: future perturbation invariance, next-open gap entry, stop-vs-target ambiguity, adverse gap exits, terminal trade inclusion, network blocking, exact source hashes, split boundaries and every saved final holdout ledger reconciliation.
- Existing and new .mjs syntax checked with `node --check`; JSON parsed. Application UI was not built/run: source is unchanged and dependencies were not installed. No live engine, Telegram/Groq key, deployed service or order endpoint was invoked.
- Fresh reproduction from repo root, using existing Python/Node and no packages:

  ```powershell
  python audit/fetch_data.py
  node audit/checks.mjs
  node audit/backtest.mjs
  node audit/backtest.mjs --stress
  node audit/verify_replay.mjs
  python audit/render_reports.py
  ```
- Raw data/archives stay in ignored `audit/data/`; publisher URLs, hashes, counts and source hashes are retained inside `audit/results/backtest.json` and `stress.json`. All18 final holdout ledgers per cost scenario are retained. Individual development metrics and train-only estimates are in those JSON reports; `run.log` and `stress-run.log` retain execution progress. No numerical reports are hand-entered.

Source contracts: [Binance public archives and checksum format](https://github.com/binance/binance-public-data). Experiment definitions and advancement rule: `audit/EXPERIMENT_PLAN.md`. Scope and data flow: `ARCHITECTURE.md`. Defects: `AUDIT_FINDINGS.md`. Implementation proposals and rejected profit candidates: `IMPROVEMENTS.md`.

**Initial Phase1–4 approval gate:** no application improvements, commits or pushes had been applied at that point. The subsequent user request authorizes publishing the audit branch without merging; runtime implementation items remain unapproved. See STRATEGY_NEWS_REVIEW.md and FOLLOWUP_RESULTS.md for the follow-up. Which items should I implement?
