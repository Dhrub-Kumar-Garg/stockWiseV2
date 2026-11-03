// Read-only SQLite export. No engine, secrets, migration, or remote calls.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
try {
 const a=process.argv.slice(2),get=k=>{const i=a.indexOf(k);if(i<0)throw new Error();return a[i+1];};
 const db=new DatabaseSync(path.join(path.resolve(get('--data-dir')),'paper.sqlite'),{readOnly:true});
 try{const rows=db.prepare("SELECT body FROM events WHERE json_extract(body,'$.type')='shadow_close' ORDER BY seq LIMIT 100000").all().map(r=>JSON.parse(r.body).label);fs.writeFileSync(get('--out'),JSON.stringify(rows,null,2),{flag:'wx'});console.log(JSON.stringify({exported:rows.length,limit:100000}));}finally{db.close();}
}catch{console.error('Read-only shadow export requires an existing paper database and new --out file');process.exitCode=1;}
