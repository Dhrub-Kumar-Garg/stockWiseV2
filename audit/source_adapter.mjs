// Historical audit factory is frozen to the audited Git source/tooling revisions.
import path from "node:path";
import {fileURLToPath} from "node:url";
import {frozenBaseline,auditedBytes} from "../scripts/v2/baseline.mjs";
const base=await frozenBaseline();
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export const BASELINE_ROOT=base.BASELINE_ROOT;
export const {sandbox,declarations,config,clone}=base;
export {auditedBytes};
