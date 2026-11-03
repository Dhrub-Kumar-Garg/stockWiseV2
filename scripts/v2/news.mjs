import {createHash} from 'node:crypto';
// Bounded RSS/Atom subset. Reject DTD/entities; no XML external resource resolution.
const strip=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ');
export function decodeText(s='') {
  return strip(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,x)=>{
    if(x[0]==='#'){const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):parseInt(x.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[x.toLowerCase()];
  }).replace(/\s+/g,' ').trim();
}
function field(block,name){return block.match(new RegExp('<(?:[\\w-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+name+'>','i'))?.[1]||'';}
export function assetTags(title,kind='crypto') {
  const assets=[];for(const [id,re] of [['BTC',/\b(bitcoin|btc)\b/i],['ETH',/\b(ethereum|ether|eth)\b/i],['SOL',/\b(solana|sol)\b/i],['XRP',/\b(ripple|xrp)\b/i],['DOGE',/\b(dogecoin|doge)\b/i],['AAPL',/\b(apple|aapl)\b/i],['NVDA',/\b(nvidia|nvda)\b/i],['TSLA',/\b(tesla|tsla)\b/i]])if(re.test(title))assets.push(id);
  return assets.length?assets:[kind==='fed'?'MACRO':kind==='equity'?'EQUITY':'CRYPTO'];
}
export function parseFeed(xml,{source,kind='crypto',observedAt=Date.now(),maxAgeMs=86400000}={}) {
  if(typeof xml!=='string'||Buffer.byteLength(xml)>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsafe/oversize feed');
  const blocks=[...xml.matchAll(/<(?:[\w-]+:)?(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?\1>/gi)].slice(0,200);
  if(!blocks.length&&!/<(?:rss|feed)\b/i.test(xml))throw new Error('Malformed feed');
  const out=[];
  for(const [,type,block] of blocks) {
    const title=decodeText(field(block,'title')).slice(0,500),publishedAt=Date.parse(decodeText(field(block,'pubDate')||field(block,'published')||field(block,'date')||field(block,'updated')));
    let link=decodeText(field(block,'link'));
    if(type.toLowerCase()==='entry')link=block.match(/<(?:[\w-]+:)?link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]||link;
    try {const u=new URL(link);if(!['https:','http:'].includes(u.protocol))link='';else{u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);link=u.href;}}catch{link='';}
    if(!title||!Number.isFinite(publishedAt)||publishedAt>observedAt||observedAt-publishedAt>maxAgeMs)continue;
    const fingerprint=createHash('sha256').update(title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()).digest('hex');
    const id=createHash('sha256').update(source+'|'+decodeText(field(block,'guid')||field(block,'id'))+'|'+fingerprint+'|'+publishedAt).digest('hex');
    out.push({id,fingerprint,title,source,kind,url:link,publishedAt,observedAt,assets:assetTags(title,kind)});
  }
  return out;
}
export function balancedNews(groups,{at=Date.now(),perSource=5,maxAgeMs=86400000}={}) {
  const seen=new Set(),rows=[];
  // Round-robin prevents a busy feed from monopolizing the result.
  const queues=groups.map(g=>g.filter(x=>x.publishedAt<=at&&x.observedAt<=at&&at-x.publishedAt<=maxAgeMs).sort((a,b)=>b.publishedAt-a.publishedAt));
  for(let i=0;i<perSource;i++)for(const q of queues){let item;while(q.length){const next=q.shift();if(!seen.has(next.fingerprint)){item=next;break;}}if(item){seen.add(item.fingerprint);rows.push(item);}}
  return rows;
}
export function pointInTimeNews(rows,at){return rows.filter(r=>r.publishedAt<=at&&r.observedAt<=at);}
