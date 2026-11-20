import assert from "node:assert/strict";
import { strict } from "../policy.mjs";
import { spawnSync } from "node:child_process";
import { availableParallelism, cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { founderRanges } from "../population-research.mjs";
import { executable } from "../native.mjs";
import { hash, check, num, list, unique } from "../factory/reader.mjs";
import {
  adjusted,
  act,
  actionFor,
  catalogue,
  compare,
  constants,
  fitResponse,
  forecasts,
  scorePolicies,
  validateRows,
} from "./policy.mjs";

export function histogramSearch(rows, rules) {
  const cells = new Map();
  let additions = 0;
  const sums = rules.map((rule) => {
    const key = rule.first + "/" + rule.second;
    if (!cells.has(key)) {
      const table = Array.from({ length: 4 }, () => [0, 0, 0]);
      for (const r of rows) {
        const leaf =
          ((r.flags >>> rule.first) & 1) |
          (((r.flags >>> rule.second) & 1) << 1);
        for (let a = 0; a < 3; a++) table[leaf][a] += r.scores[a];
      }
      additions += rows.length * 3;
      cells.set(key, table);
    }
    return cells
      .get(key)
      .reduce((s, values, i) => s + values[(rule.leaves >>> (2 * i)) & 3], 0);
  });
  return {
    sums,
    distinctPredicatePairs: cells.size,
    additions: additions + 4 * rules.length,
  };
}
function countDistinct(rows, rules) {
  const partitions = new Map(),
    seen = new Set(),
    actions = Buffer.alloc(rows.length);
  for (const r of rules) {
    const k = r.first + "/" + r.second;
    if (!partitions.has(k))
      partitions.set(
        k,
        Buffer.from(
          rows.map(
            (row) =>
              ((row.flags >>> r.first) & 1) |
              (((row.flags >>> r.second) & 1) << 1),
          ),
        ),
      );
    const buckets = partitions.get(k),
      lookup = [0, 1, 2, 3].map((leaf) => (r.leaves >>> (2 * leaf)) & 3);
    for (let i = 0; i < buckets.length; i++) actions[i] = lookup[buckets[i]];
    seen.add(createHash("sha256").update(actions).digest("hex"));
  }
  return seen.size;
}
function firstBest(sums) {
  let best = 0;
  for (let i = 1; i < sums.length; i++) if (sums[i] > sums[best]) best = i;
  return best;
}
export function auditSector(rows, rules, ranges) {
  const digest = createHash("sha256"),
    block = Buffer.alloc(32768);
  let length = 0,
    index = 0,
    id = ranges[0][0];
  for (const rule of rules)
    for (const row of rows) {
      const action = act(rule, row.flags);
      block.writeBigUInt64LE(BigInt(id) * 4n + BigInt(action), length);
      block.writeBigInt64LE(BigInt(row.scores[action]), length + 8);
      length += 16;
      if (length === block.length) {
        digest.update(block);
        length = 0;
      }
      if (id === ranges[index][1]) {
        index++;
        id = ranges[index]?.[0];
      } else id++;
    }
  assert.equal(index, ranges.length);
  if (length) digest.update(block.subarray(0, length));
  return digest.digest("hex");
}
export function runNative(layout, rows, rules, threads, sealed) {
  num(threads, 1, 10);
  num(rows.length, 10, 10000);
  num(rules.length, 1, 10000);
  check(
    rows.length % 10 === 0,
    "Cada sector requiere el mismo número de expedientes",
  );
  const started = performance.now(),
    perSector = (rows.length * rules.length) / 10,
    ranges = founderRanges(layout, perSector);
  const input = [
    [threads, rows.length, rules.length],
    ...ranges.map((rs) => [rs.length, ...rs.flat()]),
    ...rows.map((r) => [r.flags, ...r.scores]),
    ...rules.map((r) => [r.first, r.second, r.leaves]),
  ]
    .map((v) => v.join(" "))
    .join("\n");
  const run = spawnSync(
    executable,
    [sealed ? "offers-packed" : "offers-scores-packed"],
    {
      input,
      timeout: 180000,
      maxBuffer: 12e6,
    },
  );
  if (run.error || run.status !== 0) throw run.error ?? Error(run.stderr);
  const binary = run.stdout,
    receiptLength = sealed ? 64 : 0,
    stride = receiptLength + 8 * rules.length;
  assert.equal(binary.toString("ascii", 0, 4), sealed ? "SGN1" : "SUM1");
  assert.equal(binary.length, 4 + 10 * stride);
  const total = Array(rules.length).fill(0);
  const sectors = ranges.map((_, i) => {
    const start = 4 + i * stride,
      seal = sealed ? binary.toString("ascii", start, start + 64) : "scores";
    if (sealed) assert.match(seal, /^[a-f0-9]{64}$/);
    for (let j = 0; j < rules.length; j++) {
      const offset = start + receiptLength + 8 * j;
      const value =
        binary.readInt32LE(offset + 4) * 4294967296 +
        binary.readUInt32LE(offset);
      num(value, -1e13, 1e13);
      total[j] += value;
    }
    return { sector: i + 1, participants: perSector, ranges: ranges[i], seal };
  });
  return {
    total,
    sectors,
    perSector,
    populationMs: performance.now() - started,
  };
}
export function compareEngines(
  layout,
  rows,
  rules,
  threads = Math.min(4, availableParallelism()),
) {
  const { total, sectors, perSector, populationMs } = runNative(
    layout,
    rows,
    rules,
    threads,
    true,
  );
  const ranges = sectors.map((s) => s.ranges);
  const beforeSingle = performance.now(),
    single = histogramSearch(rows, rules),
    oneWorkerMs = performance.now() - beforeSingle;
  assert.deepEqual(total, single.sums);
  // Validate a complete sector independently on tractable scopes; the full search is always checked algebraically.
  if (perSector <= 50000)
    assert.equal(
      sectors[0].seal,
      auditSector(rows.slice(0, rows.length / 10), rules, ranges[0]),
    );
  return {
    participants: perSector * 10,
    policies: rules.length,
    selected: firstBest(total),
    scoresHash: hash(total),
    singleWorkerExact: true,
    distinctDecisions: countDistinct(rows, rules),
    distinctPredicatePairs: single.distinctPredicatePairs,
    oneWorkerAdditions: single.additions,
    sectors,
    populationMs,
    oneWorkerMs,
    checkpoint: layout.checkpoint,
    threads,
  };
}
function clean(row) {
  return { id: row.id, x: row.x };
}
export function prepareSearch(layout, packet, execution = "population") {
  check(
    ["population", "compressed"].includes(execution),
    "Método de búsqueda desconocido",
  );
  const { design, fit, search, validation, holdout, limits } = packet;
  for (const group of [fit, search, validation]) validateRows(group, design);
  validateRows(holdout, design, false);
  unique([...fit, ...search, ...validation, ...holdout].map((r) => r.id));
  list(limits, 1, 4);
  limits.forEach((k, i) => {
    num(k, 1, 10000);
    check(i === 0 || k > limits[i - 1], "Escalas fuera de orden");
  });
  const model = fitResponse(design, fit);
  const reference = [
    ...constants.map((rule) => ({ type: "tree", rule })),
    { type: "response" },
  ];
  const base = scorePolicies(search, reference, model, design);
  const bestSimple = firstBest(
      base.values.map((v) => v.reduce((s, x) => s + x, 0)),
    ),
    incumbent = reference[bestSimple];
  const rows = search.map((r) => adjusted(r, model, design)),
    rules = catalogue(design, limits.at(-1));
  const measurements = limits.map((k) => {
    const active = rules.slice(0, k);
    if (execution === "population") return compareEngines(layout, rows, active);
    const start = performance.now(),
      single = histogramSearch(rows, active);
    return {
      participants: 0,
      workers: 1,
      equivalentComparisons: k * rows.length,
      policies: k,
      selected: firstBest(single.sums),
      scoresHash: hash(single.sums),
      oneWorkerAdditions: single.additions,
      distinctPredicatePairs: single.distinctPredicatePairs,
      oneWorkerMs: performance.now() - start,
      threads: 1,
    };
  });
  const policies = [
    incumbent,
    ...measurements.map((m) => ({ type: "tree", rule: rules[m.selected] })),
  ];
  const result = scorePolicies(validation, policies, model, design);
  // Eight or fewer prespecified validation contrasts (each candidate against control and simpler survivor).
  const z = 2.74;
  let selected = 0;
  const routing = measurements.map((m, i) => {
    const j = i + 1,
      previous = selected,
      againstSimple = compare(result.values, j, 0, z),
      againstPrevious = compare(result.values, j, previous, z);
    if (againstSimple.lower > 0 && againstPrevious.lower > 0) selected = j;
    return {
      policies: m.policies,
      previous,
      againstSimple,
      againstPrevious,
      promoted: selected === j,
    };
  });
  const all = [...policies, reference[0], ...reference.slice(1, 3)];
  const frozen = forecasts(holdout, all, model, design);
  const recipe = {
    version: 1,
    design,
    policy: policies[selected],
    model,
    incumbent,
    selected,
    training: hash([fit, search, validation]),
  };
  const ids = holdout.map((r) => r.id),
    holdoutHash = hash(holdout),
    modelLabels = [
      "simple",
      ...measurements.map((m) => "rules-" + m.policies),
      "control",
      "offer-a",
      "offer-b",
    ];
  return {
    execution,
    recipe,
    recipeHash: hash(recipe),
    ids,
    holdoutHash,
    decisions: frozen,
    modelLabels,
    seal: hash([hash(recipe), holdoutHash, ids, modelLabels, frozen]),
    routing,
    measurements,
    hardware: { cpu: cpus()[0]?.model, threads: measurements[0].threads },
    support: {
      fit: fit.length,
      search: search.length,
      validation: validation.length,
      holdout: holdout.length,
    },
    simple: bestSimple,
  };
}
export function gradeSearch(report, holdout, labels) {
  const { recipe, ids, decisions, holdoutHash } = report,
    design = recipe.design;
  check(
    report.recipeHash === hash(recipe) &&
      report.seal ===
        hash([
          report.recipeHash,
          holdoutHash,
          ids,
          report.modelLabels,
          decisions,
        ]) &&
      holdoutHash === hash(holdout),
    "Examen distinto del sello",
  );
  validateRows(holdout, design, false);
  check(hash(holdout.map((r) => r.id)) === hash(ids), "Identidades alteradas");
  check(
    decisions.length === report.modelLabels.length &&
      report.modelLabels.length >= 5 &&
      report.modelLabels[0] === "simple" &&
      report.modelLabels.at(-3) === "control",
    "Catálogo de decisiones inválido",
  );
  for (const d of decisions)
    check(
      d.decisions.length === ids.length,
      "Cantidad incorrecta de pronósticos",
    );
  for (const l of labels) strict(l, ["id", "arm", "y"]);
  const ledger = new Map(labels.map((r) => [r.id, r]));
  check(
    ledger.size === labels.length && ledger.size === ids.length,
    "Cobertura de desenlaces inválida",
  );
  const rows = holdout.map((r) => ({ ...r, ...ledger.get(r.id) }));
  validateRows(rows, design);
  check(
    hash(rows.map(clean)) === holdoutHash,
    "Datos posteriores sustituyeron entradas anteriores",
  );
  const pseudo = rows.map((r) => adjusted(r, recipe.model, design).scores);
  const values = decisions.map((f) =>
    f.decisions.map((a, i) => pseudo[i][num(a, 0, 2)]),
  );
  const none = report.modelLabels.indexOf("control"),
    selected = recipe.selected;
  const selectedVsSimple = compare(values, selected, 0),
    selectedVsNoContact = compare(values, selected, none);
  return {
    mode: "HISTORICAL_RANDOMIZED",
    unit:
      design.currency +
      " cents per eligible customer over the observation window",
    support: report.support,
    seal: report.seal,
    selected: report.modelLabels[selected],
    selectedVsSimple,
    selectedVsNoContact,
    observedArms: design.actions.map((action, arm) => {
      const group = rows.filter((r) => r.arm === arm),
        sales = group.reduce((n, r) => n + r.y, 0);
      return {
        action,
        people: group.length,
        positiveSpend: group.filter((r) => r.y > 0).length,
        historicalGrossCents: sales,
        observedMeanCents: sales / group.length,
      };
    }),
    qualification:
      selectedVsSimple.lower > 0 && selectedVsNoContact.lower > 0
        ? "READY_FOR_PROSPECTIVE_TRIAL"
        : "NO_DEMONSTRATED_ADVANTAGE_OVER_INCUMBENT",
    ownSales: null,
    merchantMargin: null,
    relativeToSimple:
      selectedVsSimple.lower > 0 ? "IMPROVED_IN_THIS_EXAM" : "KEEP_SIMPLE",
    methods: report.modelLabels.map((name, i) => ({
      name,
      contacts: decisions[i].decisions.filter((a) => a !== 0).length,
      matched: rows.filter((r, j) => r.arm === decisions[i].decisions[j])
        .length,
      vsSimple: compare(values, i, 0, 2.74),
      vsNoContact: compare(values, i, none, 2.74),
    })),
  };
}

export function explainFounder(report, packet, population, agent) {
  num(agent, 1, 1e12);
  check(
    hash([packet.fit, packet.search, packet.validation]) ===
      report.recipe.training && hash(report.recipe) === report.recipeHash,
    "Detrás del dictamen hay datos distintos",
  );
  const stage = report.measurements.find((m) => m.participants === population);
  check(stage, "Escala no examinada");
  let sector, ordinal;
  for (const g of stage.sectors) {
    let offset = 0;
    for (const [first, last] of g.ranges) {
      if (agent >= first && agent <= last) {
        sector = g.sector;
        ordinal = offset + agent - first;
        break;
      }
      offset += last - first + 1;
    }
    if (sector) break;
  }
  check(sector, "Identidad ajena a este reparto");
  const n = packet.search.length / 10,
    ruleIndex = Math.floor(ordinal / n),
    rowIndex = (sector - 1) * n + (ordinal % n);
  const rules = catalogue(packet.design, stage.policies),
    r = packet.search[rowIndex],
    model = report.recipe.model;
  const scored = packet.search.map((x) => adjusted(x, model, packet.design));
  const totals = histogramSearch(scored, rules).sums;
  check(hash(totals) === stage.scoresHash, "Puntuaciones del examen alteradas");
  const action = act(rules[ruleIndex], scored[rowIndex].flags),
    baseAction = actionFor(report.recipe.incumbent, r, model, packet.design);
  const before = firstBest(totals),
    delta =
      scored[rowIndex].scores[action] - scored[rowIndex].scores[baseAction];
  totals[ruleIndex] -= delta;
  const after = firstBest(totals);
  return {
    agent,
    sector,
    population,
    ordinal,
    ruleIndex,
    customer: r.id,
    assignedAction: packet.design.actions[action],
    incumbentAction: packet.design.actions[baseAction],
    observedArm: packet.design.actions[r.arm],
    observedAmount: r.y,
    contribution: scored[rowIndex].scores[action],
    differenceFromIncumbent: delta,
    winningPolicy: before,
    winningPolicyWithIncumbentContribution: after,
    changedWinner: before !== after,
    interpretation:
      "Sustituir esta comparación por la acción de referencia en la misma fila mantiene fijo el número de clientes.",
  };
}
export function recommendTrial(report, customers, expectedRecipeHash) {
  check(
    hash(report.recipe) === expectedRecipeHash &&
      expectedRecipeHash === report.recipeHash,
    "Receta ajena al compromiso autorizado",
  );
  const r = report.recipe;
  validateRows(customers, r.design, false);
  return {
    mode: "PROPOSED_RANDOMIZED_PILOT",
    recipe: expectedRecipeHash,
    offers: customers.map((c) => {
      const a = actionFor(r.policy, c, r.model, r.design),
        b = actionFor(r.incumbent, c, r.model, r.design);
      return {
        id: c.id,
        proposed: r.design.actions[a],
        incumbent: r.design.actions[b],
        sameDecision: a === b,
      };
    }),
  };
}
