// Materialize a pinned, minimal legacy research snapshot. Never executes entrypoints.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const AUDITED_SOURCE='50360996451ddc7ad742372bff398b7938ae0029';
export const AUDIT_TOOLING='e4198ca69df37e7659d18ad0a4381163add614c9';
const sources=['scripts/lib.mjs','scripts/daemon.mjs','scripts/v2/engine.mjs','scripts/v2/perp.mjs','scripts/v2/episode.mjs',
  'scripts/v2/brain.mjs','scripts/v2/sizing.mjs','scripts/v2/strategies.mjs','scripts/v2/analyst.mjs','scripts/v2/world.mjs',
  'scripts/world/score.mjs','config.example.json','data/strategies.json','web/app/api/state/route.ts'];
const tooling=['audit/source_adapter.mjs','audit/backtest.mjs','audit/EXPERIMENT_PLAN.md','audit/FOLLOWUP_EXPERIMENT_PLAN.md','audit/followup_research.mjs'];
let directory, loaded;
export function auditedBytes(name) {
  if (![...sources,...tooling].includes(name)) throw new Error('Source not in frozen baseline allowlist');
  return execFileSync('git',['show',`${name.startsWith('audit/')?AUDIT_TOOLING:AUDITED_SOURCE}:${name}`],{cwd:ROOT,maxBuffer:2000000});
}
export async function frozenBaseline() {
  if (loaded) return loaded;
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'stockwise-frozen-'));
  for (const name of [...sources,...tooling]) {
    const dest=path.join(directory,name); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,auditedBytes(name));
  }
  process.once('exit',()=>{
    const target=path.resolve(directory);
    if (target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('stockwise-frozen-')) fs.rmSync(target,{recursive:true,force:true});
  });
  const module=await import(pathToFileURL(path.join(directory,'audit/source_adapter.mjs')));
  loaded={...module,BASELINE_ROOT:directory};
  return loaded;
}
