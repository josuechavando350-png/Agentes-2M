import { performance } from "node:perf_hooks";
import { cpus, availableParallelism } from "node:os";
import { digest, integer } from "./policy.mjs";
import {
  populationResearch,
  preparePopulation,
} from "./population-research.mjs";
import { allocate, gradeAccounts } from "./account-market.mjs";

function recency(packet) {
  // Order by recency. Estimate its probability from training outcomes in fixed age bands.
  const band = (days) => [7, 14, 30, 60].filter((limit) => days > limit).length;
  const bins = Array.from({ length: 5 }, () => ({ n: 0, positive: 0 }));
  for (const row of packet.historical) {
    const b = bins[band(row.features.recency)];
    b.n++;
    b.positive += packet.outcomes[row.id];
  }
  const ages = new Map(packet.queries.map((r) => [r.id, r.features.recency]));
  const predictions = allocate(
    packet.queries.map((r) => ({
      id: r.id,
      probability: 1 / (1 + r.features.recency),
    })),
  ).map((r) => {
    const b = bins[band(ages.get(r.id))];
    return { ...r, probability: (b.positive + 1) / (b.n + 2) };
  });
  return predictions;
}
export function scaleExam(
  layout,
  packet,
  labels,
  threads = Math.min(4, availableParallelism()),
  rate = null,
) {
  preparePopulation(packet);
  if (rate !== null) integer(rate, 0, 1e10, "tarifa por hora de máquina");
  const start = performance.now(),
    predictions = recency(packet);
  const simple = {
    name: "recency",
    participants: 1,
    comparisons: packet.queries.length,
    elapsedMs: performance.now() - start,
    decisions: predictions,
  };
  const arms = [simple];
  const keys = { 1: "ten", 10: "hundred", 100: "thousand" };
  for (const rules of [1, 10, 100]) {
    const r = populationResearch(layout, packet, threads, rules);
    arms.push({
      name: "rules-" + rules,
      participants: r.result.participants,
      comparisons: r.result.participants,
      elapsedMs: r.measurement.elapsedMs,
      nativeMs: r.measurement.nativeMs,
      commitment: r.commitment,
      decisions: r.result.decisions[keys[rules]],
    });
    if (
      rules === 100 &&
      (digest(arms[1].decisions) !== digest(r.result.decisions.ten) ||
        digest(arms[2].decisions) !== digest(r.result.decisions.hundred))
    )
      throw Error(
        "Escalas parciales no reproducen los votos del lote completo",
      );
  }
  return {
    checkpoint: layout.checkpoint,
    input: digest(packet),
    outcomes: digest(labels),
    hardware: {
      cpu: cpus()[0]?.model,
      parallelism: availableParallelism(),
      threads,
    },
    machineCentsPerHour: rate,
    arms: arms.map(({ decisions, ...a }) => ({
      ...a,
      predictions: digest(decisions),
      estimatedComputeCents:
        rate === null ? null : (a.elapsedMs * rate) / 3600000,
      scores: gradeAccounts(decisions, labels),
    })),
  };
}

// Choose among already measured scales for fixed-seat work. Accuracy ties go to the smaller population.
export function routedRank(layout, packet, report, maxComparisons) {
  const p = preparePopulation(packet);
  integer(maxComparisons, 1, 100_000_000, "comparaciones disponibles");
  if (
    !report.cohorts.length ||
    report.cohorts.some(
      (c) =>
        c.niche !== p.niche ||
        c.references !== p.history.length ||
        c.cases !== p.queries.length ||
        packet.queries.some((q) => q.cutoff < c.maturedAt),
    )
  )
    throw Error("El examen de escala no cubre este alcance y corte");
  const options = report.cohorts[0].arms
    .map((a, i) => ({
      method: a.name,
      comparisons: a.comparisons,
      hits: report.cohorts.reduce((n, c) => n + c.arms[i].scores.pilotHits, 0),
    }))
    .filter((a) => a.comparisons <= maxComparisons)
    .sort((a, b) => b.hits - a.hits || a.comparisons - b.comparisons);
  if (!options.length)
    throw Error("El presupuesto no alcanza el método más pequeño");
  const best = options[0];
  const rules = {
    "rules-1": [1, "ten"],
    "rules-10": [10, "hundred"],
    "rules-100": [100, "thousand"],
  }[best.method];
  const run = rules
    ? populationResearch(layout, packet, undefined, rules[0])
    : null;
  return {
    method: best.method,
    comparisons: best.comparisons,
    scope: packet.niche,
    evidence: digest(report),
    options,
    predictions: run ? run.result.decisions[rules[1]] : recency(packet),
    commitment: run?.commitment ?? digest(p),
  };
}
