import { readFileSync } from "node:fs";
import { executeMission } from "./global-analysis.mjs";
const snapshot = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(await executeMission(snapshot)));
