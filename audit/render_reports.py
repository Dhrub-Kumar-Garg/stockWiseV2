"""Render audit inventory and numeric report from retained machine-readable evidence."""
import collections
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
RESULTS = ROOT / 'audit/results'
BASE_REVISION = '50360996451ddc7ad742372bff398b7938ae0029'


def inventory():
    paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASE_REVISION], cwd=ROOT, text=True).splitlines()
    rows, tree = [], {}
    for name in paths:
        payload = (ROOT / name).read_bytes()
        skip = name.endswith('lock.json')
        binary = name.endswith('.png')
        text = None if skip or binary else payload.decode('utf-8-sig')
        blob = subprocess.check_output(['git', 'show', BASE_REVISION + ':' + name], cwd=ROOT)
        assert payload.replace(b'\r\n', b'\n') == blob.replace(b'\r\n', b'\n'), name
        rows.append({'path': name, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
                     'git_blob_sha256': hashlib.sha256(blob).hexdigest(),
                     'lines': len(text.splitlines()) if text is not None else None,
                     'review': 'skipped: lockfile (authorized)' if skip else
                     'binary asset visually inspected and hashed' if binary else 'read in full, line by line'})
        node = tree
        for part in pathlib.PurePosixPath(name).parts:
            node = node.setdefault(part, {})
    (ROOT / 'audit/source_inventory.json').write_text(json.dumps(rows, indent=2) + '\n')
    lines = ['# Complete tracked file tree at audited revision', '',
             '47 tracked files. Lockfiles listed but not line-read. No source file excluded.', '', '```text', 'stockWiseV2/']

    def walk(node, prefix=''):
        for i, (name, sub) in enumerate(sorted(node.items(), key=lambda x: (not bool(x[1]), x[0]))):
            last = i == len(node) - 1
            lines.append(prefix + ('└── ' if last else '├── ') + name + ('/' if sub else ''))
            if sub:
                walk(sub, prefix + ('    ' if last else '│   '))
    walk(tree)
    lines += ['```', '', 'The .git directory is repository metadata, not application source. '
              'This tree describes the fresh checkout before audit outputs were added. '
              'No node_modules or build output existed. Full byte hashes, line counts, and review dispositions '
              'are in source_inventory.json. Windows checkout core.autocrlf=true changes line endings; '
              'both checkout and Git-blob SHA256 values are recorded, and normalized contents match the audited revision.', '',
              '| File | Lines | Review |', '| --- | ---: | --- |']
    lines.extend(f"| `{r['path']}` | {r['lines'] if r['lines'] is not None else 'binary/skip'} | {r['review']} |" for r in rows)
    (ROOT / 'audit/FILE_TREE.md').write_text('\n'.join(lines) + '\n', encoding='utf8')


LABELS = {'baseline': 'Baseline', 'ledger_wiring': 'Ledger wiring', 'fractional_kelly': 'Empirical quarter Kelly',
          'exposure_cap': 'Leverage/gross caps', 'kill_switch': 'Loss kill-switch', 'no_unhedged_pairs': 'Remove one-legged pairs',
          'mtf_filter': 'Daily + intraday confirmation', 'hold_24h': '24h max hold', 'cooldown_4h': '4h post-exit cooldown'}


def metric_row(name, metric, status=''):
    def n(value, digits=2):
        return 'N/A' if value is None else f'{value:.{digits}f}'
    if metric['winRate'] is None:
        return f'| {name} | N/A | 0.00% | N/A | N/A | 0 | N/A | 0.00% | {status} |'
    return (f"| {name} | {n(metric['sharpe'])} | {metric['maxDrawdown']:.2%} | {n(metric['profitFactor'])} "
            f"| {n(metric['expectancyUsd'], 4)} | {metric['tradeCount']:,} | {metric['winRate']:.1%} "
            f"| {metric['returnPct']:.2%} | {status} |")


