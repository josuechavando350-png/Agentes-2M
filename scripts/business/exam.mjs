import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  fitAccounts,
  accountForecast,
  allocate,
  gradeAccounts,
  improves,
} from "../../src/account-market.mjs";
import { digest } from "../../src/policy.mjs";
const [mode, path, ...args] = process.argv.slice(2),
  dir = resolve(path ?? ".cache/negocios/data");
const read = (file) => JSON.parse(readFileSync(join(dir, file + ".json")));
const write = (file, body) => {
  const name = join(dir, file + ".json");
  writeFileSync(
    name + ".tmp",
    JSON.stringify(body, null, file === "negocios" ? 2 : undefined) + "\n",
  );
  renameSync(name + ".tmp", name);
};
const decide = (rows, model) =>
  allocate(rows.map((r) => accountForecast(r, model, [1])));
const compact = (items) =>
  items.map(({ id, source, probability, decision }) => ({
    id,
    source,
    probability,
    decision,
  }));
function train() {
  const train = read("train-cases"),
    val = read("validation-cases"),
    labels = read("train-outcomes"),
    vl = read("validation-outcomes");
  assert.equal(
    new Set([...train, ...val].map((r) => r.id)).size,
    train.length + val.length,
  );
  assert.ok(
    train.every((r) => r.cutoff === "2011-04-01") &&
      val.every((r) => r.cutoff === "2011-07-01"),
  );
  const baseline = fitAccounts(train, labels, 1),
    challenger = fitAccounts(train, labels, 10);
  const a = gradeAccounts(decide(val, baseline), vl),
    b = gradeAccounts(decide(val, challenger), vl);
  const selected = improves(b, a) ? "challenger" : "baseline";
  write("model", {
    version: 1,
    scope: "positive-net-invoicing-next-30-days",
    trainCases: train.length,
    trainIds: train.map((r) => r.id),
    validationIds: val.map((r) => r.id),
    baseline,
    challenger,
    selected,
    validation: { baseline: a, challenger: b },
  });
}
async function predict() {
  const { Semar } = await import("../../src/semar.mjs");
  const model = read("model"),
    rows = read("test-cases"),
    used = new Set([...model.trainIds, ...model.validationIds]);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(rows.every((r) => !used.has(r.id) && r.cutoff === "2011-10-01"));
  const exam = digest(rows),
    root = mkdtempSync(join(tmpdir(), "semar-examen-"));
  const arms = {};
  try {
    for (const [name, size, policy] of [
      ["solo", 1, model.selected],
      ["ten", 10, model.selected],
      ["incumbent", 1, "baseline"],
    ]) {
      const start = performance.now(),
        system = new Semar(join(root, name + ".sqlite"), {
          clock: () => 1800000000000,
        });
      try {
        await system.command("inicio", { type: "init", reserve: 100000 });
        const creditCeiling = rows.length * 10;
        await system.command("abrir", {
          type: "open_mission",
          mission: "examen",
          budget: 4 * creditCeiling,
        });
        const forecasts = [];
        let reads = 0;
        for (const row of rows) {
          const r = await system.command(row.id, {
            type: "account_prediction",
            mission: "examen",
            size,
            row,
            model: model[policy],
          });
          assert.equal(r.status, "ACCOUNT_FORECAST");
          const f = r.detail;
          assert.equal(f.source, digest(row));
          assert.equal(f.parts.length, 10);
          assert.equal(
            new Set(f.parts.map((p) => system.agent(p.actor).sector)).size,
            size,
          );
          reads += f.parts.length;
          forecasts.push(f);
        }
        const decisions = compact(allocate(forecasts));
        arms[name] = {
          decisions,
          creditCeiling,
          creditsSpent: system.mission().mission.spent,
          reads,
          elapsedMs: performance.now() - start,
          checkpoint: system.checkpoint().tip,
        };
        assert.equal(arms[name].creditsSpent, size * rows.length);
        assert.equal(system.audit().status, "VERIFIED");
      } finally {
        system.close();
      }
    }
    const decisionCommitment = digest(
      Object.fromEntries(
        Object.entries(arms).map(([name, a]) => [name, a.decisions]),
      ),
    );
    write("predictions", {
      exam,
      decisionCommitment,
      code: process.env.GITHUB_SHA ?? null,
      model: digest(model),
      arms,
    });
    write("human-packet", {
      exam,
      target: "Facturación neta positiva en los 30 días siguientes",
      pilotSlots: Math.floor(rows.length * 0.2),
      investigationSlots: Math.floor(rows.length * 0.4),
      maxFieldReads: rows.length * 10,
      cases: rows.map((r) => ({ ...r, source: digest(r) })),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function grade() {
  const frozen = read("predictions"),
    model = read("model"),
    rows = read("test-cases");
  assert.equal(frozen.exam, digest(rows));
  assert.equal(frozen.model, digest(model));
  assert.equal(
    frozen.decisionCommitment,
    digest(
      Object.fromEntries(
        Object.entries(frozen.arms).map(([name, a]) => [name, a.decisions]),
      ),
    ),
  );
  const labels = read("test-outcomes"),
    sources = new Map(rows.map((r) => [r.id, digest(r)]));
  const summary = {};
  for (const [name, arm] of Object.entries(frozen.arms)) {
    assert.ok(arm.decisions.every((p) => p.source === sources.get(p.id)));
    assert.deepEqual(arm.decisions, compact(allocate(arm.decisions)));
    const { decisions, ...resources } = arm;
    summary[name] = { ...gradeAccounts(decisions, labels), ...resources };
  }
  let human = null;
  if (args[0]) {
    const submission = JSON.parse(readFileSync(args[0]));
    assert.equal(submission.exam, frozen.exam);
    if (
      !Array.isArray(submission.predictions) ||
      submission.predictions.length !== rows.length
    )
      throw Error("Predicciones humanas incompletas");
    for (const p of submission.predictions)
      assert.equal(p.source, sources.get(p.id));
    human = gradeAccounts(allocate(submission.predictions), labels);
  }
  const disagreements = frozen.arms.ten.decisions.filter(
    (p, i) =>
      p.decision !== frozen.arms.solo.decisions[i].decision ||
      p.id !== frozen.arms.solo.decisions[i].id,
  ).length;
  const promoted =
    model.selected === "challenger" && improves(summary.ten, summary.incumbent);
  const report = {
    source: {
      author: "Daqing Chen",
      dataset: "Online Retail, UCI",
      doi: "10.24432/C5BW33",
      license: "CC BY 4.0",
      url: "https://archive.ics.uci.edu/dataset/352/online+retail",
      sha256Zip:
        "f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b",
    },
    scope: model.scope,
    code: frozen.code,
    exam: frozen.exam,
    decisionCommitment: frozen.decisionCommitment,
    predictionsHash: digest(frozen),
    cutoff: rows[0].cutoff,
    trainCases: model.trainCases,
    validation: model.validation,
    validationSelected: model.selected,
    modelHashes: {
      baseline: digest(model.baseline),
      challenger: digest(model.challenger),
    },
    summary,
    human,
    disagreements,
    promoted,
    cashEvidence: null,
    cases: frozen.arms.ten.decisions.map((p) => ({
      ...p,
      observedNetInvoice: labels[p.id],
    })),
  };
  write("negocios", report);
  write("account-policy", {
    scope: model.scope,
    model: promoted ? model.challenger : model.baseline,
    exam: frozen.exam,
    decision: promoted ? "PROMOTED" : "HOLD_BASELINE",
    report: digest(report),
  });
  console.log(
    JSON.stringify({
      selected: model.selected,
      promoted,
      disagreements,
      summary,
      human,
    }),
  );
}
if (mode === "train") train();
else if (mode === "predict") await predict();
else if (mode === "grade") grade();
else throw Error("Usa train, predict o grade");
