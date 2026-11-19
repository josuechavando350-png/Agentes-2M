import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir, cpus, availableParallelism, release } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Semar } from "../src/semar.mjs";
import { materialize } from "../src/packed.mjs";
import { oracle } from "../src/policy.mjs";

function stats(ms, elapsed) {
  const sorted = ms.toSorted((a, b) => a - b);
  const q = (f) => sorted[Math.ceil(f * ms.length) - 1];
  return {
    samples: ms.length,
    p50Ms: q(0.5),
    p95Ms: q(0.95),
    p99Ms: q(0.99),
    maxMs: sorted.at(-1),
    elapsedMs: elapsed,
    actionsPerSecond: (ms.length * 1000) / elapsed,
  };
}
function service(path) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/cli.mjs", import.meta.url)), "serve"],
    {
      env: { ...process.env, SEMAR_DB: path },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const pending = new Map();
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      const error = Error("Servicio local cerrado, código " + code);
      for (const p of pending.values()) p.reject(error);
      pending.clear();
      if (code !== 0) reject(error);
      else resolve();
    });
  });
  // Attach the rejection handler immediately, even if startup fails before the first reply.
  done.catch(() => {});
  child.stdin.on("error", (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const reply = JSON.parse(line),
      p = pending.get(reply.key);
    if (!p) {
      child.kill();
      return;
    }
    pending.delete(reply.key);
    if (reply.error) p.reject(Error(reply.error));
    else p.resolve(reply.result);
  });
  return {
    request(key, command) {
      return new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.stdin.destroyed) {
          reject(Error("Servicio cerrado"));
          return;
        }
        pending.set(key, { resolve, reject });
        child.stdin.write(JSON.stringify({ key, command }) + "\n");
      });
    },
    async close() {
      child.stdin.end();
      await done;
    },
  };
}

const dir = resolve(process.argv[2] ?? ".cache/escuela"),
  read = (n) => readFileSync(join(dir, n));
const anchor = JSON.parse(read("avance.json")).audit,
  events = JSON.parse(
    gunzipSync(read("bitacora.json.gz"), { maxOutputLength: 64_000_000 }),
  );
const tmp = mkdtempSync(join(tmpdir(), "semar-latencia-")),
  db = join(tmp, "prueba.sqlite");
let school = new Semar(db),
  srv;
try {
  assert.deepEqual(school.restore(events, anchor.tip), anchor);
  const base = school.status();
  const packed = await materialize(
    school.layout(),
    join(dir, "padron-100m.bin.gz"),
  );
  assert.equal(packed.tested, base.live);
  assert.equal(packed.founders, base.founders);
  const sampleCount = 128;
  const agents = [];
  for (let ordinal = 84000; agents.length < sampleCount * 3 + 24; ordinal++) {
    const agent = school.agent(school.founderId(7, ordinal));
    if (agent.balance > 1 && agent.skills.includes("inference"))
      agents.push(agent);
  }
  school.close();
  school = null;
  const started = performance.now();
  srv = service(db);
  let seq = 0;
  async function work(op) {
    const block = seq++,
      a = agents[block];
    const data =
      op === "sum"
        ? [8, -3, block]
        : {
            facts: [
              { literal: "pedido", source: "acta" },
              ...(block % 2
                ? [{ literal: "!valido", source: "rectificación" }]
                : []),
            ],
            rules: [
              { if: ["pedido"], then: "registrado", source: "A" },
              { if: ["registrado"], then: "valido", source: "B" },
            ],
            query: "valido",
          };
    const expected = oracle(op, data);
    const at = performance.now();
    const receipt = await srv.request("latencia-banco-" + block, {
      type: "work",
      id: a.id,
      generation: a.generation,
      version: a.version,
      op,
      data,
    });
    const duration = performance.now() - at;
    assert.equal(receipt.status, "APPROVED");
    assert.equal(receipt.value, expected);
    assert.equal(receipt.balance, a.balance - 1);
    return duration;
  }
  await work("sum");
  const coldMs = performance.now() - started;
  for (let i = 0; i < 12; i++) await work(i % 2 ? "sum" : "inference");
  async function load(op, concurrency) {
    const times = [],
      start = performance.now();
    for (let i = 0; i < sampleCount; i += concurrency)
      times.push(
        ...(await Promise.all(
          Array.from({ length: concurrency }, () => work(op)),
        )),
      );
    return { op, concurrency, ...stats(times, performance.now() - start) };
  }
  const workloads = [
    await load("sum", 1),
    await load("inference", 1),
    await load("inference", 8),
  ];
  const missionStart = performance.now();
  const missionAction = await srv.request("latencia-mision-pulso", {
    type: "pulse",
  });
  const mission = {
    status: missionAction.status,
    localMs: performance.now() - missionStart,
    documentsFetchedDuringTiming: 0,
  };
  await srv.close();
  srv = null;
  school = new Semar(db);
  const replay = school.audit();
  assert.equal(replay.deliveries, anchor.deliveries + seq);
  assert.ok(school.status().spent >= base.spent + seq);
  const report = {
    schema: 1,
    measuredAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    runtime: {
      node: process.version,
      platform: process.platform,
      os: release(),
      arch: process.arch,
      cpu: cpus()[0]?.model,
      availableCpus: availableParallelism(),
    },
    snapshot: packed,
    service: {
      checkpoint: anchor.tip,
      transport: "local stdio JSONL",
      storage: "SQLite en disco, WAL, synchronous=FULL",
      coldStartAndFirstApprovedMs: coldMs,
      warmups: 12,
      workloads,
      mission,
      verifiedNewDeliveries: seq,
      replayedTip: replay.tip,
    },
  };
  const file = join(dir, "latencia.json");
  writeFileSync(file + ".tmp", JSON.stringify(report, null, 2) + "\n");
  renameSync(file + ".tmp", file);
  console.log(
    JSON.stringify({
      population: packed.population,
      examined: packed.tested,
      ms: packed.nativeExamAndGzipMs,
      coldMs,
      workloads,
      mission,
    }),
  );
} finally {
  try {
    if (srv) await srv.close();
  } finally {
    school?.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
