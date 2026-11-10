// News collector is read-only, keyless and independent of the paper risk loop.
import {readPublic} from './http.mjs';
import {parseFeed,balancedNews} from './news.mjs';
export const NEWS_SOURCES=[
 {id:'cointelegraph',kind:'crypto',url:'https://cointelegraph.com/rss'},
 {id:'decrypt',kind:'crypto',url:'https://decrypt.co/feed'},
 {id:'fed',kind:'fed',url:'https://www.federalreserve.gov/feeds/press_all.xml'},
 {id:'equity',kind:'equity',url:'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY&region=US&lang=en-US'}];
export function createWorldCollector({fetchText=url=>readPublic(url,{timeoutMs:5000,retries:0}),sources=NEWS_SOURCES,clock=Date.now,ttlMs=600000}={}) {
 const cache=new Map(),firstSeen=new Map();
 return async()=>{
  const at=clock(),health=[];
  await Promise.all(sources.map(async source=>{
   const prior=cache.get(source.id);
   if(prior&&at-prior.at<ttlMs){health.push({source:source.id,status:'cached',lastSuccess:prior.at,ageMs:at-prior.at,count:prior.items.length});return;}
   try {
    const xml=await fetchText(source.url);
    const receivedAt=clock();
    const items=parseFeed(xml,{source:source.id,kind:source.kind,observedAt:receivedAt});
    for(const item of items){if(!firstSeen.has(item.id))firstSeen.set(item.id,item.observedAt);item.observedAt=firstSeen.get(item.id);}
    cache.set(source.id,{at:receivedAt,items});health.push({source:source.id,status:'ok',lastSuccess:receivedAt,ageMs:0,count:items.length});
   }catch{health.push({source:source.id,status:'error',lastSuccess:prior?.at??null,ageMs:prior?clock()-prior.at:null});}
  }));
  const completedAt=clock();
  const items=balancedNews(sources.map(s=>cache.get(s.id)?.items||[]),{at:completedAt});
  // IDs older than the news horizon cannot return as fresh observations.
  for(const [id,ts] of firstSeen)if(completedAt-ts>172800000)firstSeen.delete(id);
  return {ts:completedAt,deep_due:completedAt,news:items,newsHealth:health,headlines:items.filter(i=>i.kind!=='fed').map(i=>i.title),fed:items.filter(i=>i.kind==='fed').map(i=>i.title),
   thesis:'Timestamped source-balanced news context; predictive value unvalidated',regime:'unknown',risk_posture:'evidence_required'};
 };
}
const collect=createWorldCollector();
export async function collectWorld(){return collect();}
