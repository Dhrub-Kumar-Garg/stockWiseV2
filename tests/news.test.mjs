import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,balancedNews,pointInTimeNews,decodeText} from '../scripts/v2/news.mjs';
import {createWorldCollector} from '../scripts/v2/world.mjs';
import {buildPrompt} from '../scripts/v2/analyst.mjs';
const at=Date.UTC(2026,0,2),date=new Date(at-1000).toUTCString();
const rss=(title='Bitcoin rally')=>`<rss><channel><title>Feed</title><item><title><![CDATA[${title} &amp; &#x26;]]></title><dc:date>${new Date(at-1000).toISOString()}</dc:date><guid>abc</guid><link>https://example.com/a?utm_source=x</link></item></channel></rss>`;
test('RSS CDATA/namespaces/entities and Atom preserve event/observation times and assets',()=>{
 const rows=parseFeed(rss(),{source:'a',observedAt:at});assert.equal(rows.length,1);assert.equal(rows[0].title,'Bitcoin rally & &');assert.deepEqual(rows[0].assets,['BTC']);assert.equal(rows[0].url,'https://example.com/a');
 const atom=`<feed><entry><title>Apple earnings</title><published>${date}</published><link href="https://example.com/apple"/><id>z</id></entry></feed>`;
 assert.equal(parseFeed(atom,{source:'equity',kind:'equity',observedAt:at})[0].assets[0],'AAPL');assert.equal(decodeText('&#99999999;'),'');
});
test('future/stale/undated stories and unsafe XML cannot enter point-in-time inputs',()=>{
 assert.equal(parseFeed(rss(),{source:'a',observedAt:at-2000}).length,0);assert.equal(parseFeed(rss(),{source:'a',observedAt:at+86400000}).length,0);
 assert.throws(()=>parseFeed('<!DOCTYPE a><rss/>',{source:'a'}));const rows=parseFeed(rss(),{source:'a',observedAt:at});assert.equal(pointInTimeNews(rows,at-1).length,0);
});
test('syndication dedup and round robin retain Fed/equity/second-feed coverage',()=>{
 const group=s=>Array.from({length:30},(_,i)=>({...parseFeed(rss(s+i),{source:s,observedAt:at})[0]}));
 const a=group('a'),b=group('b'),fed=group('Fed');b[0]=a[0];const rows=balancedNews([a,b,fed],{at,perSource:2});
 assert.equal(rows.length,6);assert.equal(rows.filter(r=>r.source==='Fed').length,2);
});
test('outage is explicit and old cache cannot gain a fresh observation time',async()=>{
 let now=at,fail=false;const collect=createWorldCollector({clock:()=>now,ttlMs:10,sources:[{id:'fed',kind:'fed',url:'https://example.com'}],fetchText:async()=>{if(fail)throw new Error();return rss('Fed rates');}});
 const first=await collect();now+=20;const repeat=await collect();assert.equal(repeat.news[0].observedAt,first.news[0].observedAt);
 fail=true;now+=20;const outage=await collect();assert.equal(outage.newsHealth[0].status,'error');now+=86400000;assert.equal((await collect()).news.length,0);
 assert.match(buildPrompt({},first),/Federal Reserve Releases/);assert.match(buildPrompt({},first),/Fed rates/);
});

test('the first refresh includes news received after the fetch began', async () => {
  let now = at;
  const collect = createWorldCollector({
    clock: () => now,
    sources: [{ id: 'crypto', kind: 'crypto', url: 'https://example.com' }],
    fetchText: async () => {
      now += 500;
      return rss();
    },
  });

  const digest = await collect();
  assert.equal(digest.ts, at + 500);
  assert.equal(digest.newsHealth[0].lastSuccess, at + 500);
  assert.equal(digest.news.length, 1);
  assert.equal(digest.news[0].observedAt, at + 500);
});
