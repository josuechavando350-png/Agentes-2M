import { verify } from "node:crypto";
import { canonical, digest, integer, strict } from "./policy.mjs";
import { label, token } from "./dossiers.mjs";

const day = 86400000;
const amount = (n) => integer(n, 0, 1e10, "centavos");
export function signedRecord(g, c) {
  strict(c, ["type", "record", "signature"]);
  if (
    !g.key ||
    typeof c.signature !== "string" ||
    !verify(
      null,
      Buffer.from(canonical(c.record)),
      g.key,
      Buffer.from(c.signature, "base64"),
    )
  )
    throw Error("Constancia firmada requerida");
  return c.record;
}
function lookup(list, id) {
  const found = list?.find((x) => x.id === id);
  if (!found) throw Error("Registro desconocido");
  return found;
}
export function currentReview(m, id) {
  if (!Object.hasOwn(m?.business ?? {}, id))
    throw Error("Falta dictamen del comprador");
  const r = m.business[id].latest,
    docs = m.docs.filter((d) => d.rows.some((x) => x.subject === id));
  if (r.revision !== digest(docs.map((d) => [d.id, d.revision, d.sha256])))
    throw Error("Dictamen caducado");
  return r;
}
export function traceSources(m, refs) {
  const groups = [];
  const untraced = new Set();
  for (const ref of refs) {
    const origin = m.lineage?.find((x) => x.sha256 === ref.sha256);
    if (!origin) {
      untraced.add(ref.sha256);
      continue;
    }
    const component = new Set(origin.roots);
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].some((r) => component.has(r))) {
        for (const r of groups[i]) component.add(r);
        groups.splice(i, 1);
      }
    }
    groups.push([...component]);
  }
  return {
    attestedIndependent: groups.length,
    untraced: untraced.size,
    roots: groups,
  };
}

