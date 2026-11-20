import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { digest } from "../src/policy.mjs";
import {
  exampleBook,
  exampleGoal,
  exampleSource,
} from "../scripts/global/demo.mjs";
import { experiments } from "../src/global-analysis.mjs";
import { GlobalDesk } from "../src/global-desk.mjs";
import { routedRank, scaleExam } from "../src/global-scale.mjs";
const exec = promisify(execFile);
async function setup(t, patch = {}, customClock) {
  const dir = mkdtempSync(join(tmpdir(), "semar-global-test-")),
    path = join(dir, "db.sqlite");
  const clock = customClock ?? Date.now;
  const e = await exampleBook(path, clock);
  t.after(() => {
    e.close();
    rmSync(dir, { force: true, recursive: true });
  });
  Object.assign(e.grant, patch);
  e.command("open", "abrir", e.grant);
  return { ...e, dir, path, now: clock() };
}
test("shared monetary ceiling survives racing command processes, restart, last cent and a late retry", async (t) => {
  const e = await setup(t, { budgetCents: 10 }),
    g = exampleGoal();
  const run = async (id, goal) => {
    const file = join(e.dir, id + ".json");
    writeFileSync(
      file,
      JSON.stringify(e.message("reserve", id, { goal, cap: 10 })),
    );
    return exec(process.execPath, ["src/cli.mjs", "global-command", file], {
      env: { ...process.env, SEMAR_DB: e.path },
    });
  };
  const res = await Promise.allSettled([
    run("a", g),
    run("b", { ...g, subject: "otro" }),
  ]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  const win = e.desk.view().jobs[0].id;
  assert.equal(e.desk.view().freeCents, 0);
  assert.equal(e.desk.view().status, "ACTIVE");
  const reopened = new GlobalDesk(e.path, e.store);
  t.after(() => reopened.close());
  const answer = await reopened.work(win);
  assert.equal(answer.decision.action, "NEED_EVIDENCE");
  await e.desk.work(win);
  e.command("settle", "pago", {
    job: win,
    cents: 10,
    reference: "recibo-externo",
  });
  e.command("settle", "pago", {
    job: win,
    cents: 10,
    reference: "recibo-externo",
  });
  assert.equal(e.desk.view().status, "DEAD");
  assert.equal(e.store.agent(500).status, "DEAD");
  assert.throws(() => e.store.layout(), /agotado/);
  await assert.rejects(
    e.store.command("otra", {
      type: "work",
      id: 500,
      generation: 1,
      version: 1,
      op: "sum",
      data: [1],
    }),
    /agotado/,
  );
  assert.throws(
    () => e.command("reserve", "revivir", { goal: g, cap: 1 }),
    /cero/,
  );
  assert.equal((await reopened.replay(win)).verified, true);
});
test("individual zero applies to the ordinary executor, releases are idempotent and a zero initial grant is final", async (t) => {
  const actors = [
    { id: 1, generation: 1, limit: 2, ops: ["lookup"], policy: "indexed" },
    {
      id: 1000001,
      generation: 1,
      limit: 10,
      ops: ["difference"],
      policy: "indexed",
    },
  ];
  const e = await setup(t, { actors }),
    g = {
      ...exampleGoal(),
      op: "lookup",
      operands: exampleGoal().operands.slice(0, 1),
      probes: [],
    };
  e.command("reserve", "leer", { goal: g, cap: 2 });
  await e.desk.work("leer");
  e.command("settle", "pago", { job: "leer", cents: 2, reference: "unico" });
  assert.equal(e.store.agent(1).status, "DEAD");
  assert.equal(e.store.agent(1000001).status, "LIVE");
  await assert.rejects(
    e.store.command("muerto", {
      type: "work",
      id: 1,
      generation: 1,
      version: 1,
      op: "sum",
      data: [1],
    }),
    /retirada/,
  );
  const shared = e.command("reserve", "ya-leido", { goal: g, cap: 1 });
  assert.equal(shared.kind, "shared");
  assert.equal(
    (await e.desk.work("ya-leido")).decision.action,
    "NEED_EVIDENCE",
  );
  assert.throws(
    () =>
      e.command("reserve", "sin-lector", {
        goal: { ...g, threshold: 12 },
        cap: 1,
      }),
    /equipo/,
  );
  e.command("reserve", "otro", { goal: exampleGoal(), cap: 10 });
  e.command("cancel", "cancelar", { job: "otro" });
  e.command("cancel", "cancelar", { job: "otro" });
  assert.equal(e.desk.view().freeCents, 98);
  const z = await setup(t, { budgetCents: 0 });
  assert.equal(z.desk.view().status, "DEAD");
  assert.throws(
    () => z.command("reserve", "gratis", { goal: g, cap: 1 }),
    /cero/,
  );
});
test("claim dependencies, indirect provenance, contradiction, deadlines, scoped feedback and archived replay", async (t) => {
  let now = 1800000000000;
  const e = await setup(t, {}, () => now),
    g = exampleGoal();
  const add = (id, roots) => {
    const d = exampleSource(id, roots[0], now);
    d.roots = roots;
    return e.command("source", "s-" + id, d).data;
  };
  add("a", ["x"]);
  add("b", ["y"]);
  add("c", ["x", "y"]);
  e.command("reserve", "antes", { goal: g, cap: 5 });
  const one = (await e.desk.work("antes")).decision;
  assert.equal(one.action, "NEED_EVIDENCE");
  assert.equal(one.evidence[0].independent, 1);
  assert.equal(one.next.id, "contraste");
  assert.deepEqual(
    one.reviews.map((r) => r.sector),
    [1, 2],
  );
  add("d", ["z"]);
  assert.equal(e.desk.view().jobs[0].freshness, "REVIEW_REQUIRED");
  e.command("refresh", "despues", { job: "antes", cap: 5 });
  const result = await e.desk.work("despues");
  assert.equal(result.decision.value, 45);
  assert.equal(result.nexus.roles.length, 3);
  assert.equal(result.decision.commercial.next, "TEST_AGAINST_CONTROL");
  e.command("feedback", "observado", {
    job: "despues",
    resultHash: digest(result),
    action: "ADVANCE",
    reference: "revision-independiente",
    until: now + 80000,
  });
  assert.equal((await e.desk.regressions()).failures, 0);
  const newGoal = { ...g, threshold: 44 };
  const next = e.command("reserve", "aprendido", { goal: newGoal, cap: 5 });
  assert.equal(next.data.snapshot.worker.examined, 1);
  const changed = exampleSource("d", "z", now, 85);
  changed.previous = e.desk.read().docs.get("d").version;
  e.command("source", "corregida", changed);
  await assert.rejects(e.desk.work("aprendido"), /caducado/);
  assert.equal((await e.desk.replay("despues")).verified, true);
  e.command("refresh", "conflicto", { job: "despues", cap: 5 });
  assert.equal(
    (await e.desk.work("conflicto")).decision.oracle.status,
    "CONFLICTED",
  );
  now += 2 * 86400000;
  const exp = e.command("reserve", "caducas", { goal: g, cap: 5 });
  assert.equal(exp.data.snapshot.worker.examined, 0);
  assert.equal((await e.desk.work("caducas")).decision.action, "NEED_EVIDENCE");
});
test("unsigned documents cannot grant tools, introduce another unit, or authorize spending", async (t) => {
  const e = await setup(t, { permissions: ["read"] });
  const d = exampleSource("doc", "root", e.now);
  const forged = e.message("source", "falsa", d);
  forged.record.data.document.rows[0].value = 100000;
  assert.throws(() => e.desk.command(forged), /firmada/);
  assert.throws(
    () => e.command("reserve", "calculo", { goal: exampleGoal(), cap: 1 }),
    /permiso/,
  );
  assert.throws(
    () => e.command("contact", "correo", { subject: "cliente" }),
    /fuera/,
  );
  const g = exampleGoal();
  g.operands[1].unit = "dolares";
  assert.throws(
    () => e.command("reserve", "moneda", { goal: g, cap: 1 }),
    /unidades/,
  );
  const p = exampleGoal().probes[0];
  assert.deepEqual(
    experiments([p, { ...p, id: "caro", costCents: 55 }], 10, 20, [
      "costo",
    ]).map((v) => [v.id, v.expectedGainCents, v.eligible]),
    [
      ["contraste", 49, true],
      ["caro", -5, false],
    ],
  );
});
test("a synthesized recipe is sealed before scoring, beats its control, and expires after source revision", async (t) => {
  const e = await setup(t, {
      budgetCents: 1200,
      actors: [
        {
          id: 1,
          generation: 1,
          limit: 1000,
          ops: ["lookup", "difference"],
          policy: "indexed",
        },
      ],
    }),
    d = exampleSource("base", "primario", e.now);
  d.document.rows = ["a", "b", "c", "d", "nuevo"].flatMap((subject, i) => [
    { subject, field: "ingreso", value: 40 + 3 * i },
    { subject, field: "costo", value: 9 + i },
  ]);
  const admitted = e.command("source", "entrenar", d).data;
  const labels = { c: 35, d: 37 },
    salt = "sal-privada-del-examen";
  const input = {
    scope: d.scope,
    fields: ["ingreso", "costo"],
    incumbent: { op: "lookup", fields: ["ingreso"] },
    examples: [
      { subject: "a", value: 31 },
      { subject: "b", value: 33 },
    ],
    testSubjects: ["c", "d"],
    labelsHash: digest({ salt, labels }),
    until: d.until,
  };
  const proposal = e.command("propose", "evolucion", input);
  assert.equal(proposal.data.candidate.op, "difference");
  const spec = {
    proposal: "evolucion",
    goal: { ...exampleGoal(), subject: "nuevo", minFamilies: 1 },
    cap: 2,
  };
  assert.throws(
    () => e.command("reserve-method", "temprano", spec),
    /admitida/,
  );
  assert.throws(
    () =>
      e.command("examine", "trampa", {
        proposal: "evolucion",
        salt,
        labels: { c: 2, d: 37 },
      }),
    /reservada/,
  );
  const exam = e.command("examine", "salud", {
    proposal: "evolucion",
    salt,
    labels,
  });
  assert.equal(exam.data.admitted, true);
  e.command("reserve-method", "publicar", spec);
  assert.equal((await e.desk.work("publicar")).decision.value, 39);
  await e.store.command("incubar", { type: "reserve_births" });
  const work = (id) => ({
    type: "work",
    id,
    generation: 1,
    version: 1,
    op: "nonAdjacent",
    data: [8, 1, 9, 2, 8],
  });
  await e.store.command("maestro", work(5000001));
  const cohort = await e.store.command("evolucion-escuela", work(1000001));
  assert.equal(cohort.replicas, 666);
  const release = {
    proposal: "evolucion",
    birth: "evolucion-escuela",
    sponsor: 1,
    generation: 1,
    perAgentCents: 1,
  };
  const deployment = e.command("deploy", "publicar-version", release);
  assert.equal(deployment.data.members.length, 666);
  assert.throws(
    () => e.command("deploy", "duplicar-version", release),
    /cohorte/,
  );
  const clone = e.command("reserve-method", "hija", {
    ...spec,
    cap: 1,
    replica: cohort.last,
  });
  assert.equal(clone.data.snapshot.worker.id, cohort.last);
  assert.equal((await e.desk.work("hija")).decision.value, 39);
  e.command("source", "revision", { ...d, previous: admitted.version });
  assert.throws(() => e.command("reserve-method", "otra", spec), /admitida/);
});
test("native scale arms do separate work, reproduce the full votes and constrain routing to the measured scope", async (t) => {
  const e = await setup(t);
  const row = (id, cutoff, day, i) => ({
    id,
    cutoff,
    features: {
      recency: i + 1,
      orders: 2,
      gross_pence: 100,
      returns_permille: 0,
      recent_orders: 1,
      active_weeks: 2,
      sku_count: 2,
      largest_share: 600,
      gap_days: 7,
      last_pence: 50,
    },
    references: [{ invoice: id, day, firstRow: 2 }],
  });
  const cases = Array.from({ length: 5 }, (_, i) =>
    row("q" + i, "2020-03-01", "2020-02-23", i),
  );
  const packet = {
    niche: "test",
    historical: [
      row("a", "2019-01-15", "2019-01-12", 0),
      row("b", "2019-01-15", "2019-01-12", 2),
    ],
    outcomes: { a: 1, b: 0 },
    queries: cases,
  };
  const labels = Object.fromEntries(cases.map((q, i) => [q.id, i % 2]));
  const layout = e.store.layout(),
    r = scaleExam(layout, packet, labels, 1);
  assert.deepEqual(
    r.arms.map((a) => a.comparisons),
    [5, 100, 1000, 10000],
  );
  const report = {
    cohorts: [
      {
        niche: "test",
        references: 2,
        cases: 5,
        maturedAt: "2020-02-01",
        arms: r.arms,
      },
    ],
  };
  assert.equal(routedRank(layout, packet, report, 5).method, "recency");
  assert.throws(
    () => routedRank(layout, { ...packet, niche: "otra" }, report, 100),
    /alcance/,
  );
});
test("Diablo compiles a portfolio brief, revisits a better new subject and requests a precise measure for an unsupported task", async (t) => {
  const e = await setup(t),
    g = exampleGoal();
  for (const k of ["a", "b"])
    e.command("source", k, exampleSource(k, k, e.now));
  const brief = {
    scope: g.scope,
    question: "Encuentra una oportunidad de margen",
    subject: null,
    unit: "centavos",
    stage: "conciliado",
    threshold: g.threshold,
    minFamilies: 2,
    probes: [],
  };
  e.command("reserve-brief", "cartera", { brief, cap: 4 });
  const first = await e.desk.work("cartera");
  assert.equal(first.decision.planning.alternatives[0].subject, "cliente");
  for (const k of ["p", "q"]) {
    const d = exampleSource(k, k, e.now, 10);
    d.document.rows.forEach((r) => (r.subject = "nuevo"));
    e.command("source", k, d);
  }
  assert.equal(e.desk.view().jobs[0].freshness, "REVIEW_REQUIRED");
  e.command("refresh", "actualizar", { job: "cartera", cap: 3 });
  const next = await e.desk.work("actualizar");
  assert.equal(next.decision.planning.alternatives[0].subject, "nuevo");
  assert.equal(next.decision.value, 90);
  const correction = e.command("withdraw", "retiro", {
    document: "p",
    previous: e.desk.read().docs.get("p").version,
    reason: "documento retirado",
  });
  assert.equal(correction.kind, "withdraw");
  const unknown = e.command("reserve-brief", "aclarar", {
    brief: { ...brief, question: "Diseña un avión" },
    cap: 3,
  });
  assert.equal(unknown.kind, "clarify");
  assert.equal(e.desk.view().reservedCents, 7);
  assert.deepEqual((await e.desk.audit()).reproduced, [
    "cartera",
    "actualizar",
  ]);
});
test("a reconciled intervention changes the commercial recommendation and a corrected trial invalidates it", async (t) => {
  const e = await setup(t);
  for (const id of ["a", "b"])
    e.command("source", id, exampleSource(id, id, e.now));
  const { fieldLesson, fieldTrials } = e.store;
  t.after(() => {
    e.store.fieldLesson = fieldLesson;
    e.store.fieldTrials = fieldTrials;
  });
  // The real field-lab suite tests signed randomized assignment, payment reconciliation and corrections.
  let qualified = true;
  e.store.fieldLesson = () => ({
    active: { method: qualified ? "candidata" : "control" },
    trials: [
      {
        trial: "ensayo",
        linked: true,
        status: qualified ? "QUALIFIED_IN_SCOPE" : "KEEP_CONTROL",
      },
    ],
  });
  e.store.fieldTrials = () => [
    {
      trial: "ensayo",
      scope: "demostracion",
      mission: "prueba",
      completed: 20,
      incrementalNetPerPairCents: 50,
      observedPaidCents: 2000,
    },
  ];
  e.command("reserve", "accion", { goal: exampleGoal(), cap: 3 });
  const out = await e.desk.work("accion");
  assert.equal(out.decision.commercial.evidence.perPairCents, 50);
  qualified = false;
  assert.equal(e.desk.view().jobs[0].freshness, "REVIEW_REQUIRED");
  e.command("refresh", "corregir", { job: "accion", cap: 3 });
  assert.equal(
    (await e.desk.work("corregir")).decision.commercial.next,
    "TEST_AGAINST_CONTROL",
  );
});
test("a documented miss remains a regression after restart", async (t) => {
  const e = await setup(t),
    g = exampleGoal();
  for (const id of ["a", "b"])
    e.command("source", id, exampleSource(id, id, e.now));
  e.command("reserve", "fallo", { goal: g, cap: 2 });
  const result = await e.desk.work("fallo");
  e.command("feedback", "auditoria-externa", {
    job: "fallo",
    resultHash: digest(result),
    action: "STOP",
    reference: "acta-correctiva",
    until: e.now + 60000,
  });
  const reopened = new GlobalDesk(e.path, e.store);
  t.after(() => reopened.close());
  const report = await reopened.regressions();
  assert.equal(report.failures, 1);
  assert.equal(report.cases[0].expected, "STOP");
});