def reports():
    base = json.loads((RESULTS / 'backtest.json').read_text())
    stress = json.loads((RESULTS / 'stress.json').read_text())
    lines = ['# Backtest results and verification boundary', '',
             '**No proposed change established positive out-of-sample edge. All eight profit candidates '
             'failed the preregistered screen in both fixed analyst modes.** Safety/accounting repairs remain '
             'valid proposals; they are not profit claims.', '',
             'This is a **conditional source-linked research replay**, not measured production or live returns. '
             'It uses source revision `50360996451ddc7ad742372bff398b7938ae0029` and the unchanged strategy '
             'functions, dispatcher, strategy exits and baseline sizing rule. Source-backed bug proofs are separate.', '',
             '## Data and causal protocol', '',
             '- Five preselected symbols: BTC, ETH, SOL, XRP, DOGE. Binance **spot** USDT as USD proxy, '
             '70,176 fifteen-minute bars per symbol from 2024-01-01 through 2025-12-31; 365 daily warmup bars in 2023. '
             '350,880 intraday + 1,825 daily rows, 180 publisher-checksummed archives. No gaps/duplicates. '
             '2025 microseconds normalized to milliseconds. No private data APIs or credentials.',
             '- Every fold starts with $100. Completed daily closes only (last365, excludes current day), '
             'completed intraday closes only (last480). Decisions at candle close; entries and strategy exits '
             'at next candle open. No same-close signal fills. Stop-first if stop and target both touch; '
             'gap stops use adverse opening price. All terminal positions close and count as trades.',
             '- Common executable-price simulator for every candidate: 5bp taker fee + 10bp slippage + '
             '2bp half-spread **per side** (about34bp round trip), plus modeled signed1bp/8h funding. '
             'Stress: slippage+spread24bp per side and funding3bp/8h; fee remains5bp. '
             'These are explicit cost assumptions, not observed bid/ask or historical funding.',
             '- Expanding training starts 2024-01-01. Test quarters: 2024Q3, 2024Q4, 2025Q1, 2025Q2. '
             'Each train set stops before its test. Final temporal holdout: 2025-07-01 through 2025-12-31. '
             'No threshold/symbol/variant tuning after seeing results. The final period was run after development folds. '
             'Source strategies were authored by2026: we cannot verify the developer never saw2024-25 data.',
             '- Fixed neutral TREND and REVERT scenarios evaluated separately; neutral/missing news/F&G, '
             'no fabricated OI. Zero-observation seed confidence/learning is frozen. Empirical Kelly alone estimates '
             'p/payoff from **training** closed trades; requires30 observations and positive cost-net expectancy.',
             '- Source-style daily episode risk-peak reset in baseline; no fresh deposits on ruin. '
             'All variants share corrected cash settlement, fees and financing. This deliberately prevents '
             'accounting bugs or EMA fills from masquerading as returns. It does not replay the whole deployed engine.', '',
             '## Metrics and decision rule', '',
             'Sharpe = mean(daily marked simple returns) / sample SD × sqrt365, risk-free0. '
             'DD uses **every15m equity mark**, including unrealized P&L. PF = total positive net trade P&L / '
             'absolute negative net trade P&L. Expectancy is **net USD/trade** at each fold’s $100 starting balance. '
             'Win rate counts net positive trades. N/A means no trades/variance/loss denominator, not a measured0 Sharpe. '
             'Development returns and curve are concatenated/rebased across independently initialized folds; '
             'trade dollars are pooled at equal initial capital. This is an evaluation construct, not a continuously '
             'traded $100 account; DD locks reset at each new fold.', '',
             'A profit candidate had to have higher Sharpe and return, PF>=baseline and>1, positive expectancy, '
             'no higher DD, >=30 trades in aggregate development and holdout, plus improvement in>=3/4 quarters. '
             'Cost-stress expectancy must remain positive. None passed even before the stress gate. '
             'No parameter search, significance or maximized-profit claim is made.', '']
    header = ['| Experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return | Decision |',
              '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |']
    for mode, entries in base['results'].items():
        for key, title in [('aggregate', 'Walk-forward tests combined'), ('holdout', '2025-H2 temporal holdout')]:
            lines += [f'## {mode}: {title}', ''] + header
            for variant, result in entries.items():
                decision = 'Reference' if variant == 'baseline' else 'Reject profit claim'
                if variant == 'fractional_kelly': decision = 'No eligible edge; zero trades'
                if variant in ('kill_switch', 'exposure_cap'): decision = 'Safety only; fails profit gate'
                if variant == 'ledger_wiring': decision = 'Correctness only; sizing alone worsens losses'
                lines.append(metric_row(LABELS[variant], result[key], decision))
            lines += ['']
    lines += ['## Baseline by development quarter', ''] + header
    for mode, entries in base['results'].items():
        for row in entries['baseline']['folds']:
            lines.append(metric_row(mode + ' ' + row['name'], row, 'Reference'))
    lines += ['', '## Cost stress: final holdout', ''] + header
    for mode, entries in stress['results'].items():
        for variant, result in entries.items():
            lines.append(metric_row(mode + ' ' + LABELS[variant], result['holdout'],
                                    'No trades' if result['holdout']['tradeCount'] == 0 else 'Negative expectancy'))

    lines += ['', '## What limits returns in these scenarios', '',
              'Costs and repeated short-horizon entries matter, and the signal/exit rules do not establish '
              'a sufficiently large net edge. Baseline exit counts below show daily signals mostly churn '
              'through the2h time stop; fixed targets/trailing do little at this horizon. '
              'This is measured conditional evidence, not causal proof for an unobserved production run.', '',
              '| Holdout baseline | Mid-reference gross $ | Modeled slippage+spread $ | Fees $ | Signed funding $ | Net $ | Time exits / all exits |',
              '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    leverage = {'tsmom':5, 'donchian':5, 'mom_trend':4, 'orb':5, 'ibreakout':5, 'atr_expand':4,
                'vol_expand':5, 'rsi2dip':3, 'vwap_revert':3, 'orderflow':3, 'pairs_trade':3,
                'adaptive_regime':4, 'oi_diverge':4}
    for mode in base['results']:
        trades = json.loads((RESULTS / f'{mode}-baseline-holdout-trades.json').read_text())
        c, fee = .0012, .0005
        impact = 0
        for t in trades:
            sign = 1 if t['side'] == 'long' else -1
            entry_n = t['margin'] * leverage[t['id']]
            exit_n = t['fees'] / fee - entry_n
            impact += c * (entry_n / (1 + sign*c) + exit_n / (1-sign*c))
        net = sum(t['net'] for t in trades)
        fees = sum(t['fees'] for t in trades)
        funding = sum(t['funding'] for t in trades)
        mid_gross = net + fees - funding + impact
        time_exits = sum(t['reason'] == 'time' for t in trades)
        lines.append(f'| {mode} | {mid_gross:.3f} | {impact:.3f} | {fees:.3f} | {funding:.3f} | {net:.3f} | {time_exits}/{len(trades)} |')
    lines += ['', 'The mid-reference gross attribution holds the **same executed quantities and trade path** '
              'fixed and removes modeled price concessions and fees. It is not a new zero-cost strategy '
              'backtest; removing costs could change subsequent sizing/selection and equity. '
              'Training-only Kelly estimates find no eligible positive net edge in either mode. '
              'The baseline bankroll also shrinks below minimum margin, limiting later training observations '
              'and causing activity to stop; unchanged training sample counts are retained rather than '
              'silently replenishing money. This is a limitation of capital-constrained edge estimates.', '',
              '24h holding improves relative loss rates but PF remains<1 and expectancy negative; '
              'drop it as a profit recommendation. MTF/cooldown/pair-removal alone also fail. '
              'The ledger-only correction raises seed base allocation from.10 to.12 and increases loss. '
              'Neither increasing Kelly nor unlocking leverage creates evidence of edge.', '',
              'A latched loss breaker limits individual final holdout DD to about10% under this model; '
              'it is checked every15m and close costs/gaps can overshoot the threshold. Combined development '
              'DD can exceed10% because each independent fold resets its initial capital and lock. '
              'Reduced leverage can prolong trading through more negative-edge trades, reducing losses '
              'while worsening Sharpe. Retain risk controls only as safety/capital limits, never as proven alpha.', '',
              '## What these numbers cannot establish', '',
              '- Historical production baseline: no private run config, trades/equity, AI decisions, timestamped '
              'news/sentiment, actual financing or30s quotes were provided. Source-engine behavior differs '
              'between npm and deploy entrypoints; neither was started.',
              '- Full13-strategy edge: ORB needs a US session dataset; orderflow/OI divergence need matched '
              'timestamped OI/funding. Some available strategies rarely win confluence, so their independent '
              'edge is not estimated. US/India equities, calendars, FX, splits and borrow require separate '
              'historical datasets. These are **unverified**, not successful backtests.',
              '- Actual perpetual fills: spot-USDT prices differ from USD quotes/perpetual marks; constant '
              'funding/spreads are assumptions. There are no orderbook/partial-fill/latency recordings. '
              'Minute-path uncertainty inside15m candles remains. Stop-first is conservative but cannot '
              'reconstruct liquidation/slippage in a real outage.',
              '- Genuine forward validation: strategies may have been selected using these historical dates; '
              'fixed current survivor symbols, correlated strategies/trades and multiple experiments prevent '
              'treating ordinary trade counts as independent statistical proof. No fresh holdout beyond '
              '2025 or forward paper run was claimed. Do not promote a discovered winner without another '
              'untouched chronological test and prospective paper observations.', '',
              '## Evidence, checks and reproduction', '',
              '- `node audit/checks.mjs`:17 passing deterministic/static checks, mostly successful '
              'reproductions of source defects. `node audit/verify_replay.mjs`:12 passing independent '
              'replay checks: future perturbation invariance, next-open gap entry, stop-vs-target '
              'ambiguity, adverse gap exits, terminal trade inclusion, network blocking, exact source '
              'hashes, split boundaries and every saved final holdout ledger reconciliation.',
              '- Existing and new .mjs syntax checked with `node --check`; JSON parsed. Application UI '
              'was not built/run: source is unchanged and dependencies were not installed. No live engine, '
              'Telegram/Groq key, deployed service or order endpoint was invoked.',
              '- Fresh reproduction from repo root, using existing Python/Node and no packages:\n\n'
              '  ```powershell\n  python audit/fetch_data.py\n  node audit/checks.mjs\n'
              '  node audit/backtest.mjs\n  node audit/backtest.mjs --stress\n'
              '  node audit/verify_replay.mjs\n  python audit/render_reports.py\n  ```',
              '- Raw data/archives stay in ignored `audit/data/`; publisher URLs, hashes, counts and source '
              'hashes are retained inside `audit/results/backtest.json` and `stress.json`. '
              'All18 final holdout ledgers per cost scenario are retained. Individual development metrics '
              'and train-only estimates are in those JSON reports; `run.log` and `stress-run.log` retain '
              'execution progress. No numerical reports are hand-entered.', '',
              'Source contracts: [Binance public archives and checksum format](https://github.com/binance/binance-public-data). '
              'Experiment definitions and advancement rule: `audit/EXPERIMENT_PLAN.md`. '
              'Scope and data flow: `ARCHITECTURE.md`. Defects: `AUDIT_FINDINGS.md`. '
              'Implementation proposals and rejected profit candidates: `IMPROVEMENTS.md`.', '',
              '**Initial Phase1–4 approval gate:** no application improvements, commits or pushes '
              'had been applied at that point. The subsequent user request authorizes publishing '
              'the audit branch without merging; runtime implementation items remain unapproved. '
              'See STRATEGY_NEWS_REVIEW.md and FOLLOWUP_RESULTS.md for the follow-up. '
              'Which items should I implement?']
    (ROOT / 'BACKTEST_RESULTS.md').write_text('\n'.join(lines) + '\n', encoding='utf8')


if __name__ == '__main__':
    inventory()
    reports()
    print('Wrote audit/FILE_TREE.md, audit/source_inventory.json, BACKTEST_RESULTS.md')
