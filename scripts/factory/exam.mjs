import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleBook } from "../global/demo.mjs";
import { corpus } from "./fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [destination, seed] = process.argv.slice(2);
const dir = destination
  ? resolve(destination)
  : mkdtempSync(join(tmpdir(), "semar-fabrica-"));
if (destination) mkdirSync(dir);
const state = mkdtempSync(join(tmpdir(), "semar-fabrica-libro-"));
const db = join(state, "factory.sqlite");
const product = join(dir, "producto");
const cli = (entry, args) =>
  JSON.parse(
    execFileSync(process.execPath, [entry, ...args], {
      env: { ...process.env, SEMAR_DB: db },
      encoding: "utf8",
      maxBuffer: 12_000_000,
    }),
  );
const use = (...args) => cli(join(product, "product-cli.mjs"), args);
const save = (file, value) => {
  const path = join(dir, file);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return path;
};
let env;
try {
  const { project, batches, answers, seed: used } = corpus(seed);
  env = await exampleBook(db);
  const { command, desk, grant } = env;
  command("open", "abrir", grant);
  command("factory-reserve", "fabrica", { cap: 10, project });
  const { factory, nexus } = await desk.work("fabrica");
  command("factory-predict", "sellar", { job: "fabrica", groups: batches });
  command("factory-score", "calificar", { job: "fabrica", answers });
  command("settle", "cerrar", {
    job: "fabrica",
    cents: 2,
    reference: "costo-de-demostracion",
  });
  const replay = await desk.replay("fabrica"),
    audit = await desk.audit();
  const exported = cli(join(root, "src/cli.mjs"), [
    "factory-export",
    "fabrica",
    product,
  ]);
  const checked = use("check"),
    grade = checked.grade;
  assert.equal(grade.status, "QUALIFIED_IN_SCOPE");
  const inputs = batches.flatMap((b) =>
    b.cases.map((dossier) => ({ format: 2, dossier })),
  );
  const sample = save("expediente.json", inputs[0]),
    batch = save("lote.json", inputs);
  const single = use("run", sample);
  assert.equal(single.value, answers[0].values[inputs[0].dossier.id]);
  assert.equal(
    single.findings.reduce((sum, a) => sum + a.value, 0),
    single.value,
  );
  const reference = use("batch", batch);
  const native = use("qualify-native"),
    selected = use("batch", batch);
  assert.deepEqual(reference.results, selected.results);
  // Export portable sources; the receiving host qualifies its own optional binary.
  rmSync(join(product, "kernel-" + native.binary));
  rmSync(join(product, "native.json"));
  const labels = Object.assign({}, ...answers.map((a) => a.values));
  for (const result of selected.results)
    assert.equal(result.value, labels[result.case]);
  const replenishment = use(
    "tool",
    "reposicion",
    save("inventario.json", { demanda: 18, dias: 5, stock: 12 }),
  );
  assert.equal(replenishment.value, 78);
  const plan = use("plan", save("proceso.json", project.workflow));
  assert.equal(plan.gap, 0);
  const storage = join(state, "product.sqlite");
  use("install", storage);
  const request = save("alta.json", {
    request: "alta",
    previous: null,
    input: inputs[0],
  });
  const first = use("append", storage, request);
  assert.deepEqual(first, use("append", storage, request));
  assert.equal(use("history", storage).length, 1);
  const report = {
    dataset:
      "generated controlled cases; no real customers, savings or receipts",
    seed: used,
    version: exported.version,
    search: {
      ledgerPrograms: factory.search.attempts.length,
      selected: factory.program.rule,
      formulaAttempts: factory.formulas[0].tried,
      formula: factory.program.tools[0].ast,
      adversarialCases: factory.adversary.cases,
      controls: factory.controls.length,
    },
    exam: {
      correct: grade.correct,
      total: grade.total,
      opportunities: grade.opportunities,
      missing: grade.missing,
      bestControl: grade.bestKnownCorrect,
      falseClaims: grade.falseClaims,
      missed: grade.missed,
      sectors: grade.metrics,
      tools: grade.tools,
      seal: grade.seal,
    },
    workflow: {
      stages: plan.selected,
      baselineMinutes: plan.baselineMinutes,
      optimalMinutes: plan.optimalMinutes,
      gap: plan.gap,
    },
    native: {
      cases: native.cases,
      selected: native.selected,
      nativeMs: native.nativeMs,
      referenceMs: native.referenceMs,
      benchmark: native.benchmark,
    },
    product: {
      single: single.status,
      sourceReferences: single.refs.length,
      batch: inputs.length,
      replenishment: replenishment.value,
      historyRecords: 1,
    },
    nexus: { grounding: nexus.grounding, roles: nexus.roles },
    replay: replay.verified,
    audit: audit.status,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  env?.close();
  rmSync(state, { recursive: true, force: true });
  if (!destination) rmSync(dir, { recursive: true, force: true });
}
