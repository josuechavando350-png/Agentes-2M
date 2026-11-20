import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const [kind, actualPath, expectedPath] = process.argv.slice(2);
const read = (f) => JSON.parse(readFileSync(f));
function normalize(value) {
  if (kind === "pressure") {
    return {
      seal: value.seal,
      orderedCases: value.orderedCases,
      rows: value.distinctCases ?? value.distinctTestPositions,
      counts: value.expectedStatusCounts,
      workloads: (value.results ?? value.configurations).map((r) => r.burst),
    };
  } else if (kind === "hillstrom") {
    delete value.hardware;
    for (const worker of value.workers) {
      delete worker.populationMs;
      delete worker.oneWorkerMs;
    }
  } else if (kind === "credit") {
    for (const scope of value.runs) delete scope.elapsedMs;
  } else if (kind === "queue") {
    for (const r of value.runs) delete r.elapsedMs;
  } else if (kind === "serving") {
    for (const k of [
      "buildMs",
      "localCallMicroseconds",
      "firstResponseWithStartupMs",
      "warmStreamMilliseconds",
      "elapsedStreamMs",
      "node",
      "cpu",
    ])
      delete value[k];
  } else if (kind === "pricing") {
    delete value.timing;
  } else if (["participation", "register"].includes(kind))
    delete value.milliseconds;
  else assert.equal(kind, "diagnostic");
  return value;
}
assert.deepEqual(normalize(read(actualPath)), normalize(read(expectedPath)));
console.log("Resultados y huellas reproducidos: " + kind);
