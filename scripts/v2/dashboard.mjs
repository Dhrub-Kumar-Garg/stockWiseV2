// Server-only boundary: configuration and unknown fields never reach the client.
import {createHash, timingSafeEqual} from 'node:crypto';
export function dashboardAccess(headers, env = process.env) {
  const secret = env.STOCKWISE_DASHBOARD_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) return {ok: false, status: 503, error: 'Dashboard access is not configured'};
  const authorization = headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 4096) return {ok: false, status: 401, error: 'Authentication required'};
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(authorization.slice(7)), hash(secret)) ? {ok: true, status: 200} : {ok: false, status: 401, error: 'Authentication required'};
}
const scalars = (object, keys) => Object.fromEntries(keys.split(' ').filter(key => {
  const value = object?.[key];
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string';
}).map(key => [key, typeof object[key] === 'string' ? object[key].slice(0, 1000) : object[key]]));
const rows = (value, keys, limit = 100) => Array.isArray(value) ? value.slice(-limit).map(row => scalars(row, keys)) : [];
export function dashboardDTO(input = {}, serverTs = Date.now()) {
  const sig = input.signals || {};
  const signals = scalars(sig, 'ts iso version mode episodeNum equity walletBalance startingCapital totalPnl totalNetPnl totalPnlPct progressPct goalGap realizedPnlEpisode peakEquity maxDrawdownPct riskState regime generation fundingRate investedNotional grossLeverage');
  signals.shadowBooks=rows(sig.shadowBooks,'id strategy_id symbol family equity tradeCount netPnl pending lastReason',500);
  signals.decisionTraces=rows(sig.decisionTraces,'ts symbol strategy_id side pool market stage reason rawConfidence',100);
  signals.decisionCounters=rows(sig.decisionCounters,'strategy_id evaluated raw vetoed selected filled lastAt lastReason',100);
  signals.health = scalars(sig.health, 'status validQuotes totalQuotes lastTick');
  signals.goal = scalars(sig.goal, 'target deadlineHours startEquity startedAt');
  signals.aggression = scalars(sig.aggression, 'kellyFraction leverageCap leverageCeiling unlockedLevel');
  signals.lifetime = scalars(sig.lifetime, 'episodes totalBlowups bestEpisodeReturnPct bestEquityEver initialCapital');
  signals.positions = rows(sig.positions, 'symbol name market side leverage notional margin entry mark liqPrice uPnl roiPct fundingAccrued strategy_id setup_tag stopPct targetPct reason');
  signals.watch = rows(sig.watch, 'symbol name market icon price changePct trend rsi bias stale');
  signals.analyst = scalars(sig.analyst, 'mode direction_bias aggression reasoning ts stale');
  signals.world = {newsHealth:rows(sig.world?.newsHealth,'source status lastSuccess ageMs count',20),news:rows(sig.world?.news,'id title source kind url publishedAt observedAt',20),...scalars(sig.world, 'regime risk_posture fundingRate whaleCrowd oiUsd thesis deep_due'),
    fearGreedCrypto: scalars(sig.world?.fearGreedCrypto, 'value band'), fearGreedStocks: scalars(sig.world?.fearGreedStocks, 'value band'),
    newsMood: scalars(sig.world?.newsMood, 'mean_s dispersion impact n mixed'),
    headlines: Array.isArray(sig.world?.headlines) ? sig.world.headlines.slice(0, 5).filter(x => typeof x === 'string').map(x => x.slice(0, 250)) : [],
    fed: Array.isArray(sig.world?.fed) ? sig.world.fed.slice(0, 5).filter(x => typeof x === 'string').map(x => x.slice(0, 250)) : []};
  const strategies = (Array.isArray(input.strategies) ? input.strategies : []).slice(0, 100).map(s => ({
    ...scalars(s, 'id name setup_tag pool text status baseLev stopPct targetPct'), learned: scalars(s.learned, 'n expectancy_R win_rate kelly confidence pf profitFactor dsr')}));
  return {v2: {signals, strategies, serverTs,
    episodes: rows(input.episodes, 'episodeNum startingCapital finalEquity peakEquity returnPct maxDrawdownPct blownUp endReason generation endedAt', 40),
    generations: rows(input.generations, 'generation episodeNum afterEpisode leverageCap kellyFraction unlockedLevel note ts', 30),
    memory: rows(input.memory, 'type kind title text lesson importance regime strategy_id ts', 20),
    equity: rows(input.equity, 'ts equity netEquity wallet margin uPnl positions dd regime riskState episode', 2000),
    trades: rows(input.trades, 'type trade_id symbol market strategy_id side price margin leverage notional fee entryPrice exitPrice net_pnl realized_R roi_on_margin exit_reason regime openedAt closedAt ts', 100)}};
}
