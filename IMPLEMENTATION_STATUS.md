# Approved implementation sequence

The user approved all numbered improvements on 2026-11-03. Each item is committed
separately on audit/profit-improvements. No push, merge, deployment, live order,
credential rotation, or destructive historical migration is authorized here.
Rejected alpha toggles stay out of production; research components remain gated
on positive cost-net evidence. Historical audit reports describe the old revision.

| Item | State | Validation |
| --- | --- | --- |
| 1. Dashboard/secret boundary | Complete | Auth, sentinel leakage, integrations disabled; no credential rotation |
| 2. Cash accounting | Complete | Signed funding/restart idempotency, fees, isolated gaps, risk R; legacy state rejected |
| 3. Persistent risk locks | Complete | Operator/day/DD locks survive restart and episode; no cash replenishment |
| 4. Exposure budgets | Complete | Leverage, gross/net/cluster/correlation, stop risk, cash and reservations tested |
| 5. Evidence-based sizing | Complete | Cost-net causal samples, quarter Kelly, no floors/goal chasing, nested ledger zero respected |
| 6. Timestamp/currency integrity | Complete | Closed OHLC, gaps/duplicates, quote/FX age, currency and event-time pairing tested |
| 7. One entrypoint and truthful UI | Complete | Both CLI paths mock-only integration; next-observation fill, cashflow P&L, build passed |
| 8. Durable paper order lifecycle | Complete | SQLite atomic snapshots/events/IDs, writer lease, crash rollback, reservations, safe migration plan |
| 9. Versioned causal evaluation | Complete | Frozen historical source, all-cost current runtime replay, adverse-first OHLC, chronological embargo and flat-alpha rejection |
| 10. Bounded asynchronous feeds | Complete | Single-flight background snapshots, 1s risk cadence, bounded HTTP body deadlines/retry, WS watchdog/parser and partial-fill research adapter |
| 11. Decision traces | Complete | Every symbol/strategy has a reason; bounded traces, separate raw/veto/selection/primary-fill counters and UI |
| 12. Structured news | Pending | |
| 13. Calibration and expiring context | Pending | |
| 14. Shadow strategy books/netting | Pending | |
| 15. Sub-minute feasibility tools | Pending | |

External credential revocation and deployment require separate approval. Future
forward returns and unavailable historical inputs cannot be manufactured.
