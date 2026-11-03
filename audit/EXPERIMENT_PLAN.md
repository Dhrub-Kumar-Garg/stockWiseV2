# Frozen experiment plan (written before replay results)

Source: 50360996451ddc7ad742372bff398b7938ae0029. Experiments stay in audit/.
No production strategy, credential, configuration, deployment, or ledger changes.

Public Binance spot BTC/ETH/SOL/XRP/DOGE USDT 15-minute OHLCV, 2024-01-01
through 2025-12-31; 2023 daily warmup. USDT approximates USD. Each archive is
SHA256-checked against its publisher checksum. Missing/duplicate bars fail closed.

The **conditional research baseline** uses the actual source signal functions,
dispatcher, strategy exits, and broken sizing rule, with frozen zero-observation
seed learning and fixed neutral TREND and REVERT analyst scenarios separately.
It is not a reconstruction of the deployed bot: historical AI decisions/news,
30-second quotes, exchange marks, OI, and funding observations were not supplied.
ORB and the two OI strategies cannot be validated on these inputs. No retrospective
LLM calls or fabricated OI/news. SLEEP/default behavior is checked with fixtures.

Use completed daily bars (last 365), completed 15-minute bars (last 480),
decisions at candle close, fills at the NEXT candle open. Stop-first when high
and low both touch exits; gap exits use the adverse opening price; close mark
equity every bar, include entry/exit fees and terminal trades. Shared execution:
5 bp taker fee + 10 bp slippage + 2 bp half-spread per side. Funding is an
explicit modeled 1 bp/8h, with 3 bp/8h stress. It is a cost scenario, not measured
historical funding. This uses conservative executable prices, not EMA fills;
liquidation and equity never replenish cash after ruin. Every strategy variant
uses exactly the same data, costs, and execution model.

Expanding training from 2024-01-01. Nonoverlapping OOS quarters: 2024-Q3,
2024-Q4, 2025-Q1, 2025-Q2. Final held-out 2025-H2 is evaluated only after those
experiments. No parameter search, best-symbol selection, or holdout retuning.
Fresh $100 capital and seed state per fold. Concatenate/rebase fold daily
returns for aggregate Sharpe/DD; pool trade dollars at equal $100 fold starts.
Training only supplies empirical Kelly estimates; it never reads test trades.

Single-factor candidates, fixed before observing output:

1. `ledger_wiring`: consume learned.kelly from the actual array schema.
2. `fractional_kelly`: train-only p/payoff; quarter Kelly, zero for n<30 or
   nonpositive net expectancy; risk-at-stop <=0.5% equity; no positive size floor.
3. `exposure_cap`: per-position leverage <=2; aggregate gross notional <=1.5x.
4. `kill_switch`: UTC daily loss >=2% or lifetime DD >=10% flattens positions;
   daily lock resets only next UTC day; lifetime lock stays latched.
5. `no_unhedged_pairs`: remove one-legged pairs entries (no claimed pair hedge).
6. `mtf_filter`: require direction agreement with completed daily SMA200 and
   completed 15-minute SMA48.
7. `hold_24h`: change only max hold from 2h to 24h.
8. `cooldown_4h`: require 4h after a symbol closes before another entry.

Report Sharpe on daily marked returns (sqrt365; risk-free=0), max drawdown on
every 15m mark, net profit factor, net $ expectancy per completed trade, trade
count, win rate, and return. Null Sharpe/PF for insufficient variance/losses
must not become a fake zero or infinity in JSON. A flat portfolio is no edge.

A profit candidate advances only if aggregate OOS AND final holdout beat their
matching conditional baseline: higher Sharpe, PF >= baseline and >1, positive
expectancy, higher return, no larger drawdown, >=30 OOS/holdout trades, and
improvement in >=3/4 walk-forward quarters. Cost stress must retain positive
expectancy. These are screening gates, not proof of statistical significance.
Reject failed profit ideas. Accounting/security/operational repairs remain
correctness proposals, validated with fixtures rather than fictitious Sharpe.
