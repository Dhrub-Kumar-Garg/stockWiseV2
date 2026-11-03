# Audit findings

Follow-up details and additional source-backed proofs are in
STRATEGY_NEWS_REVIEW.md. They expand Q11/Q12 and R05/R06: asymmetric side
confidence plus the .60 entry gate, hard unexpired bias vetoes, first-feed
headline starvation, missing Fed prompt context and stale news reuse. The
public-feed probe succeeded from the audit machine; production ingestion
remains uninspected. FOLLOWUP_RESULTS.md reports the additional2026 routing
experiments. No runtime fixes are included in this branch.

Source revision: 50360996451ddc7ad742372bff398b7938ae0029. Locations below
refer to unchanged source, not generated audit files. P0: immediate credential/
control boundary; P1: material correctness/risk/measurement; P2: reliability or
research quality; P3: presentation/documentation. Findings describe source
behavior or a stated risk, not an assertion that a remote deployment was inspected.
Credential contents are deliberately omitted. Nothing here was repaired in production.

## Credentials, inputs and control boundaries

| ID | Priority | File:line | Finding, trigger and consequence |
| --- | --- | --- | --- |
| S01 | P0 | `scripts/v2/telegram.mjs:8` | Credential-shaped bot token hardcoded in a public repo; owner chat ID at9. Treat as exposed; validity was not tested. Revocation/rotation and any history rewrite require separate explicit approval. |
| S02 | P0 | `web/app/api/state/route.ts:55`, `:89`; `deploy/setup.sh:33`, `:90` | Public GET serializes entire config.json, including configured analyst key, without authentication/redaction. Deploy opens public3002, with HTTP in deploy/README.md:94. A real config would be disclosed to any caller. No live endpoint was queried. |
| S03 | P1 | `scripts/v2/engine.mjs:609`, `:618`, `:654`; `scripts/v2/telegram.mjs:165` | Pending opens run while halted; then normal DD calculation overwrites manual /kill. Kill is neither universal nor latched. Fixture: halt -> normal with dd=0; halted doOpen still creates position. |
| S04 | P1 | `scripts/v2/engine.mjs:209`, `:227`; `scripts/v2/perp.mjs:79`; `scripts/lib.mjs:74` | No config/order/state schema validation: side, symbol, finite positive price/margin/leverage, stop/target, and numeric bounds unchecked. Fixture: price0 produces qty=Infinity; JSON serialization later converts nonfinite values to null. |
| S05 | P2 | `.gitignore:3`; `scripts/v2/analyst.mjs:189` | config.json and *.pem are ignored; .env*, *.key and other secret formats are not. No env-based secret boundary. This is an exposure risk, not evidence of additional leaked keys. |
| S06 | P2 | `scripts/v2/telegram.mjs:219`, `:226`; `:12` | Command cursor only in RAM; restart can replay recent Telegram commands. No command expiry or persistent idempotency. Sender is restricted by owner chat ID, but bot-token compromise still exposes messaging/control channel integrity. |
| S07 | P2 | `scripts/v2/store.mjs:11`; `web/app/api/state/route.ts:58` | FAB_SIGNALS accepts path traversal relative to data, while API ignores the override. An operator-controlled env value can redirect a write outside data and silently disconnect UI; no remote input path was found. |
| S08 | P2 | `scripts/v2/analyst.mjs:60`, `:92`, `:178` | Untrusted news enters a trading-mode prompt; regex/enum checks constrain output syntax, not prompt influence or provenance. Saved decisions lack expiry/schema validation on read. Persistent stale or manipulated bias can route entries indefinitely. |

## Money, sizing, risk and execution

