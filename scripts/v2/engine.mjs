import {runCLI} from "./cli.mjs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
export {runCLI};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCLI(["--paper",...process.argv.slice(2)]).catch(() => {console.error("Paper engine failed; inspect local configuration/data health"); process.exitCode=1;});
