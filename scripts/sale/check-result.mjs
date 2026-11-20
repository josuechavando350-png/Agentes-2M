import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const [kind, actualPath, expectedPath] = process.argv.slice(2);
const read = (f) => JSON.parse(readFileSync(f));
function normalize(value) {
  if (kind === "hillstrom") {
    delete value.hardware;
    for (const worker of value.workers) {
      delete worker.populationMs;
      delete worker.oneWorkerMs;
    }
  } else if (kind === "credit") {
    for (const scope of value.runs) delete scope.elapsedMs;
  } else if (kind === "register") delete value.milliseconds;
  else assert.equal(kind, "diagnostic");
  return value;
}
assert.deepEqual(normalize(read(actualPath)), normalize(read(expectedPath)));
console.log("Resultados y huellas reproducidos: " + kind);
