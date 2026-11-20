import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Semar } from "../../src/semar.mjs";
import { adjusted, catalogue } from "../../src/sale/policy.mjs";
import {
  runNative,
  histogramSearch,
  auditSector,
} from "../../src/sale/search.mjs";
import { hash } from "../../src/factory/reader.mjs";
const [
  dir,
  statePath,
  dest,
  secondsText = "180",
  seed = randomBytes(4).toString("hex"),
] = process.argv.slice(2);
const seconds = Number(secondsText);
assert.ok(
  Number.isInteger(seconds) &&
    seconds >= 1 &&
    seconds <= 7200 &&
    /^[a-f0-9]{8}$/.test(seed),
);
const read = (p) => JSON.parse(readFileSync(p)),
  p = read(join(dir, "packet.json")),
  report = read(join(dir, "frozen.json"));
const store = new Semar(":memory:"),
  start = performance.now();
const result = {
  mode: "FINITE_LOAD_TEST",
  seconds,
  started: new Date().toISOString(),
  seed,
  populationPerRound: 0,
  rounds: 0,
  scoredContributions: 0,
  independentlyHashedContributions: 0,
  timingsMs: [],
  scoresCompared: 0,
  periodicOriginal: 0,
  semanticChanges: 0,
};
const publish = (status, err) => {
  writeFileSync(
    dest + ".tmp",
    JSON.stringify(
      {
        ...result,
        status,
        elapsedSeconds: (performance.now() - start) / 1000,
        updated: new Date().toISOString(),
        ...(err ? { error: err } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  renameSync(dest + ".tmp", dest);
};
try {
  store.restore(
    JSON.parse(gunzipSync(readFileSync(join(statePath, "bitacora.json.gz")))),
    read(join(statePath, "avance.json")).audit.tip,
  );
  const layout = store.layout(),
    base = p.search.map((r) => adjusted(r, report.recipe.model, p.design));
  const rules = catalogue(p.design, report.measurements.at(-1).policies),
    history = report.measurements.at(-1);
  result.populationPerRound = base.length * rules.length;
  assert.equal(result.populationPerRound, 100000000);
  let rnd = parseInt(seed, 16);
  function draw(n) {
    rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
    return rnd % n;
  }
  do {
    const original = result.rounds % 5 === 0,
      offset = draw(base.length),
      sentinel = [-1000000000, 0, 1000000000];
    const rows = original
      ? base
      : base.map((_, i) => {
          const b = base[(i + offset) % base.length],
            scores = b.scores.map((v, a) =>
              i % 137 === 0
                ? sentinel[(a + result.rounds) % 3]
                : v + draw(20001) - 10000,
            );
          return { flags: b.flags, scores };
        });
    const threads = [1, 2, 4, 7, 10][result.rounds % 5],
      run = runNative(layout, rows, rules, threads, true),
      expected = histogramSearch(rows, rules).sums;
    assert.deepEqual(run.total, expected);
    if (original) {
      assert.deepEqual(run.sectors, history.sectors);
      result.periodicOriginal++;
    } else {
      assert.notEqual(hash(expected), history.scoresHash);
      result.semanticChanges++;
    }
    const sector = result.rounds % 10,
      n = rows.length / 10;
    assert.equal(
      auditSector(
        rows.slice(sector * n, (sector + 1) * n),
        rules,
        run.sectors[sector].ranges,
      ),
      run.sectors[sector].seal,
    );
    result.timingsMs.push(run.populationMs);
    result.scoresCompared += rules.length;
    result.scoredContributions += result.populationPerRound;
    result.independentlyHashedContributions += result.populationPerRound / 10;
    result.rounds++;
    publish("RUNNING");
    const remain = seconds * 1000 - (performance.now() - start);
    if (remain > 0) await pause(Math.min(30000, remain));
  } while (performance.now() - start < seconds * 1000);
  publish("PASSED");
} catch (e) {
  publish("FAILED", e.message);
  throw e;
} finally {
  store.close();
}
