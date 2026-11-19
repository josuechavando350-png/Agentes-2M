import { STIPEND, digest, integer, strict } from "./policy.mjs";
import {
  label,
  token,
  freezeDocument,
  investigate,
  referee,
} from "./dossiers.mjs";
import { signedRecord, currentReview } from "./field-lab.mjs";
import { getAgent } from "./ledger.mjs";
const hash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
function recipe(spec) {
  strict(spec, ["op", "fields"]);
  const arity = new Map([
    ["difference", 2],
    ["product", 2],
    ["lookup", 1],
  ]).get(spec.op);
  if (
    !arity ||
    !Array.isArray(spec.fields) ||
    spec.fields.length !== arity ||
    new Set(spec.fields).size !== arity
  )
    throw Error("Receta inválida");
  spec.fields.forEach(token);
  return { version: 1, op: spec.op, fields: spec.fields };
}
function inferRecipe(spec, docs, targets) {
  strict(spec, ["examples"]);
  if (
    !Array.isArray(spec.examples) ||
    spec.examples.length < 2 ||
    spec.examples.length > 16
  )
    throw Error("Se requieren de 2 a 16 ejemplos");
  const inputs = new Map();
  for (const e of spec.examples) {
    strict(e, ["subject", "value"]);
    token(e.subject);
    if (
      inputs.has(e.subject) ||
      targets.includes(e.subject) ||
      !["string", "number"].includes(typeof e.value)
    )
      throw Error("Ejemplo inválido o reutilizado");
    inputs.set(e.subject, new Map());
  }
  const fields = new Set();
  for (const d of docs)
    for (const row of d.rows) {
      const record = inputs.get(row.subject);
      if (!record) continue;
      fields.add(row.field);
      const seen = record.get(row.field) ?? new Set();
      seen.add(row.value);
      record.set(row.field, seen);
    }
  if (fields.size > 16) throw Error("Demasiados campos de aprendizaje");
  const names = [...fields].sort(),
    candidates = [];
  for (const a of names) {
    candidates.push({ op: "lookup", fields: [a] });
    for (const b of names)
      if (a !== b) {
        candidates.push({ op: "difference", fields: [a, b] });
        if (a < b) candidates.push({ op: "product", fields: [a, b] });
      }
  }
  const matches = candidates.filter(({ op, fields }) =>
    spec.examples.every((e) => {
      const values = fields.map((f) => inputs.get(e.subject).get(f));
      if (values.some((v) => v?.size !== 1)) return false;
      const [a, b] = values.map((v) => [...v][0]);
      if (op === "lookup") return a === e.value;
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return false;
      const n = op === "product" ? a * b : a - b;
      return Number.isSafeInteger(n) && n === e.value;
    }),
  );
  if (matches.length !== 1)
    throw Error("Ejemplos insuficientes para identificar una receta única");
  return recipe(matches[0]);
}
function produce(program, docs, subjects) {
  if (
    !Array.isArray(subjects) ||
    !subjects.length ||
    subjects.length > 256 ||
    new Set(subjects).size !== subjects.length
  )
    throw Error("Partidas inválidas");
  return subjects.map((subject) => {
    token(subject);
    const q = { subject, op: program.op, fields: program.fields };
    const answer = investigate(docs, q),
      audit = referee(docs, q);
    for (const k of ["status", "value", "refs"])
      if (digest(answer[k]) !== digest(audit[k]))
        throw Error("Diferencia en auditoría de entrega");
    return {
      subject,
      status: audit.status,
      value: audit.value,
      refs: audit.refs,
    };
  });
}
export const deliveryCommands = [
  "delivery_spec",
  "delivery_build",
  "delivery_accept",
  "risk_pledge",
  "truth_reward",
];
export function deliveryCommand(state, c, at) {
  const g = state.gov,
    r = c.type === "delivery_build" ? c : signedRecord(g, c);
  const m = g.missions.find((x) => x.id === r.mission);
  if (!m) throw Error("Misión desconocida");
  const open = !m.closed && at < m.deadline;
  if (c.type === "risk_pledge") {
    strict(r, [
      "mission",
      "id",
      "subject",
      "review",
      "sponsor",
      "cents",
      "reference",
    ]);
    token(r.id);
    token(r.subject);
    label(r.reference, 160);
    const review = currentReview(m, r.subject);
    if (
      !open ||
      !review.offer ||
      r.review !== digest(review) ||
      getAgent(state, r.sponsor).balance <= 1 ||
      g.missions.some((x) =>
        x.pledges?.some((p) => p.id === r.id || p.reference === r.reference),
      )
    )
      throw Error("Compromiso inválido");
    integer(r.cents, 1, 1e10, "gasto autorizado");
    (m.pledges ??= []).push({
      ...r,
      at,
      generation: getAgent(state, r.sponsor).generation,
    });
    return { result: { status: "OUTLAY_AUTHORIZED", id: r.id }, actors: [] };
  }
  if (c.type === "truth_reward") {
    strict(r, [
      "mission",
      "pledge",
      "review",
      "reason",
      "cancellation",
      "avoidedCents",
    ]);
    label(r.cancellation, 160);
    const p = m.pledges?.find((x) => x.id === r.pledge);
    if (
      !p ||
      p.reward ||
      m.pledges.some((v) => v.reward?.review === r.review) ||
      g.missions.some((x) =>
        x.pledges?.some((v) => v.reward?.cancellation === r.cancellation),
      ) ||
      r.cancellation === p.reference
    )
      throw Error("Cancelación inválida o reutilizada");
    integer(r.avoidedCents, 1, p.cents, "monto cancelado");
    const review = currentReview(m, p.subject),
      veto = review.veto.find((v) => v.reason === r.reason);
    if (
      !veto ||
      review.decision !== "ABANDON" ||
      digest(review) !== r.review ||
      review.at < p.at ||
      r.review === p.review
    )
      throw Error("Falta refutación posterior");
    const field = r.reason === "ACCESS_DENIED" ? "access" : "cost_mxn_cents",
      fact = review.checks[field];
    const recipient = getAgent(state, fact.actor),
      sponsor = getAgent(state, p.sponsor);
    const original = state.events.findLast(
      (e) =>
        e.result?.status === "BUSINESS_REVIEWED" &&
        e.result.detail.subject === p.subject &&
        digest(e.result.detail) === r.review,
    );
    const identity = original?.steps.find(
      (s) => s.kind === "agent" && s.agent.id === recipient.id,
    )?.agent;
    if (
      !fact.refs.length ||
      recipient.status !== "LIVE" ||
      identity?.generation !== recipient.generation ||
      sponsor.generation !== p.generation ||
      recipient.balance >= STIPEND ||
      sponsor.balance <= 1 ||
      recipient.id === sponsor.id
    )
      throw Error("Identidad no elegible para la transferencia");
    const transfer = { from: sponsor.id, to: recipient.id };
    p.reward = { ...r, transfer };
    return {
      result: {
        status: "VERIFIED_REFUTATION",
        transfer,
        documentedCancelledCents: r.avoidedCents,
      },
      actors: [],
      transfer,
    };
  }
  if (c.type === "delivery_spec") {
    strict(r, [
      "mission",
      "id",
      "subject",
      "review",
      "spec",
      "documents",
      "subjects",
      "testHash",
    ]);
    token(r.id);
    token(r.subject);
    const rev = currentReview(m, r.subject);
    if (
      !open ||
      !rev.offer ||
      digest(rev) !== r.review ||
      !hash(r.testHash) ||
      m.products?.some((p) => p.id === r.id || p.testHash === r.testHash)
    )
      throw Error("Encargo o examen inválido");
    if (
      !Array.isArray(r.documents) ||
      !r.documents.length ||
      r.documents.length > 256 ||
      new Set(r.documents).size !== r.documents.length
    )
      throw Error("Documentos inválidos");
    if (
      !Array.isArray(r.subjects) ||
      !r.subjects.length ||
      r.subjects.length > 256 ||
      new Set(r.subjects).size !== r.subjects.length
    )
      throw Error("Partidas inválidas");
    r.subjects.forEach(token);
    const docs = r.documents.map((id) => {
      const d = m.docs.find((v) => v.id === id);
      if (!d) throw Error("Fuente no admitida");
      return d;
    });
    const sources = docs.map((d) => [d.id, d.sha256]);
    const program = Object.hasOwn(r.spec ?? {}, "examples")
      ? inferRecipe(r.spec, docs, r.subjects)
      : recipe(r.spec);
    (m.products ??= []).push({ ...r, program, sources, at });
    return {
      result: { status: "SPEC_FROZEN", id: r.id, program, sources },
      actors: [],
    };
  }
  const item = m.products?.find((p) => p.id === r.id);
  if (!item) throw Error("Encargo desconocido");
  if (c.type === "delivery_build") {
    strict(c, ["type", "mission", "id"]);
    if (item.artifact) throw Error("Entrega ya construida");
    const docs = item.sources.map(([id, sha]) => {
      const d = m.docs.find((x) => x.id === id && x.sha256 === sha);
      if (!d) throw Error("Fuente modificada");
      return d;
    });
    const rows = produce(item.program, docs, item.subjects);
    item.artifact = {
      program: item.program,
      rows,
      sha256: digest({ program: item.program, rows }),
      at,
    };
    return { result: { status: "BUILT", artifact: item.artifact }, actors: [] };
  }
  strict(r, [
    "mission",
    "id",
    "artifact",
    "suite",
    "salt",
    "buyerAccepted",
    "evidence",
  ]);
  label(r.salt, 160);
  label(r.evidence, 200);
  if (
    !item.artifact ||
    r.artifact !== item.artifact.sha256 ||
    item.exam ||
    typeof r.buyerAccepted !== "boolean" ||
    digest([r.salt, r.suite]) !== item.testHash
  )
    throw Error("Examen no corresponde a la entrega");
  strict(r.suite, ["documents", "cases"]);
  if (
    !Array.isArray(r.suite.documents) ||
    !r.suite.documents.length ||
    r.suite.documents.length > 64 ||
    !Array.isArray(r.suite.cases) ||
    !r.suite.cases.length ||
    r.suite.cases.length > 256
  )
    throw Error("Suite inválida");
  const docs = r.suite.documents.map(freezeDocument);
  if (
    new Set(docs.map((d) => d.id)).size !== docs.length ||
    docs.some((d) =>
      item.sources.some(([id, sha]) => id === d.id || sha === d.sha256),
    ) ||
    r.suite.cases.some(
      (x) =>
        item.subjects.includes(x.subject) ||
        item.spec.examples?.some((e) => e.subject === x.subject),
    )
  )
    throw Error("La reserva debe contener partidas nuevas");
  const out = produce(
    item.program,
    docs,
    r.suite.cases.map((x) => x.subject),
  );
  let correct = 0;
  for (const [i, row] of out.entries()) {
    const e = r.suite.cases[i];
    strict(e, ["subject", "status", "value"]);
    if (e.status === row.status && e.value === row.value) correct++;
  }
  const useful = item.artifact.rows.every((row) => row.status === "SUPPORTED");
  item.exam = {
    correct,
    total: out.length,
    accepted: correct === out.length && useful && r.buyerAccepted,
    evidence: r.evidence,
    at,
  };
  return {
    result: {
      status: item.exam.accepted ? "DELIVERY_ACCEPTED" : "DELIVERY_REJECTED",
      exam: item.exam,
    },
    actors: [],
  };
}
