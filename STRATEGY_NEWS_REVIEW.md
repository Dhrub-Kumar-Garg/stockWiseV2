# Strategy participation, direction bias, news and trading frequency

Follow-up requested 2026-11-03. Audited source remains
50360996451ddc7ad742372bff398b7938ae0029. The user authorized publishing this
audit branch without merging; runtime strategy changes remain proposals.

## What explains inactive strategies

The source does not run every strategy on every instrument. Some exclusions are
intentional market/regime rules; others are broken inputs, uncalibrated entry
thresholds, or loss of attribution. Turning everything on is a model change,
not a guarantee of more profitable opportunities.

`strategies.mjs:936–945` first excludes retired, wrong-market and wrong-pool
strategies. On one valid crypto symbol, the actual dispatcher evaluates **9 of
13** strategies in TREND, **6 of 13** in REVERT, and only pairs in SLEEP.
SLEEP's confidence rule prevents that remaining single strategy opening a trade.
These counts were reproduced with unchanged source, not inferred from the UI.

Only one position per symbol and five positions total are allowed. A strategy
may emit a valid signal but lose to another strategy; only the winner's ID is
credited in trades/learning (`strategies.mjs:1002–1018`). Therefore a zero trade
count does not mean the function was never evaluated, and equal use of all13
strategies would be the wrong success metric. We need evaluated/eligible/raw
signal/vetoed/selected/filled counts separately.

| Strategy | Why it can be absent or underrepresented |
| --- | --- |
| tsmom | TREND only. High long confidence and first-seed ordering can dominate weaker same-side signals. |
| donchian | TREND only; needs a breakout. Short confidence fails solitary-entry gate. |
| mom_trend | TREND only; fractional momentum must exceed1 (>100% over10 intervals), an unusually strong gate. Long-only. |
| orb | US only, regular-session metadata and range tracking around the open; cannot be assessed on crypto data. |
| ibreakout | TREND crypto only, completed intraday data required; .50 confidence cannot enter alone under neutral news. |
| atr_expand | TREND only, ATR expansion and channel break; .58/.55 confidence generally needs confluence. |
| vol_expand | TREND only, squeeze/release condition; .58/.55 generally needs confluence. |
| rsi2dip | REVERT only, >=210 daily closes, RSI2 extremes within SMA200 trend; solitary shorts blocked at.55. |
| vwap_revert | REVERT crypto only, intraday data, .52 cannot enter alone without a confidence boost. |
| orderflow | REVERT crypto only, funding/OI caches required; npm daemon never populates these caches. |
| pairs_trade | Both pools, only BTC/SOL base legs; dynamic confidence must survive selection. This is unhedged directional exposure. |
| adaptive_regime | Both pools, volatility-specific entry and confluence selection; middle-vol region deliberately abstains. |
| oi_diverge | Both pools, OI cache/horizon issue; no XRP/DOGE OI source and none populated by npm daemon. |

The original conditional2025-H2 replay selected six different primary strategies
in TREND and four in REVERT. It did not test production's actual AI decisions.
Full long/short/strategy counts are retained in
`audit/results/strategy-participation.json`. Missing OI/US data remain explicit
coverage limits, not an excuse to fabricate signals or force trades.

## Direction bias is partly structural

The strongest source mechanisms are:

1. **Asymmetric confidence plus a common .60 threshold.** tsmom long=.62 versus
   short=.55; donchian and rsi2dip long=.60 versus short=.55. A lone long qualifies
   where an otherwise comparable short is rejected. These are heuristic values,
   not estimated probabilities (`strategies.mjs:180`, `:188`, `:210`, `:218`,
   `:239`, `:247`, `:998`).
2. **Hard analyst veto.** LONG rejects all short candidates and SHORT rejects all
   longs, even a .99-confidence opposite candidate (`:954–955`). The saved
   decision reader has no expiry (`analyst.mjs:175–178`), so an old opinion can
   dominate indefinitely. The npm daemon never refreshes it.
3. **Tie bias and strategy duplication.** Equal long/short confluence counts
   choose long (`strategies.mjs:987`). A fixture with two.40 longs versus two.99
   shorts chooses long. Multiple correlated breakout rules can win by count
   without supplying independent evidence. Single-score ties also choose long.
4. **Shared global sentiment.** All symbols receive the same news/F&G adjustment;
   symbol, market, exposure and existing portfolio direction are not considered.

