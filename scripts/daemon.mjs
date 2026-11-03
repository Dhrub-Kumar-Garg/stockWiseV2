import {runCLI} from "./v2/cli.mjs";
runCLI(["--paper",...process.argv.slice(2)]).catch(() => {console.error("Paper engine failed"); process.exitCode=1;});
