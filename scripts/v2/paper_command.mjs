import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaperStore} from './paper_store.mjs';
export function queuePaperCommand(directory,command) {
  const store=new PaperStore(directory);
  try {return store.enqueue(command);} finally {store.close();}
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), get=flag=>args[args.indexOf(flag)+1];
  try {
    if (!args.includes('--paper') || !args.includes('--data-dir') || !args.includes('--command')) throw new Error('Explicit paper directory and command JSON file required');
    console.log(JSON.stringify(queuePaperCommand(get('--data-dir'),JSON.parse(fs.readFileSync(get('--command'),'utf8')))));
  } catch {console.error('Paper command rejected; validate command and account state'); process.exitCode=1;}
}