The analyst prompt receives a coarse regime label, news and recent bot outcomes,
but no per-symbol price/SMA/RSI table (`analyst.mjs:116–169`). Its global direction
veto therefore cannot be treated as verified technical confirmation for every
crypto, US and India instrument.

Even with NEUTRAL analyst and neutral news, original replay selection was long
**1,349/1,424 (94.7%)** in TREND and **1,348/1,651 (81.6%)** in REVERT. Market
conditions also affect these figures: these are not proof that an appropriate
strategy must trade50/50. Compare long and short calibration/expectancy within
matched opportunities, symbols and regimes; do not impose equal counts.

The follow-up tests symmetric confidence, all-pool scanning and their interaction
on additional2026 history. Results are in `FOLLOWUP_RESULTS.md`. A symmetric
heuristic still is not a calibrated probability or approved runtime change.

## News is used, but the data path is weak

Read-only public-feed probe from the audit machine at **2026-11-03 16:05 IST**:

| Feed | HTTP | Items / titles recognized by current parser |
| --- | ---: | ---: |
| Cointelegraph RSS | 200 | 30 / 30 |
| Decrypt RSS | 200 | 39 / 39 |
| Federal Reserve press releases | 200 | 20 / 20 |

This does not establish health from the production server. Exact URLs, UTC
observation time, response sizes, durations and publication metadata are in
`audit/results/news-feed-probe.json`. No articles or headline bodies were saved
to the published audit. Source URLs:
[Cointelegraph](https://cointelegraph.com/rss),
[Decrypt](https://decrypt.co/feed),
[Federal Reserve](https://www.federalreserve.gov/feeds/press_all.xml).

Confirmed routing defects/limitations:

- `world.mjs:200–210` appends Cointelegraph first, then Decrypt, then keeps only
  the first20 titles. With30 valid first-feed items today, **zero Decrypt items
  would survive** this function. This was reproduced with source-backed fixtures.
- The digest keeps only first5 titles (`world.mjs:348`); Groq sees at most those5
  (`analyst.mjs:150`). A newer second-feed story need not be considered at all.
- Only title strings survive parsing: publication time, ingestion time, source,
  asset/entity mapping and duplicate IDs are lost (`world.mjs:36–48`). Old stories
  cannot be expired or deduplicated correctly. Atom entries are unsupported.
- Fetch failures retain cached values without an exposed age/health marker
  (`world.mjs:20–30`). Silence can look like valid unchanged news.
- Fed headlines appear separately in the digest, but buildPrompt reads only
  `w.headlines`, not `w.fed`. The analyst does not get the collected Fed titles.
- The newer engine collects news/analyst **after** trading decisions, so new
  information affects a later cycle (`engine.mjs:629`, `:694`, `:701`). Slow
  network calls can also delay the next risk check.
- The old npm daemon collects world data but never runs the analyst. Consequently
  its lexical news multiplier may update while its direction veto stays stale.
- News is not ignored: fixtures show .52 confidence becomes.624 on supportive
  sentiment, changing no-entry into an actual long or short router order.
  Whether that change has positive net predictive value is **unverified**.
- A word-list score is global rather than event/asset-specific. It cannot reliably
  distinguish a BTC exchange incident from equity earnings or a negated headline.
  No point-in-time news ablation or calibrated impact/decay model exists.

## Would lots of small orders per minute help?

The existing bot has no measured sub-minute edge, recorded orderbook, durable
fill lifecycle or calibrated probability model. Its decisions primarily use
daily features and10min-cached15m history. A30s sleep after slow IO is not a
low-latency execution schedule. Increasing loop speed would often repeat the
same information rather than discover new independent opportunities.

Expected value matters more than order count or win rate:

`net EV = p(win) * average gross win - (1-p(win)) * average gross loss - all costs`

At the audit's **assumed**34bp round-trip cost, a90%-win strategy with10bp
average gross win and40bp average loss has9-4-34 = **-29bp expected net/trade**.
These are arithmetic examples, not measured scalping returns. With50bp gross
win,30bp loss and34bp costs, breakeven win probability is80%; higher execution
quality or a larger genuine edge is needed for a safety margin.

Ten completed$10-notional round trips per minute cost approximately **$20.40/hour**
under that34bp model, before funding or gross P&L. Ten order messages/minute
are not necessarily ten completed round trips. Smaller tickets lower dollar
cost per ticket, but proportional fees/spread remain; slicing creates no edge
by itself. Actual exchange minimum notional, quantity steps and price increments
also constrain tiny orders; consult current instrument filters for the selected
paper venue, rather than hardcoding universal limits.
[Official Binance filter definitions](https://developers.binance.com/en/docs/products/spot/filters).

Frequent trading is a separate research track. First record timestamped bid/ask,
trades and depth on liquid instruments, with sequence/gap validation, then test
microprice/order-flow/short-horizon signals against executable quotes. Model
latency, queue position, partial fills, adverse selection, fees, cancellation
and venue limits. A limit-price touch is insufficient evidence of a maker fill.
Do not promote a sub-minute model from15m candle results.

## Additional proposals, ranked for the next research/repair stage

These extend the original ten proposals; effort estimates include review and
meaningful validation. No performance increase is assigned without measurement.

| # | Change | Files | Expected impact | Risk | Effort | How to verify |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | Emit per-strategy decision traces and structured rejection reasons, with primary and confirming strategy attribution. | `strategies.mjs`, `engine.mjs`, dashboard/API | Makes inactivity/bias diagnosable. No assumed Sharpe gain. | Low; bound log/cardinality overhead. | 1–2d | Every eligible strategy has evaluated/raw/vetoed/selected/filled counters and timestamps; synthetic fixtures explain all blocked paths, no false fill attribution. |
| 12 | Repair news ingestion: structured timestamps/source/asset IDs, dedup, balanced sources, publication cutoff, TTL/health, explicit Fed/equity inclusion. | `world.mjs`, `analyst.mjs`, `world/score.mjs`, dashboard | Fix coverage and stale inputs; predictive edge still unverified. | Medium; malformed timestamps, delayed/revised stories and prompt influence. | 2–3d | Fixtures for feed starvation, namespaces/Atom, duplicate syndication, stale/outage, asset mapping and point-in-time replay; news-on versus news-off at identical costs on unseen data. |
| 13 | Replace arbitrary side confidence/vetoes with audited side/regime calibration and expiring analyst context. Retain explicit emergency risk locks. | `strategies.mjs`, `analyst.mjs`, `brain.mjs` | Target better net expectancy/calibration; symmetric heuristics alone are diagnostic and must pass tests. | Medium-high; calibration can overfit; never force50/50 trades. | 3–5d | Reliability bins/Brier score and confidence intervals by side/asset/regime; train-only fit, calibration validation, untouched test, cost-net EV lower bound; long/short opportunity-conditioned comparisons. |
| 14 | Run all eligible strategies in separate **shadow paper books**, keep signal horizons and model families distinct, then net portfolio target exposure into one execution plan. | `strategies.mjs`, `brain.mjs`, `sizing.mjs`, store/API | Independent coverage and cleaner attribution/diversification; no order-count target. | Medium-high; correlation, capital allocation and contradictory signals. | 3–5d | Standalone and portfolio cost-aware P&L, family correlation/contribution, risk budget and netting invariants; no capital assigned solely for evaluation coverage. Compare against source selection and all-pool experiment. |
| 15 | Conduct a separate minute/sub-minute feasibility study using recorded executable quotes and queue-aware paper simulation. | New research recorder/harness; eventual paper execution adapter | Determine whether net scalable short-horizon edge exists; no current profit claim. | High; dataset/latency/fill assumptions can dominate apparent edge. | 5–10d after reliable data capture | Freeze signal/model/cost hypotheses, chronological train/calibration/test, realistic cost and latency stress, fill/rejection metrics, forward paper run. Advance only positive net expectancy with uncertainty and portfolio DD control; otherwise reject. |

Items11–12 provide the clearest immediate diagnostic value. Original accounting,
kill-switch and exposure repairs remain dependencies for trustworthy paper P&L.
Do not lower entry thresholds or activate all pools merely to increase activity.

## Evidence and authorization

`node audit/routing_news_checks.mjs` supplies16 additional passing source-backed
fixtures/static checks. A passing bug reproduction confirms behavior; it does
not repair the bot. `audit/followup_research.mjs` evaluates only memory-held
source variants and writes research outputs under audit/. Original source,
credentials, config and deployment files remain unchanged.

The user's request to push authorizes publishing the audit reports/tooling on
audit/profit-improvements. It does not select production implementation items,
authorize live trading, rotate keys or approve deployment. No merge is permitted.
