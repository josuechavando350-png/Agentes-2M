import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  packBatch,
  runBatch,
  scanShard,
  mergeShards,
} from "../src/distribution.mjs";
import { digest } from "../src/policy.mjs";
import { sealedDossier } from "./dossier-cases.mjs";

const [mode, dirArg, ...args] = process.argv.slice(2),
  dir = resolve(dirArg ?? ".cache/reparto");
mkdirSync(dir, { recursive: true });
const file = (name) => join(dir, name);
const read = (name) => JSON.parse(readFileSync(file(name)));
function write(name, body) {
  const path = file(name);
  writeFileSync(path + ".tmp", JSON.stringify(body) + "\n");
  renameSync(path + ".tmp", path);
}
function nextFounder(system, sector, used) {
  for (let ordinal = 808000; ordinal <= 1_000_000; ordinal++) {
    const a = system.agent(system.founderId(sector, ordinal));
    if (!used.has(a.id) && a.balance > 1 && a.status === "LIVE") return a;
  }
  throw Error("No se encontró un agente disponible");
}
async function prepare(stateDir) {
  const { Semar } = await import("../src/semar.mjs");
  const journal = JSON.parse(
    gunzipSync(readFileSync(join(stateDir, "bitacora.json.gz")), {
      maxOutputLength: 64_000_000,
    }),
  );
  const state = JSON.parse(readFileSync(join(stateDir, "avance.json")));
  const now = journal.at(-1).at + 1,
    seed = args[1] ?? randomBytes(24).toString("hex");
  if (!/^[0-9a-f]{48}$/.test(seed)) throw Error("Semilla inválida");
  const mission = "reparto-" + seed.slice(0, 16),
    system = new Semar(file("base.sqlite"), { clock: () => now });
  try {
    assert.deepEqual(system.restore(journal, state.audit.tip), state.audit);
    const originals = new Map();
    for (const e of journal) {
      const raw = e.steps[0]?.command?.document;
      if (
        raw?.publicRecord?.dependencia &&
        system.sourceRevision(raw.id)?.sha256 === digest(raw.publicRecord)
      )
        originals.set(raw.id, raw);
    }
    if (!system.status().absolute.holder) {
      const a = nextFounder(system, 1, new Set());
      await system.command(mission + "-concurso", {
        type: "contest",
        candidates: [{ id: a.id, generation: a.generation, policy: "indexed" }],
      });
    }
    const last = system.mission()?.mission;
    if (last && !last.sealed)
      await system.command(
        mission + "-cerrar",
        last.phase === "CLOSED"
          ? { type: "pulse" }
          : {
              type: "halt",
              reason: "Cerrar únicamente la copia para medir el reparto",
            },
      );
    await system.command(mission + "-abrir", {
      type: "open_mission",
      mission,
      budget: 1000,
    });
    const inputs = [];
    for (let i = 0; i < 60; i++) {
      const c = sealedDossier(seed, i, 128, "f" + i + "-");
      inputs.push({
        doc: c.docs[0],
        query: c.query,
        expected: c.expected,
        kind: "generado",
      });
    }
    for (const raw of [...originals.values()].slice(0, 10)) {
      const expected = {
        status: "SUPPORTED",
        value: raw.publicRecord.dependencia,
        refs: [
          {
            document: raw.id,
            source: raw.source,
            sha256: digest(raw.publicRecord),
            row: 1,
            pointer: "/dependencia",
            quote: raw.publicRecord.dependencia,
          },
        ],
      };
      inputs.push({
        doc: raw,
        query: { subject: raw.id, op: "lookup", fields: ["buyer"] },
        expected,
        kind: "aviso-publico",
      });
    }
    const used = new Set(),
      jobs = [],
      truth = [];
    for (const [i, entry] of inputs.entries()) {
      const { doc, query, expected, kind } = entry;
      const actor = nextFounder(system, 1 + (i % 10), used);
      used.add(actor.id);
      const received = await system.command(mission + "-doc-" + i, {
        type: "admit_source",
        document: doc,
      });
      const key = mission + "-caso-" + i;
      jobs.push({
        key,
        command: {
          type: "dispatch_inquiry",
          id: actor.id,
          generation: actor.generation,
          version: actor.version,
          mission,
          document: doc.id,
          revision: received.revision,
          sha256: received.sha256,
          query,
        },
      });
      truth.push({ key, kind, expected });
    }
    const pack = packBatch(system, jobs);
    write("paquete.json", pack);
    write("solicitudes.json", jobs);
    write("clave.json", truth);
    write("origen.json", {
      seed,
      code: process.env.GITHUB_SHA ?? null,
      sourceCheckpoint: state.audit.tip,
      examCheckpoint: system.checkpoint().tip,
      clock: now,
      batch: pack.id,
      releasedAt: Date.now(),
    });
  } finally {
    system.close();
  }
}
function quantiles(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const q = (p) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(3));
  return { p50: q(0.5), p95: q(0.95), max: q(1) };
}
async function collect(count, requireMachines) {
  const { Semar } = await import("../src/semar.mjs");
  const meta = read("origen.json"),
    jobs = read("solicitudes.json"),
    truth = read("clave.json"),
    batch = read("paquete.json");
  const parts = Array.from({ length: count }, (_, i) =>
    read("parte-" + i + ".json"),
  );
  assert.equal(meta.batch, batch.id);
  if (requireMachines)
    assert.equal(
      new Set(parts.map((p) => p.machine)).size,
      count,
      "Se requieren máquinas diferentes",
    );
  const root = mkdtempSync(join(tmpdir(), "semar-comparar-"));
  function copy(name) {
    const path = join(root, name + ".sqlite");
    copyFileSync(file("base.sqlite"), path);
    return new Semar(path, { clock: () => meta.clock });
  }
  function verify(system, rows) {
    assert.equal(rows.length, jobs.length);
    for (const [i, r] of rows.entries()) {
      assert.equal(r.key, jobs[i].key);
      assert.equal(r.receipt?.status, "DISPATCH_ANSWERED", r.error);
      assert.deepEqual(r.receipt.answer, truth[i].expected);
      assert.equal(r.receipt.assignments[0].id, jobs[i].command.id);
      assert.equal(r.receipt.credits, 1);
    }
    assert.equal(system.mission().mission.spent, jobs.length);
    assert.equal(system.audit().status, "VERIFIED");
  }
  const proofRows = parts.flatMap((p) =>
    p.results.map((r) => ({ ...r, index: p.index, start: p.startedAt })),
  );
  const lookup = new Map(proofRows.map((r) => [r.key, r]));
  try {
    let distributed, samples;
    const system = copy("distribuido");
    try {
      system.audit(meta.examCheckpoint);
      const rows = await mergeShards(system, jobs, batch, parts);
      const end = rows.at(-1).committedAt;
      verify(system, rows);
      samples = rows.map((r, i) => {
        const scan = lookup.get(r.key);
        return {
          key: r.key,
          kind: truth[i].kind,
          document: jobs[i].command.document,
          agent: jobs[i].command.id,
          shard: scan.index,
          expectedDigest: digest(truth[i].expected),
          answerDigest: digest(r.receipt.answer),
          queueMs: scan.start - meta.releasedAt + scan.queueMs,
          workerQueueMs: scan.queueMs,
          commitMs: r.commitMs,
          confirmedMs: r.committedAt - meta.releasedAt,
          attempts: scan.attempts,
        };
      });
      assert.ok(
        samples.every((s) => s.queueMs >= 0 && s.confirmedMs >= s.queueMs),
      );
      const elapsedMs = end - meta.releasedAt;
      distributed = {
        correct: rows.length,
        cases: jobs.length,
        elapsedMs,
        correctPerSecond: (1000 * rows.length) / elapsedMs,
        creditPerAnswer: 1,
        credits: system.mission().mission.spent,
        workerSlotSecondsPerAnswer:
          parts.reduce(
            (sum, p) => sum + (p.results.at(-1)?.elapsedMs ?? 0),
            0,
          ) /
          (1000 * rows.length),
        currencyCharge: null,
        queueMs: quantiles(samples.map((r) => r.queueMs)),
        commitMs: quantiles(samples.map((r) => r.commitMs)),
        confirmedMs: quantiles(samples.map((r) => r.confirmedMs)),
        machines: parts.map((p) => ({
          index: p.index,
          boot: p.machine,
          version: p.node,
          answers: p.results.length,
          startedAt: p.startedAt,
          endedAt: p.endedAt,
        })),
      };
      // Restart the collector over the same evidence; no budget or receipt changes.
      const tip = system.checkpoint().tip;
      await mergeShards(system, jobs, batch, parts);
      assert.equal(system.checkpoint().tip, tip);
      distributed.checkpoint = tip;
    } finally {
      system.close();
    }
    const trials = [];
    for (const slots of [1, 4, 4, 1]) {
      const system = copy("local-" + trials.length);
      try {
        system.audit(meta.examCheckpoint);
        const result = await runBatch(system, jobs, Array(slots).fill("local"));
        verify(system, result.results);
        trials.push({
          slots,
          elapsedMs: result.elapsedMs,
          correct: jobs.length,
          credits: jobs.length,
          correctPerSecond: (1000 * jobs.length) / result.elapsedMs,
          queueMs: quantiles(result.results.map((r) => r.queueMs)),
          commitMs: quantiles(result.results.map((r) => r.commitMs)),
          confirmedMs: quantiles(result.results.map((r) => r.elapsedMs)),
        });
      } finally {
        system.close();
      }
    }
    const report = {
      schema: 1,
      ...meta,
      workflow: process.env.GITHUB_RUN_ID ?? null,
      counts: {
        generated: truth.filter((r) => r.kind === "generado").length,
        publicNotices: truth.filter((r) => r.kind === "aviso-publico").length,
      },
      multiHost: distributed,
      localTrials: trials,
      samples,
    };
    write("reparto.json", report);
    console.log(
      JSON.stringify({
        cases: jobs.length,
        distributed: distributed.correctPerSecond,
        local: trials.map((t) => t.correctPerSecond),
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
if (mode === "prepare") await prepare(resolve(args[0]));
else if (mode === "scan") {
  const [index, count] = args.map(Number);
  const part = await scanShard(read("paquete.json"), index, count);
  let machine = hostname();
  try {
    machine = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {}
  write("parte-" + index + ".json", {
    ...part,
    machine: digest(machine),
    node: process.version,
  });
} else if (mode === "collect")
  await collect(Number(args[0]), args.includes("--distinct-hosts"));
else throw Error("Usa prepare, scan o collect");
