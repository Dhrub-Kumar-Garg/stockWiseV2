# Implementation verification — paper only

Baseline source: 50360996451ddc7ad742372bff398b7938ae0029. Historical audit tooling: e4198ca69df37e7659d18ad0a4381163add614c9. All software changes require review; no implementation push/deploy or live trading occurred.

## Same-period comparison

Five crypto assets, July 1 through December 31 2025, identical public 15m input files and hashes. Fixed neutral TREND/REVERT are conditional legacy reconstructions, not a recovered deployed AI/news history. Prices use USDT as USD proxy. Costs and execution differ deliberately where accounting/reliability was repaired; this is a system comparison, not an isolated alpha attribution.

| Run | Sharpe | Max DD | Profit factor | Expectancy USD/trade | Trades | Return |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Legacy TREND | -9.046 | 81.21% | 0.456 | -0.05699 | 1424 | -81.15% |
| Legacy REVERT | -10.982 | 73.23% | 0.283 | -0.04433 | 1651 | -73.19% |
| Repaired evidence-gated portfolio | Undefined | 0% | Undefined | Undefined | 0 | 0% |

Cash preservation is not a profitable trading edge. No real qualifying calibration artifact is supplied. Security, accounting and risk repairs are validated by deterministic checks rather than invented Sharpe improvements. Original isolated candidate comparisons remain in BACKTEST_RESULTS.md and FOLLOWUP_RESULTS.md; failed alpha variants remain rejected.

## Independent shadow research

The repaired library evaluates all data-ready models across pools. Sixty supported crypto model/asset books have virtual $100 each; missing OI prevents flow signals, US-only ORB is inapplicable, and paired strategies use joint shadow legs. The six-month replay closed 7905 shadow trades across 47 books. Seven books had positive sample net expectancy; this is neither statistical validation nor portfolio profit. Summed virtual P&L was -$153.22 across the books. Comparing this dollar sum to a $100 portfolio would be invalid.

Separate July–August training, September–October calibration, and November–December test windows screened 89 strategy/asset/side/regime scopes. **Zero qualified** under minimum samples/days, Brier versus baseline, positive net R lower bound, costs, scope and multiple-trial gates. No scope was promoted. These historical windows were already accessible during development and provide retrospective verification, not an untouched future track record. Forward paper evidence is still required.

Per-book Sharpe, marked maximum drawdown, profit factor, expectancy, win rate, trade count and return are in audit/shadow-results/summary.json. Every scope screen is in calibration-screen.json. Legacy comparison is in legacy-comparison.json. Reproduce with the command recorded in summary.json, then run calibrate.mjs with --train-end 2025-09-01 --calibration-end 2025-11-01 --test-end 2026-01-01. Hashes cover raw input files; full local outcomes are in ignored data/current-shadow-replay.json and can be regenerated.

The replay uses completed historical bars and next-observation entries, adverse-first OHLC excursions per shadow book, both fees, adverse slippage/spread, modeled eight-hour funding and terminal liquidation. Adverse excursions are conservative OHLC bounds rather than exact executable paths; simultaneous adverse moves for both pair legs are deliberately pessimistic. Actual depth, queue, exchange funding, outage, FX and point-in-time news/OI histories are unavailable. No short-horizon edge is inferred from candle data.

## Validation scope

Automated checks cover authentication/redaction, cash reconciliation, loss locks, exposure/reservations, causal sizing, timestamp/currency handling, CLI equivalence, SQLite writer contention/crash windows/idempotency, body deadlines/WS parsing, strategy attribution, structured news and stale context, frozen calibration, shadow independence/netting, and future-data perturbation. Web build also passes. Passing synthetic tests demonstrate software behavior, not future returns.
