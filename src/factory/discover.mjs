import {
  hash,
  check,
  fields,
  num,
  key,
  list,
  unique,
  trainReader,
  readDossier,
} from "./reader.mjs";
import {
  learnRule,
  compute,
  evaluate,
  knownMethods,
  contrast,
} from "./rules.mjs";
import { fitFormula, applyFormula } from "./synth.mjs";
import { challenge } from "./challenge.mjs";
import { certify, exact } from "./proof.mjs";
import { expertPolicy, gate } from "./expert.mjs";
import { optimize } from "./workflow.mjs";

const groupKey = (c) => c.sector + "/" + c.period;
export function validateProject(p) {
  key(p.id);
  key(p.unit);
  key(p.trainingSector);
  unique(list(p.kinds, 2, 4).map(key));
  list(p.rates, 0, 8).forEach((n) => num(n, 1, 9999));
  unique(p.rates);
  num(p.maxEvaluations, 1, 2e6);
  list(p.demos, 2, 64);
  unique(p.demos.map((x) => key(x.dossier.id)));
  list(p.precedents, 0, 32);
  knownMethods(p.kinds, p.precedents);
  list(p.exams, 2, 12);
  unique(
    p.exams.map((g) => {
      key(g.sector);
      key(g.period);
      num(g.count, 3, 128);
      check(
        [g.inputHash, g.answersHash].every((h) => /^[0-9a-f]{64}$/.test(h)),
        "Examen sin sello",
      );
      return groupKey(g);
    }),
  );
  check(
    new Set(p.exams.map((g) => g.sector)).size >= 2 &&
      p.exams.every((g) => g.sector !== p.trainingSector),
    "Se necesitan sectores de transferencia distintos del entrenamiento",
  );
  list(p.provenance, 1, 64).forEach((x) =>
    check(
      typeof x === "string" && x.trim() && x.length <= 300,
      "Origen sin declarar",
    ),
  );
  trainReader(p.guide, p.kinds);
}
export function discover(p) {
  validateProject(p);
  const reader = trainReader(p.guide, p.kinds),
    training = p.demos.map((ex) => {
      check(
        ex.dossier.sector === p.trainingSector,
        "Ejemplo fuera de entrenamiento",
      );
      const parsed = readDossier(ex.dossier, reader, p.kinds, p.unit);
      check(
        !parsed.issues.length && !parsed.open.length,
        "Ejemplo de experto incompleto",
      );
      num(ex.value, 0, 4104e9);
      return { parsed, value: ex.value };
    });
  unique(training.map((ex) => ex.parsed.pattern));
  const search = learnRule(training, p.kinds, p.rates, p.maxEvaluations),
    workflow = optimize(p.workflow);
  const base = {
    status: search.status,
    project: p.id,
    scope: p.trainingSector,
    training: training.map((x) => ({
      id: x.parsed.id,
      identity: x.parsed.identity,
      pattern: x.parsed.pattern,
    })),
    workflow,
    search,
    exams: p.exams,
    provenance: p.provenance,
    reader,
  };
  const expert = p.expert ? expertPolicy(p.expert) : null;
  if (expert && expert.status !== "IDENTIFIED")
    return { ...base, status: expert.status, expert };
  if (search.status !== "CANDIDATE") return base;
  const program = {
    schema: 1,
    expert,
    kinds: p.kinds,
    unit: p.unit,
    rule: search.rule,
    reader,
    proof: certify(search.rule),
  };
  const adversary = challenge(
    search.rule,
    training.map((t) => t.parsed.groups),
  );
  if (!adversary.passed) return { ...base, status: "REFUTED", adversary };
  const specs = list(p.tools ?? [], 0, 4);
  unique(specs.map((x) => key(x.id)));
  const formulas = specs.map(fitFormula);
  if (formulas.some((f) => f.status !== "CANDIDATE"))
    return { ...base, status: "REVISE_TOOL", formulas };
  const tools = formulas.map(({ attempts, ...f }) => f);
  program.tools = tools;
  const controls = knownMethods(p.kinds, p.precedents);
  const refutations = controls.map((x) => ({
    name: x.name,
    witness: contrast(
      search.rule,
      x.rule,
      training.map((t) => t.parsed.groups),
      p.kinds.length,
    ),
  }));
  return {
    ...base,
    program,
    toolTraining: Object.fromEntries(
      specs.map((s) => [s.id, s.examples.map((e) => hash(e.record))]),
    ),
    formulas,
    adversary,
    controls,
    refutations,
    programHash: hash(program),
  };
}
function summary(result) {
  return { status: result.status, value: result.value };
}
export function freezePredictions(candidate, groups) {
  check(candidate.status === "CANDIDATE", "Candidata no identificada");
  const program = candidate.program;
  list(groups, candidate.exams.length, candidate.exams.length);
  unique(groups.map(groupKey));
  const ids = new Set(candidate.training.map((t) => t.id)),
    seen = new Set(candidate.training.flatMap((t) => [t.identity, t.pattern]));
  const toolSeen = new Map(
    program.tools.map((t) => [t.id, new Set(candidate.toolTraining[t.id])]),
  );
  const batches = groups.map((group) => {
    fields(group, ["sector", "period", "guide", "cases", "tools"]);
    if (group.tools)
      fields(
        group.tools,
        program.tools.map((t) => t.id),
      );
    const plan = candidate.exams.find((g) => groupKey(g) === groupKey(group));
    check(
      plan &&
        hash(group) === plan.inputHash &&
        group.cases.length === plan.count,
      "Expediente distinto de la reserva",
    );
    // A target glossary may annotate columns and movement names, never monetary answer labels.
    const reader = group.guide
      ? trainReader(group.guide, program.kinds)
      : program.reader;
    const predictions = group.cases.map((c) => {
      check(
        c.sector === group.sector &&
          c.period === group.period &&
          !ids.has(c.id),
        "Reutilización de caso o periodo",
      );
      ids.add(c.id);
      const parsed = readDossier(c, reader, program.kinds, program.unit);
      const identity = hash([
        parsed.identity,
        parsed.open.map((r) => [r.account, r.kind, r.limit]),
        parsed.issues.map((r) => r.error),
      ]);
      check(
        !seen.has(parsed.pattern) &&
          !seen.has(identity) &&
          (!seen.has(parsed.identity) ||
            parsed.issues.length > 0 ||
            parsed.open.length > 0),
        "Movimientos de entrenamiento o examen reutilizados",
      );
      seen.add(parsed.pattern);
      seen.add(identity);
      if (!parsed.open.length && !parsed.issues.length)
        seen.add(parsed.identity);
      if (c.flags) fields(c.flags, program.expert?.signals ?? []);
      const permission = gate(program.expert, c.flags);
      const run = (rule) =>
        permission.allowed
          ? evaluate(parsed, rule, program.kinds)
          : {
              status: "NEED_EVIDENCE",
              value: null,
              questions: [permission],
              worlds: [],
            };
      const result = run(program.rule);
      if (result.value !== null)
        check(
          result.value === exact(program.rule, parsed.groups),
          "Oráculo entero discrepante",
        );
      const baselines = candidate.controls.map((x) => summary(run(x.rule)));
      return {
        id: c.id,
        identity,
        pattern: parsed.pattern,
        ...summary(result),
        baselines,
        trace: hash(result),
        observations: parsed.entries.length,
        questions: result.questions,
        worlds: result.worlds,
      };
    });
    const toolRows = {};
    for (const f of program.tools) {
      const records = list(group.tools?.[f.id], 3, 128);
      toolRows[f.id] = records.map((row) => {
        const identity = hash(row);
        check(
          !toolSeen.get(f.id).has(identity),
          "Ejemplo de herramienta reutilizado",
        );
        toolSeen.get(f.id).add(identity);
        check(
          Object.keys(row).length === f.columns.length &&
            f.columns.every((c) => Object.hasOwn(row, c.id)),
          "Tabla ajena a la herramienta",
        );
        return { identity, record: row, value: applyFormula(f.ast, row) };
      });
    }
    return {
      sector: group.sector,
      period: group.period,
      toolRows,
      inputHash: plan.inputHash,
      predictions,
      readerHash: hash(reader),
    };
  });
  return {
    programHash: candidate.programHash,
    batches,
    seal: hash([candidate.programHash, batches]),
  };
}
export function judge(candidate, frozen, answers) {
  check(
    candidate.programHash === frozen.programHash &&
      hash([frozen.programHash, frozen.batches]) === frozen.seal,
    "Predicción alterada",
  );
  list(answers, candidate.exams.length, candidate.exams.length);
  unique(answers.map(groupKey));
  const metrics = [],
    controlTotals = candidate.controls.map(() => 0);
  let correct = 0,
    missed = 0,
    falseClaims = 0,
    opportunities = 0,
    verifiedAmount = 0,
    total = 0,
    missing = 0;
  const toolMetrics = Object.fromEntries(
    candidate.program.tools.map((f) => [
      f.id,
      {
        correct: 0,
        total: 0,
        sectors: [],
        controlHits: Array(f.columns.length + 1).fill(0),
      },
    ]),
  );
  for (const b of frozen.batches) {
    const plan = candidate.exams.find((x) => groupKey(x) === groupKey(b)),
      labels = answers.find((x) => groupKey(x) === groupKey(b));
    check(
      labels &&
        hash(labels) === plan.answersHash &&
        typeof labels.salt === "string" &&
        labels.salt.length >= 16,
      "Clave de examen inválida",
    );
    check(
      Object.keys(labels.values).length === b.predictions.length,
      "Etiquetas incompletas",
    );
    let hits = 0;
    const statuses = new Set();
    for (const p of b.predictions) {
      check(Object.hasOwn(labels.values, p.id), "Caso sin respuesta");
      const value = labels.values[p.id];
      if (value !== null) num(value, 0, 4104e9);
      const status =
        value === null ? "NEED_EVIDENCE" : value === 0 ? "CLEAR" : "FOUND";
      statuses.add(status);
      missing += Number(value === null);
      opportunities += Number(status === "FOUND");
      total++;
      const match = (r) => r.status === status && r.value === value;
      hits += Number(match(p));
      missed += Number(status === "FOUND" && !match(p));
      falseClaims += Number(p.status === "FOUND" && !match(p));
      if (status === "FOUND" && match(p)) verifiedAmount += value;
      p.baselines.forEach((r, i) => (controlTotals[i] += Number(match(r))));
    }
    for (const f of candidate.program.tools) {
      const results = b.toolRows[f.id],
        labelsForTool = labels.tools?.[f.id];
      list(labelsForTool, results.length, results.length);
      let toolHits = 0;
      results.forEach((r, i) => {
        const truth = labelsForTool[i];
        if (truth !== null)
          num(truth, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        toolHits += Number(r.value === truth);
        [0, ...f.columns.map((c) => r.record[c.id])].forEach(
          (v, j) => (toolMetrics[f.id].controlHits[j] += Number(v === truth)),
        );
      });
      const t = toolMetrics[f.id];
      t.total += results.length;
      t.correct += toolHits;
      t.sectors.push({
        sector: b.sector,
        correct: toolHits,
        total: results.length,
      });
    }
    metrics.push({
      sector: b.sector,
      period: b.period,
      cases: b.predictions.length,
      hits,
      coverage: [...statuses].sort(),
    });
    correct += hits;
  }
  const best = Math.max(...controlTotals),
    passed =
      Object.values(toolMetrics).every(
        (t) => t.correct === t.total && Math.max(...t.controlHits) < t.correct,
      ) &&
      correct === total &&
      best < correct &&
      metrics.every((g) => g.coverage.length >= 2) &&
      missing > 0 &&
      opportunities > 0 &&
      total > missing + opportunities;
  return {
    status: passed ? "QUALIFIED_IN_SCOPE" : "KEEP_IN_LAB",
    correct,
    total,
    missed,
    falseClaims,
    opportunities,
    missing,
    verifiedAmount,
    amountMeaning: "labelled opportunity amounts; no money collected",
    unit: candidate.program.unit,
    metrics,
    tools: toolMetrics,
    bestKnownCorrect: best,
    controls: candidate.controls.map((x, i) => ({
      name: x.name,
      correct: controlTotals[i],
    })),
    attempted: candidate.search.attempts.length,
    seal: frozen.seal,
    originality:
      best === correct
        ? "MATCHED_BY_KNOWN_METHOD"
        : "RELATIVE_TO_LISTED_CONTROLS",
  };
}

export function examIdentities(batch) {
  return [
    ...batch.predictions.flatMap((p) => [
      "case/" + p.identity,
      "pattern/" + p.pattern,
    ]),
    ...Object.entries(batch.toolRows).flatMap(([id, rows]) =>
      rows.map((r) => "tool/" + id + "/" + r.identity),
    ),
  ];
}

export function predictExam(candidate, groups) {
  const frozen = freezePredictions(candidate, groups);
  const adapters = groups.map((g) => ({
    sector: g.sector,
    period: g.period,
    reader: g.guide
      ? trainReader(g.guide, candidate.program.kinds)
      : candidate.program.reader,
  }));
  return { frozen, adapters };
}
export function scoreExam(candidate, predictions, adapters, answers) {
  return {
    ...judge(candidate, predictions, answers),
    programHash: candidate.programHash,
    adaptersHash: hash(adapters),
  };
}