| ID | Priority | File:line | Finding, trigger and consequence |
| --- | --- | --- | --- |
| M01 | P1 | `scripts/v2/engine.mjs:324`, `:329`; `scripts/daemon.mjs:426` | Reported net/realized_R omits entry fee. Flat $30-notional trade at5bp each side loses$.030 cash but reports-$.015. Brain learns inflated return and may label a net losing trade a winner. |
| M02 | P1 | `scripts/v2/perp.mjs:49`; `scripts/v2/engine.mjs:155`, `:324`, `:327`, `:402`; `scripts/daemon.mjs:194`, `:426`, `:429` | fundingPayment is signed cashflow (negative long payment), but close subtracts it and wallet never settles it. Fixture: -.30 funding + .03 fees should lose.33; reports+.285 and wallet loses only.03. Equity omits accrual too. |
| M03 | P1 | `scripts/v2/sizing.mjs:30`, `:31`, `:33`; `scripts/v2/brain.mjs:300`; `data/strategies.json:1` | Array/nested learned.kelly written, object/flat kelly read. All strategy sizes default.10 instead of learned risk; fixture learned Kelly .12 ->0 leaves margin unchanged at$17. |
| M04 | P1 | `scripts/v2/brain.mjs:150`, `:160`, `:176`; `scripts/v2/sizing.mjs:33` | Before5 trades risk uses hardcoded.12; later .4*mean/variance is mislabeled half Kelly and clamped to at least.02 even if edge<=0. No credible win/payoff estimates or uncertainty guard for unproven candidates. |
| M05 | P1 | `scripts/v2/sizing.mjs:45`, `:54`, `:58`; `scripts/v2/engine.mjs:214`; `config.example.json:31` | No loss-at-stop budget, gross/net/correlated exposure cap; config maxPositionPct/minCashPct ignored. Up to5 correlated crypto bets, goal multiplier increases margin up to55%. Fixture allows90% equity margin despite30% config cap. |
| M06 | P1 | `scripts/v2/engine.mjs:144`, `:175`, `:318`; `scripts/daemon.mjs:181` | New engine manufactures EMA venue mark and exits against it; old uses current quote. Example 100 entry,96 stop,90 raw tick =>97.5 EMA and no stop. Can delay liquidation/stops and book non-executable smoothed fills. |
| M07 | P1 | `scripts/v2/engine.mjs:327`; `scripts/v2/perp.mjs:19`, `:116` | Liquidation closes as ordinary trade; gap loss can exceed isolated collateral and debit unrelated cash. Fixture10 margin at5x,100->1 leaves50.45 wallet vs~89.975 free before close. Approximate liq formula also ignores deduction, changing mark notional, funding/fees; calculated maintMargin is not used for trigger. |
| M08 | P1 | `scripts/v2/engine.mjs:651`, `:672`; `scripts/v2/episode.mjs:173`, `:178`, `:194`; `scripts/daemon.mjs:156` | DD evaluated after opens (old daemon uses previous cycle equity), no daily-loss breaker, no lifetime lock, caution inert, new engine ignores hardFloorPct. Episode reset erases halt/DD; blowup replenishes capital even if autoResetOnBlowup=false in newer engine. Lifetime returns/deposits therefore not economically reconciled. |
| M09 | P1 | `scripts/v2/engine.mjs:629`, `:642`; `scripts/daemon.mjs:273`; `scripts/v2/backtest.mjs:103` | Same snapshot creates signal and fill. No next-observation ACK/queue despite comments. Historical same-close execution understates latency and selection costs; not a proven future-bar read in signal math. |
| M10 | P1 | `scripts/v2/strategies.mjs:927`; `scripts/v2/engine.mjs:74`, `:141`, `:618` | Stale quote flag is set but never rejected. Histories can remain indefinitely stale; no positive-price or timestamp-age check. Mark/risk exits may freeze on failed symbols or use old prices; pending path bypasses even session check. Fixture stale=true produces entry. |
| M11 | P1 | `scripts/v2/engine.mjs:574`, `:224`; `scripts/daemon.mjs:341`; `scripts/lib.mjs:185` | FX is unused for INR position quantities/fees/P&L; currencies commingled as numeric USD. Failure falls back silently to83. Fee/P&L comparisons across India and USD instruments are invalid. |
| M12 | P2 | `scripts/v2/engine.mjs:321`; `scripts/v2/perp.mjs:64`, `:68`; `config.example.json:73` | Exit fee based on entry notional; maker rate/spread/depth functions unused. Fixed slippage lacks actual spread/impact; partial fills, exchange limits, precision and borrowed-equity financing absent. borrowAnnual=.08 never charged. No actual exchange order/API error path exists to audit; these are missing simulator features. |
| M13 | P2 | `scripts/v2/engine.mjs:231`; `scripts/v2/sizing.mjs:23`; `scripts/v2/perp.mjs:17` | Account/market leverage caps applied by sizer, but tier maxLev is not checked when opening; builder accepts unsafe leverage and malformed tiers. External direct opens bypass sizer contract. |
| M14 | P2 | `scripts/v2/engine.mjs:229`; `scripts/v2/sizing.mjs:58` | minNotionalUsd compares margin rather than notional;98% wallet margin reserve does not explicitly reserve fees. Can misreject small leveraged orders; generalized high leverage/fees could overspend wallet. |
| M15 | P2 | `scripts/v2/brain.mjs:521`, `:537` | Every8min can unlock risk again from the same4+ closed trades, with no new-evidence cursor; starting leverage remains a hard lower bound during loss adjustments. Promotion is not an independent validation step. |

