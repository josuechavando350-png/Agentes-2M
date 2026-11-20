import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { corpus } from "../scripts/factory/fixtures.mjs";
import { exampleBook } from "../scripts/global/demo.mjs";
import { hash, trainReader, readDossier, csv } from "../src/factory/reader.mjs";
import {
  discover,
  freezePredictions,
  judge,
} from "../src/factory/discover.mjs";
import { learnRule, evaluate, compute } from "../src/factory/rules.mjs";
import { expertPolicy, gate } from "../src/factory/expert.mjs";
import { verifyRule } from "../src/factory/proof.mjs";
import { challenge } from "../src/factory/challenge.mjs";
import { verifyOptimum } from "../src/factory/workflow.mjs";
import { exportProduct, runtimeStamp } from "../src/factory/export.mjs";
import { fitFormula, generateTools } from "../src/factory/synth.mjs";
import { runProduct, prepare } from "../src/factory/product.mjs";
const clone = structuredClone,
  run = promisify(execFile);
const data = corpus("examen-unitario");
const f = discover(data.project),
  b = data.batches[0],
  rule = f.program.rule,
  reader = trainReader(b.guide, f.program.kinds);
const parse = (c) => readDossier(c, reader, f.program.kinds, "mxn");
const evaluateCase = (c) => evaluate(parse(c), rule, f.program.kinds);
function completed(x) {
  const candidate = discover(x.project),
    predictions = freezePredictions(candidate, x.batches),
    adapters = x.batches.map((b) => ({
      sector: b.sector,
      period: b.period,
      reader: trainReader(b.guide, candidate.program.kinds),
    }));
  const grade = {
    ...judge(candidate, predictions, x.answers),
    programHash: candidate.programHash,
    adaptersHash: hash(adapters),
  };
  return {
    output: { factory: candidate },
    predictions,
    adapters,
    grade,
    snapshot: { factory: x.project, productRuntime: runtimeStamp },
  };
}
const job = completed(data);
test("Las citas sobreviven a duplicados, conflictos, datos omitidos y moneda extraña", () => {
  assert.deepEqual(csv('a,b\r\n"x,x","p""q"'), [
    ["a", "b"],
    ["x,x", 'p"q'],
  ]);
  const found = evaluateCase(b.cases[0]);
  assert.equal(found.status, "FOUND");
  assert.ok(found.entries.some((e) => e.refs.length === 2));
  assert.ok(
    found.findings.every((a) =>
      found.entries.some((e) => e.account === a.account && e.refs[0].row === 2),
    ),
  );
  const c = clone(b.cases[0]);
  c.registers[0].files[1].csv = c.registers[0].files[1].csv.replace(
    /,\d+,mxn$/,
    ",1,mxn",
  );
  assert.ok(
    evaluateCase(c).questions.some((q) => q.error === "CONFLICTING_ENTRY"),
  );
  c.registers.pop();
  assert.ok(
    evaluateCase(c).questions.some((q) => q.error === "MISSING_REGISTER"),
  );
  assert.equal(evaluateCase(b.cases[4]).status, "NEED_EVIDENCE");
  const open = evaluateCase(b.cases[2]);
  assert.equal(open.value, null);
  assert.ok(open.worlds[0].value < open.worlds[1].value);
  assert.ok(open.questions[0].register);
  for (const world of open.worlds) {
    const p = parse(b.cases[2]);
    for (const completion of world.completion) {
      const r = p.open.find((r) => r.register === completion.register);
      p.groups.find((g) => g.account === r.account).values[
        f.program.kinds.indexOf(r.kind)
      ] += completion.amount;
    }
    assert.equal(compute(rule, p.groups), world.value);
  }
});
test("El experto distingue dos explicaciones y el sistema se abstiene fuera del lenguaje", () => {
  const insufficient = [
    {
      parsed: { id: "uno", groups: [{ account: "a", values: [0, 0, 0] }] },
      value: 0,
    },
  ];
  const amb = learnRule(insufficient, f.program.kinds, [500], 40000);
  assert.equal(amb.status, "ASK_EXPERT");
  assert.notEqual(amb.question.first, amb.question.second);
  assert.equal(
    learnRule(insufficient, f.program.kinds, [500], 1).status,
    "SEARCH_BUDGET_EXHAUSTED",
  );
  assert.equal(
    learnRule([{ ...insufficient[0], value: 1 }], f.program.kinds, [500], 40000)
      .status,
    "OUTSIDE_LANGUAGE",
  );
  const history = clone(data.project.expert);
  history.sessions = history.sessions.slice(0, 2);
  assert.equal(expertPolicy(history).status, "ASK_EXPERT");
  assert.equal(gate(f.program.expert, { firmado: true }).allowed, false);
  assert.equal(
    gate(f.program.expert, { firmado: true, conciliado: true }).allowed,
    true,
  );
});
test("La prueba entera y el certificado de optimalidad rechazan manipulaciones", () => {
  const proof = clone(f.program.proof);
  proof.maxAnswer = "42";
  assert.throws(() => verifyRule(rule, proof));
  const opt = clone(f.workflow.certificate);
  opt.alternatives.pop();
  assert.throws(() => verifyOptimum(data.project.workflow, opt));
  const bad = clone(f.workflow.certificate);
  bad.winner.cost = 0;
  assert.throws(() => verifyOptimum(data.project.workflow, bad));
  assert.equal(f.workflow.gap, 0);
  assert.deepEqual(f.workflow.selected, ["conciliar"]);
  const refuted = challenge(
    rule,
    [],
    (r, g) => compute(r, g) + (g.some((x) => x.values[0] > 1) ? 1 : 0),
  );
  assert.equal(refuted.passed, false);
  assert.equal(refuted.witness.length, 1);
  assert.notEqual(refuted.expected, refuted.actual);
});
test("Las etiquetas se abren después del sello y una referencia igual de buena impide exportar", () => {
  const answers = clone(data.answers);
  answers[0].salt += "x";
  assert.throws(() => judge(f, job.predictions, answers), /Clave/);
  const changed = clone(job.predictions);
  changed.batches[0].predictions[0].value++;
  assert.throws(() => judge(f, changed, data.answers), /alterada/);
  const groups = clone(data.batches);
  groups[0].cases[1] = clone(groups[0].cases[0]);
  groups[0].cases[1].id = "renombrado";
  for (const r of groups[0].cases[1].registers)
    for (const doc of r.files)
      doc.csv = doc.csv.replaceAll(b.cases[0].id, "renombrado");
  const candidate = clone(f);
  candidate.exams[0].inputHash = hash(groups[0]);
  assert.throws(() => freezePredictions(candidate, groups), /reutilizados/);
  const x = clone(data);
  x.project.precedents = [{ name: "regla-existente", rule }];
  const matched = completed(x);
  assert.equal(matched.grade.status, "KEEP_IN_LAB");
  assert.throws(() => exportProduct(matched, "invalid-product"), /aprobado/);
  const leak = clone(data.batches);
  leak[0].answers = data.answers[0].values;
  assert.throws(() => freezePredictions(f, leak), /Campos/);
});
test("El código generado respeta dimensiones, entradas enteras y los casos nuevos", async () => {
  const spec = data.project.tools[0],
    tool = fitFormula(spec);
  const { apply } = await import(
    "data:text/javascript;base64," +
      Buffer.from(generateTools([tool])).toString("base64")
  );
  for (const [i, b] of data.batches.entries())
    for (const [j, r] of b.tools.reposicion.entries())
      assert.equal(apply(tool.id, r), data.answers[i].tools.reposicion[j]);
  assert.throws(() => apply(tool.id, { demanda: 1, dias: 2 }), /dominio/);
  assert.throws(() => apply("otro", {}));
  assert.equal(
    fitFormula({ ...spec, resultUnit: { litros: 1 } }).status,
    "OUTSIDE_LANGUAGE",
  );
});
test("Saldo cero cierra la fábrica y el libro rechaza reaperturas y calificaciones anticipadas", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "semar-exam-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const e = await exampleBook(join(dir, "db"));
  t.after(() => e.close());
  e.command("open", "abrir", { ...e.grant, budgetCents: 10, maxJobCents: 10 });
  e.command("factory-reserve", "candidata", { cap: 10, project: data.project });
  await e.desk.work("candidata");
  assert.throws(
    () =>
      e.command("factory-score", "antes", {
        job: "candidata",
        answers: data.answers,
      }),
    /retirado/,
  );
  e.command("factory-predict", "sellar", {
    job: "candidata",
    groups: data.batches,
  });
  assert.throws(
    () =>
      e.command("factory-predict", "otra", {
        job: "candidata",
        groups: data.batches,
      }),
    /retirado/,
  );
  assert.throws(
    () =>
      e.command("factory-reserve", "repetir", {
        cap: 1,
        project: data.project,
      }),
    /retirado/,
  );
  e.command("factory-score", "calificar", {
    job: "candidata",
    answers: data.answers,
  });
  e.command("settle", "liquidar", {
    job: "candidata",
    cents: 10,
    reference: "costo-del-examen",
  });
  assert.equal(e.desk.view().status, "DEAD");
  assert.throws(
    () =>
      e.command("factory-reserve", "agotado", {
        cap: 1,
        project: data.project,
      }),
    /cero/,
  );
  assert.equal((await e.desk.audit()).status, "VERIFIED");
});
test("Migración con escrituras concurrentes, datos antiguos y reversión exacta", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "semar-upgrade-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = join(dir, "a"),
    bb = join(dir, "b"),
    db = join(dir, "db");
  const v1 = exportProduct(job, a).version,
    v2 = exportProduct(completed(corpus("otra-version")), bb).version;
  assert.notEqual(v1, v2);
  const file = (path, obj) => {
    const p = join(dir, path);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const cli = async (root, ...args) =>
    JSON.parse(
      (
        await run(process.execPath, [join(root, "product-cli.mjs"), ...args], {
          maxBuffer: 4e6,
        })
      ).stdout,
    );
  await cli(a, "install", db);
  const c = b.cases[0],
    legacy = {
      format: 1,
      case: {
        id: c.id,
        sector: c.sector,
        period: c.period,
        flags: c.flags,
        ledgers: c.registers.map((r) => ({
          name: r.id,
          type: r.kind,
          finished: r.closed,
          tables: r.files.map((f) => ({ name: f.id, text: f.csv })),
        })),
      },
    };
  const req = file("primero", {
    request: "primero",
    previous: null,
    input: legacy,
  });
  const [r1, r2] = await Promise.all([
    cli(a, "append", db, req),
    cli(a, "append", db, req),
  ]);
  assert.equal(r1.digest, r2.digest);
  assert.equal((await cli(bb, "install", db)).replayed, 1);
  const r3 = file("corregir", {
    request: "corregir",
    previous: r1.digest,
    input: {
      format: 2,
      dossier: { ...c, flags: { firmado: false, conciliado: true } },
    },
  });
  await Promise.all([cli(bb, "append", db, r3), cli(a, "switch", db, v1)]);
  await cli(a, "switch", db, v1);
  const back = await cli(a, "history", db);
  assert.deepEqual(
    back.map((r) => r.result.status),
    ["FOUND", "NEED_EVIDENCE"],
  );
  await cli(bb, "switch", db, v2);
  const forward = await cli(bb, "history", db);
  assert.deepEqual(
    forward.map((r) => r.digest),
    back.map((r) => r.digest),
  );
  await assert.rejects(
    () =>
      cli(
        bb,
        "append",
        db,
        file("viejo", { request: "viejo", previous: r1.digest, input: legacy }),
      ),
    /caducada/,
  );
  const release = JSON.parse(readFileSync(join(a, "release.json")));
  const foreign = clone(c);
  foreign.sector = "desconocido";
  assert.equal(
    runProduct(release, { format: 2, dossier: foreign }).status,
    "NEED_EVIDENCE",
  );
  const alt = clone(release.adapters[0]);
  alt.period = "distinto";
  alt.reader = release.program.reader;
  release.adapters.push(alt);
  assert.ok(
    prepare(release, { format: 2, dossier: { ...c, period: alt.period } })
      .parsed.issues.length,
  );
  assert.throws(
    () => prepare(release, { format: 2, dossier: { ...c, period: "otro" } }),
    /glosario/,
  );
  writeFileSync(join(a, "tools.mjs"), "throw Error()");
  await assert.rejects(() => cli(a, "check"), /alterado/);
});

test("El titular conserva su puesto ante una copia y las cinco capacidades intervienen", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "semar-titular-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const e = await exampleBook(join(dir, "db"));
  t.after(() => e.close());
  e.command("open", "abrir", e.grant);
  for (const [id, seed] of [
    ["primera", "origen"],
    ["segunda", "copia"],
  ]) {
    const x = corpus(seed);
    e.command("factory-reserve", id, { cap: 10, project: x.project });
    const output = await e.desk.work(id);
    assert.equal(output.nexus.grounding, "SUPPORTED");
    assert.equal(output.nexus.roles.length, 3);
    e.command("factory-predict", "pre-" + id, { job: id, groups: x.batches });
    e.command("factory-score", "post-" + id, { job: id, answers: x.answers });
    const j = e.desk.read().jobs.get(id);
    assert.equal(
      j.grade.status,
      id === "primera" ? "QUALIFIED_IN_SCOPE" : "KEEP_IN_LAB",
    );
    if (id === "segunda")
      assert.equal(j.snapshot.factoryPredecessor.job, "primera");
    e.command("settle", "gasto-" + id, {
      job: id,
      cents: 1,
      reference: "comprobante-" + id,
    });
  }
  assert.equal((await e.desk.audit()).status, "VERIFIED");
});
