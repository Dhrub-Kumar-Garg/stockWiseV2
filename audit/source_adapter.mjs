// Audit-only adapter. Evaluate source declarations with an in-memory store and
// injected clock. Never import an application entrypoint or Telegram module.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib.mjs';
import * as P from '../scripts/v2/perp.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const clone = x => structuredClone(x);
export const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
const permitted = new Set(['strategies', 'sizing', 'brain', 'episode', 'engine']);

export function declarations(name, dependencies, exports) {
  if (!permitted.has(name)) throw new Error('Unapproved source module');
  let source = fs.readFileSync(path.join(ROOT, `scripts/v2/${name}.mjs`), 'utf8');
  source = source.replace(/^#![^\n]*\n/, '').replace(/^import\s[\s\S]*?;\s*$/gm, '');
  if (name === 'engine') {
    const suffix = 'main().catch((err) => { console.error("FATAL:", err); process.exit(1); });';
    if (!source.includes(suffix)) throw new Error('Entrypoint changed; audit adapter needs review');
    source = source.replace(suffix, '');
  }
  source = source.replace(/^export /gm, '');
  if (/^import\s/m.test(source)) throw new Error('Unresolved import');
  const blocked = () => { throw new Error('NETWORK/PROCESS ACCESS BLOCKED IN AUDIT'); };
  const deps = { fetch: blocked, process: { argv: ['node', '--once'], env: {}, exit: blocked },
    console: { log() {}, error() {} }, ...dependencies };
  return new Function(...Object.keys(deps), '"use strict";\n' + source +
    `\nreturn {${exports.join(',')}};`)(...Object.values(deps));
}

export function sandbox(mode = 'TREND') {
  const files = new Map();
  const V2 = Object.fromEntries(['state', 'signals', 'episodes', 'generations', 'strategies', 'memory',
    'pending', 'backtestStats', 'trades', 'equity', 'prices', 'log', 'journal', 'playbook', 'reflog',
    'calib', 'world', 'worldThesis', 'worldCache'].map(x => [x, x]));
  let clock = Date.UTC(2024, 0, 1);
  const now = () => clock;
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const mem = {
    V2, now, Date: FakeDate,
    readJSON: (p, fallback = null) => files.has(p) ? clone(files.get(p)) : clone(fallback),
    writeJSON: (p, value) => files.set(p, clone(value)),
    readJSONL: (p, n = 0) => { const rows = clone(files.get(p) || []); return n > 0 ? rows.slice(-n) : rows; },
    appendJSONL: (p, row) => { const rows = files.get(p) || []; rows.push(clone(row)); files.set(p, rows); },
    round: (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n,
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    log() {}, ensureData() {},
  };
  const noNetwork = () => { throw new Error('Network data is unavailable inside the offline adapter'); };
  const deps = { ...lib, ...mem, P, fetchQuote: noNetwork, fetchFx: noNetwork,
    fetchHistory: noNetwork, getJSON: noNetwork, getText: noNetwork,
    readAnalystDecision: () => ({mode, direction_bias: 'NEUTRAL', aggression: 0.4, ts: clock}),
    notify() {}, notifyOpen() {}, notifyClose() {}, notifyEpisodeEnd() {}, notifyStartup() {}, checkCommands() {},
    runAnalyst() {}, collectWorld: async () => null, CryptoFeed: class { connect() { throw new Error('WebSocket blocked'); } } };
  const strats = declarations('strategies', deps, ['SEED_STRATEGIES', 'SIGNAL_FN', 'strategyExit', 'runStrategies', 'ensureStrategies', 'cacheOiSnapshot']);
  const sizing = declarations('sizing', deps, ['sizeOrder']);
  const episode = declarations('episode', deps, ['freshV2State', 'recordEquityPeak', 'episodeEndReason', 'finalizeEpisode', 'nextEpisode']);
  const brain = declarations('brain', deps, ['scoreStrategies', 'buildBrainV2', 'onClose', 'onEpisodeEnd', 'evolveTick', 'deflatedSharpe']);
  const engine = declarations('engine', {...deps, ...strats, ...sizing, ...episode, ...brain},
    ['doOpen', 'doClose', 'markAndManage', 'recalcEquity', 'cycle']);
  mem.writeJSON(V2.strategies, strats.SEED_STRATEGIES.map(s => ({...s, learned: {n: 0, expectancy_R: 0, win_rate: 0, kelly: 0.12, confidence: 0.2}})));
  return { ...deps, ...strats, ...sizing, ...episode, ...brain, ...engine, files, setClock: t => { clock = t; } };
}
