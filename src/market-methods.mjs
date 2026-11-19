import firstExam from "../evidence/metodos-negocio.json" with { type: "json" };
import {
  accountForecast,
  allocate,
  gradeAccounts,
  improves,
  signals,
} from "./account-market.mjs";
import { digest, integer, strict } from "./policy.mjs";

const measured = [
  ...signals,
  "distinct_buying_days",
  "longest_gap",
  "last_gap",
];
const clamp = (p) => Math.min(0.995, Math.max(0.005, p));
function observe(row, base) {
  const incumbent = accountForecast(row, base, [1]).probability;
  // Discount calendar restatements of the same invoice; cancellation dates
  // cannot stand in for an order. The base validator checks every timestamp.
  const days = [
    ...new Set(
      row.references
        .filter((r) => !r.invoice.startsWith("C"))
        .map((r) => Date.parse(r.day) / 86400000),
    ),
  ].sort((a, b) => a - b);
  const gaps = days.slice(1).map((v, i) => v - days[i]);
  const values = [
    ...signals.map((k) => row.features[k]),
    days.length,
    gaps.length ? Math.max(...gaps) : 90,
    gaps.at(-1) ?? 90,
  ];
  return { id: row.id, incumbent, values: values.map(Math.log1p) };
}
function expression(spec, x) {
  const a = x[spec.left],
    b = x[spec.right];
  if (spec.op === "read") return a;
  if (spec.op === "difference") return a - b;
  return a * b;
}
function checkProgram(p) {
  strict(p, ["op", "left", "right", "cut", "below", "above"]);
  integer(p.left, 0, measured.length - 1, "señal");
  integer(p.right, 0, measured.length - 1, "señal");
  if (
    !["read", "difference", "product"].includes(p.op) ||
    ![p.cut, p.below, p.above].every(Number.isFinite) ||
    Math.max(Math.abs(p.below), Math.abs(p.above)) > 1
  )
    throw Error("Programa de investigación inválido");
}
function adjust(p, s) {
  return clamp(
    s.incumbent + (expression(p, s.values) <= p.cut ? p.below : p.above),
  );
}
export function methodForecast(row, base, program) {
  const s = observe(row, base);
  if (program) checkProgram(program);
  return {
    id: row.id,
    source: digest(row),
    incumbent: s.incumbent,
    probability: program ? adjust(program, s) : s.incumbent,
  };
}
const minLeaf = 30,
  shortlistSize = 12;
export function inventMethods(training, trainY, validation, valY, base) {
  const accounts = new Set(training.map((r) => r.id));
  if (
    accounts.size !== training.length ||
    new Set(validation.map((r) => r.id)).size !== validation.length ||
    validation.some((r) => accounts.has(r.id))
  )
    throw Error("Separación de investigación inválida");
  const train = training.map((r) => observe(r, base)),
    val = validation.map((r) => observe(r, base));
  for (const s of train) integer(trainY[s.id], 0, 1, "desenlace");
  const scored = [],
    seen = new Set();
  // Search programs that distinguish errors of the incumbent. Corrections
  // are learned only from development rows and shrunk toward the incumbent.
  for (let left = 0; left < measured.length; left++)
    for (let right = left; right < measured.length; right++) {
      for (const op of left === right ? ["read"] : ["difference", "product"]) {
        const spec = { op, left, right },
          xs = train.map((s) => expression(spec, s.values));
        const sorted = xs.toSorted((a, b) => a - b);
        for (const q of [0.2, 0.4, 0.6, 0.8]) {
          const cut = sorted[Math.floor(q * sorted.length)],
            key = digest({ ...spec, cut });
          if (seen.has(key)) continue;
          seen.add(key);
          const residual = [0, 0],
            n = [0, 0];
          train.forEach((s, i) => {
            const branch = Number(xs[i] > cut);
            n[branch]++;
            residual[branch] += trainY[s.id] - s.incumbent;
          });
          if (Math.min(...n) < minLeaf) continue;
          const program = {
            ...spec,
            cut,
            below: residual[0] / (n[0] + 40),
            above: residual[1] / (n[1] + 40),
          };
          const loss =
            train.reduce(
              (sum, s) => sum + (adjust(program, s) - trainY[s.id]) ** 2,
              0,
            ) / train.length;
          scored.push({ program, loss, key });
        }
      }
    }
  function score(samples, labels, program) {
    return gradeAccounts(
      allocate(
        samples.map((s) => ({
          id: s.id,
          probability: program ? adjust(program, s) : s.incumbent,
        })),
      ),
      labels,
    );
  }
  const reference = score(val, valY, null);
  const finalists = scored
    .sort((a, b) => a.loss - b.loss || a.key.localeCompare(b.key))
    .slice(0, shortlistSize)
    .map((c) => ({ ...c, validation: score(val, valY, c.program) }));
  if (!finalists.length)
    throw Error("Muestra insuficiente para inventar un método");
  const chosen = finalists.toSorted(
    (a, b) =>
      Number(improves(b.validation, reference)) -
        Number(improves(a.validation, reference)) ||
      a.validation.brier - b.validation.brier ||
      a.key.localeCompare(b.key),
  )[0];
  const faults = allocate(
    train.map((s) => ({ id: s.id, probability: s.incumbent })),
  ).filter((p) => p.decision === "PILOT" && !trainY[p.id]);
  return {
    schema: 1,
    scope: "positive-net-invoicing-next-30-days",
    signals: measured,
    tested: scored.length,
    shortlist: finalists.length,
    developmentMisses: faults.length,
    reference,
    chosen,
    finalists,
    qualified: improves(chosen.validation, reference),
  };
}
export function rankMethod(rows, base, program) {
  return allocate(rows.map((r) => methodForecast(r, base, program)));
}
export function activeProgram(report, base, scope) {
  if (
    scope !== report.scope ||
    digest(base) !== report.incumbent ||
    digest(report.candidate) !== report.programHash
  )
    throw Error("Alcance o método diferente");
  checkProgram(report.candidate);
  const approved =
    improves(report.validation.candidate, report.validation.incumbent) &&
    improves(report.holdout.candidate, report.holdout.incumbent);
  if (approved !== report.admitted) throw Error("Fallo en la puerta de Salud");
  return approved ? report.candidate : null;
}

export function admittedForecast(row, base, program) {
  if (
    digest(base) !== firstExam.incumbent ||
    (program !== null && digest(program) !== firstExam.programHash)
  )
    throw Error("Método o modelo sin examen registrado");
  const approved = activeProgram(firstExam, base, firstExam.scope);
  if (program !== null && approved === null) throw Error("Método sin admisión");
  return methodForecast(row, base, program);
}
