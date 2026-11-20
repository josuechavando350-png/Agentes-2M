import { hash, check, num, key, list, unique } from "../factory/reader.mjs";
import { strict } from "../policy.mjs";
import { flagsFor } from "./policy.mjs";

const caps = [4, 12, 32],
  rate = 0.25,
  ridge = 12;
const logistic = (z) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
const logit = (p) => Math.log(p / (1 - p));
const smooth = (hit, count, p, n) => (hit + n * p) / (count + n);
function schema(fields) {
  const bits = [];
  const names = list(fields, 2, 12).map(([name, cuts], j) => {
    list(cuts, 1, 8).forEach((v, i) => {
      num(v, -1e7, 1e7);
      check(!i || v > cuts[i - 1], "Cortes fuera de orden");
      bits.push({ j, cut: v });
    });
    return key(name);
  });
  unique(names);
  check(bits.length <= 30, "Más de 30 predicados");
  return bits;
}
function samples(rows, fields, observed) {
  list(rows, 1, 250000);
  unique(
    rows.map((r) => {
      strict(r, observed ? ["id", "x", "accepted"] : ["id", "x"]);
      if (observed) num(r.accepted, 0, 1);
      list(r.x, fields.length, fields.length).forEach((n) => num(n, -1e7, 1e7));
      return key(r.id);
    }),
  );
}
function fit(rows, bits) {
  const groups = new Map(),
    base = (rows.reduce((s, r) => s + r.accepted, 0) + 0.5) / (rows.length + 1);
  const dimensions = [[], ...bits.map((_, i) => [i])],
    prior = logit(base);
  for (let i = 0; i < bits.length; i++)
    for (let j = i + 1; j < bits.length; j++) dimensions.push([i, j]);
  for (const row of rows) {
    const mask = flagsFor(row.x, bits),
      g = groups.get(mask) ?? { mask, n: 0, h: 0, score: prior };
    g.n++;
    g.h += row.accepted;
    groups.set(mask, g);
  }
  const cell = (mask, p) =>
    (p.length ? (mask >>> p[0]) & 1 : 0) |
    (p.length === 2 ? ((mask >>> p[1]) & 1) << 1 : 0);
  const cells = [...groups.values()],
    lookup = dimensions.map((p) =>
      Uint8Array.from(cells.map((g) => cell(g.mask, p))),
    );
  const trees = [];
  for (let iter = 0; iter < caps.at(-1); iter++) {
    const grad = [],
      hess = [];
    for (const g of cells) {
      const p = logistic(g.score);
      grad.push(g.h - g.n * p);
      hess.push(g.n * p * (1 - p));
    }
    let best = null;
    for (let k = 0; k < dimensions.length; k++) {
      const g = [0, 0, 0, 0],
        h = [ridge, ridge, ridge, ridge],
        c = lookup[k];
      for (let i = 0; i < cells.length; i++) {
        g[c[i]] += grad[i];
        h[c[i]] += hess[i];
      }
      const gain = g.reduce((s, v, i) => s + (v * v) / h[i], 0);
      if (!best || gain > best.gain)
        best = {
          k,
          gain,
          step: g.map((v, i) => rate * Math.max(-1.5, Math.min(1.5, v / h[i]))),
        };
    }
    const split = dimensions[best.k];
    trees.push({ split, step: best.step });
    cells.forEach((g, i) => (g.score += best.step[lookup[best.k][i]]));
  }
  // Every one-field and two-field empirical table competes under the same validation budget.
  const featuresSeen = [...new Set(bits.map((b) => b.j))],
    sets = [[], ...featuresSeen.map((i) => [i])];
  for (let i = 0; i < featuresSeen.length; i++)
    for (let j = i + 1; j < featuresSeen.length; j++)
      sets.push([featuresSeen[i], featuresSeen[j]]);
  const baselines = sets.map((features) => {
    const mask = bits.reduce(
      (v, b, i) => (features.includes(b.j) ? v | (1 << i) : v),
      0,
    );
    const counts = {};
    for (const g of cells) {
      const k = String(g.mask & mask),
        b = (counts[k] ??= [0, 0]);
      b[0] += g.h;
      b[1] += g.n;
    }
    const values = Object.fromEntries(
      Object.entries(counts).map(([k, [h, n]]) => [
        k,
        logit(smooth(h, n, base, 24)),
      ]),
    );
    return { kind: "table", features, mask, values, prior };
  });
  return {
    baselines,
    candidates: caps.map((n) => ({
      kind: "trees",
      prior,
      trees: trees.slice(0, n),
    })),
  };
}
function raw(model, row, bits) {
  if (model.kind === "table")
    return (
      model.values[String(flagsFor(row.x, bits) & model.mask)] ?? model.prior
    );
  const mask = flagsFor(row.x, bits);
  let s = model.prior;
  for (const t of model.trees) {
    const [a, b] = t.split,
      c =
        (a === undefined ? 0 : (mask >>> a) & 1) |
        (b === undefined ? 0 : ((mask >>> b) & 1) << 1);
    s += t.step[c];
  }
  return s;
}
function forecasts(rows, model, bits, cal = { slope: 1, bias: 0 }) {
  return rows.map((row) => {
    const z = raw(model, row, bits);
    return {
      id: row.id,
      rank: z,
      probability: logistic(cal.slope * z + cal.bias),
    };
  });
}
function calibrate(rows, model, bits) {
  const logits = rows.map((r) => raw(model, r, bits)),
    h = rows.reduce((s, r) => s + r.accepted, 0),
    target = (h + 0.5) / (rows.length + 1);
  let best = null;
  for (const slope of [0.25, 0.5, 0.75, 1, 1.25, 1.5]) {
    let lo = -20,
      hi = 20;
    for (let j = 0; j < 48; j++) {
      const mid = (lo + hi) / 2,
        mean =
          logits.reduce((s, z) => s + logistic(slope * z + mid), 0) /
          rows.length;
      if (mean < target) lo = mid;
      else hi = mid;
    }
    const bias = (lo + hi) / 2,
      brier =
        logits.reduce(
          (s, z, i) => s + (logistic(slope * z + bias) - rows[i].accepted) ** 2,
          0,
        ) / rows.length;
    if (!best || brier < best.brier) best = { slope, bias, brier };
  }
  return best;
}
const tieCache = new Map();
function tie(id) {
  if (!tieCache.has(id)) {
    if (tieCache.size >= 50000) tieCache.clear();
    tieCache.set(id, hash(["semar-fila-1", id]));
  }
  return tieCache.get(id);
}
function prioritize(fs, take) {
  return fs
    .toSorted((a, b) => {
      if (a.rank !== b.rank) return b.rank - a.rank;
      const x = tie(a.id),
        y = tie(b.id);
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .slice(0, take);
}
export function queueMetrics(predictions, truth) {
  check(predictions.length === truth.length, "Desenlaces incompletos");
  const labels = new Map(truth.map((r) => [r.id, num(r.accepted, 0, 1)]));
  check(
    labels.size === truth.length && predictions.every((p) => labels.has(p.id)),
    "Identidades incompatibles",
  );
  unique(predictions.map((p) => p.id));
  let hits = 0,
    selected = 0,
    brier = 0,
    positive = 0;
  const windows = [];
  for (let i = 0; i < predictions.length; i += 100) {
    const group = predictions.slice(i, i + 100),
      chosen = prioritize(group, Math.floor(group.length / 5));
    const count = chosen.reduce((s, r) => s + labels.get(r.id), 0);
    hits += count;
    selected += chosen.length;
    windows.push({ cases: group.length, selected: chosen.length, hits: count });
    for (const p of group) {
      const y = labels.get(p.id);
      positive += y;
      brier += (p.probability - y) ** 2;
    }
  }
  return {
    records: predictions.length,
    accepted: positive,
    selected,
    hits,
    precision: selected ? hits / selected : null,
    recall: positive ? hits / positive : null,
    baseRate: positive / predictions.length,
    brier: brier / predictions.length,
    windows,
  };
}
function summarize(v) {
  const { windows, ...rest } = v;
  return rest;
}
export function prepareProspects(packet) {
  const {
      fit: training,
      select,
      calibrate: cal,
      holdout,
      schema: fields,
    } = packet,
    bits = schema(fields);
  for (const rows of [training, select, cal]) samples(rows, fields, true);
  samples(holdout, fields, false);
  unique([...training, ...select, ...cal, ...holdout].map((r) => r.id));
  check(
    select.length >= 200 && holdout.length >= 400,
    "Muestra temporal insuficiente",
  );
  const fitResult = fit(training, bits),
    models = [...fitResult.baselines, ...fitResult.candidates],
    half = Math.floor(select.length / 200) * 100;
  const periods = [select.slice(0, half), select.slice(half)],
    validation = models.map((model) =>
      periods.map((rows) =>
        summarize(queueMetrics(forecasts(rows, model, bits), rows)),
      ),
    );
  const total = (i) => validation[i].reduce((v, p) => v + p.hits, 0),
    error = (i) => validation[i].reduce((v, p) => v + p.brier, 0);
  const best = (indices) =>
    indices.toSorted(
      (a, b) => total(b) - total(a) || error(a) - error(b) || a - b,
    )[0];
  const simpleCount = fitResult.baselines.length,
    incumbent = best(Array.from({ length: simpleCount }, (_, i) => i));
  const acceptable = caps
    .map((_, i) => simpleCount + i)
    .filter(
      (i) =>
        total(i) > total(incumbent) &&
        validation[i].every((p, j) => p.hits >= validation[incumbent][j].hits),
    );
  const chosen = acceptable.length ? best(acceptable) : incumbent;
  const make = (i) => ({
    model: models[i],
    calibration: calibrate(cal, models[i], bits),
    id:
      i === 0
        ? "uniforme"
        : i < simpleCount
          ? "tabla-" + models[i].features.map((j) => fields[j][0]).join("-")
          : "arboles-" + caps[i - simpleCount],
  });
  const policies = {
    selected: make(chosen),
    simple: make(incumbent),
    reference: make(0),
  };
  const targets = Object.fromEntries(
    Object.entries(policies).map(([k, m]) => [
      k,
      forecasts(holdout, m.model, bits, m.calibration),
    ]),
  );
  const recipe = {
      format: 1,
      schema: fields,
      policies,
      source: packet.source,
      training: hash([training, select, cal]),
    },
    features = hash(holdout);
  return {
    recipe,
    features,
    validation,
    modelsExamined: { simple: simpleCount, candidates: caps.length },
    support: {
      fit: training.length,
      select: select.length,
      calibrate: cal.length,
      holdout: holdout.length,
    },
    targets,
    seal: hash([recipe, features, targets]),
    acceptance:
      "Cuatro tramos cronológicos. Igual o mayor número de contratos observados a capacidad fija en cada tramo y mejora estricta total frente al control simple seleccionado. Medición histórica.",
  };
}
function combinations(n, k) {
  if (k < 0 || k > n) return 0n;
  let c = 1n;
  for (let i = 0; i < Math.min(k, n - k); i++)
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  return c;
}
// Null comparator for a capacity-limited historical list. Each time block draws without replacement.
export function uniformQueueDistribution(labels, hits) {
  let mass = [1],
    expected = 0;
  for (let i = 0; i < labels.length; i += 100) {
    const group = labels.slice(i, i + 100),
      n = group.length,
      a = group.reduce((s, v) => s + num(v, 0, 1), 0),
      k = Math.floor(n / 5);
    const den = combinations(n, k),
      prob = Array.from(
        { length: k + 1 },
        (_, h) =>
          Number(combinations(a, h) * combinations(n - a, k - h)) / Number(den),
      );
    const next = Array(mass.length + k).fill(0);
    for (let j = 0; j < mass.length; j++)
      for (let h = 0; h <= k; h++) next[j + h] += mass[j] * prob[h];
    mass = next;
    expected += (a * k) / n;
  }
  const total = mass.reduce((s, v) => s + v, 0);
  check(Math.abs(total - 1) < 1e-8, "Masa probabilística inconsistente");
  const q = (p) => {
    let sum = 0;
    for (let i = 0; i < mass.length; i++) {
      sum += mass[i] / total;
      if (sum >= p) return i;
    }
    return mass.length - 1;
  };
  return {
    expectedHits: expected,
    central95: [q(0.025), q(0.975)],
    probabilityAtLeastObserved: Math.min(
      1,
      mass.slice(hits).reduce((s, v) => s + v, 0) / total,
    ),
    interpretation:
      "Distribución de selección uniforme con igual cupo en cada bloque. Contraste secundario de priorización histórica.",
  };
}
export function gradeProspects(frozen, rows, answers, expectedSeal) {
  check(
    frozen.support.holdout === rows.length &&
      hash([frozen.recipe, frozen.features, frozen.targets]) === expectedSeal &&
      frozen.seal === expectedSeal &&
      frozen.features === hash(rows),
    "Examen o decisiones distintos de su compromiso",
  );
  samples(rows, frozen.recipe.schema, false);
  unique(
    answers.map((a) => {
      strict(a, ["id", "accepted"]);
      num(a.accepted, 0, 1);
      return key(a.id);
    }),
  );
  check(answers.length === rows.length, "Respuestas incompletas");
  for (const v of Object.values(frozen.targets))
    check(
      hash(v.map((p) => p.id)) === hash(rows.map((p) => p.id)),
      "Orden de contactos alterado",
    );
  const truth = new Map(answers.map((v) => [v.id, v]));
  check(
    rows.every((r) => truth.has(r.id)),
    "Desenlace desconocido",
  );
  const cutoff = Math.floor(rows.length / 400) * 100,
    boundaries = [0, cutoff, 2 * cutoff, 3 * cutoff, rows.length];
  const periods = boundaries.slice(1).map((last, i) => {
    const first = boundaries[i],
      labels = rows.slice(first, last).map((r) => truth.get(r.id));
    return Object.fromEntries(
      Object.entries(frozen.targets).map(([k, v]) => [
        k,
        summarize(queueMetrics(v.slice(first, last), labels)),
      ]),
    );
  });
  const totals = Object.fromEntries(
    Object.entries(frozen.targets).map(([k, v]) => [
      k,
      summarize(queueMetrics(v, answers)),
    ]),
  );
  const gain = totals.selected.hits - totals.simple.hits;
  return {
    mode: "HISTORICAL_CONTACT_PRIORITIZATION",
    source: frozen.recipe.source,
    seal: expectedSeal,
    support: frozen.support,
    modelsExamined: frozen.modelsExamined,
    methods: Object.fromEntries(
      Object.entries(frozen.recipe.policies).map(([k, p]) => [k, p.id]),
    ),
    periods,
    totals,
    additionalRecordedSubscriptionsVsSimple: gain,
    uniformSelection: uniformQueueDistribution(
      rows.map((r) => truth.get(r.id).accepted),
      totals.selected.hits,
    ),
    comparisonPassed:
      gain > 0 && periods.every((p) => p.selected.hits >= p.simple.hits),
    receipts: null,
    counterfactualSales: null,
    limits:
      "Contactos ya realizados por la entidad. El archivo no identifica de manera única a cada cliente ni mide qué habría sucedido sin contacto.",
  };
}
export function rankProspects(
  recipe,
  expectedRecipe,
  authorizedRows,
  capacity,
) {
  check(hash(recipe) === expectedRecipe, "Receta distinta de la aprobada");
  const bits = schema(recipe.schema);
  samples(authorizedRows, recipe.schema, false);
  num(capacity, 0, authorizedRows.length);
  const p = recipe.policies.selected,
    values = forecasts(authorizedRows, p.model, bits, p.calibration);
  return {
    mode: "RECOMMEND_FOR_AUTHORIZED_PILOT",
    selected: prioritize(values, capacity).map(({ id, probability }) => ({
      id,
      historicalProbability: probability,
    })),
    capacity,
    receipts: null,
  };
}
