# StockWise paper research platform

This branch is paper-only. No broker order submission is implemented. Current
research has not established a profitable strategy. Unproven/negative cost-net
edge sizes to zero; shadow strategies can collect observations without using
account capital.

## Local setup

Use Node 22 and the example configuration. Optional Groq/Telegram integrations
are off by default. Put secrets only in environment variables, never config.json.
Set STOCKWISE_DASHBOARD_TOKEN to a private value of at least32 characters before
opening the dashboard. The client keeps the entered token only in memory.

```powershell
npm ci --ignore-scripts
# Create your local configuration from config.example.json after reviewing it.
npm run init
npm run cycle
npm run daemon
cd web
npm ci --ignore-scripts
npm run build
npm run start
```

All npm/legacy CLI entrypoints select the same paper engine. For an isolated,
credential-free one-cycle check use an empty temporary data directory:

```powershell
node scripts/v2/engine.mjs --paper --mock --once --config config.example.json --data-dir YOUR_TEMP_DIRECTORY
```

Legacy V2 state is refused rather than silently resetting money or rewriting
history. An explicit migration/reconciliation plan is required. Engine state/orders/events are committed atomically in local SQLite under
data/paper; set STOCKWISE_DATA_DIR to that same absolute path for a
dashboard attached to a different working directory. Existing deployments have
not been changed or restarted; deployment still requires separate approval.

## Risk and measurement

Paper fees, adverse fills and modeled funding/borrow are charged explicitly.
Operator pause, UTC daily loss and lifetime drawdown locks persist. Opens are
bounded by cash, leverage, stop risk and gross/net/cluster/correlation budgets.
Signals fill only on a subsequent fresh observation. No live mode exists.

Run npm test. Audit reports describe source revision5036099, not these fixes;
IMPLEMENTATION_STATUS.md tracks each separately committed improvement. Original
ARCHITECTURE.md, AUDIT_FINDINGS.md, IMPROVEMENTS.md, BACKTEST_RESULTS.md,
STRATEGY_NEWS_REVIEW.md and FOLLOWUP_RESULTS.md retain the original evidence.

SQLite uses Node22.16's built-in experimental node:sqlite API (no database package
or server installation). It uses WAL/FULL synchronization and a renewable writer
lease; a stale owner cannot commit after takeover. Dashboard reads one bounded,
whitelisted snapshot, not whole JSONL files. Keep paper.sqlite and its WAL/SHM
files together when taking a stopped-engine backup. No old data was migrated.
Explicit paper commands can be appended with scripts/v2/paper_command.mjs using
--paper, --data-dir and --command JSON_FILE. IDs are durable and cannot be reused;
missing-price closes remain queued. Old destructive fix_loop is retired.

Evaluation: `node scripts/v2/backtest.mjs --data-dir audit/data --out-dir audit/current-results --from 2025-10-01 --to 2025-11-01` replays the current paper runtime using costed next-observation fills and conservative adverse-first OHLC excursions. Candle fills are assumptions, not executable-quote evidence. Original audit adapters are pinned to Git source 5036099 and tooling e4198ca; bug reproductions describe that source, not the repaired code. Raw data hashes are emitted. `evaluation.mjs` supplies chronological expanding windows with embargo and marked daily-return metrics. News/OI/AI history is unavailable and is not fabricated. Cold unvalidated strategies stay in cash: the October 2025 regression run has zero trades/return/DD and undefined Sharpe/PF/expectancy. This verifies the gate, not profitability. Historical research results remain in BACKTEST_RESULTS.md/FOLLOWUP_RESULTS.md.
