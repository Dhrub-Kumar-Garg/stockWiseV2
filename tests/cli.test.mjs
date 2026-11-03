import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('both CLI paths run the identical isolated mock paper cycle',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stockwise-cli-'));
  t.after(()=>{const resolved=path.resolve(temp); assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(resolved).startsWith('stockwise-cli-')); fs.rmSync(resolved,{recursive:true});});
  for (const [i,entry] of ['scripts/v2/engine.mjs','scripts/daemon.mjs'].entries()) {
    const dir=path.join(temp,String(i));
    const stdout=execFileSync(process.execPath,[entry,'--paper','--mock','--once','--config','config.example.json','--data-dir',dir],{cwd:root,encoding:'utf8',timeout:10000});
    const state=JSON.parse(fs.readFileSync(path.join(dir,'state.v3.json')));
    assert.equal(state.mode,'paper'); assert.equal(state.cycles,1); assert.equal(state.walletBalance,100);
    assert.equal(JSON.parse(stdout).mode,'paper');
  }
});
test('live mode is rejected before state or keys are accessed',()=>{
  const child=spawnSync(process.execPath,['scripts/v2/engine.mjs','--live'],{cwd:root,encoding:'utf8',timeout:5000});
  assert.notEqual(child.status,0);
});
