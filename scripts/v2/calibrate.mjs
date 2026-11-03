// Offline only: fit frozen chronological scopes from recorded shadow outcomes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fitCalibration,scopeKey,costFingerprint} from './calibration.mjs';
import {validateConfig} from './config.mjs';
export function fitScopes(rows,options){const groups=new Map();for(const r of rows){const key=scopeKey(r);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}return [...groups.values()].map(group=>fitCalibration(group,{...options,trials:groups.size}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw new Error('Explicit arguments required');return args[i+1];};
  const cfg=validateConfig(JSON.parse(fs.readFileSync(get('--config')))),rows=JSON.parse(fs.readFileSync(get('--labels')));
  const result=fitScopes(rows,{trainEnd:Date.parse(get('--train-end')),calibrationEnd:Date.parse(get('--calibration-end')),testEnd:Date.parse(get('--test-end')),costHash:costFingerprint(cfg)});
  fs.writeFileSync(get('--out'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({scopes:result.length,eligible:result.filter(m=>m.eligible).length}));
 }catch{console.error('Calibration refused: valid nonoverlapping point-in-time labels, frozen splits and new output required');process.exitCode=1;}
}
