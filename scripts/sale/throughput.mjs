import assert from "node:assert/strict";
import { cpus, availableParallelism } from "node:os";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Semar } from "../../src/semar.mjs";
import { hash } from "../../src/factory/reader.mjs";
import { histogramSearch, runNative } from "../../src/sale/search.mjs";
import { adjusted, catalogue } from "../../src/sale/policy.mjs";

const [dir, statePath, repeats = "21"] = process.argv.slice(2),
  n = Number(repeats);
assert.ok(Number.isSafeInteger(n) && n >= 3 && n <= 101);
const read = (where, file) =>
  JSON.parse(readFileSync(join(where, file + ".json")));
const packet = read(dir, "packet"),
  frozen = read(dir, "frozen"),
  expected = frozen.measurements.at(-1);
const rows = packet.search.map((r) =>
    adjusted(r, frozen.recipe.model, packet.design),
  ),
  rules = catalogue(packet.design, expected.policies);
const store = new Semar(":memory:");
try {
  store.restore(
    JSON.parse(gunzipSync(readFileSync(join(statePath, "bitacora.json.gz")))),
    read(statePath, "avance").audit.tip,
  );
  const layout = store.layout(),
    configs = [
      { method: "tablas", threads: 1, receipts: false },
      { method: "recorrido", threads: 1, receipts: false },
      { method: "recorrido", threads: 4, receipts: false },
      { method: "recorrido", threads: 10, receipts: false },
      { method: "recorrido", threads: 1, receipts: true },
      { method: "recorrido", threads: 4, receipts: true },
      { method: "recorrido", threads: 10, receipts: true },
    ];
  const samples = configs.map(() => []),
    output = {
      dataset: packet.design.response,
      eligibleCustomers: rows.length,
      policies: rules.length,
      comparisons: rows.length * rules.length,
      reference: expected.scoresHash,
      repetitions: n,
      warmups: 1,
      started: new Date().toISOString(),
      cpu: cpus()[0].model,
      available: availableParallelism(),
      node: process.version,
      scope:
        "Tiempo desde las filas puntuadas y el catálogo listo hasta el vector exacto de totales. Incluye serialización y proceso para C++. Auditoría individual solo en las configuraciones con recibos.",
    };
  for (let round = 0; round <= n; round++) {
    for (let step = 0; step < configs.length; step++) {
      const i = (step + round) % configs.length,
        c = configs[i],
        start = performance.now();
      const result =
        c.method === "tablas"
          ? { total: histogramSearch(rows, rules).sums }
          : runNative(layout, rows, rules, c.threads, c.receipts);
      const ms = performance.now() - start;
      assert.equal(hash(result.total), expected.scoresHash);
      if (c.receipts) assert.deepEqual(result.sectors, expected.sectors);
      if (round) samples[i].push(ms);
    }
  }
  output.finished = new Date().toISOString();
  output.timings = configs.map((c, i) => {
    const sorted = samples[i].toSorted((a, b) => a - b),
      q = (f) => sorted[Math.ceil(sorted.length * f) - 1];
    return {
      ...c,
      minMs: sorted[0],
      medianMs: q(0.5),
      p95Ms: q(0.95),
      maxMs: sorted.at(-1),
      allExact: true,
    };
  });
  console.log(JSON.stringify(output, null, 2));
} finally {
  store.close();
}