function checkArm(a) {
  strict(a, [
    "method",
    "field",
    "supported",
    "missing",
    "probe",
    "minutes",
    "outlayCents",
    "expectedNetCents",
    "expectedPaidBps",
  ]);
  token(a.method);
  token(a.field);
  label(a.probe, 400);
  if (
    ![a.supported, a.missing].every((x) => ["HOLD", "ASK", "OFFER"].includes(x))
  )
    throw Error("Acción desconocida");
  integer(a.minutes, 0, 14400, "minutos");
  amount(a.outlayCents);
  integer(a.expectedPaidBps, 0, 10000, "probabilidad");
  integer(a.expectedNetCents, -1e10, 1e10, "margen previsto");
}
function play(m, review, a) {
  if (!Object.hasOwn(review.checks, a.field))
    throw Error("Campo de decisión desconocido");
  const fact = review.checks[a.field],
    basis = traceSources(m, fact.refs);
  let action = fact.usable ? a.supported : a.missing;
  if (review.veto.length) action = "HOLD";
  if (action === "OFFER" && !review.offer) action = "ASK";
  return {
    action,
    request: action === "ASK" ? a.probe : null,
    delivery: action === "OFFER" ? review.offer : null,
    evidence: fact.refs,
    lineage: basis,
    forecast: {
      prior: review.forecast,
      expectedPaidBps: a.expectedPaidBps,
      expectedNetCents: a.expectedNetCents,
    },
    review: digest(review),
  };
}
function proofBook(g, t, subject) {
  return g.records
    .slice(t.anchor)
    .filter(
      (r) =>
        r.mission === t.mission &&
        r.subject === subject &&
        ["paid", "expense"].includes(r.stage),
    );
}
const moneyKey = (r) => JSON.stringify([r.stage, r.reference]);
const bookHash = (records) =>
  digest(
    records
      .map((r) => [r.stage, r.reference, r.cents])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
function signTail(n, w) {
  // Exact upper binomial tail for independent randomized pairs, excluding ties.
  let ways = 1n,
    tail = 0n;
  for (let i = 0; i <= n; i++) {
    if (i >= w) tail += ways;
    if (i < n) ways = (ways * BigInt(n - i)) / BigInt(i + 1);
  }
  return { numerator: tail, denominator: 1n << BigInt(n) };
}
export function fieldResult(g, t) {
  let delta = 0,
    wins = 0,
    losses = 0,
    netA = 0,
    netB = 0,
    cash = 0,
    minutes = 0,
    completed = 0,
    failedDelivery = 0,
    deviations = 0,
    differentiated = 0;
  for (const pair of t.pairs) {
    const both = [];
    for (const unit of pair) {
      const x = Object.hasOwn(t.observations, unit.subject)
        ? t.observations[unit.subject]
        : null;
      if (!x || x.book !== bookHash(proofBook(g, t, unit.subject))) continue;
      completed++;
      deviations += Number(!x.applied);
      if (
        x.applied &&
        (unit.control.action !== unit.candidate.action ||
          unit.control.request !== unit.candidate.request)
      )
        differentiated++;
      cash += x.paid;
      minutes += x.minutes;
      failedDelivery += Number(x.paid > 0 && !x.delivered);
      both.push([unit.arm, x.net]);
    }
    if (both.length !== 2) continue;
    const a = both.find((v) => v[0] === "control")[1],
      b = both.find((v) => v[0] === "candidate")[1],
      d = b - a;
    netA += a;
    netB += b;
    delta += d;
    wins += Number(d > 0);
    losses += Number(d < 0);
  }
  const total = t.pairs.length * 2,
    p = signTail(wins + losses, wins);
  const complete = completed === total;
  const passed =
    complete &&
    delta > t.minLiftCents * t.pairs.length &&
    netB > 0 &&
    differentiated > 0 &&
    failedDelivery === 0 &&
    p.numerator * BigInt(t.alphaDenominator) <= p.denominator;
  return {
    trial: t.id,
    scope: t.scope,
    control: t.control.method,
    candidate: t.candidate.method,
    total,
    completed,
    status: !complete
      ? "AWAIT_EVIDENCE"
      : passed
        ? "QUALIFIED_IN_SCOPE"
        : "KEEP_CONTROL",
    expectedLiftCents:
      t.candidate.expectedNetCents - t.control.expectedNetCents,
    netForecastErrorCents: complete
      ? {
          control: netA / t.pairs.length - t.control.expectedNetCents,
          candidate: netB / t.pairs.length - t.candidate.expectedNetCents,
        }
      : null,
    deviations,
    differentiated,
    observedPaidCents: cash,
    humanMinutes: minutes,
    failedDelivery,
    pairedControlNetCents: netA,
    pairedCandidateNetCents: netB,
    incrementalNetPerPairCents: complete ? delta / t.pairs.length : null,
    wins,
    losses,
    oneSidedSignP: complete
      ? Number(p.numerator) / Number(p.denominator)
      : null,
    alpha: 1 / t.alphaDenominator,
  };
}
function methodVersion(a) {
  return digest([a.method, a.field, a.supported, a.missing, a.probe]);
}
export function fieldLesson(g, scope) {
  token(scope);
  const series = (g.trials ?? []).filter((t) => t.scope === scope);
  if (!series.length) return { scope, active: null, trials: [] };
  let active = series[0].control;
  const trials = series.map((t) => {
    const result = fieldResult(g, t),
      linked = methodVersion(active) === methodVersion(t.control);
    if (linked && result.status === "QUALIFIED_IN_SCOPE") active = t.candidate;
    return { trial: t.id, linked, status: result.status };
  });
  return { scope, active, trials };
}
export function fieldHypotheses(m, subject) {
  const review = currentReview(m, subject);
  const fields = ["access", "cost_mxn_cents", "authority", "price_mxn_cents"];
  const questions = {
    access: [
      "El comprador habilitará el acceso dentro del plazo",
      "El acceso indispensable está bloqueado",
      "Solicitar confirmación escrita de acceso al responsable",
      "Permiso verificable o denegación explícita",
    ],
    cost_mxn_cents: [
      "La entrega deja margen al precio propuesto",
      "El costo completo consume el precio",
      "Cronometrar una entrega autorizada y cotizar sus insumos",
      "Costo completo frente al precio documentado",
    ],
    authority: [
      "El contacto puede autorizar el piloto",
      "Otra persona debe aprobarlo",
      "Contrastar la ruta de aprobación con el comprador",
      "Nombre del aprobador y constancia de su facultad",
    ],
    price_mxn_cents: [
      "El comprador acepta el precio propuesto",
      "Su precio aceptable queda por debajo",
      "Solicitar decisión sobre una cotización de alcance fijo",
      "Aceptación documentada o contrapropuesta del comprador",
    ],
  };
  const ranked = fields
    .map((field) => {
      const fact = review.checks[field],
        basis = traceSources(m, fact.refs);
      return {
        field,
        usable: fact.usable,
        lineage: basis,
        refs: fact.refs,
        priority: !fact.usable ? 0 : basis.attestedIndependent < 2 ? 1 : 2,
      };
    })
    .sort((a, b) => a.priority - b.priority);
  return {
    mission: m.id,
    subject,
    decision: review.decision,
    experiments: ranked.slice(0, 2).map((x) => {
      const [hypothesis, rival, test, discriminator] = questions[x.field];
      return { ...x, hypothesis, rival, test, discriminator };
    }),
  };
}
export function fieldView(g) {
  return (g.trials ?? []).map((t) => ({
    ...fieldResult(g, t),
    mission: t.mission,
    from: t.start,
    until: t.end,
    capacity: t.capacity,
    pairs: t.pairs,
  }));
}
function open(g, m, r, seal, at) {
  strict(r, [
    "mission",
    "id",
    "scope",
    "pairs",
    "control",
    "candidate",
    "consent",
    "days",
    "hourlyCents",
    "availableCashCents",
    "availableMinutes",
    "minLiftCents",
  ]);
  token(r.id);
  token(r.scope);
  label(r.consent, 240);
  checkArm(r.control);
  checkArm(r.candidate);
  integer(r.days, 1, 90, "días");
  amount(r.hourlyCents);
  amount(r.availableCashCents);
  amount(r.minLiftCents);
  integer(r.availableMinutes, 0, 1e7, "capacidad");
  if (
    !m ||
    m.id !== r.mission ||
    m.closed ||
    at >= m.deadline ||
    g.trials?.some((t) => t.id === r.id) ||
    r.candidate.method === r.control.method
  )
    throw Error("Ensayo inválido");
  if (!seal || !/^[0-9a-f]{64}$/.test(seal.seed))
    throw Error("Aleatorización ausente");
  if (
    !Array.isArray(r.pairs) ||
    r.pairs.length < 1 ||
    r.pairs.length > 128 ||
    r.pairs.some((p) => !Array.isArray(p) || p.length !== 2)
  )
    throw Error("Pares inválidos");
  const ids = r.pairs.flat();
  ids.forEach(token);
  if (
    new Set(ids).size !== ids.length ||
    (g.trials ?? []).some((t) =>
      t.pairs.flat().some((u) => ids.includes(u.subject)),
    )
  )
    throw Error("Comprador duplicado o reserva ya utilizada");
  const series = (g.trials ?? []).filter((t) => t.scope === r.scope);
  const prior = series.length;
  if (prior) {
    const lesson = fieldLesson(g, r.scope);
    if (
      series.some((t) => fieldResult(g, t).status === "AWAIT_EVIDENCE") ||
      methodVersion(lesson.active) !== methodVersion(r.control)
    )
      throw Error("Control distinto del vigente o ensayo pendiente");
  }
  if (prior >= 30) throw Error("Presupuesto estadístico de esta serie agotado");
  const minutes = r.pairs.length * (r.control.minutes + r.candidate.minutes);
  const cash =
    r.pairs.length * (r.control.outlayCents + r.candidate.outlayCents) +
    Math.ceil((minutes * r.hourlyCents) / 60);
  const openTrials = (g.trials ?? []).filter((t) => t.end > at);
  const capacity = {
    minutes,
    upfrontCents: cash,
    reservedMinutes: openTrials.reduce((s, t) => s + t.capacity.minutes, 0),
    reservedCents: openTrials.reduce((s, t) => s + t.capacity.upfrontCents, 0),
  };
  if (
    cash + capacity.reservedCents > r.availableCashCents ||
    minutes + capacity.reservedMinutes > r.availableMinutes
  )
    throw Error("Caja o capacidad insuficiente antes del cobro");
  const pairs = r.pairs.map((pair, i) => {
    const bit = parseInt(digest([seal.seed, r.id, i]).slice(-2), 16) % 2;
    return pair.map((subject, j) => {
      const review = currentReview(m, subject);
      return {
        subject,
        arm: bit === j ? "candidate" : "control",
        control: play(m, review, r.control),
        candidate: play(m, review, r.candidate),
      };
    });
  });
  const t = {
    ...r,
    anchor: g.records.length,
    start: at,
    end: at + r.days * day,
    pairs,
    capacity,
    observations: {},
    alphaDenominator: 20 * 2 ** prior,
  };
  (g.trials ??= []).push(t);
  return {
    status: "RANDOMIZED",
    trial: r.id,
    commitment: digest(r),
    pairs,
    capacity,
    until: t.end,
  };
}
function observe(g, r, at) {
  strict(r, [
    "trial",
    "subject",
    "previous",
    "settlements",
    "humanMinutes",
    "delivered",
    "applied",
    "evidence",
  ]);
  const t = lookup(g.trials, r.trial);
  token(r.subject);
  label(r.evidence, 240);
  if (
    at < t.end ||
    !t.pairs.flat().some((u) => u.subject === r.subject) ||
    typeof r.delivered !== "boolean" ||
    typeof r.applied !== "boolean"
  )
    throw Error("Cuenta o ventana de ensayo inválida");
  const prior = Object.hasOwn(t.observations, r.subject)
    ? t.observations[r.subject]
    : null;
  if (r.previous !== (prior ? digest(prior) : null))
    throw Error("Revisión de cierre caducada");
  if (
    (g.trials ?? []).some((x) =>
      Object.values(x.observations).some((o) => o.evidence === r.evidence),
    )
  )
    throw Error("Comprobante de cierre reutilizado");
  integer(r.humanMinutes, 0, 1e7, "tiempo humano");
  const records = proofBook(g, t, r.subject),
    table = new Map(records.map((x) => [moneyKey(x), x]));
  if (!Array.isArray(r.settlements) || r.settlements.length !== table.size)
    throw Error("Conciliación incompleta");
  let paid = 0,
    refunds = 0,
    cost = 0;
  for (const line of r.settlements) {
    strict(line, ["stage", "reference", "occurredAt", "category"]);
    const key = moneyKey(line),
      entry = table.get(key);
    if (!entry) throw Error("Referencia desconocida o duplicada");
    table.delete(key);
    integer(line.occurredAt, 1, at, "fecha económica");
    if (
      !(entry.stage === "paid"
        ? line.category === "payment"
        : ["refund", "cost"].includes(line.category))
    )
      throw Error("Categoría incompatible");
    if (line.occurredAt < t.start || line.occurredAt >= t.end) continue;
    if (entry.stage === "paid") paid += entry.cents;
    else if (line.category === "refund") refunds += entry.cents;
    else cost += entry.cents;
  }
  const labor = Math.ceil((t.hourlyCents * r.humanMinutes) / 60);
  const net = integer(paid - refunds - cost - labor, -1e13, 1e13, "margen");
  const close = {
    book: bookHash(records),
    evidence: r.evidence,
    paid,
    refunds,
    cost,
    labor,
    minutes: r.humanMinutes,
    delivered: r.delivered,
    applied: r.applied,
    net,
    at,
  };
  t.observations[r.subject] = close;
  return {
    status: "ACCOUNT_RECONCILED",
    revision: digest(close),
    close,
    result: fieldResult(g, t),
  };
}
export const fieldCommands = ["trial_open", "trial_observed", "source_lineage"];
export function fieldCommand(state, c, at, seal) {
  const g = state.gov,
    r = signedRecord(g, c),
    m = g.missions.at(-1);
  if (c.type === "trial_open")
    return { result: open(g, m, r, seal, at), actors: [] };
  if (c.type === "trial_observed")
    return { result: observe(g, r, at), actors: [] };
  strict(r, ["mission", "document", "sha256", "roots"]);
  const doc = m?.docs.find((d) => d.id === r.document && d.sha256 === r.sha256);
  if (
    !m ||
    r.mission !== m.id ||
    !doc ||
    !Array.isArray(r.roots) ||
    !r.roots.length ||
    r.roots.length > 16 ||
    new Set(r.roots).size !== r.roots.length
  )
    throw Error("Linaje inválido");
  r.roots.forEach((x) => label(x, 200));
  if (m.lineage?.some((x) => x.sha256 === doc.sha256))
    throw Error("Origen ya atestiguado");
  (m.lineage ??= []).push(r);
  return {
    result: { status: "SOURCES_TRACED", document: doc.id, roots: r.roots },
    actors: [],
  };
}
