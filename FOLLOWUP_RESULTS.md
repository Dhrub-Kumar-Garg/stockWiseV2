# Follow-up historical results: strategy participation and direction bias

**Symmetric heuristic confidence, scanning all pools, and their combination failed the profit screen. None is approved or recommended as a profit improvement.**

Source remains `50360996451ddc7ad742372bff398b7938ae0029`. Only research copies were modified in memory. This follows the user’s request to investigate inactive strategies, direction bias and news. Source-backed explanations and five additional proposals are in STRATEGY_NEWS_REVIEW.md.

## Method and limits

- Plan: `audit/FOLLOWUP_EXPERIMENT_PLAN.md`, written before the additional download/run. No hyperparameter search or retuning after seeing these results.
- Additional data: 45 publisher-checksummed Binance public spot archives; 5 ×26,208 =131,040 fifteen-minute candles from2026-01-01 to2026-09-30. Completed2025 daily bars provide365-day warmup; first5 January days provide intraday warmup. Test windows are Jan6–Mar31, Apr1–Jun30 and Jul1–Sep30, each starting with$100.
- This period was unused by the initial audit, but the source was authored in October2026; we cannot prove the developer had not seen2026 prices. It is additional chronological historical evidence, not a genuinely prospective holdout or production performance.
- Same original source signal functions/dispatcher/sizing, frozen seed learning, fixed neutral TREND/REVERT and missing OI/news inputs. Same next-open entries, conservative stop/gap handling, terminal trade counting and exact all-cost cash reconciliation as original research replay.
- Base cost:5bp fee +10bp slippage +2bp half-spread per side, signed modeled1bp/8h funding. Stress:5bp fee +24bp price concession per side and3bp/8h funding. Spot/USD proxy and missing actual execution/funding/AI inputs remain limitations.
- Symmetric confidence raises each short’s heuristic confidence to its long counterpart; all-pools sets seed pool tags to both in memory. No indicator, stop, target, size, exposure or execution rule was tuned. Missing US/OI inputs remain missing. These are not calibrated probability models and do not test sub-minute trading.
- Advancement requires higher aggregate Sharpe/return, PF>=baseline and>1, positive expectancy, no higher DD, >=30 trades, positive expectancy in>=2/3 quarters and under stress. All candidates fail. Marked-daily Sharpe uses sqrt365; DD uses every15m mark; expectancy is net USD/trade at each fold’s$100 start. Aggregate curves concatenate/rebase independent fold returns, so their DD is not a single continuously traded production account.

## Base costs: all three test windows combined

| Mode / experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TREND / Baseline | -12.71 | 98.51% | 0.36 | -0.0622 | 3,556 | 24.6% | -98.47% |
| TREND / Symmetric confidence | -10.44 | 99.17% | 0.34 | -0.0647 | 3,679 | 24.8% | -99.17% |
| TREND / All pools | -13.29 | 98.86% | 0.34 | -0.0548 | 4,206 | 24.2% | -98.86% |
| TREND / Symmetric + all pools | -9.96 | 99.22% | 0.34 | -0.0580 | 4,131 | 25.2% | -99.22% |
| REVERT / Baseline | -11.65 | 93.32% | 0.25 | -0.0524 | 3,178 | 23.2% | -93.32% |
| REVERT / Symmetric confidence | -12.74 | 96.71% | 0.26 | -0.0511 | 3,877 | 23.6% | -96.71% |
| REVERT / All pools | -13.29 | 98.86% | 0.34 | -0.0548 | 4,206 | 24.2% | -98.86% |
| REVERT / Symmetric + all pools | -9.96 | 99.22% | 0.34 | -0.0580 | 4,131 | 25.2% | -99.22% |

## Base costs: final test quarter,2026-Q3

