import { strict, integer } from "./policy.mjs";
import { label, token } from "./dossiers.mjs";
import { assessMission, relevant } from "./global-analysis.mjs";
const names = {
  revenue: [
    "ingreso",
    "ingresos",
    "cobrado",
    "ventas",
    "revenue",
    "paid",
    "paid_cents",
  ],
  cost: ["costo", "costos", "gasto", "gastos", "cost", "cost_cents"],
  price: ["precio", "price", "precio_unitario", "unit_price"],
  quantity: ["cantidad", "unidades", "units", "quantity"],
};
const clean = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
export function compileBrief(b, sources, at, canCalculate = true) {
  strict(b, [
    "scope",
    "question",
    "subject",
    "unit",
    "stage",
    "threshold",
    "minFamilies",
    "probes",
  ]);
  token(b.scope);
  label(b.question, 400);
  token(b.unit);
  token(b.stage);
  if (b.subject !== null) token(b.subject);
  integer(
    b.threshold,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    "umbral",
  );
  integer(b.minFamilies, 1, 10, "familias");
  const docs = sources.filter(
    (s) => s.scope === b.scope && s.from <= at && at < s.until,
  );
  const fields = [
    ...new Set(docs.flatMap((s) => Object.keys(s.schema))),
  ].sort();
  const subjects = b.subject
    ? [b.subject]
    : [
        ...new Set(docs.flatMap((s) => s.document.rows.map((r) => r.subject))),
      ].sort();
  const q = clean(b.question);
  const gap =
    /\b(margen|utilidad|profit|margin|oportunidad|oportunidades)\b/.test(q);
  const volume = /\b(multiplica|producto|multiplicar)\b/.test(q);
  if ((gap || volume) && !canCalculate) throw Error("Cálculo sin permiso");
  const choices = (list) => fields.filter((f) => list.includes(f));
  const matches = gap
    ? [choices(names.revenue), choices(names.cost)]
    : volume
      ? [choices(names.price), choices(names.quantity)]
      : [fields.filter((f) => q.split(/[^a-z0-9_]+/).includes(f))];
  const clarify = (why) => ({
    status: "NEED_MISSION_DEFINITION",
    question: b.question,
    reason: why,
    fields,
    subjects: subjects.length,
  });
  if (gap && volume) return clarify("Se solicitan dos decisiones distintas");
  if (
    !gap &&
    !volume &&
    !/\b(consulta|leer|cuanto|valor|lookup|mide|medir)\b/.test(q)
  )
    return clarify("Falta una medida identificable y una regla para decidir");
  if (!subjects.length || matches.some((a) => a.length !== 1))
    return clarify(
      "Especifica los campos de una consulta, diferencia o producto; usa un mandato estructurado si hay varios significados",
    );
  const operands = matches.map(([field], i) => ({
    field,
    unit: volume && i === 1 ? "unidades" : b.unit,
    stage: b.stage,
  }));
  if (subjects.length > 256)
    throw Error("Delimita el expediente a 256 sujetos");
  const worker = { id: 1, sector: 1, policy: "indexed" };
  const candidates = subjects.map((subject) => {
    const goal = {
      scope: b.scope,
      objective: b.question,
      subject,
      op: gap ? "difference" : volume ? "product" : "lookup",
      operands,
      threshold: b.threshold,
      minFamilies: b.minFamilies,
      probes: b.probes,
    };
    const finding = assessMission({
      goal,
      sources: relevant(docs, goal),
      at,
      worker,
      team: [worker],
      budget: 0,
      minutes: 0,
      field: null,
    });
    return {
      goal,
      action: finding.action,
      value: finding.value,
      missing: finding.missing.length,
    };
  });
  const preference = { ADVANCE: 0, NEED_EVIDENCE: 1, STOP: 2 };
  candidates.sort(
    (a, b) =>
      preference[a.action] - preference[b.action] ||
      (b.value ?? 0) - (a.value ?? 0) ||
      a.missing - b.missing ||
      a.goal.subject.localeCompare(b.goal.subject),
  );
  return {
    status: "PLANNED",
    goal: candidates[0].goal,
    alternatives: candidates.map((c) => ({
      subject: c.goal.subject,
      action: c.action,
      value: c.value,
      missing: c.missing,
    })),
    criterion:
      "Primero margen o medida respaldada sobre el umbral, luego información pendiente, después alternativas descartadas",
  };
}
