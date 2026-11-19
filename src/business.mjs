import { investigate, referee, token } from "./dossiers.mjs";
import { digest, strict } from "./policy.mjs";

// The ordering is also the evidence-acquisition order for the next decision.
const checks = [
  ["buyer", "¿Quién compra y en qué documento figura?", "text"],
  [
    "prior_spend_mxn_cents",
    "¿Qué pagó recientemente el comprador por resolverlo?",
    "positive",
  ],
  ["authority", "¿Qué puesto puede autorizar el piloto?", "text"],
  ["alternative", "¿Cómo resuelve hoy el problema?", "text"],
  [
    "access",
    "¿El comprador confirmó el acceso indispensable para entregar?",
    "yesno",
  ],
  ["scope", "¿Qué entrega concreta aceptaría el comprador?", "text"],
  ["price_mxn_cents", "¿Qué precio de piloto respalda la fuente?", "positive"],
  [
    "cost_mxn_cents",
    "¿Cuál es el costo completo estimado de entregar ese piloto?",
    "cost",
  ],
  ["delivery_days", "¿Cuántos días toma entregar?", "days"],
  ["acceptance", "¿Qué medición demostraría que funcionó el piloto?", "text"],
];
function valid(value, type) {
  if (type === "text")
    return typeof value === "string" && value.trim().length > 0;
  if (type === "yesno") return value === "yes" || value === "no";
  return (
    Number.isSafeInteger(value) &&
    value >= (type === "cost" ? 0 : 1) &&
    (type !== "days" || value <= 365)
  );
}
export function commercialReview(state, m, c, actors, at) {
  strict(c, ["type", "mission", "subject", "size"]);
  token(c.subject);
  if (m.id !== c.mission) throw Error("Misión distinta");
  const docs = m.docs.filter((d) =>
    d.rows.some((r) => r.subject === c.subject),
  );
  if (!docs.length)
    throw Error("Falta una fuente autorizada sobre la oportunidad");
  const checksByField = {};
  const gaps = [];
  for (const [i, [field, question, type]] of checks.entries()) {
    const query = { subject: c.subject, op: "lookup", fields: [field] };
    const a = investigate(docs, query),
      reference = referee(docs, query);
    const { status, value, refs } = a;
    if (digest({ status, value, refs }) !== digest(reference))
      throw Error("Lectura comercial inconsistente");
    const usable = status === "SUPPORTED" && valid(value, type);
    checksByField[field] = {
      status,
      value,
      refs,
      usable,
      actor: actors[i % actors.length],
    };
    if (!usable)
      gaps.push({
        field,
        question,
        reason: status === "SUPPORTED" ? "INVALID_VALUE" : status,
      });
  }
  const fact = (f) => (checksByField[f].usable ? checksByField[f].value : null);
  const price = fact("price_mxn_cents"),
    cost = fact("cost_mxn_cents"),
    margin = price !== null && cost !== null ? price - cost : null;
  const veto = [];
  if (fact("access") === "no")
    veto.push({ reason: "ACCESS_DENIED", fields: ["access"] });
  if (margin !== null && margin <= 0)
    veto.push({
      reason: "NONPOSITIVE_MARGIN",
      fields: ["price_mxn_cents", "cost_mxn_cents"],
    });
  // Prefer a low-cost question whose answer alone could veto the pilot.
  // For equal impact, resolve a documented contradiction before seeking a new source.
  const effort = {
    buyer: 1,
    prior_spend_mxn_cents: 2,
    authority: 1,
    alternative: 2,
    access: 1,
    scope: 2,
    price_mxn_cents: 2,
    cost_mxn_cents: 3,
    delivery_days: 1,
    acceptance: 2,
  };
  for (const gap of gaps) {
    const canVeto =
      gap.field === "access" ||
      (gap.field === "cost_mxn_cents" && price !== null) ||
      (gap.field === "price_mxn_cents" && cost !== null);
    gap.canChangeTo = canVeto
      ? ["ABANDON", ...(gaps.length === 1 ? ["PILOT"] : [])]
      : gaps.length === 1
        ? ["PILOT"]
        : [];
    gap.estimatedResearchCredits = effort[gap.field];
  }
  gaps.sort(
    (a, b) =>
      Number(b.canChangeTo.length > 0) - Number(a.canChangeTo.length > 0) ||
      Number(b.reason === "CONFLICTED") - Number(a.reason === "CONFLICTED") ||
      a.estimatedResearchCredits - b.estimatedResearchCredits,
  );
  const decision = veto.length
    ? "ABANDON"
    : gaps.length
      ? "INVESTIGATE"
      : "PILOT";
  const history = state.gov.missions
    .filter((x) => x.id !== m.id)
    .flatMap((x) => Object.values(x.business ?? {}));
  // Nonresponses remain unobserved. Only explicit declines or signed receipts count.
  let wins = 0,
    losses = 0;
  for (const entry of history) {
    if (entry.first.decision !== decision) continue;
    if (
      state.gov.records.some(
        (r) =>
          r.mission === entry.first.mission &&
          r.subject === entry.first.subject &&
          r.stage === "paid",
      )
    )
      wins++;
    else if (entry.feedback?.at(-1)?.stage === "declined") losses++;
  }
  const revision = digest(docs.map((d) => [d.id, d.revision, d.sha256]));
  const result = {
    mission: m.id,
    subject: c.subject,
    at,
    revision,
    decision,
    checks: checksByField,
    veto,
    gaps,
    nextQuestion: decision === "INVESTIGATE" ? gaps[0].question : null,
    abandonIf: "Acceso indispensable denegado o margen del piloto no positivo",
    forecast: {
      paidProbability: wins + losses ? (wins + 1) / (wins + losses + 2) : null,
      observations: wins + losses,
      priceMxnCents: price,
      costMxnCents: cost,
      deliveryDays: fact("delivery_days"),
    },
    offer:
      decision === "PILOT"
        ? {
            status: "DRAFT",
            buyer: fact("buyer"),
            approver: fact("authority"),
            scope: fact("scope"),
            acceptance: fact("acceptance"),
            priceMxnCents: price,
            expectedMarginMxnCents: margin,
            deliveryDays: fact("delivery_days"),
          }
        : null,
    actors,
  };
  m.business ??= {};
  const old = Object.hasOwn(m.business, c.subject)
    ? m.business[c.subject]
    : null;
  m.business[c.subject] = {
    first: old?.first ?? result,
    latest: result,
    feedback: old?.feedback ?? [],
  };
  return result;
}