| Mode / experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TREND / Baseline | -13.71 | 80.12% | 0.29 | -0.0664 | 1,197 | 24.0% | -79.44% |
| TREND / Symmetric confidence | -11.17 | 81.49% | 0.18 | -0.0876 | 926 | 20.2% | -81.13% |
| TREND / All pools | -15.74 | 81.26% | 0.22 | -0.0659 | 1,229 | 21.4% | -81.03% |
| TREND / Symmetric + all pools | -10.66 | 81.50% | 0.20 | -0.0725 | 1,119 | 23.0% | -81.14% |
| REVERT / Baseline | -11.43 | 55.95% | 0.25 | -0.0553 | 1,011 | 25.0% | -55.94% |
| REVERT / Symmetric confidence | -12.58 | 69.57% | 0.20 | -0.0584 | 1,192 | 21.7% | -69.57% |
| REVERT / All pools | -15.74 | 81.26% | 0.22 | -0.0659 | 1,229 | 21.4% | -81.03% |
| REVERT / Symmetric + all pools | -10.66 | 81.50% | 0.20 | -0.0725 | 1,119 | 23.0% | -81.14% |

## Every test quarter: base costs

| Mode / experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TREND / Baseline / 2026Q1_partial | -8.33 | 61.13% | 0.52 | -0.0623 | 976 | 32.6% | -60.83% |
| TREND / Baseline / 2026Q2 | -16.85 | 81.02% | 0.25 | -0.0586 | 1,383 | 19.5% | -81.00% |
| TREND / Baseline / 2026Q3 | -13.71 | 80.12% | 0.29 | -0.0664 | 1,197 | 24.0% | -79.44% |
| TREND / Symmetric confidence / 2026Q1_partial | -7.50 | 74.36% | 0.53 | -0.0530 | 1,399 | 35.0% | -74.14% |
| TREND / Symmetric confidence / 2026Q2 | -14.11 | 82.93% | 0.20 | -0.0612 | 1,354 | 17.5% | -82.90% |
| TREND / Symmetric confidence / 2026Q3 | -11.17 | 81.49% | 0.18 | -0.0876 | 926 | 20.2% | -81.13% |
| TREND / All pools / 2026Q1_partial | -9.79 | 68.94% | 0.50 | -0.0521 | 1,324 | 32.6% | -68.94% |
| TREND / All pools / 2026Q2 | -14.84 | 80.71% | 0.23 | -0.0488 | 1,653 | 19.5% | -80.67% |
| TREND / All pools / 2026Q3 | -15.74 | 81.26% | 0.22 | -0.0659 | 1,229 | 21.4% | -81.03% |
| TREND / Symmetric + all pools / 2026Q1_partial | -7.39 | 75.19% | 0.52 | -0.0502 | 1,497 | 34.1% | -75.19% |
| TREND / Symmetric + all pools / 2026Q2 | -12.86 | 83.30% | 0.21 | -0.0549 | 1,515 | 18.2% | -83.24% |
| TREND / Symmetric + all pools / 2026Q3 | -10.66 | 81.50% | 0.20 | -0.0725 | 1,119 | 23.0% | -81.14% |
| REVERT / Baseline / 2026Q1_partial | -8.54 | 33.44% | 0.30 | -0.0656 | 509 | 30.8% | -33.41% |
| REVERT / Baseline / 2026Q2 | -15.22 | 77.26% | 0.22 | -0.0466 | 1,658 | 19.7% | -77.21% |
| REVERT / Baseline / 2026Q3 | -11.43 | 55.95% | 0.25 | -0.0553 | 1,011 | 25.0% | -55.94% |
| REVERT / Symmetric confidence / 2026Q1_partial | -10.23 | 50.61% | 0.34 | -0.0497 | 1,019 | 30.2% | -50.59% |
| REVERT / Symmetric confidence / 2026Q2 | -15.31 | 78.15% | 0.23 | -0.0469 | 1,666 | 20.8% | -78.11% |
| REVERT / Symmetric confidence / 2026Q3 | -12.58 | 69.57% | 0.20 | -0.0584 | 1,192 | 21.7% | -69.57% |
| REVERT / All pools / 2026Q1_partial | -9.79 | 68.94% | 0.50 | -0.0521 | 1,324 | 32.6% | -68.94% |
| REVERT / All pools / 2026Q2 | -14.84 | 80.71% | 0.23 | -0.0488 | 1,653 | 19.5% | -80.67% |
| REVERT / All pools / 2026Q3 | -15.74 | 81.26% | 0.22 | -0.0659 | 1,229 | 21.4% | -81.03% |
| REVERT / Symmetric + all pools / 2026Q1_partial | -7.39 | 75.19% | 0.52 | -0.0502 | 1,497 | 34.1% | -75.19% |
| REVERT / Symmetric + all pools / 2026Q2 | -12.86 | 83.30% | 0.21 | -0.0549 | 1,515 | 18.2% | -83.24% |
| REVERT / Symmetric + all pools / 2026Q3 | -10.66 | 81.50% | 0.20 | -0.0725 | 1,119 | 23.0% | -81.14% |

