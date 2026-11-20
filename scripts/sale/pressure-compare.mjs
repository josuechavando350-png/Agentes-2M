import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "../../src/factory/reader.mjs";

const [mode, dir, nText, previousCommit, packet, model, previousRoot] =
  process.argv.slice(2);
const n = Number(nText);
assert.ok(Number.isInteger(n) && n >= 3 && n <= 50);
assert.match(previousCommit, /^[0-9a-f]{40}$/);
const groups = { current: [], previous: [] };
if (mode === "run") mkdirSync(dir, { recursive: false });
for (let i = 0; i < n; i++) {
  const editions = i % 2 ? ["current", "previous"] : ["previous", "current"];
  for (const name of editions) {
    const path = join(dir, i + "-" + name + ".json");
    if (mode === "run") {
      const out = execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL("pressure-exam.mjs", import.meta.url)),
          packet,
          model,
          name === "current" ? "." : previousRoot,
        ],
        { timeout: 120000 },
      );
      writeFileSync(path, out, { flag: "wx" });
    } else assert.equal(mode, "collect");
    groups[name].push(JSON.parse(readFileSync(path)));
  }
}
const first = groups.current[0],
  labels = ["previous", "current"];
for (const r of [...groups.current, ...groups.previous]) {
  for (const k of [
    "mode",
    "seal",
    "orderedCases",
    "distinctTestPositions",
    "expectedStatusCounts",
    "cpu",
    "node",
  ])
    assert.deepEqual(r[k], first[k]);
  for (const [i, c] of r.configurations.entries()) {
    assert.equal(c.burst, [1, 32, 256, 4096][i]);
    assert.equal(c.verified, first.distinctTestPositions);
  }
}
const median = (v) => v.toSorted((a, b) => a - b)[Math.floor(v.length / 2)];
const results = [1, 32, 256, 4096].map((burst, j) => {
  const out = { burst };
  for (const name of labels) {
    const configs = groups[name].map((r) => r.configurations[j]);
    out[name] = {
      medianOfP95Ms: median(
        configs.map((c) => c.latencyFromBurstArrivalMs.p95),
      ),
      medianRequestsPerSecond: median(configs.map((c) => c.requestsPerSecond)),
      measuredP95Ms: configs.map((c) => c.latencyFromBurstArrivalMs.p95),
    };
  }
  return out;
});
console.log(
  JSON.stringify(
    {
      mode: "MATCHED_LOCAL_BURST_TESTS",
      previousCommit,
      seal: first.seal,
      orderedCases: first.orderedCases,
      cpu: first.cpu,
      node: first.node,
      repetitionsPerEdition: n,
      distinctCases: first.distinctTestPositions,
      expectedStatusCounts: first.expectedStatusCounts,
      repliesVerified: 2 * n * results.length * first.distinctTestPositions,
      results,
      recordings: Object.fromEntries(
        labels.map((k) => [k, groups[k].map(hash)]),
      ),
      scope:
        "Lectura y escritura locales de una receta fijada. La mediana de los p95 se calcula entre repeticiones que alternan el orden de las dos versiones. Los límites dependen del tamaño del lote y del equipo.",
    },
    null,
    2,
  ),
);
