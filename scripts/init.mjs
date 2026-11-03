import {runCLI} from "./v2/cli.mjs";
runCLI([...process.argv.slice(2),"--initialize"]).catch(() => {console.error("Paper initialization refused"); process.exitCode=1;});
