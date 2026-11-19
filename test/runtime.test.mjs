import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { Semar, birthCounts } from "../src/semar.mjs";
import {
  canonical,
  CAP,
  INITIAL,
  BATCH,
  STIPEND,
  OPS,
  compute,
  oracle,
  healthExam,
} from "../src/policy.mjs";

async function fixture(t, reserve = 66600) {
  const dir = mkdtempSync(join(tmpdir(), "semar-"));
  const path = join(dir, "db.sqlite");
  const s = new Semar(path);
  t.after(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await s.command("genesis", { type: "init", reserve });
  return { s, path };
}
const work = (id, op = "sum", data = [1, 2]) => ({
  type: "work",
  id,
  generation: 1,
  version: 1,
  op,
  data,
});

test("ten million initial funded identities partitioned equally, ten leaders and a single supreme", async (t) => {
  const { s } = await fixture(t);
  assert.equal(s.status().population, INITIAL);
  assert.equal(s.status().leaders.filter((l) => l.supreme).length, 1);
  for (let i = 0; i < 10; i++) {
    assert.equal(s.agent(i * 1_000_000 + 1).sector, i + 1);
    assert.equal(s.agent((i + 1) * 1_000_000).sector, i + 1);
  }
  assert.throws(() => s.agent(INITIAL + 1));
  assert.equal(s.audit().status, "VERIFIED");
});

test("real Nexus pipeline reads shared memory, explores arms and preserves the results across restarts", async (t) => {
  const { s, path } = await fixture(t);
  const first = await s.command("uno", work(1));
  const other = new Semar(path);
  t.after(() => other.close());
  const second = await other.command("dos", work(2));
  assert.equal(first.memory, "EMPTY");
  assert.equal(second.memory, "FOUND");
  assert.equal(second.peer, "uno");
  assert.equal(second.grounding, "SUPPORTED");
  assert.match(second.answer, /3/);
  assert.deepEqual(
    second.verdicts.map((v) => v.role),
    ["PLANNER", "CRITIC", "VERIFIER"],
  );
  assert.ok(second.verdicts.every((v) => v.verdict === "ACCEPT"));
  assert.notEqual(first.arm, second.arm);
  const outcomes = [first.arm, second.arm];
  for (let i = 0; i < 6; i++)
    outcomes.push((await s.command("turno-" + i, work(3 + i))).arm);
  assert.equal(outcomes[6], "breve");
  assert.equal(s.audit().deliveries, 8);
});

test("two simultaneous attempts with the same key debit once; changed input conflicts", async (t) => {
  const { s } = await fixture(t);
  const [a, b] = await Promise.all([
    s.command("igual", work(1)),
    s.command("igual", work(1)),
  ]);
  assert.deepEqual(a, b);
  assert.equal(s.agent(1).balance, STIPEND - 1);
  await assert.rejects(s.command("igual", work(2)), /repetida/);
});

test("the last credit causes terminal death, including after restart", async (t) => {
  const { s, path } = await fixture(t);
  let res;
  for (let i = 0; i < STIPEND; i++)
    res = await s.command("gasto-" + i, work(1));
  assert.equal(res.status, "DEAD_ZERO");
  assert.equal(s.agent(1).balance, 0);
  const reopened = new Semar(path);
  t.after(() => reopened.close());
  await assert.rejects(reopened.command("todavia", work(1)), /muerta/);
  assert.equal(reopened.status().dead, 1);
  assert.equal(reopened.audit().deliveries, STIPEND - 1);
});

test("forged claims cannot punish a worker; an authenticated wrong delivery retires its identity and its key", async (t) => {
  const { s } = await fixture(t);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const common = { id: 1, generation: 1, version: 1 };
  await s.command("alta", {
    type: "register",
    ...common,
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  });
  const body = { type: "submit", ...common, op: "sum", data: [2, 1], value: 5 };
  assert.equal(
    (await s.command("falso", { ...body, signature: "fake" })).status,
    "INVALID_SIGNATURE",
  );
  assert.equal(s.agent(1).balance, STIPEND);
  const signature = sign(
    null,
    Buffer.from(canonical({ key: "erronea", packet: body })),
    privateKey,
  ).toString("base64");
  const result = await s.command("erronea", { ...body, signature });
  assert.equal(result.status, "REPLACED");
  assert.equal(result.expected, 3);
  assert.equal(s.agent(1).generation, 2);
  assert.equal(s.agent(1).publicKey, null);
  await assert.rejects(s.command("anterior", work(1)), /caducada/);
  assert.equal(
    (await s.command("relevo", { ...work(1), generation: 2 })).value,
    3,
  );
  assert.equal(s.audit().deliveries, 1);
});

test("health-sector student learns from another sector, all 666 clones act with the approved policy", async (t) => {
  const { s } = await fixture(t);
  const student = 1_000_001;
  assert.equal(
    (await s.command("sin-fuente", work(student, "nonAdjacent"))).status,
    "NEEDS_TRAINING",
  );
  await s.command("maestro", work(5_000_001, "nonAdjacent", [9, 1, 9]));
  const evolved = await s.command(
    "salud",
    work(student, "nonAdjacent", [9, 1, 10]),
  );
  assert.equal(evolved.status, "APPROVED");
  assert.equal(evolved.value, 19);
  assert.equal(evolved.last - evolved.first + 1, BATCH);
  assert.equal(evolved.peer, "maestro");
  for (let i = evolved.first; i <= evolved.last; i++) {
    const a = s.agent(i);
    assert.ok(a.skills.includes("nonAdjacent"));
    assert.equal(a.sector, 2);
    assert.equal(a.version, 2);
  }
  assert.equal(
    (
      await s.command("descendiente", {
        ...work(evolved.last, "nonAdjacent", [4, -2, 7]),
        version: 2,
      })
    ).value,
    11,
  );
  assert.equal(s.audit().replicaCertificates, BATCH);
  assert.equal(s.status().treasury, 66600 - BATCH * STIPEND);
  // A child can evolve again from a different evidence-backed peer.
  await s.command("segundo-maestro", work(1, "minimum", [-4, 1]));
  const next = await s.command("segunda-generacion", {
    ...work(evolved.first, "minimum", [-9, 2]),
    version: 2,
  });
  assert.equal(next.version, 3);
  assert.equal(s.audit().replicaCertificates, 2 * BATCH);
});

test("no funding or external lesson blocks promotion, final batch respects one trillion", async (t) => {
  const { s } = await fixture(t, 0);
  await s.command("maestro", work(5_000_001, "nonAdjacent"));
  const result = await s.command("bloqueada", work(1, "nonAdjacent"));
  assert.equal(result.status, "RESERVE_TOO_LOW");
  assert.equal(s.agent(1).version, 1);
  assert.equal(s.status().population, INITIAL);
  assert.equal(s.audit().replicaCertificates, 0);
  assert.deepEqual(birthCounts(CAP - 1), { count: 1, standby: 665 });
  assert.deepEqual(birthCounts(CAP), { count: 0, standby: BATCH });
  assert.throws(() => birthCounts(CAP + 1));
});

test("council broadcast and responses can be read incrementally by every leader", async (t) => {
  const { s } = await fixture(t);
  await s.command("uno", work(1));
  const result = await s.command("consejo", {
    type: "council",
    sector: 2,
    op: "sum",
  });
  assert.equal(result.replies.length, 10);
  assert.equal(result.replies[0].teacher, "uno");
  for (let i = 1; i <= 10; i++)
    assert.deepEqual(s.feed("L" + i, 2, 1)[0].result, result);
  assert.throws(() => s.feed("L11"));
});

test("unexpected authority, bribes and fabricated score fields never approve a task; regressions rejected", async (t) => {
  const { s } = await fixture(t);
  for (const injected of [
    { reward: 999 },
    { approved: true },
    { sector: 2 },
    { balance: 99 },
    { bribe: 888 },
  ]) {
    await assert.rejects(
      s.command("fraude-" + Object.keys(injected)[0].toLowerCase(), {
        ...work(1),
        ...injected,
      }),
      /Campos/,
    );
  }
  assert.throws(
    () => healthExam(["sum"], ["maximum", "count"], "x"),
    /inválida/,
  );
  assert.throws(() => healthExam(["sum"], ["sum"], "x"));
  assert.equal(s.audit().deliveries, 0);
});

test("oracle reproduces every supported operation including negatives, ties and limits", () => {
  for (const op of OPS.filter((op) => op !== "inference"))
    for (const a of [
      [-1],
      [-5, -2, -9],
      [1, 1],
      [8, -20, 9, 2, -8],
      Array(16).fill(1000000),
    ]) {
      assert.equal(compute(op, a), oracle(op, a));
    }
});

test("audit verifies externally retained tip; modified ledger fails closed", async (t) => {
  const { s, path } = await fixture(t);
  await s.command("uno", work(1));
  const tip = s.status().tip;
  assert.equal(s.audit(tip).tip, tip);
  assert.throws(() => s.audit("bad"), /Ancla/);
  const db = new DatabaseSync(path);
  assert.throws(
    () => db.exec("UPDATE journal SET hash='x' WHERE seq=2"),
    /immutable/,
  );
  db.exec(
    "DROP TRIGGER immutable_update; UPDATE journal SET hash='x' WHERE seq=2",
  );
  db.close();
  assert.throws(() => s.audit(), /alterada/);
  await assert.rejects(s.command("dos", work(1)), /alterada/);
});

test("concurrent CLI processes share one accountable debit", async (t) => {
  const { s, path } = await fixture(t);
  function child() {
    const p = spawn(
      process.execPath,
      ["src/cli.mjs", "request", "process-retry"],
      { env: { ...process.env, SEMAR_DB: path } },
    );
    p.stdin.end(JSON.stringify(work(1)));
    let output = "",
      error = "";
    p.stdout.on("data", (d) => (output += d));
    p.stderr.on("data", (d) => (error += d));
    return new Promise((ok, no) => {
      p.on("error", no);
      p.on("close", (code) =>
        code ? no(Error(error)) : ok(JSON.parse(output)),
      );
    });
  }
  const [a, b] = await Promise.all([child(), child()]);
  assert.deepEqual(a, b);
  assert.equal(s.audit().deliveries, 1);
  assert.equal(s.status().spent, 1);
});

test("scientific dossiers carry evidence across sectors; contradiction stays local and cyclic rules cannot create a fact", async (t) => {
  const { s } = await fixture(t);
  const data = {
    facts: [
      { literal: "documentado", source: "registro A" },
      { literal: "inspeccionado", source: "registro B" },
      { literal: "!listo", source: "registro C" },
    ],
    rules: [
      { if: ["documentado"], then: "trazable", source: "criterio 1" },
      {
        if: ["trazable", "inspeccionado"],
        then: "listo",
        source: "criterio 2",
      },
      { if: ["bucle"], then: "bucle", source: "criterio 3" },
    ],
    query: "listo",
  };
  const first = await s.command(
    "expediente",
    work(6_000_001, "inference", data),
  );
  assert.equal(first.value, "CONFLICTED");
  assert.equal(first.proof.length, 5);
  const recall = (from, query, version) => ({
    type: "recall",
    id: 1_000_001,
    generation: 1,
    version,
    from,
    query,
  });
  const next = await s.command(
    "otra-pregunta",
    recall("expediente", "trazable", 1),
  );
  assert.equal(next.value, "SUPPORTED");
  assert.equal(next.caseSource, "expediente");
  assert.equal(next.replicas, BATCH);
  assert.equal(
    (await s.command("ciclo", recall("expediente", "bucle", 2))).value,
    "UNKNOWN",
  );
  assert.equal(
    (await s.command("ausente", recall("expediente", "otra", 2))).value,
    "UNKNOWN",
  );
  assert.equal(
    (
      await s.command("refutado", {
        ...work(6_000_001, "inference"),
        data: {
          facts: [{ literal: "!listo", source: "control" }],
          rules: [],
          query: "listo",
        },
      })
    ).value,
    "REFUTED",
  );
  assert.equal(s.audit().deliveries, 5);
});

test("admission exams reject invalid sources and forged derivations", async () => {
  const { infer, verifyDerivation, validateCase } = await import(
    "../src/inference.mjs"
  );
  const input = {
    facts: [{ literal: "a", source: "doc" }],
    rules: [{ if: ["a"], then: "b", source: "regla" }],
    query: "b",
  };
  assert.throws(
    () => validateCase({ ...input, facts: [{ literal: "a", source: "" }] }),
    /Fuente/,
  );
  assert.throws(
    () =>
      verifyDerivation(input, {
        value: "SUPPORTED",
        proof: [{ literal: "b", rule: 0 }],
      }),
    /Derivación/,
  );
  const valid = infer(input);
  verifyDerivation(input, valid);
  assert.throws(
    () => verifyDerivation(input, { value: "UNKNOWN", proof: [] }),
    /Oráculo/,
  );
});

test("academy coordinates peer-driven work and resumes the same round without creating another cohort", async (t) => {
  const { s } = await fixture(t);
  const { trainRound } = await import("../src/academy.mjs");
  const one = await trainRound(s, 1);
  const previous = s.status();
  assert.equal(one.status, "COMPLETED");
  assert.equal(one.replicas, BATCH);
  assert.equal(one.leaders, 10);
  assert.deepEqual(await trainRound(s, 1), one);
  assert.deepEqual(s.status(), previous);
  assert.equal(
    s.census(INITIAL + 1, INITIAL + BATCH).sectors[1].identities,
    BATCH,
  );
});

test("portable checkpoint restores atomically, rejects truncation and preserves learned skills", async (t) => {
  const { s } = await fixture(t);
  await s.command("primera", work(1));
  const { events, tip } = s.checkpoint();
  const copy = new Semar(":memory:");
  t.after(() => copy.close());
  assert.throws(() => copy.restore(events.slice(0, 1), tip));
  assert.equal(copy.status().population, 0);
  assert.equal(copy.restore(events, tip).tip, tip);
  assert.deepEqual(copy.agent(1), s.agent(1));
  assert.throws(() => copy.restore(events, tip), /vacía/);
});

test("synthesized decisions inherit evidence, are applied by a child and survive restoration", async (t) => {
  const { researchRound } = await import("../src/research.mjs");
  const { s } = await fixture(t);
  const trial = await researchRound(s, 1);
  assert.equal(trial.status, "COMPLETED");
  assert.deepEqual(
    [
      trial.exam.training,
      trial.exam.heldOut,
      trial.exam.heldOutCorrect,
      trial.exam.correct,
      trial.exam.total,
    ],
    [6, 2, 2, 8, 8],
  );
  assert.ok(trial.exam.baselineCorrect < trial.exam.correct);
  assert.equal(trial.replicas, 666);
  const child = s.agent(trial.first);
  assert.equal(child.programs[0].id, trial.id);
  const state = s.checkpoint(),
    restored = new Semar(":memory:");
  t.after(() => restored.close());
  restored.restore(state.events, state.tip);
  for (const [mask, expected] of [
    [0, "UNKNOWN"],
    [4, "SUPPORTED"],
  ]) {
    const p = await restored.command("predict-" + mask, {
      type: "predict",
      id: child.id,
      generation: 1,
      version: child.version,
      program: trial.id,
      mask,
    });
    assert.equal(p.value, expected);
    assert.equal(p.program, trial.id);
  }
  assert.equal(restored.audit().replicaCertificates, 666);
});
test("a hypothesis fitting every training example is rejected if the unseen outcomes disagree", async (t) => {
  const { s } = await fixture(t);
  const book = {
    facts: [],
    rules: [{ if: ["a", "b"], then: "listo", source: "criterio" }],
    query: "listo",
  };
  await s.command("caso", work(6_000_001, "inference", book));
  const receipt = await s.command("candidata", {
    type: "synthesize",
    id: 6_000_002,
    generation: 1,
    version: 1,
    from: "caso",
    features: ["a", "b", "c"],
  });
  assert.equal(receipt.status, "REJECTED_HYPOTHESIS");
  assert.equal(receipt.exam.heldOutCorrect, 0);
  assert.equal(s.status().population, INITIAL);
  assert.equal(s.audit().replicaCertificates, 0);
});
