// Public RSS GETs only. Never contacts Groq, Telegram, deployment or private APIs.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,BASELINE_ROOT} from './source_adapter.mjs';
const source = fs.readFileSync(path.join(BASELINE_ROOT, 'scripts/v2/world.mjs'), 'utf8');
const parseSource = source.slice(source.indexOf('function parseTitles('), source.indexOf('// ── Individual source fetchers'));
const parseTitles = new Function(parseSource + '\nreturn parseTitles;')();
const urls = ['https://cointelegraph.com/rss', 'https://decrypt.co/feed', 'https://www.federalreserve.gov/feeds/press_all.xml'];
const observedAt = new Date().toISOString();
const results = await Promise.all(urls.map(async url => {
  const begun = performance.now();
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(15_000),
      headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}});
    const xml = await res.text();
    const dates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/gi)].map(m => Date.parse(m[1])).filter(Number.isFinite);
    return {url, observedAt, status: res.status, contentType: res.headers.get('content-type'),
      elapsedMs: Math.round(performance.now() - begun), bytes: Buffer.byteLength(xml),
      itemBlocks: [...xml.matchAll(/<item[\s>]/gi)].length,
      parsedTitles: res.ok ? parseTitles(xml).length : 0,
      newestPublicationUTC: dates.length ? new Date(Math.max(...dates)).toISOString() : null};
  } catch (error) {
    return {url, observedAt, status: null, elapsedMs: Math.round(performance.now() - begun),
      error: error.name + ': ' + error.message, parsedTitles: 0};
  }
}));
const report = {scope: 'Public feeds observed from audit machine only, not production server; no headline bodies retained', results};
fs.writeFileSync(path.join(ROOT, 'audit/results/news-feed-probe.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