## Strategy edge, data integrity and research bias

| ID | Priority | File:line | Finding, trigger and consequence |
| --- | --- | --- | --- |
| Q01 | P1 | `scripts/v2/strategies.mjs:643`, `:655`, `:663`, `:817` | Advertised stat-arb only trades A, never hedges B; ratio uses fixed log coefficient1, no correlation/cointegration or stability test. Exit supports onlyBTC/ETH despite3 pairs; SOL and BTC/SOL attribution/exits mismatched. This is directional exposure, not a demonstrated market-neutral spread. |
| Q02 | P1 | `scripts/v2/backtest.mjs:56`, `:64`, `:83`, `:100`, `:114` | Existing backtest reinterprets 15m closes as daily; only one strategy/position; no fees/spread/slip/funding/MTM equity, no training/test separation or Sharpe/PF/expectancy. Terminal P&L is omitted from trade count/win stats; exit helper imported but not used. Exit-event-only DD misses floating losses. |
| Q03 | P1 | `scripts/v2/strategies.mjs:75`, `:180`, `:936`, `:977`; `data/strategies.json:17` | Heuristic .5-.62 signal confidence, thresholds and candidate sizing not statistically estimated. Tracked ledger has zero observations for every strategy. No evidence validating13 trials, market/regime selection or tuning history; overfitting risk is unresolved, not proven intentional overfit. |
| Q04 | P1 | `scripts/v2/engine.mjs:189`; `scripts/v2/strategies.mjs:168`, `:225`, `:339` | Common2h time exit conflicts with daily/28-day/200-day features. Same daily signal can reenter repeatedly after2min from signal emission; costs compound without fresh independent evidence. Source and conditional replay support turnover drag, not a universal proof that longer hold adds edge. |
| Q05 | P2 | `scripts/lib.mjs:178`; `scripts/v2/strategies.mjs:616`; `scripts/v2/fetch_hist.mjs:21` | Timestamps lost/nulls filtered separately; pairing last50 values can compare different dates. History may include forming bars, no close-time cutoff, no adjustment/split policy. Current code cannot demonstrate causal multi-source alignment; audited harness explicitly enforces completed bars. |
| Q06 | P2 | `scripts/v2/strategies.mjs:136` | retN subtracts n+1, so intended28-day signal is29 intervals. Reproduced on a30-close fixture. |
| Q07 | P2 | `scripts/lib.mjs:224`; `scripts/v2/strategies.mjs:265` | mom_trend tests fractional q.mom>1 (>100% rise) rather than a likely intended1% threshold; strategy nearly unreachable for ordinary equity moves. Intent requires approval; do not silently choose a new threshold. |
| Q08 | P2 | `scripts/lib.mjs:214`, `:262`; `scripts/v2/strategies.mjs:549` | Flat RSI becomes100, ATR ignores high/low/gaps, VWAP is plain close mean without volume/session. Names imply indicators different from implemented inputs; may change entry selection/stop distances. |
| Q09 | P2 | `scripts/v2/strategies.mjs:436`, `:442`; `scripts/v2/world.mjs:274`; `scripts/v2/engine.mjs:712` | Price divergence spans8 daily bars while OI spans8 loop snapshots; world OI cached5min but appended each cycle, creating repeated values then jumps. Restart loses cache and clocks; no matching time horizon. XRP/DOGE OI never collected. |
| Q10 | P2 | `scripts/v2/world.mjs:300`; `scripts/v2/engine.mjs:151` | Hyperliquid hourly funding source is averaged across symbols and applied at8h boundaries; not venue/symbol/time-specific historical funding. Numeric signs/accounting are separate M02. Hourly settlement verified against official docs below. |
| Q11 | P2 | `scripts/v2/strategies.mjs:883`, `:941`, `:974`, `:998`; `scripts/v2/analyst.mjs:178` | Analyst aggression unused; SLEEP allow-pairs comment is unreachable through single-signal confidence<=.5 vs.6 gate; default disabled analyst leaves no entries absent stored decision. No explicit universal SLEEP risk lock, and old daemon never refreshes analyst. |
| Q12 | P2 | `scripts/v2/strategies.mjs:987`, `:1004`; `scripts/lib.mjs:419` | Correlated versions of breakout count as independent confluence; ties favor longs/watchlist order; only best strategy receives trade attribution. General regime value is not used to gate entries; no portfolio correlation or market diversification policy. |
| Q13 | P2 | `scripts/v2/brain.mjs:258`, `:274`, `:296` | Negative candidates never retired before promotion; saved learned stats omit PF/DSR shown in UI. Confidence decay on probation can repeat from same observations. Approximate DSR uses trade ROI (not calendar returns), excess-vs-raw kurtosis convention mismatch at134, and trial count only current strategies rather than all historical searches. It cannot certify OOS edge. |
| Q14 | P2 | `scripts/v2/brain.mjs:197`, `:204`, `:246`; `scripts/lib.mjs:58` | Last6000 journal rows can orphan long-lived pre records; duplicates are not removed from pairing. `isFinite(null)` is true, so serialized nonfinite/null can enter stats as0. One malformed JSONL line discards entire history silently. |
| Q15 | P2 | `scripts/v2/strategies.mjs:747`, `:794`; `:296` | Adaptive exit only middle-vol band, not a remembered regime change; VWAP-zone exit misses jumps over the band; ORB can initialize before open and lose range on restart. These are unvalidated edge/exit behaviors, not profitable fixes by assumption. |

