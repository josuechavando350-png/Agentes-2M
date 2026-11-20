import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { openServing } from "../../src/sale/serve.mjs";
import { hash } from "../../src/factory/reader.mjs";

const [directory, modelPath, programRoot = "."] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p)),
  model = read(modelPath);
const packet = read(join(directory, "packet.json")),
  engine = openServing(model, model.seal);
const cases = packet.holdout.map((r, i) => {
  if (i % 601 === 0)
    return { line: "x".repeat(65537), status: "INVALID_REQUEST" };
  if (i % 599 === 0) return { line: "{", status: "INVALID_REQUEST" };
  const request = i % 557 === 0 ? { ...r, x: [1000000, ...r.x.slice(1)] } : r;
  return { line: JSON.stringify(request), expected: engine.score(request) };
});
const counters = {};
for (const c of cases) {
  const status = c.expected?.status ?? c.status;
  counters[status] = (counters[status] ?? 0) + 1;
}
const summaries = [];
for (const burst of [1, 32, 256, 4096]) {
  const child = spawn(
    process.execPath,
    [join(programRoot, "src/cli.mjs"), "sale-stream", modelPath, model.seal],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  let errors = "";
  child.stderr.on("data", (b) => (errors += b.toString()));
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const arrivals = [],
    statuses = {};
  let inputDrainWaits = 0;
  try {
    child.stdin.write(JSON.stringify(packet.holdout[0]) + "\n");
    const warm = await reader.next();
    assert.equal(JSON.parse(warm.value).seq, 1);
    const begin = performance.now();
    for (let first = 0; first < cases.length; first += burst) {
      const last = Math.min(first + burst, cases.length),
        submitted = performance.now();
      const send = async () => {
        for (let i = first; i < last; i++) {
          if (!child.stdin.write(cases[i].line + "\n")) {
            inputDrainWaits++;
            await once(child.stdin, "drain");
          }
        }
      };
      const receive = async () => {
        for (let i = first; i < last; i++) {
          const r = await reader.next();
          assert.ok(
            !r.done,
            "Se cerró el servicio antes de devolver todo el lote",
          );
          arrivals.push(performance.now() - submitted);
          const got = JSON.parse(r.value),
            c = cases[i];
          assert.equal(got.seq, i + 2);
          assert.equal(got.seal, model.seal);
          if (c.expected)
            assert.deepEqual(got, {
              seq: i + 2,
              seal: model.seal,
              ...c.expected,
            });
          else {
            assert.equal(got.status, c.status);
            assert.equal(typeof got.error, "string");
          }
          statuses[got.status] = (statuses[got.status] ?? 0) + 1;
        }
      };
      await Promise.all([send(), receive()]);
    }
    const ms = performance.now() - begin;
    child.stdin.end();
    assert.equal((await reader.next()).done, true);
    assert.equal((await exited)[0], 0, errors);
    assert.deepEqual(statuses, counters);
    arrivals.sort((a, b) => a - b);
    const quantile = (p) => arrivals[Math.ceil(arrivals.length * p) - 1];
    summaries.push({
      burst,
      verified: arrivals.length,
      elapsedMs: ms,
      requestsPerSecond: (arrivals.length * 1000) / ms,
      latencyFromBurstArrivalMs: {
        p50: quantile(0.5),
        p95: quantile(0.95),
        p99: quantile(0.99),
        maximum: arrivals.at(-1),
      },
      inputDrainWaits,
    });
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
console.log(
  JSON.stringify(
    {
      mode: "OFFLINE_PIPE_BURSTS",
      seal: model.seal,
      orderedCases: hash(cases.map((c) => c.line)),
      distinctTestPositions: cases.length,
      expectedStatusCounts: counters,
      configurations: summaries,
      cpu: cpus()[0].model,
      node: process.version,
      meaning:
        "Cada lote llega junto a un solo proceso local ya iniciado. El tiempo incluye espera, transporte y lectura del cliente hasta cada respuesta. Los mismos expedientes se repiten entre configuraciones. Incluye solicitudes fuera de rango, mal formadas y demasiado largas.",
    },
    null,
    2,
  ),
);
