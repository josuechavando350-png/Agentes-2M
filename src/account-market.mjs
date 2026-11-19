import { token } from "./dossiers.mjs";
import { digest, integer, strict } from "./policy.mjs";
export const signals = [
  "recency",
  "orders",
  "gross_pence",
  "returns_permille",
  "recent_orders",
  "active_weeks",
  "sku_count",
  "largest_share",
  "gap_days",
  "last_pence",
];
const sigmoid = (x) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, x))));
function vector(row) {
  strict(row.features, signals);
  return signals.map((field) =>
    Math.log1p(integer(row.features[field], 0, Number.MAX_SAFE_INTEGER, field)),
  );
}
export function fitAccounts(rows, labels, dimensions) {
  if (![1, 10].includes(dimensions) || rows.length < 2)
    throw Error("Entrenamiento inválido");
  const samples = rows.map((row) => vector(row).slice(0, dimensions));
  const target = rows.map((row) =>
    integer(labels[row.id], 0, 1, "desenlace de entrenamiento"),
  );
  const mean = [],
    scale = [],
    weights = Array(dimensions).fill(0);
  for (let j = 0; j < dimensions; j++) {
    mean[j] = samples.reduce((s, x) => s + x[j], 0) / samples.length;
    scale[j] =
      Math.sqrt(
        samples.reduce((s, x) => s + (x[j] - mean[j]) ** 2, 0) / samples.length,
      ) || 1;
    for (const x of samples) x[j] = (x[j] - mean[j]) / scale[j];
  }
  let intercept = 0;
  // Fixed full-batch ridge logistic regression. Training sees only the earlier split.
  for (let epoch = 0; epoch < 250; epoch++) {
    let total = 0;
    const delta = weights.map(() => 0);
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i],
        residual =
          sigmoid(weights.reduce((s, w, j) => s + w * x[j], intercept)) -
          target[i];
      total += residual;
      for (let j = 0; j < dimensions; j++) delta[j] += x[j] * residual;
    }
    intercept -= (0.2 * total) / samples.length;
    for (let j = 0; j < dimensions; j++)
      weights[j] -= 0.2 * (delta[j] / samples.length + 0.015 * weights[j]);
  }
  return { dimensions, intercept, mean, scale, weights };
}
export function accountForecast(row, model, actors) {
  if (
    ![1, 10].includes(actors.length) ||
    new Set(actors).size !== actors.length
  )
    throw Error("Equipo inválido");
  strict(row, ["id", "cutoff", "features", "references"]);
  token(row.id);
  const date = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (
    !date(row.cutoff) ||
    !Array.isArray(row.references) ||
    !row.references.length ||
    row.references.length > 8192
  )
    throw Error("Expediente temporal inválido");
  for (const ref of row.references) {
    strict(ref, ["invoice", "firstRow", "day"]);
    if (
      typeof ref.invoice !== "string" ||
      !ref.invoice ||
      !date(ref.day) ||
      ref.day >= row.cutoff ||
      Date.parse(row.cutoff) - Date.parse(ref.day) > 90 * 86400000
    )
      throw Error("Referencia fuera del corte");
    integer(ref.firstRow, 2, Number.MAX_SAFE_INTEGER, "fila fuente");
  }
  const x = vector(row);
  if (
    ![1, 10].includes(model.dimensions) ||
    ![model.mean, model.scale, model.weights].every(
      (a) =>
        Array.isArray(a) &&
        a.length === model.dimensions &&
        a.every(Number.isFinite),
    ) ||
    !Number.isFinite(model.intercept) ||
    model.scale.some((n) => n <= 0)
  )
    throw Error("Modelo de cuentas inválido");
  const parts = signals.map((field, i) => ({
    field,
    actor: actors[i % actors.length],
    value: row.features[field],
    contribution:
      i < model.dimensions
        ? (model.weights[i] * (x[i] - model.mean[i])) / model.scale[i]
        : 0,
  }));
  return {
    id: row.id,
    source: digest(row),
    probability: sigmoid(
      parts.reduce((sum, p) => sum + p.contribution, model.intercept),
    ),
    parts,
  };
}
export function allocate(proposals) {
  // Seats are fixed before outcomes open. Unselected accounts can still buy.
  const n = proposals.length,
    pilots = Math.floor(n * 0.2),
    investigations = Math.floor(n * 0.4);
  return proposals
    .toSorted(
      (a, b) => b.probability - a.probability || a.id.localeCompare(b.id),
    )
    .map((p, i) => ({
      ...p,
      decision:
        i < pilots
          ? "PILOT"
          : i < pilots + investigations
            ? "INVESTIGATE"
            : "ABANDON",
    }));
}
export function gradeAccounts(decisions, labels) {
  if (
    Object.keys(labels).length !== decisions.length ||
    new Set(decisions.map((d) => d.id)).size !== decisions.length ||
    !decisions.length
  )
    throw Error("Cobertura de cuentas incompleta");
  let brier = 0,
    hits = 0,
    pilots = 0,
    missed = 0,
    observed = 0;
  for (const d of decisions) {
    const y = integer(labels[d.id], 0, 1, "desenlace");
    observed += y;
    if (
      !Number.isFinite(d.probability) ||
      d.probability < 0 ||
      d.probability > 1
    )
      throw Error("Probabilidad inválida");
    brier += (d.probability - y) ** 2;
    if (d.decision === "PILOT") {
      pilots++;
      hits += y;
    } else if (d.decision === "ABANDON") missed += y;
  }
  return {
    cases: decisions.length,
    observed,
    pilots,
    pilotHits: hits,
    wastedPilots: pilots - hits,
    missedAfterAbandon: missed,
    brier: brier / decisions.length,
  };
}
export const improves = (a, b) =>
  a.brier < b.brier &&
  a.pilotHits >= b.pilotHits &&
  a.missedAfterAbandon <= b.missedAfterAbandon;

// A published policy is paired with the exact report that qualified it.
export function admittedModel(policy, report) {
  const promoted =
    report.validationSelected === "challenger" &&
    improves(report.validation.challenger, report.validation.baseline) &&
    improves(report.summary.ten, report.summary.incumbent);
  const expected = promoted ? "challenger" : "baseline";
  if (
    report.scope !== "positive-net-invoicing-next-30-days" ||
    policy.scope !== report.scope ||
    policy.report !== digest(report) ||
    policy.exam !== report.exam ||
    report.promoted !== promoted ||
    policy.decision !== (promoted ? "PROMOTED" : "HOLD_BASELINE") ||
    digest(policy.model) !== report.modelHashes[expected]
  )
    throw Error("La política no coincide con el examen admitido");
  return policy.model;
}
