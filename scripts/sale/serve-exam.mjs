import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { compileServing, openServing } from "../../src/sale/serve.mjs";
import { actionFor } from "../../src/sale/policy.mjs";
const [dir, modelFile] = process.argv.slice(2),
  read = (p) => JSON.parse(readFileSync(p));
const packet = read(join(dir, "packet.json")),
  frozen = read(join(dir, "frozen.json")),
  model = read(modelFile);
assert.equal(
  compileServing(
    frozen,
    packet,
    frozen.recipeHash,
    model.minPerArm,
    model.supportMode ?? "observed-cell",
  ).seal,
  model.seal,
);
const build = performance.now(),
  serve = openServing(model, model.seal),
  buildMs = performance.now() - build;
const counts = {},
  micros = [],
  sample = [];
for (const c of packet.holdout) {
  const start = performance.now(),
    r = serve.score(c);
  micros.push((performance.now() - start) * 1000);
  counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (r.status === "PROPOSED_FOR_PILOT") {
    const { recipe } = frozen;
    assert.equal(
      r.proposed,
      packet.design.actions[
        actionFor(recipe.policy, c, recipe.model, packet.design)
      ],
    );
    assert.equal(
      r.incumbent,
      packet.design.actions[
        actionFor(recipe.incumbent, c, recipe.model, packet.design)
      ],
    );
  }
  if (sample.length < 1000) sample.push(c);
}
const before = performance.now(),
  child = spawn(
    process.execPath,
    ["src/cli.mjs", "sale-stream", modelFile, model.seal],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
const ended = once(child, "exit");
let stderr = "";
child.stderr.on("data", (b) => (stderr += b));
const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ](),
  roundTrips = [];
for (let seq = 0; seq < sample.length; seq++) {
  const request = sample[seq],
    expected = serve.score(request),
    start = performance.now();
  child.stdin.write(JSON.stringify(request) + "\n");
  const raw = await reader.next();
  assert.ok(!raw.done);
  const response = JSON.parse(raw.value);
  assert.deepEqual(response, { seq: seq + 1, seal: model.seal, ...expected });
  roundTrips.push(performance.now() - start);
}
child.stdin.end();
const [code] = await ended;
assert.equal(code, 0, stderr);
const quartiles = (values) => {
  const sorted = values.toSorted((a, b) => a - b),
    q = (f) => sorted[Math.ceil(sorted.length * f) - 1];
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1) };
};
console.log(
  JSON.stringify(
    {
      mode: "HISTORICAL_QUERY_THROUGHPUT",
      modelSeal: model.seal,
      trainingRecipe: frozen.recipeHash,
      minPerArm: model.minPerArm,
      observedCells: serve.keys,
      rows: packet.holdout.length,
      counts,
      admittedExact: true,
      buildMs,
      localCallMicroseconds: quartiles(micros),
      streamRequests: sample.length,
      firstResponseWithStartupMs: roundTrips[0],
      warmStreamMilliseconds: quartiles(roundTrips.slice(1)),
      elapsedStreamMs: performance.now() - before,
      node: process.version,
      cpu: cpus()[0].model,
      semantics:
        "Una consulta por comprador a una receta fija. El dictamen puede abstenerse. Esta medición excluye investigación, cobro y evidencia de demanda.",
    },
    null,
    2,
  ),
);
