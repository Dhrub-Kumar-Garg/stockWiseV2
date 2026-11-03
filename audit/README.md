# Audit tooling

Read the root ARCHITECTURE.md, AUDIT_FINDINGS.md, IMPROVEMENTS.md and
BACKTEST_RESULTS.md first. Stop at the user's approval gate.

The user subsequently authorized pushing the audit branch without merging.
STRATEGY_NEWS_REVIEW.md and FOLLOWUP_RESULTS.md cover the requested follow-up;
production improvements still require item selection/approval. No runtime code
has been changed.

All tooling is new, audit-only, standard-library Python/Node. No packages were
installed. No application entrypoint is run. The source adapter evaluates
allowlisted source declarations with an in-memory store, an injected clock,
blocked data calls, and no-op notification adapters. It never loads Telegram,
Groq credentials, config.json, production state, or a deployment script.

From the repository root:

```powershell
python audit/fetch_data.py
node audit/checks.mjs
node audit/backtest.mjs
node audit/backtest.mjs --stress
node audit/verify_replay.mjs
python audit/render_reports.py
```

fetch_data.py is the only audit network downloader: it GETs public Binance
historical ZIPs and SHA256 checksum files. Data stays in ignored audit/data.
It validates OHLC and rejects missing/duplicate intervals. Checksums/URLs are
retained in result JSON. The repository source audit also consulted public
GitHub, Binance and Hyperliquid documentation read-only.

The replay loads original signal functions/dispatcher/sizing; execution is a
separate cost-aware simulator shared across candidates. It does **not**
reconstruct historical AI decisions, OI, news, live quotes, real financing,
equity markets, or the production brain's learning path. Frozen seed learning
and fixed analyst modes are deliberate limitations, not optimized policies.

EXPERIMENT_PLAN.md fixes the variants, splits, costs, and pass/fail rule.
source_inventory.json covers the entire original tracked tree, with raw checkout
and Git-blob hashes (Windows autocrlf changes byte-level line endings).
Hash verification permits only equivalent LF/CRLF checkout differences; other
content changes still fail. The inventory is pinned to the audited revision,
so regeneration after the audit commit does not mistake research outputs for
original application source.

results/backtest.json and stress.json contain individual fold and holdout metrics,
training-only Kelly inputs, source hashes and the full data manifest. Holdout
trade ledgers are stored for each variant/cost scenario. checks.json contains
17 successful source-defect/static reproductions; replay-checks.json contains
12 simulator/integrity checks. Passing a bug reproduction means the bug exists.
smoke.json is a preliminary seven-day plumbing run and is not performance evidence.

Follow-up reproduction:

```powershell
node audit/routing_news_checks.mjs
node audit/probe_news.mjs
python audit/fetch_followup_data.py
node audit/followup_research.mjs
python audit/render_followup.py
```

probe_news.mjs GETs only the three public RSS URLs used by source and retains
response metadata/counts, not articles. It does not inspect production or use
Groq/Telegram. That observation is time-sensitive and is separate from offline
checks. Follow-up data remain ignored; archive provenance and all scenario
ledgers are retained. The six follow-up integrity checks and16 routing/news
fixtures bring total checks to51. More orders or more balanced directions did
not establish positive cost-net expectancy.

No strategy improvements have been applied. Production correctness fixes, key
rotation and deployment require their respective approvals. The user authorized
committing/pushing this audit package on its branch; no merge is authorized.
