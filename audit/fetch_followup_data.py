"""Additional public 2026 historical data, leaving original audit inputs intact."""
import concurrent.futures
import hashlib
import json
from fetch_data import archive, OUT, SYMBOLS


def main():
    jobs = [(s, 2026, m, '15m') for s in SYMBOLS for m in range(1, 10)]
    collected = {s: [] for s in SYMBOLS}
    sources = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for n, (symbol, _, bars, metadata) in enumerate(pool.map(archive, jobs), 1):
            collected[symbol].extend(bars)
            sources.append(metadata)
            if n % 10 == 0:
                print(f'Validated {n}/{len(jobs)} additional archives', flush=True)
    files = []
    for symbol, bars in collected.items():
        bars.sort(key=lambda b: b[0])
        assert len(bars) == 26208
        assert all(b[0] - a[0] == 900000 for a, b in zip(bars, bars[1:]))
        name = symbol + '_15m_2026.json'
        payload = json.dumps(bars, separators=(',', ':')).encode()
        (OUT / name).write_bytes(payload)
        files.append({'file': name, 'rows': len(bars), 'sha256': hashlib.sha256(payload).hexdigest(),
                      'first': bars[0][0], 'last': bars[-1][0], 'gaps': []})
    (OUT / 'followup_manifest.json').write_text(json.dumps({'files': files, 'archives': sources}, indent=2) + '\n')
    print('Additional input manifest saved; original inputs unchanged.')


if __name__ == '__main__':
    main()
