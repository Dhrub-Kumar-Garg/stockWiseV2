import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planLegacyMigration,reconciledFlatImport} from '../scripts/v2/migration.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url)));
test('migration is explicit, flat only, preserves source and never invents capital',()=>{
  const raw=JSON.stringify({version:2,walletBalance:80,equity:80,positions:{}});
  assert.equal(planLegacyMigration(raw).requiresManualReconciliation,true);
  assert.throws(()=>reconciledFlatImport(raw,cfg,{}));
  const state=reconciledFlatImport(raw,cfg,{reconciledCash:79.5,acknowledgement:'IMPORT_RECONCILED_FLAT_PAPER_SNAPSHOT'});
  assert.equal(state.walletBalance,79.5); assert.equal(state.cashflows[0].amount,79.5);
  assert.equal(JSON.parse(raw).walletBalance,80);
  assert.throws(()=>reconciledFlatImport(JSON.stringify({positions:{BTC:{}}}),cfg,{reconciledCash:80,acknowledgement:'IMPORT_RECONCILED_FLAT_PAPER_SNAPSHOT'}));
});
