"""Download only public Binance historical archives; standard library, no credentials.

Run from the repository root: python audit/fetch_data.py
Output stays inside audit/data; checksums and provenance are retained.
"""
import concurrent.futures
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import time
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'data'
SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']


def retrieve(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def archive(job):
    symbol, year, month, interval = job
    name = f'{symbol}USDT-{interval}-{year}-{month:02d}.zip'
    url = f'https://data.binance.vision/data/spot/monthly/klines/{symbol}USDT/{interval}/{name}'
    target = OUT / 'archives' / name
    checksum_path = target.with_suffix('.zip.CHECKSUM')
    raw = target.read_bytes() if target.exists() else retrieve(url)
    check = checksum_path.read_bytes() if checksum_path.exists() else retrieve(url + '.CHECKSUM')
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == check.decode().split()[0], f'checksum mismatch: {name}'
    target.write_bytes(raw)
    checksum_path.write_bytes(check)
    with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
        text = zipped.read(zipped.namelist()[0]).decode()
    bars = []
    for row in csv.reader(io.StringIO(text)):
        ts = int(row[0])
        if ts > 100_000_000_000_000:  # Binance spot switches to microseconds in 2025.
            ts //= 1000
        o, h, l, c, v = map(float, row[1:6])
        assert all(x > 0 for x in (o, h, l, c)) and v >= 0
        assert l <= min(o, c) <= max(o, c) <= h
        bars.append([ts, o, h, l, c, v])
    return symbol, interval, bars, {'url': url, 'sha256': digest, 'rows': len(bars)}


def main():
    (OUT / 'archives').mkdir(parents=True, exist_ok=True)
    # 2023 daily warmup; 2024-2025 15-minute replay, complete calendar years.
    jobs = [(s, 2023, m, '1d') for s in SYMBOLS for m in range(1, 13)]
    jobs += [(s, y, m, '15m') for s in SYMBOLS for y in (2024, 2025) for m in range(1, 13)]
    collected = {(s, i): [] for s in SYMBOLS for i in ('1d', '15m')}
    provenance = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for n, (symbol, interval, bars, source) in enumerate(pool.map(archive, jobs), 1):
            collected[symbol, interval].extend(bars)
            provenance.append(source)
            if n % 20 == 0:
                print(f'Validated {n}/{len(jobs)} archives', flush=True)
    files = []
    for (symbol, interval), bars in collected.items():
        bars.sort(key=lambda b: b[0])
        step = 86_400_000 if interval == '1d' else 900_000
        gaps = [[a[0], b[0]] for a, b in zip(bars, bars[1:]) if b[0] - a[0] != step]
        assert not gaps, f'gaps/duplicates in {symbol}/{interval}: {gaps[:4]}'
        payload = json.dumps(bars, separators=(',', ':')).encode()
        name = f'{symbol}_{interval}.json'
        (OUT / name).write_bytes(payload)
        files.append({'file': name, 'sha256': hashlib.sha256(payload).hexdigest(),
                      'rows': len(bars), 'first': bars[0][0], 'last': bars[-1][0], 'gaps': gaps})
    manifest = {'downloaded_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
                'source': 'Binance public spot archives; USDT treated as USD proxy',
                'schema': ['open_time_ms', 'open', 'high', 'low', 'close', 'volume_base'],
                'files': files, 'archives': sorted(provenance, key=lambda p: p['url'])}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(files, indent=2))


if __name__ == '__main__':
    main()