## Stress costs: all test windows combined

| Mode / experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TREND / Baseline | -12.28 | 98.95% | 0.19 | -0.1013 | 2,293 | 15.1% | -98.95% |
| TREND / Symmetric confidence | -9.55 | 99.32% | 0.16 | -0.1103 | 2,200 | 15.0% | -99.32% |
| TREND / All pools | -11.32 | 99.17% | 0.18 | -0.0913 | 2,602 | 15.2% | -99.17% |
| TREND / Symmetric + all pools | -9.60 | 99.38% | 0.16 | -0.0999 | 2,445 | 16.0% | -99.37% |
| REVERT / Baseline | -11.47 | 97.69% | 0.12 | -0.0825 | 2,453 | 12.5% | -97.69% |
| REVERT / Symmetric confidence | -11.84 | 98.93% | 0.11 | -0.0804 | 2,858 | 13.3% | -98.93% |
| REVERT / All pools | -11.32 | 99.17% | 0.18 | -0.0913 | 2,602 | 15.2% | -99.17% |
| REVERT / Symmetric + all pools | -9.60 | 99.38% | 0.16 | -0.0999 | 2,445 | 16.0% | -99.37% |

## Participation and direction: base costs

| Mode / experiment | Long trades | Short trades | Long share | Primary strategies selected |
| --- | ---: | ---: | ---: | ---: |
| TREND / Baseline | 946 | 2,610 | 26.6% | 6 |
| TREND / Symmetric confidence | 253 | 3,426 | 6.9% | 6 |
| TREND / All pools | 479 | 3,727 | 11.4% | 6 |
| TREND / Symmetric + all pools | 218 | 3,913 | 5.3% | 6 |
| REVERT / Baseline | 614 | 2,564 | 19.3% | 4 |
| REVERT / Symmetric confidence | 549 | 3,328 | 14.2% | 3 |
| REVERT / All pools | 479 | 3,727 | 11.4% | 6 |
| REVERT / Symmetric + all pools | 218 | 3,913 | 5.3% | 6 |

Counts describe primary attribution under a conditional data model. They do not measure all raw signals or production participation. More strategies/orders and a different side mix did not establish positive net edge. Scanning all pools intentionally erases the fixed TREND/REVERT pool distinction, hence identical outcomes between those two labels.

## Verification and next action

`audit/results/followup-checks.json` contains six passing integrity/reconciliation checks. `routing-news-checks.json` contains16 new passing source fixtures/static checks. Together with the original29 checks,51 checks pass. Passing a bug reproduction confirms the issue; it does not mean a runtime fix was applied.

Machine-readable metrics, per-quarter participation, source/data hashes and archive URLs are in `audit/results/followup-research.json`; all16 scenario/mode/variant trade ledgers are retained. Source adapter and original replay hashes remain unchanged.

Reproduce the follow-up from the repository root:

```powershell
node audit/routing_news_checks.mjs
node audit/probe_news.mjs  # optional public-feed observation; results change over time
python audit/fetch_followup_data.py
node audit/followup_research.mjs
python audit/render_followup.py
```

Reject these parameter/pool toggles as profit changes. Prioritize reliable accounting, risk locks, decision tracing and news provenance, then collect point-in-time data for proper cost-net calibration. Frequent-order research requires executable quote/depth data and an independent prospective paper test. No runtime strategy changes, live orders, key changes, deployments or merges were performed. Audit-branch publication was explicitly authorized by the user.
