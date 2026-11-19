import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, availableParallelism, cpus } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { digest, LEADERS, LEGACY_INITIAL } from "../src/policy.mjs";

import { sealedDossier } from "./dossier-cases.mjs";
const orders = [
  [1, 10, 100],
  [10, 100, 1],
  [100, 1, 10],
  [100, 10, 1],
  [10, 1, 100],
  [1, 100, 10],
];
function quantiles(numbers) {
  const sorted = numbers.toSorted((a, b) => a - b);
  const pct = (p) =>
    Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(3));
  return { p50: pct(0.5), p95: pct(0.95), max: pct(1) };
}
const dir = resolve(process.argv[2] ?? ".cache/escuela"),
  seed = process.argv[3] ?? randomBytes(24).toString("hex");
if (!/^[0-9a-f]{48}$/.test(seed))
  throw Error("Semilla de 48 dígitos hexadecimales requerida");
const root = mkdtempSync(join(tmpdir(), "semar-equipos-")),
  base = join(root, "base.sqlite"),
  file = join(root, "caso.sqlite"),
  arm = join(root, "equipo.sqlite");
const state = JSON.parse(readFileSync(join(dir, "avance.json"))),
  journal = JSON.parse(
    gunzipSync(readFileSync(join(dir, "bitacora.json.gz")), {
      maxOutputLength: 64_000_000,
    }),
  );
const now = journal.at(-1).at + 1,
  opts = { clock: () => now };
const mission = "examen-" + seed.slice(0, 16),
  cases = [];
function liveFounder(system, excluded) {
  const perSector =
    (system.status().founders ?? LEGACY_INITIAL) / LEADERS.length;
  for (let i = 0; i < perSector; i++) {
    const a = system.agent(system.founderId(1, 1 + ((819822 + i) % perSector)));
    if (a.id !== excluded && a.status === "LIVE" && a.balance > 1) return a;
  }
  throw Error("No hay un fundador disponible para el examen");
}
function sumCommand(agent) {
  return {
    type: "work",
    id: agent.id,
    generation: agent.generation,
    version: agent.version,
    op: "sum",
    data: [1, 2],
  };
}
let baseline, warmMember;
try {
  const initial = new Semar(base, opts);
  try {
    assert.deepEqual(initial.restore(journal, state.audit.tip), state.audit);
    // Resolve a vacant or exhausted office only in the benchmark copy.
    let holder = initial.status().absolute.holder;
    while (holder && initial.agent(holder.id).balance === 1) {
      const retired = await initial.command(
        mission + "-retiro-" + holder.id,
        sumCommand(initial.agent(holder.id)),
      );
      assert.equal(retired.status, "DEAD_ZERO");
      holder = initial.status().absolute.holder;
    }
    if (!holder) {
      const a = liveFounder(initial);
      await initial.command(mission + "-concurso", {
        type: "contest",
        candidates: [{ id: a.id, generation: a.generation, policy: "indexed" }],
      });
      holder = initial.status().absolute.holder;
    }
    baseline = {
      id: holder.id,
      generation: holder.generation,
      policy: holder.policy,
    };
    warmMember = liveFounder(initial, holder.id);
    const m = initial.mission()?.mission;
    if (m && !m.sealed)
      await initial.command(
        "banco-cerrar-" + seed.slice(0, 16),
        m.phase === "CLOSED"
          ? { type: "pulse" }
          : { type: "halt", reason: "Copia local para examen sectorial" },
      );
    await initial.command("banco-abrir-" + seed.slice(0, 16), {
      type: "open_mission",
      mission,
      budget: 400,
    });
  } finally {
    initial.close();
  }
  const N = 36;
  for (let i = 0; i < N; i++) {
    const rows = [128, 512, 2048][(i + Math.floor(i / 6)) % 3];
    const sample = sealedDossier(seed, i, rows);
    copyFileSync(base, file);
    const prepare = new Semar(file, opts);
    try {
      for (const document of sample.docs)
        await prepare.command(mission + "-" + document.id, {
          type: "admit_source",
          document,
        });
    } finally {
      prepare.close();
    }
    const record = {
      case: i + 1,
      inputDigest: sample.inputDigest,
      expectedDigest: digest(sample.expected),
      expected: sample.expected.status,
      rows,
      arms: [],
    };
    for (const size of orders[i % orders.length]) {
      copyFileSync(file, arm);
      const system = new Semar(arm, opts);
      try {
        system.audit();
        const warm = await system.command(
          mission + "-precalentar",
          sumCommand(warmMember),
        );
        assert.equal(warm.value, 3);
        const before = system.status().spent;
        const command = {
          type: "team_inquiry",
          mission,
          documents: sample.docs.map((d) => d.id),
          query: sample.query,
          size,
          rowBudget: rows,
          creditBudget: 100,
        };
        const start = performance.now();
        const receipt = await system.command(mission + "-investigar", command);
        const latencyMs = performance.now() - start;
        assert.equal(receipt.status, "TEAM_ANSWERED");
        assert.equal(receipt.rows, rows);
        assert.equal(receipt.credits, size);
        assert.equal(system.status().spent - before, size);
        assert.equal(system.mission().mission.spent, size);
        assert.equal(receipt.assignments.length, size);
        const sectors = new Set(receipt.assignments.map((a) => a.sector)).size;
        assert.equal(sectors, Math.min(size, 10));
        const answerDigest = digest(receipt.answer),
          correct = answerDigest === record.expectedDigest;
        record.arms.push({
          size,
          sectors,
          lanes: receipt.lanes,
          credits: size,
          reads: rows,
          correct,
          severe: !correct && receipt.answer.status === "SUPPORTED",
          answerDigest,
          latencyMs,
          scanMs: receipt.scanNs / 1e6,
        });
      } finally {
        system.close();
      }
    }
    cases.push(record);
  }
  const summary = [1, 10, 100].map((size) => {
    const arms = cases.map((c) => c.arms.find((a) => a.size === size));
    return {
      size,
      lanes: Math.max(...arms.map((a) => a.lanes)),
      cases: arms.length,
      correct: arms.filter((a) => a.correct).length,
      severe: arms.filter((a) => a.severe).length,
      workerRowReads: arms.reduce((n, a) => n + a.reads, 0),
      credits: arms.reduce((n, a) => n + a.credits, 0),
      commitMs: quantiles(arms.map((a) => a.latencyMs)),
      nativeMs: quantiles(arms.map((a) => a.scanMs)),
      foundOnlyByTeam: cases.filter(
        (c) =>
          c.arms.find((a) => a.size === size).correct &&
          !c.arms.find((a) => a.size === 1).correct,
      ).length,
    };
  });
  const report = {
    schema: 1,
    baseline,
    seed,
    checkpoint: state.audit.tip,
    code: process.env.GITHUB_SHA ?? null,
    createdAt: new Date().toISOString(),
    resources: {
      creditCeilingPerCase: 100,
      maxNativeLanes: Math.min(4, availableParallelism()),
      cpu: cpus()[0]?.model,
      availableCpus: availableParallelism(),
      node: process.version,
      storage: "SQLite WAL FULL en disco",
    },
    summary,
    cases,
  };
  const output = join(dir, "equipos.json");
  writeFileSync(output + ".tmp", JSON.stringify(report, null, 2) + "\n");
  renameSync(output + ".tmp", output);
  console.log(JSON.stringify(summary));
} finally {
  rmSync(root, { recursive: true, force: true });
}