## Reliability, persistence, dashboard and deployment

| ID | Priority | File:line | Finding, trigger and consequence |
| --- | --- | --- | --- |
| R01 | P1 | `scripts/lib.mjs:45`, `:52`; `scripts/v2/engine.mjs:621`, `:718` | Shared fixed .tmp filename and independent JSON/JSONL writes, no writer/process lock or transaction. Multiple daemons can lose updates; crash after journal before state can duplicate/loss-account fills; clearing pending erases concurrently appended orders and failed orders. |
| R02 | P1 | `package.json:9`; `scripts/daemon.mjs:26`, `:326`; `scripts/v2/engine.mjs:744` | npm daemon uses older code with materially different risk/funding/mark behavior and no signals publication. A fresh npm-started bot can show empty/stale UI, no analyst refresh, no OI features or Telegram control. Deployment selects a different engine. |
| R03 | P1 | `scripts/v2/engine_ws.mjs:31`, `:54`, `:61`, `:77` | Prototype uses tiers=[] (throws), deletes positions without fees/wallet/P&L settlement, never persists state/orders or generates actual signals. Limit touch is assumed full fill with no queue/partial fills/reserve/expiry. Not a deployable execution upgrade. |
| R04 | P2 | `scripts/v2/ws_feed.mjs:14`, `:24`, `:45`; `scripts/v2/engine.mjs:47`, `:72` | Invalid raw multi-stream URL; combined wrapper unsupported; malformed JSON can throw; no heartbeat/backoff/stale watchdog; callbacks async errors uncontained. REST completion can overwrite newer WS quote across awaits; hardcoded symbols omit custom watchlists. Official WS contract linked below. |
| R05 | P2 | `scripts/v2/engine.mjs:581`, `:694`, `:701`, `:548`; `scripts/v2/world.mjs:270`; `scripts/v2/telegram.mjs:18`; `scripts/v2/analyst.mjs:69` | Sequential slow feeds and blocking world/analyst/Telegram requests delay risk checks; Groq/Telegram lack timeouts, retries/backoff/status checks on notify. 30s is post-work sleep, not30s cadence. REST body parsing is outside timeout lifetime (`lib.mjs:96`, `:103`). |
| R06 | P2 | `scripts/lib.mjs:35`, `:55`; `scripts/v2/engine.mjs:519`, `:523`; `scripts/v2/world.mjs:30` | Corruption/missing/permission errors collapse to defaults; corrupted state can auto-initialize fresh capital. Cached world values have no stale age in digest and can live forever; failed history refreshes repeat blocking calls. No source-health alerts. |
| R07 | P2 | `scripts/v2/telegram.mjs:203`; `scripts/v2/engine.mjs:621` | close_all replaces existing pending orders, rather than appending/transactionally cancelling opens. Failure to obtain a quote still clears the attempted close. Awaited command/network handling precedes position protection. |
| R08 | P2 | `web/app/api/state/route.ts:26`, `:76`; `scripts/lib.mjs:57` | Unbounded full synchronous log reads and parsing before slicing/downsampling. Memory/latency grows with every30s equity append, per6s browser poll and perbrain scan; malformed trailing row makes entire log appear empty. No retention/index/pagination. |
| R09 | P2 | `web/app/components/Root.tsx:23`, `:29`; `web/app/components/DashboardV2.tsx:577` | UI continues showing prior successful data after polling error and always renders green live status, including missing/old signals. setInterval permits overlapping requests and older responses overwriting newer data. No stale-age or error banner reaches dashboard. |
| R10 | P2 | `web/app/components/DashboardV2.tsx:47`, `:226`, `:269`, `:282`, `:506` | Charts hardcode$100 and ignore startCap. Range PnL counts lifetime change from100 in first bucket, rather than selected interval change. Replenished episodes also misstate lifetime performance without cashflow accounting. |
| R11 | P3 | `web/app/components/DashboardV2.tsx:845`, `:849`, `:954`; `scripts/v2/brain.mjs:386` | PF/DSR rendered0 since absent in learned schema; lessons writer text/type vs reader lesson/kind/title hides actual explanation. Misleading display, not real zeroPF evidence. |
| R12 | P2 | `scripts/fix_loop.mjs:42`, `:73`, `:88`, `:100`; `scripts/v2/init.mjs:34` | Recovery/reset scripts erase logs/learning/open positions without settlement, lock or backup. Hardcoded episode/generation3. Force init only overwrites state/pending, leaving mismatched old journals. Reviewed only; never run. |
| R13 | P2 | `deploy/setup.sh:9`, `:26`, `:44`, `:64`, `:108` | Setup performs OS upgrades, shell-piped installer, mutable npm install and immediate service restart, without config validation, rollback, TLS/auth or service hardening. sudo install/build can leave root-owned local files. A private/sandbox deployment path is absent. Script not executed. |
| R14 | P3 | `README.md:31`, `:39`, `:47`, `:88`, `:159` | Claimed regimes differ, analyst aggression unused, confluence not decorrelated, backtest never trains ledger, downloader uses Yahoo rather than described Binance. These documentation claims can cause unsafe assumptions. |

## External contracts verified (read-only)

- Binance documents separate raw `/ws/<stream>` and combined `/stream?streams=...`
  requests. The source concatenates multiple stream names onto raw /ws and only
  understands unwrapped `msg.e`. [Official Binance stream documentation](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-streams/~).
- Hyperliquid documents hourly funding transfers, unlike the source's8h application.
  [Official Hyperliquid funding documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding).
- Historical archive checksums and2025 spot microsecond timestamp convention used
  by audit downloader follow [Binance public-data documentation](https://github.com/binance/binance-public-data).

## Proof status

`node audit/checks.mjs` provides17 passing checks: most are **successful bug
reproductions**, not fixes. Static checks are labeled as such. No network is used
inside the source adapter, and Telegram/Groq/engine entrypoints are never imported
or run. The credential was not validated or rotated. Other findings are static
source control/data-flow observations; no vulnerability penetration test, package
advisory scan, deployed latency test or actual exchange fill experiment was done.
See BACKTEST_RESULTS.md for measured conditional strategy experiments and limits.
