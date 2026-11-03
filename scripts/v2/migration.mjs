// Read-only reconciliation planning. Never changes or executes an old account.
import {createHash} from 'node:crypto';
import {createPaperState} from './runtime.mjs';
export function planLegacyMigration(raw) {
  const legacy=JSON.parse(raw), positions=Object.keys(legacy.positions || {});
  return {sourceSha256:createHash('sha256').update(raw).digest('hex'),legacyVersion:legacy.version,
    openPositions:positions,reportedWallet:legacy.walletBalance,reportedEquity:legacy.equity,
    requiresManualReconciliation:true,canImportFlat:positions.length===0,
    warning:'Legacy fees/funding may not reconcile. No inferred cash adjustment or history deletion is permitted.'};
}
export function reconciledFlatImport(raw,cfg,{acknowledgement,reconciledCash,at=Date.now()}={}) {
  const plan=planLegacyMigration(raw);
  if (!plan.canImportFlat || acknowledgement!=='IMPORT_RECONCILED_FLAT_PAPER_SNAPSHOT' || !Number.isFinite(reconciledCash) || reconciledCash<0) throw new Error('Explicit flat paper reconciliation required');
  const copy=structuredClone(cfg); copy.v2.startingCapital=reconciledCash;
  const state=createPaperState(copy,at); state.migration={...plan,approvedCash:reconciledCash,ts:at};
  return state;
}
