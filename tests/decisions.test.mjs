import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPaperState,paperTick,signalsFor} from '../scripts/v2/runtime.mjs';
import {evaluateCandidates,SEED_STRATEGIES,recordDecision} from '../scripts/v2/strategies.mjs';
import {validateConfig} from '../scripts/v2/config.mjs';
import {dashboardDTO} from '../scripts/v2/dashboard.mjs';
const cfg=validateConfig(JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url))));
test('every symbol and strategy has a reason, including unavailable and inactive strategies',()=>{
 const at=Date.UTC(2026,0,1),s=createPaperState(cfg,at),rows=evaluateCandidates(s,{},cfg,{now:at});
 assert.equal(rows.length,cfg.watchlist.length*SEED_STRATEGIES.length);assert.ok(rows.every(r=>r.reason&&r.strategy_id));
 paperTick(s,{},cfg,{at});for(const strat of SEED_STRATEGIES)assert.equal(s.decisionCounters[strat.id].evaluated,cfg.watchlist.length);
 const dto=dashboardDTO({signals:signalsFor(s,cfg)});assert.equal(dto.v2.signals.decisionCounters.length,SEED_STRATEGIES.length);
});
test('bounded traces do not count selected confirmations as actual fills',()=>{
 const s={};for(let i=0;i<600;i++)recordDecision(s,{ts:i,strategy_id:'a',symbol:'BTC-USD',stage:'selected',reason:'confirmation'});
 assert.equal(s.decisionTraces.length,500);assert.equal(s.decisionCounters.a.filled,0);
 recordDecision(s,{ts:601,strategy_id:'b',stage:'filled',reason:'primary_fill'});assert.equal(s.decisionCounters.b.filled,1);
});