export function businessOutcomes(g, m) {
  return Object.values(m.business ?? {}).map((entry) => {
    const { first, latest, feedback } = entry;
    const records = g.records.filter(
      (r) => r.mission === m.id && r.subject === first.subject,
    );
    const sum = (stage) =>
      records.filter((r) => r.stage === stage).reduce((a, r) => a + r.cents, 0);
    const paid = sum("paid"),
      expenses = sum("expense"),
      declined = feedback.at(-1)?.stage === "declined";
    const observed = paid > 0 ? 1 : declined ? 0 : null,
      prob = first.forecast.paidProbability;
    return {
      subject: first.subject,
      firstDecision: first.decision,
      latest,
      review: digest(latest),
      feedback,
      firstForecast: first.forecast,
      observed,
      paidMxnCents: paid,
      bookedExpenseMxnCents: expenses,
      bookedNetMxnCents: paid - expenses,
      brier: observed === null || prob === null ? null : (prob - observed) ** 2,
    };
  });
}

export function commercialQueue(m) {
  if (!m) return [];
  const bySubject = new Map();
  for (const doc of m.docs) {
    for (const subject of new Set(doc.rows.map((r) => r.subject))) {
      if (!bySubject.has(subject)) bySubject.set(subject, []);
      bySubject.get(subject).push(doc);
    }
  }
  const queue = [];
  for (const [subject, docs] of bySubject) {
    const revision = digest(docs.map((d) => [d.id, d.revision, d.sha256]));
    if (
      Object.hasOwn(m.business ?? {}, subject) &&
      m.business[subject].latest.revision === revision
    )
      continue;
    const evidence = (field) =>
      investigate(docs, { subject, fields: [field], op: "lookup" });
    const buyer = evidence("buyer"),
      spend = evidence("prior_spend_mxn_cents");
    if (buyer.status === "UNKNOWN" && spend.status === "UNKNOWN") continue;
    queue.push({
      subject,
      revision,
      buyer: buyer.value,
      spendMxnCents: valid(spend.value, "positive") ? spend.value : null,
      refs: spend.refs,
    });
  }
  return queue.sort(
    (a, b) =>
      (b.spendMxnCents ?? 0) - (a.spendMxnCents ?? 0) ||
      a.subject.localeCompare(b.subject),
  );
}
