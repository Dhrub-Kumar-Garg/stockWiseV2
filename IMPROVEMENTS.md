> Historical proposal/audit record. The subsequent instruction "do every improvement one by one" approved software items 1–15. See IMPLEMENTATION_STATUS.md for the separate local commits and IMPLEMENTATION_RESULTS.md for current measurements. No rejected alpha was promoted; credential/deployment and implementation-push gates remain separate.

# Ranked improvement proposals — no application changes applied

Follow-up: see STRATEGY_NEWS_REVIEW.md for strategy inactivity, structural
long/short bias, the verified news path, and additional proposals11–15.
FOLLOWUP_RESULTS.md compares symmetric confidence/all-pool experiments on
additional2026 history. The user has authorized publishing the **audit branch**
without merging; production implementation and credential/deployment steps
remain gated. Initial Phase1–4 findings and decisions below are preserved.

Revision audited: 50360996451ddc7ad742372bff398b7938ae0029.
Decision date: 2026-11-03 (Asia/Kolkata). Branch: audit/profit-improvements.

**There is no validated profit improvement to implement from these experiments.**
All eight single-factor candidates failed the frozen OOS+holdout profit screen.
Proposals1–10 below repair security, accounting, measurement, risk limits and
reliability. Their benefit must not be called increased trading edge. Rejected
profit ideas are retained in a separate decision table for auditability, not as
items recommended for implementation. Read BACKTEST_RESULTS.md for every metric,
scenario and limitation before interpreting a relative reduction in loss.

## Ranking method

Order uses estimated **risk-adjusted engineering impact / effort**. Impact1–5
is an ordinal assessment of prevented exposure/corruption, not forecast Sharpe
or a dollar-return estimate. Effort is estimated engineer-days including review
and meaningful validation. Indicative scores: 1=5/.5=10; 2=5/1=5;
3=5/1.5=3.3; 4=4/1.5=2.7; 5=4/2=2; 6=4/2.5=1.6; 7=3/2=1.5;
8=5/4=1.25; 9=5/5=1; 10=3/4=.75. Dependencies may require doing accounting
before calibration, and state integrity before any operational rollout. These
are proposals, not a change budget or authorization to touch deployment/keys.

