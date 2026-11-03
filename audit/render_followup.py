"""Render follow-up tables and validate retained trade ledgers; no network."""
import collections
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'audit/results'
LABEL = {'baseline': 'Baseline', 'symmetric_confidence': 'Symmetric confidence',
         'all_pools': 'All pools', 'symmetric_all_pools': 'Symmetric + all pools'}


def main():
    report = json.loads((OUT / 'followup-research.json').read_text())
    checks = []

    def check(name, condition):
        assert condition, name
        checks.append({'name': name, 'status': 'PASS'})

    def matches_source(name, digest):
        raw = (ROOT / name).read_bytes()
        lf = raw.replace(b'\r\n', b'\n')
        return digest in {hashlib.sha256(p).hexdigest() for p in (raw, lf, lf.replace(b'\n', b'\r\n'))}

    check('Follow-up source content hashes match (LF/CRLF checkout differences allowed)', all(
        matches_source(name, digest) for name, digest in report['sourceHashes'].items()))
    check('Additional data hashes/counts and strictly pre-October endpoint match manifest', all(
        hashlib.sha256((ROOT / 'audit/data' / f['file']).read_bytes()).hexdigest() == f['sha256']
        and f['rows'] == 26208 and f['last'] == 1790811900000
        for f in report['manifest']['files']))
    check('Three chronological test folds are nonoverlapping with explicit January warmup',
          report['folds'] == [['2026Q1_partial', '2026-01-06', '2026-04-01'],
                              ['2026Q2', '2026-04-01', '2026-07-01'], ['2026Q3', '2026-07-01', '2026-10-01']])
    consistent = True
    for cost, modes in report['results'].items():
        for mode, variants in modes.items():
            for variant, result in variants.items():
                trades = json.loads((OUT / f'followup-{cost}-{mode}-{variant}-trades.json').read_text())
                for fold in result['folds']:
                    ts = [t for t in trades if t['fold'] == fold['name']]
                    pnl = sum(t['net'] for t in ts)
                    consistent &= len(ts) == fold['metrics']['tradeCount']
                    consistent &= abs(100 + pnl - fold['metrics']['finalEquity']) < 1e-7
                    consistent &= abs(pnl / len(ts) - fold['metrics']['expectancyUsd']) < 1e-7
                    consistent &= all(abs(t['net'] - (t['gross'] - t['fees'] + t['funding'])) < 1e-7 for t in ts if t['reason'] != 'liquidation')
    check('Every saved follow-up trade count/expectancy/cash ledger reconciles by independent fold', consistent)
    check('All-pool controls give identical TREND/REVERT outcomes as expected', all(
        report['results'][cost]['TREND'][variant]['aggregate'] == report['results'][cost]['REVERT'][variant]['aggregate']
        for cost in ('base', 'stress') for variant in ('all_pools', 'symmetric_all_pools')))
    check('No follow-up profit candidate passes its complete screen', all(
        not r['profitScreenPassed'] for mode in report['results']['base'].values()
        for variant, r in mode.items() if variant != 'baseline'))
    (OUT / 'followup-checks.json').write_text(json.dumps(checks, indent=2) + '\n')

    participation = {}
    seeds = json.loads((ROOT / 'data/strategies.json').read_text())
    for mode in ('TREND', 'REVERT'):
        ts = json.loads((OUT / f'{mode}-baseline-holdout-trades.json').read_text())
        participation[mode] = {'scope': 'original conditional 2025-H2 baseline, not production',
                               'total': len(ts), 'sides': dict(collections.Counter(t['side'] for t in ts)),
                               'primaryStrategy': {s['id']: dict(collections.Counter(t['side'] for t in ts if t['id'] == s['id'])) for s in seeds}}
    (OUT / 'strategy-participation.json').write_text(json.dumps(participation, indent=2) + '\n')

    lines = ['# Follow-up historical results: strategy participation and direction bias', '',
             '**Symmetric heuristic confidence, scanning all pools, and their combination failed the profit screen. '
             'None is approved or recommended as a profit improvement.**', '',
             'Source remains `50360996451ddc7ad742372bff398b7938ae0029`. Only research copies were modified in memory. '
             'This follows the user’s request to investigate inactive strategies, direction bias and news. '
             'Source-backed explanations and five additional proposals are in STRATEGY_NEWS_REVIEW.md.', '',
             '## Method and limits', '',
             '- Plan: `audit/FOLLOWUP_EXPERIMENT_PLAN.md`, written before the additional download/run. '
             'No hyperparameter search or retuning after seeing these results.',
             '- Additional data: 45 publisher-checksummed Binance public spot archives; '
             '5 ×26,208 =131,040 fifteen-minute candles from2026-01-01 to2026-09-30. '
             'Completed2025 daily bars provide365-day warmup; first5 January days provide intraday warmup. '
             'Test windows are Jan6–Mar31, Apr1–Jun30 and Jul1–Sep30, each starting with$100.',
             '- This period was unused by the initial audit, but the source was authored in October2026; '
             'we cannot prove the developer had not seen2026 prices. It is additional chronological historical '
             'evidence, not a genuinely prospective holdout or production performance.',
             '- Same original source signal functions/dispatcher/sizing, frozen seed learning, fixed neutral '
             'TREND/REVERT and missing OI/news inputs. Same next-open entries, conservative stop/gap handling, '
             'terminal trade counting and exact all-cost cash reconciliation as original research replay.',
             '- Base cost:5bp fee +10bp slippage +2bp half-spread per side, signed modeled1bp/8h funding. '
             'Stress:5bp fee +24bp price concession per side and3bp/8h funding. Spot/USD proxy and missing '
             'actual execution/funding/AI inputs remain limitations.',
             '- Symmetric confidence raises each short’s heuristic confidence to its long counterpart; '
             'all-pools sets seed pool tags to both in memory. No indicator, stop, target, size, exposure '
             'or execution rule was tuned. Missing US/OI inputs remain missing. These are not calibrated '
             'probability models and do not test sub-minute trading.',
             '- Advancement requires higher aggregate Sharpe/return, PF>=baseline and>1, positive expectancy, '
             'no higher DD, >=30 trades, positive expectancy in>=2/3 quarters and under stress. '
             'All candidates fail. Marked-daily Sharpe uses sqrt365; DD uses every15m mark; expectancy '
             'is net USD/trade at each fold’s$100 start. Aggregate curves concatenate/rebase independent '
             'fold returns, so their DD is not a single continuously traded production account.', '']
    header = ['| Mode / experiment | Sharpe | Max DD | PF | Exp. $/trade | Trades | Win rate | Return |',
              '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']

    def row(name, m):
        return (f"| {name} | {m['sharpe']:.2f} | {m['maxDrawdown']:.2%} | {m['profitFactor']:.2f} "
                f"| {m['expectancyUsd']:.4f} | {m['tradeCount']:,} | {m['winRate']:.1%} | {m['returnPct']:.2%} |")

    lines += ['## Base costs: all three test windows combined', ''] + header
    for mode, variants in report['results']['base'].items():
        for variant, result in variants.items():
            lines.append(row(mode + ' / ' + LABEL[variant], result['aggregate']))
    lines += ['', '## Base costs: final test quarter,2026-Q3', ''] + header
    for mode, variants in report['results']['base'].items():
        for variant, result in variants.items():
            lines.append(row(mode + ' / ' + LABEL[variant], result['folds'][-1]['metrics']))
    lines += ['', '## Every test quarter: base costs', ''] + header
    for mode, variants in report['results']['base'].items():
        for variant, result in variants.items():
            for fold in result['folds']:
                lines.append(row(mode + ' / ' + LABEL[variant] + ' / ' + fold['name'], fold['metrics']))
    lines += ['', '## Stress costs: all test windows combined', ''] + header
    for mode, variants in report['results']['stress'].items():
        for variant, result in variants.items():
            lines.append(row(mode + ' / ' + LABEL[variant], result['aggregate']))
    lines += ['', '## Participation and direction: base costs', '',
              '| Mode / experiment | Long trades | Short trades | Long share | Primary strategies selected |',
              '| --- | ---: | ---: | ---: | ---: |']
    for mode, variants in report['results']['base'].items():
        for variant, result in variants.items():
            long = sum(p['long'] for p in result['participation'].values())
            short = sum(p['short'] for p in result['participation'].values())
            lines.append(f"| {mode} / {LABEL[variant]} | {long:,} | {short:,} | {long/(long+short):.1%} | {len(result['participation'])} |")
    lines += ['', 'Counts describe primary attribution under a conditional data model. They do not measure '
              'all raw signals or production participation. More strategies/orders and a different side '
              'mix did not establish positive net edge. Scanning all pools intentionally erases the fixed '
              'TREND/REVERT pool distinction, hence identical outcomes between those two labels.', '',
              '## Verification and next action', '',
              '`audit/results/followup-checks.json` contains six passing integrity/reconciliation checks. '
              '`routing-news-checks.json` contains16 new passing source fixtures/static checks. Together '
              'with the original29 checks,51 checks pass. Passing a bug reproduction confirms the issue; '
              'it does not mean a runtime fix was applied.', '',
              'Machine-readable metrics, per-quarter participation, source/data hashes and archive URLs '
              'are in `audit/results/followup-research.json`; all16 scenario/mode/variant trade ledgers '
              'are retained. Source adapter and original replay hashes remain unchanged.', '',
              'Reproduce the follow-up from the repository root:', '',
              '```powershell', 'node audit/routing_news_checks.mjs',
              'node audit/probe_news.mjs  # optional public-feed observation; results change over time',
              'python audit/fetch_followup_data.py', 'node audit/followup_research.mjs',
              'python audit/render_followup.py', '```', '',
              'Reject these parameter/pool toggles as profit changes. Prioritize reliable accounting, '
              'risk locks, decision tracing and news provenance, then collect point-in-time data for '
              'proper cost-net calibration. Frequent-order research requires executable quote/depth '
              'data and an independent prospective paper test. No runtime strategy changes, live orders, '
              'key changes, deployments or merges were performed. Audit-branch publication was explicitly '
              'authorized by the user.']
    (ROOT / 'FOLLOWUP_RESULTS.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
    for c in checks:
        print(c['status'], c['name'])


if __name__ == '__main__':
    main()
