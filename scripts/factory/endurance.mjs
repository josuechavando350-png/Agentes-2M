import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { corpus } from "./fixtures.mjs";
import {
  discover,
  predictExam,
  scoreExam,
} from "../../src/factory/discover.mjs";

const [secondsText = "60", file, seed = randomBytes(12).toString("hex")] =
  process.argv.slice(2);
const seconds = Number(secondsText);
assert.ok(
  Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400 && file,
);
const started = new Date(),
  start = performance.now(),
  end = start + seconds * 1000;
const stats = {
  seed,
  started: started.toISOString(),
  targetSeconds: seconds,
  rounds: 0,
  records: 0,
  tools: 0,
  negativeChecks: 0,
  fullExports: 0,
};
const publish = (status, extra = {}) => {
  const out = {
    ...stats,
    status,
    elapsedSeconds: (performance.now() - start) / 1000,
    updated: new Date().toISOString(),
    ...extra,
  };
  writeFileSync(file + ".tmp", JSON.stringify(out, null, 2) + "\n");
  renameSync(file + ".tmp", file);
};
let nextProduct = start,
  nextReport = start;
try {
  do {
    const key = seed + "/" + stats.rounds;
    const x = corpus(key),
      candidate = discover(x.project),
      { frozen, adapters } = predictExam(candidate, x.batches);
    const score = scoreExam(candidate, frozen, adapters, x.answers);
    assert.equal(score.status, "QUALIFIED_IN_SCOPE");
    assert.equal(score.correct, 36);
    assert.equal(score.tools.reposicion.correct, 24);
    const broken = structuredClone(x.answers);
    broken[stats.rounds % broken.length].salt += "x";
    assert.throws(
      () => scoreExam(candidate, frozen, adapters, broken),
      /Clave/,
    );
    stats.negativeChecks++;
    stats.rounds++;
    stats.records += score.total;
    stats.tools += score.tools.reposicion.total;
    if (performance.now() >= nextProduct) {
      const p = spawnSync(
        process.execPath,
        [fileURLToPath(new URL("exam.mjs", import.meta.url))],
        { encoding: "utf8", timeout: 90000, maxBuffer: 4e6 },
      );
      assert.equal(p.status, 0, p.stderr);
      const r = JSON.parse(p.stdout);
      assert.equal(r.audit, "VERIFIED");
      stats.fullExports++;
      nextProduct = performance.now() + 60_000;
    }
    if (performance.now() >= nextReport) {
      publish("RUNNING");
      nextReport = performance.now() + 15_000;
    }
  } while (performance.now() < end);
  publish("PASSED");
} catch (error) {
  publish("FAILED", { error: error.message, stack: error.stack });
  throw error;
}