| # | Change | Files | Expected impact | Risk | Effort | How to verify |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Restrict dashboard output to an allowlisted public DTO; authenticate private state; remove source-secret dependency in a reviewed future patch. Separately plan Telegram credential revocation/rotation. | `web/app/api/state/route.ts`, `scripts/v2/telegram.mjs`, `.gitignore`, config example | Prevent config/key disclosure and control-channel compromise. **Sharpe/PF/expectancy: not an alpha claim.** S01–S05. | Low-medium compatibility risk to API clients; rotation affects existing bot and requires **separate explicit approval**, as do deploy/service actions. | .5d code review; external rotation separately scoped | Fake sentinel keys must never appear in HTTP body, browser bundle/logs or unauthenticated responses; private routes401; mock notifications off by default. Do not validate exposed token. Existing static proof shows config currently serialized. |
| 2 | Make one cash ledger the source of truth: charge both fees, settle signed funding exactly once by symbol/time, distinguish net margin ROI from risk-at-stop R; correct exit notional and isolated-liquidation debit. | `scripts/v2/engine.mjs`, `scripts/daemon.mjs`, `scripts/v2/perp.mjs`, `scripts/v2/brain.mjs` | Restore **PF, expectancy, win rate, Sharpe and DD measurement accuracy**. Reported performance may decrease. M01–M02, M07, M11–M12. | Medium: existing journals cannot silently be reinterpreted; version schema and reconcile old paper state without inventing cash. | 1d | Flat-price long/short, both funding signs, boundaries/restart/gaps: wallet delta must equal sum(all-cost net trades)+open equity. Fixture today: flat trade loses.030 but reports-.015; funding example should-.330 vs reported+.285. No fabricated profit gain. |
| 3 | Persist separate operator pause, daily-loss lock and lifetime-DD lock. Evaluate before **every** open path; flatten per chosen policy, disable risk auto-clear/episode bypass; require explicit resume rules. | `scripts/v2/engine.mjs`, `scripts/daemon.mjs`, `scripts/v2/episode.mjs`, `scripts/v2/telegram.mjs` | Bound **max DD / daily tail loss**; kill_switch holdout DD: TREND10.22%, REVERT10.06% vs81.21%/73.23%. Still negative expectancy; **safety only**. | Medium: gaps/close costs overshoot thresholds; venue exits may fail. No promise of exact10% ceiling. Thresholds10% DD/2% UTC daily are tested research values requiring user selection. | 1.5d | Kill -> pending open -> restart -> episode boundary must stay blocked; daily lock resets at defined UTC day only, lifetime/operator lock stays latched; source stale/failed-exit fixtures. Replay and stress as in report; verify no remaining exposure after flatten succeeds. |
| 4 | Enforce market/tier/per-position leverage and portfolio gross/net, risk-at-stop and correlated-cluster budgets before reserving capital; deterministic allocation across watchlist. | `scripts/v2/sizing.mjs`, `scripts/v2/engine.mjs`, `scripts/v2/perp.mjs`, config example | Bound **DD/exposure concentration**, not create edge. Tested <=2x/1.5x gross lowers holdout loss but PF remains<1. Diversification limits require separate calibration. | Medium: rejects trades and changes allocations; correlation estimates can fail during stress. USD/INR inputs must be corrected first. | 1.5d initial caps; covariance work additional | Fixtures: all5 crypto signals, pending/manual path, tier crossings, fee reserve, zero cash, high correlation, gap stress. Assert caps at reservation/fill time. Do not claim Sharpe gain: TREND leverage-cap Sharpe worsens in replay. |
| 5 | Repair strategy ledger contract, then replace unsupported positive size floors/goal chasing with training-only fractional Kelly and fixed stop-risk budgets; zero size for nonpositive or insufficient edge. | `scripts/v2/sizing.mjs`, `scripts/v2/brain.mjs`, `scripts/v2/strategies.mjs`, ledger schema | Make risk depend on measured **cost-net expectancy**. Correct ledger wiring **alone increases losses**. Quarter Kelly finds no eligible edge and allocates0 in both modes; no trading-profit recommendation. | Medium-high: can legitimately stop all trades; estimated p/payoff not stable, selection bias remains. Do not ship the schema fix alone as a size increase. | 2d | Change learned Kelly .12->0 must change order risk; training fold cannot read test trades; n>=30 and uncertainty policy explicit; no min2% floor or goal multiplier when edge<=0. Mathematically sized stop loss within approved budget. Walk-forward gate and new paper observations required before allowing positive risk. |
| 6 | Keep timestamped OHLCV/quote source/currency; reject expired/forming/gapped inputs; align pairs/OI by event time and horizon; handle FX conversion explicitly; expire analyst/news inputs. | `scripts/lib.mjs`, `scripts/v2/engine.mjs`, `scripts/v2/strategies.mjs`, `scripts/v2/world.mjs`, `scripts/v2/analyst.mjs` | Remove stale/misaligned signal and valuation errors; improve credibility of **expectancy/Sharpe/DD**. Missing historical outages prevent a quantified profit estimate. | Medium: more no-trade states during feed failure, FX/adjustment choices affect historical comparability. | 2.5d | Inject null/missing/out-of-order/stale candles, rate limits, market closure, FX unavailable and expired decisions; fail closed for entries while preserving explicit risk-exit policy. Future-data perturbation must leave prior signals identical. INR position P&L reconciles to USD cash. |
| 7 | Consolidate npm/deploy entrypoints and publish consistent health/metrics; dashboard uses cashflow-aware interval P&L, actual start capital, true stale/error status and matching lesson/stat fields. | `package.json`, `scripts/daemon.mjs`, `scripts/v2/engine.mjs`, `web/app/components/Root.tsx`, `DashboardV2.tsx`, API route, README | Remove conflicting behavior and misleading display; **metric accuracy and operational observability**, no expected alpha. | Medium: changing default entrypoint can activate notifications/analyst calls unless explicit mocks/paper mode are enforced. Do not start services during implementation. | 2d | Offline CLI integration: both commands select same mocked engine; signals advance monotonically, failed polling marks stale, non-$100 deposit/selected-date-range returns correct; API DTO remains sanitized. No key/deployment interaction. |
| 8 | Single writer and durable order lifecycle: reserve funds, persist idempotency/client IDs, transactional queue consumption/state+journal consistency, recovery and bounded logs; explicit paper execution adapter. | `scripts/lib.mjs`, `scripts/v2/store.mjs`, `scripts/v2/engine.mjs`, `scripts/v2/telegram.mjs`, `scripts/fix_loop.mjs` | Prevent duplicate/lost orders and P&L corruption; **tail DD / reconciliation reliability**, unquantified profit. | High: storage migration/recovery semantics; old files need backup and schema/version plan. No data deletion or history rewrite without approval. | 4d | Two-worker contention, duplicate ID, crash before/after each write, rejected/missing quote close, partial fill/retry using mocks; exactly-once economic effect and full cash reconciliation after restart. Bound API/log memory. Existing static analysis establishes race windows; no claim current code is repaired. |
| 9 | Replace misleading backtest claims with a versioned causal, cost-aware walk-forward pipeline; integrate approved fixes only after isolated comparisons; archive point-in-time AI/OI/news and forward paper decisions. | `scripts/v2/backtest.mjs`, `fetch_hist.mjs`, `scripts/v2/brain.mjs`, `audit/*`, README | Establish whether **Sharpe, PF, expectancy and DD** are real before risking capital. Audit harness is already delivered as research; adopting it into product/runtime is a future approval item. | Medium-high: actual deployed baseline remains unavailable; no fixture proves trading edge. Current survivor symbols and developer access to historical data limit OOS inference. | 5d for production-grade integration/coverage | Existing29 deterministic/replay checks plus new authoritative exchange/FX/calendar/funding datasets, no future features, complete terminal/MTM metrics, source/data hashes, unseen temporal holdout, multiple-testing/uncertainty and forward paper track record. Require positive net OOS edge; otherwise no trade. |
| 10 | Repair WS subscription/parser/staleness watchdog; decouple slow world/analyst/notification IO from risk loop with deadlines/backoff; model actual exchange order lifecycle only through paper/mock adapters. Retire or complete the unsafe WS prototype. | `scripts/v2/ws_feed.mjs`, `scripts/v2/engine_ws.mjs`, `engine.mjs`, `world.mjs`, `analyst.mjs`, `telegram.mjs` | Reduce risk-check latency and silent outages; possible **execution shortfall/DD** improvement, no measured Sharpe gain. Limit vs market is unverified. | High: concurrency increases shared-state hazards; a touched limit price cannot be assumed full maker fill. Depends on item8 boundaries. | 4d | Mock combined/raw frames, malformed JSON, disconnect, hung HTTP body,429/5xx/timeout/partial fills/late ACK; risk loop latency p95/p99 and quote age bounded; duplicate/retry tests; queue-aware maker assumptions versus taker reference on identical recorded data. No authenticated order calls. |

## Profit experiments explicitly rejected

All metrics below use the final2025-H2 temporal holdout with identical modeled
costs; development-quarter results and stress are in BACKTEST_RESULTS.md. A change
that merely loses less is dropped as an alpha recommendation. Items3–5 above
are retained **only for safety/correctness**, with this distinction explicit.

| Experiment | TREND Sharpe / PF / expectancy $ | REVERT Sharpe / PF / expectancy $ | Decision |
| --- | --- | --- | --- |
| Source-linked baseline | -9.05 / .46 / -.0570 | -10.98 / .28 / -.0443 | No validated net edge in either fixed mode. |
| Ledger contract correction alone | -8.61 / .47 / -.0616 | -11.13 / .29 / -.0483 | Drop as profit change; repair only with guarded sizing item5. |
| Train-only quarter Kelly | N/A / N/A / N/A;0 trades | N/A / N/A / N/A;0 trades | No eligible edge. Flat cash is not a positive Sharpe strategy. |
| <=2x per-position and1.5x gross caps | -12.80 / .43 / -.0245 | -11.81 / .29 / -.0313 | No alpha; item4 is an exposure constraint. |
| Latched10% DD/2% daily breaker | -3.47 / .20 / -.1051 | -4.48 / .35 / -.0601 | No alpha; item3 limits further capital loss. |
| Remove one-legged pairs entries | -8.83 / .46 / -.0576 | -10.63 / .28 / -.0448 | Drop as profit idea. Proper hedged pairs require a separate model/cointegration/execution study; none proposed for automatic implementation. |
| Daily SMA200 + intraday SMA48 direction | -10.87 / .46 / -.0562 | -11.11 / .25 / -.0497 | Reject; no next-round parameter tuning on same holdout. |
| Extend max hold2h->24h | -1.13 / .87 / -.0604 | -3.23 / .65 / -.0677 | Reject despite relative loss reduction; PF<1 and negative expectancy. |
| Four-hour cooldown after exit | -10.45 / .43 / -.0594 | -9.80 / .31 / -.0544 | Reject; fewer trades does not establish edge. |

Other tempting changes—1% momentum threshold, actual VWAP/ATR substitution,
different z-score thresholds, fitted hedge ratios, learned regime router,
profit targets/trails or market-to-limit conversion—are **not approved or proven
profit recommendations**. Indicator defects are documented with locations, but
changing signal definitions creates a new model that needs fresh data/experiments.
No expected win-rate/Sharpe increase is assigned without those measurements.

## Approval gate and remaining evidence

The audit reports, deterministic proofs, offline harness and local research
outputs are the only new files. Original tracked application/config/deploy files
remain unchanged. No commits, pushes, global installs, credential changes,
deployments, live orders or external notifications were made.

Full deployed-bot comparison and US/India/ORB/OI/AI-history validation remain
unavailable without corresponding historical inputs. This limits Phase4 claims;
the delivered conditional comparisons must not be relabeled production returns.
No additional user data is needed to review these concrete repair proposals.

Select numbered items to authorize implementation. Credential revocation/rotation,
history rewriting and deployment actions each still require their own explicit
approval. For approved code items, show the complete diff and validation before
the requested item commits; use one commit per approved item, show `git diff --stat`
and commit messages, then ask **"Approve push?"**. Push only after an explicit yes.

**Which items should I implement?**
