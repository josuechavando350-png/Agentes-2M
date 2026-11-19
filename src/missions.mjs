import { createPublicKey, verify } from "node:crypto";
import { canonical, digest, integer, strict, LEADERS } from "./policy.mjs";
import { getAgent, founderId } from "./ledger.mjs";
import {
  freezeDocument,
  investigate,
  tribunal,
  label,
  token,
} from "./dossiers.mjs";
import { dossierScore, dominates, verifyMetrics } from "./blind.mjs";

export const ABSOLUTE = "Diablo 666";
export const HOUR = 3600000;
export const GOVERNED = new Set([
  "contest",
  "open_mission",
  "admit_source",
  "research",
  "inquire",
  "pulse",
  "halt",
  "settlement_key",
  "commerce",
  "mandate",
]);
export function charter() {
  return {
    roster: [
      { id: 666, generation: 1, policy: "first" },
      { id: 667, generation: 1, policy: "first" },
    ],
    missions: [],
    records: [],
    performance: {},
    key: null,
  };
}
export function incumbent(state) {
  return (
    state.gov.roster.find((x) => {
      const a = getAgent(state, x.id);
      return a.status === "LIVE" && a.generation === x.generation;
    }) ?? null
  );
}
const lastMission = (g) => g.missions.at(-1);
export function phase(m, at) {
  if (m.closed || at >= m.deadline) return "CLOSED";
  if (at < m.start + 24 * HOUR) return "DISCOVERY";
  if (at < m.start + 96 * HOUR) return "VALIDATION";
  return "COMMERCIAL";
}
function finance(g, m) {
  const receipts = g.records.filter((r) => r.mission === m.id);
  const sums = { estimate: 0, quote: 0, order: 0, paid: 0, expense: 0 };
  const latest = new Map();
  for (const r of receipts) {
    if (["paid", "expense"].includes(r.stage)) sums[r.stage] += r.cents;
    else latest.set(r.sale + "/" + r.stage, r);
  }
  for (const r of latest.values()) sums[r.stage] += r.cents;
  for (const v of Object.values(sums))
    integer(v, 0, Number.MAX_SAFE_INTEGER, "acumulado MXN");
  return {
    currency: "MXN",
    unit: "centavos",
    ...sums,
    net: sums.paid - sums.expense,
  };
}
function closeReport(g, m, at, why) {
  const money = finance(g, m),
    decisions = Object.values(m.findings);
  const calibrated = decisions.map((f) => {
    const observed = Number(
      g.records.some(
        (r) =>
          r.stage === "paid" && r.mission === m.id && r.subject === f.subject,
      ),
    );
    return {
      subject: f.subject,
      decision: f.firstDecision,
      forecast: f.forecast,
      observed,
      brier: (f.forecast - observed) ** 2,
    };
  });
  return {
    id: m.id,
    closedAt: at,
    reason: why,
    finance: money,
    simulationCost: m.spent,
    forecasts: calibrated,
    sectors: LEADERS.map((leader, i) => {
      const own = decisions.filter((f) => f.sector === i + 1),
        collected = calibrated.filter(
          (c) => c.observed && own.some((f) => f.subject === c.subject),
        );
      const profitable = collected.filter(
        (c) =>
          g.records
            .filter((r) => r.mission === m.id && r.subject === c.subject)
            .reduce(
              (net, r) =>
                net +
                (r.stage === "paid"
                  ? r.cents
                  : r.stage === "expense"
                    ? -r.cents
                    : 0),
              0,
            ) > 0,
      );
      return {
        leader,
        examined: own.length,
        repeat: profitable.map((c) => c.subject),
        unconfirmed: own
          .filter((f) => !collected.some((c) => c.subject === f.subject))
          .map((f) => f.subject),
        avoided: own
          .filter((f) => f.decision === "ABANDON")
          .map((f) => ({
            subject: f.subject,
            reviewer: f.crew[2],
            source: f.proof.referee.refs,
          })),
      };
    }),
  };
}
export function missionView(state, at) {
  const g = state.gov;
  if (!g) return null;
  const m = lastMission(g);
  return {
    absolute: {
      name: ABSOLUTE,
      holder: incumbent(state),
      ranking: g.roster,
      lastExam: g.lastExam ?? null,
    },
    supremeLeaders: LEADERS,
    mission: m
      ? {
          id: m.id,
          start: m.start,
          deadline: m.deadline,
          phase: phase(m, at),
          sealed: !!m.closed,
          budget: m.budget,
          spent: m.spent,
          documents: m.docs.length,
          pilots: m.pilots,
          portfolio: m.portfolio,
          findings: Object.values(m.findings),
          finance: finance(g, m),
          close:
            m.closed ??
            (at >= m.deadline
              ? closeReport(g, m, m.deadline, "DEADLINE")
              : null),
        }
      : null,
  };
}
export function awareness(state, id, at) {
  const a = getAgent(state, id),
    m = state.gov && lastMission(state.gov);
  const commitments =
    m && phase(m, at) !== "CLOSED"
      ? Object.values(m.findings)
          .filter((f) => f.crew.includes(id))
          .map((f) => ({ subject: f.subject, decision: f.decision }))
      : [];
  return {
    id,
    generation: a.generation,
    alive: a.status === "LIVE",
    balance: a.balance,
    unit: "créditos simulados",
    nextActionCost: 1,
    canDeliver: a.status === "LIVE" && a.balance > 1,
    specialtyRecord: state.gov?.performance[id + "@" + a.generation] ?? {
      attempts: 0,
      correct: 0,
      elite: false,
    },
    skills: a.skills,
    programs: (a.programs ?? []).map((p) => p.id),
    commitments,
    mission: m?.id ?? null,
    remainingMs: m && !m.closed ? Math.max(0, m.deadline - at) : 0,
    zero: "DEAD_ZERO",
  };
}
function openMission(g, c, at) {
  strict(c, ["type", "mission", "budget"]);
  token(c.mission);
  integer(c.budget, 4, 1000000, "presupuesto simulado");
  if (
    g.missions.some((m) => m.id === c.mission) ||
    g.missions.some((m) => !m.closed)
  )
    throw Error("Ya existe o continúa una misión");
  const m = {
    id: c.mission,
    budget: c.budget,
    start: at,
    deadline: at + 168 * HOUR,
    spent: 0,
    docs: [],
    findings: {},
    pilots: [],
    portfolio: null,
    closed: null,
  };
  g.missions.push(m);
  return {
    status: "OPEN",
    id: m.id,
    start: at,
    deadline: m.deadline,
    budget: m.budget,
  };
}
function settlement(g, m, c, state) {
  strict(c, ["type", "record", "signature"]);
  const r = c.record;
  strict(r, [
    "mission",
    "subject",
    "sale",
    "stage",
    "reference",
    "currency",
    "cents",
    "contributors",
  ]);
  [r.subject, r.sale].forEach(token);
  label(r.reference, 120);
  if (
    r.mission !== m.id ||
    !Object.hasOwn(m.findings, r.subject) ||
    r.currency !== "MXN" ||
    !["estimate", "quote", "order", "paid", "expense"].includes(r.stage)
  )
    throw Error("Registro comercial inválido");
  integer(r.cents, 1, 1000000000000, "centavos");
  if (
    !Array.isArray(r.contributors) ||
    !r.contributors.length ||
    r.contributors.length > 100 ||
    new Set(r.contributors).size !== r.contributors.length
  )
    throw Error("Atribución inválida");
  r.contributors.forEach((id) => getAgent(state, id));
  if (
    !g.key ||
    typeof c.signature !== "string" ||
    !verify(
      null,
      Buffer.from(canonical(r)),
      g.key,
      Buffer.from(c.signature, "base64"),
    )
  )
    throw Error("Falta constancia firmada por tesorería");
  if (g.records.some((x) => x.stage === r.stage && x.reference === r.reference))
    throw Error("Referencia ya contabilizada");
  if (
    g.records.some(
      (x) =>
        x.sale === r.sale &&
        (x.mission !== r.mission || x.subject !== r.subject),
    )
  )
    throw Error("Venta vinculada a otro expediente");
  g.records.push(r);
  return { status: "BOOKED", record: r, finance: finance(g, m) };
}
function eligible(state, sector, role, chiefId) {
  const g = state.gov;
  const candidates = Array.from({ length: 32 }, (_, i) =>
    getAgent(state, founderId(state, sector, 720 + role * 32 + i)),
  ).filter((a) => a.status === "LIVE" && a.balance > 1 && a.id !== chiefId);
  candidates.sort((a, b) => {
    const skill = (id) => {
      const s = g.performance[id + "@" + getAgent(state, id).generation];
      return s ? (s.correct + 1) / (s.attempts + 2) : 0.5;
    };
    return skill(b.id) - skill(a.id) || b.balance - a.balance || a.id - b.id;
  });
  return candidates[0];
}
function probability(g, decision) {
  const past = g.missions
    .flatMap((x) => x.closed?.forecasts ?? [])
    .filter((x) => x.decision === decision);
  return (past.reduce((s, x) => s + x.observed, 0) + 1) / (past.length + 2);
}
function selection(g, m, at, policy) {
  const subjects = [
    ...new Set(m.docs.flatMap((d) => d.rows.map((r) => r.subject))),
  ].sort();
  const current = phase(m, at);
  const options = subjects
    .map((subject) => {
      const docs = m.docs.filter((d) =>
        d.rows.some((r) => r.subject === subject),
      );
      const evidence = g.records.filter(
        (r) => r.mission === m.id && r.subject === subject,
      );
      const revision = digest({
        sources: docs.map((d) => d.sha256),
        commercial: evidence,
      });
      const known = Object.hasOwn(m.findings, subject)
        ? m.findings[subject]
        : null;
      if (
        known &&
        known.revision === revision &&
        (known.phase === current || known.decision === "ABANDON")
      )
        return null;
      const get = (field) =>
        investigate(docs, { subject, op: "lookup", fields: [field] }, policy)
          .value;
      const closing = get("opening");
      if (
        typeof closing === "string" &&
        Number.isFinite(Date.parse(closing)) &&
        Date.parse(closing) <= at
      )
        return null;
      const fields = [
        "buyer",
        "problem",
        "alternative",
        "price",
        "cost",
        "units",
      ];
      const present = fields.filter((f) => get(f) !== null).length;
      const units = get("units"),
        price = get("price"),
        cost = get("cost");
      const potential = [units, price, cost].every(Number.isSafeInteger)
        ? BigInt(units) * (BigInt(price) - BigInt(cost))
        : 0n;
      const calibrated = probability(
        g,
        known?.firstDecision ??
          (present === 6 ? "VALIDATE_BUYER" : "SEEK_EVIDENCE"),
      );
      return {
        subject,
        docs,
        revision,
        known,
        present,
        potential,
        calibrated,
        weight:
          current === "DISCOVERY"
            ? present
            : current === "VALIDATION"
              ? (known ? 12 : 0) + present
              : (known?.decision === "VALIDATE_BUYER" ? 20 : 0) + present,
      };
    })
    .filter(Boolean);
  options.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.calibrated - a.calibrated ||
      (b.potential > a.potential ? 1 : b.potential < a.potential ? -1 : 0) ||
      a.subject.localeCompare(b.subject),
  );
  return options;
}
function allowance(m, at) {
  const stages = { DISCOVERY: 0.25, VALIDATION: 0.7, COMMERCIAL: 1 };
  return Math.min(
    m.budget,
    Math.max(4, Math.floor(m.budget * (stages[phase(m, at)] ?? 0))),
  );
}
function research(state, m, at, chief) {
  const g = state.gov,
    options = selection(g, m, at, chief.policy);
  if (!options.length)
    return {
      result: {
        status: "WAIT_FOR_SOURCE",
        reason: "Una fuente nueva puede cambiar la decisión",
      },
      actors: [],
    };
  if (m.spent + 4 > allowance(m, at))
    return { result: { status: "BUDGET_LIMIT" }, actors: [] };
  if (!m.portfolio && options.length >= 2 && allowance(m, at) - m.spent >= 8) {
    m.portfolio = {
      opened: at,
      arms: options
        .slice(0, 2)
        .map((o) => ({ subject: o.subject, allocation: 4, spent: 0 })),
      winner: null,
      reserve: m.budget - m.spent - 8,
    };
  }
  const arm = m.portfolio?.arms.find(
    (a) => !a.spent && options.some((o) => o.subject === a.subject),
  );
  const preferred = arm?.subject ?? m.portfolio?.winner;
  const { subject, docs, revision, known } =
    options.find((o) => o.subject === preferred) ?? options[0];
  const sector = 1 + (Number.parseInt(digest(subject).slice(0, 6), 16) % 10);
  const crew = [0, 1, 2].map((role) =>
    eligible(state, 1 + ((sector - 1 + role) % 10), role, chief.id),
  );
  if (crew.some((a) => !a))
    return { result: { status: "STAFF_LIMIT" }, actors: [] };
  const q = { subject, op: "difference", fields: ["price", "cost"] };
  const proof = tribunal(docs, q),
    facts = {};
  for (const field of [
    "buyer",
    "problem",
    "alternative",
    "units",
    "price",
    "cost",
  ])
    facts[field] = investigate(docs, {
      subject,
      fields: [field],
      op: "lookup",
    });
  const missing = Object.entries(facts)
    .filter(([, r]) => r.status !== "SUPPORTED")
    .map(([k]) => k);
  const positive =
    proof.referee.status === "SUPPORTED" && proof.referee.value > 0;
  const qualified =
    positive &&
    !missing.length &&
    typeof facts.buyer.value === "string" &&
    typeof facts.problem.value === "string" &&
    typeof facts.alternative.value === "string" &&
    Number.isSafeInteger(facts.units.value) &&
    facts.units.value > 0;
  const refutedDemand =
    facts.units.status === "SUPPORTED" &&
    Number.isSafeInteger(facts.units.value) &&
    facts.units.value <= 0;
  const stage = phase(m, at);
  const commercial = g.records.filter(
    (r) => r.mission === m.id && r.subject === subject,
  );
  const cash = commercial.filter((r) => r.stage === "paid");
  const decision = cash.length
    ? "PAYMENT_RECORDED"
    : stage === "COMMERCIAL" && commercial.some((r) => r.stage === "order")
      ? "VERIFY_SETTLEMENT"
      : qualified
        ? "VALIDATE_BUYER"
        : (proof.referee.status === "SUPPORTED" && proof.referee.value <= 0) ||
            refutedDemand
          ? "ABANDON"
          : "SEEK_EVIDENCE";
  const forecast = probability(g, decision);
  const actors = [chief.id, ...crew.map((a) => a.id)];
  for (const [i, a] of crew.entries()) {
    const key = a.id + "@" + a.generation,
      score = (g.performance[key] ??= { correct: 0, attempts: 0 });
    const answer = [proof.proposer, proof.investigator, proof.referee][i];
    score.attempts++;
    score.correct += Number(
      answer.status === proof.referee.status &&
        answer.value === proof.referee.value,
    );
    score.elite = score.attempts >= 3 && score.correct / score.attempts >= 0.9;
  }
  const finding = {
    subject,
    sector,
    revision,
    phase: phase(m, at),
    policy: chief.policy,
    crew: actors.slice(1),
    proof,
    facts,
    decision,
    forecast: known?.forecast ?? forecast,
    firstDecision: known?.firstDecision ?? decision,
    commercialEvidence: commercial.map((r) => ({
      stage: r.stage,
      reference: r.reference,
      cents: r.cents,
    })),
    firstAt: known?.firstAt ?? at,
    at,
    chief: chief.id,
    missing,
    abandonIf: "Margen documentado no positivo o demanda refutada",
    question: "¿Hay demanda documentada y margen unitario positivo?",
    alternatives: options.slice(0, 2).map((o) => ({
      subject: o.subject,
      documentedFields: o.present,
      potentialCents: o.potential.toString(),
    })),
    experiment: {
      strategy: "contrastar margen y demanda",
      alternative: "esperar nueva evidencia",
      cost: 4,
      nextEvidence: cash.length
        ? "conciliar costos atribuibles"
        : stage === "COMMERCIAL"
          ? "constancia firmada de pedido, cobro o gasto"
          : qualified
            ? "confirmación documental del comprador"
            : "fuente primaria sobre " + missing.join(", "),
    },
  };
  m.spent += 4;
  m.findings[subject] = finding;
  if (arm) {
    arm.spent = 4;
    m.pilots.push({ subject, decision, at, cost: 4 });
    if (m.portfolio.arms.every((a) => a.spent)) {
      const outcomes = m.portfolio.arms
        .map((a) => m.findings[a.subject])
        .filter((f) => f.decision === "VALIDATE_BUYER");
      outcomes.sort(
        (a, b) =>
          b.proof.referee.value - a.proof.referee.value ||
          a.subject.localeCompare(b.subject),
      );
      m.portfolio.winner = outcomes[0]?.subject ?? null;
      m.portfolio.authorizedFollowup = m.portfolio.winner
        ? m.budget - m.spent
        : 0;
    }
  }
  return { result: { status: "RESEARCHED", finding }, actors };
}

export function decide(state, c, at, seal) {
  const g = state.gov;
  if (!g) throw Error("Instala el mando de SEMAR");
  const chief = incumbent(state);
  if (c.type === "contest") {
    strict(c, ["type", "candidates"]);
    if (
      !Array.isArray(c.candidates) ||
      !c.candidates.length ||
      c.candidates.length > 8
    )
      throw Error("Candidaturas inválidas");
    if (!seal || seal.scores.length !== c.candidates.length + 1)
      throw Error("Examen incompleto");
    const baseline = chief ?? g.roster[0],
      all = [baseline, ...c.candidates];
    const seen = new Set();
    const entries = all.map((x, i) => {
      if (i) strict(x, ["id", "generation", "policy"]);
      const a = getAgent(state, x.id);
      if (
        i &&
        (a.status !== "LIVE" || a.generation !== x.generation || seen.has(x.id))
      )
        throw Error("Candidato caducado o repetido");
      seen.add(x.id);
      const score = seal.scores[i];
      verifyMetrics(dossierScore(seal.seed, x.policy), score);
      return { entry: x, score };
    });
    let winner = entries[0];
    if (!chief) winner = entries[1];
    for (const next of entries.slice(1))
      if (
        dominates(next.score, winner.score) &&
        (!chief || next.score.cost <= entries[0].score.cost)
      )
        winner = next;
    const qualified = entries
      .filter(
        (x) =>
          x === winner ||
          (!x.score.severe &&
            x.score.correct === x.score.total &&
            x.score.elapsedUs <= x.score.total * 250000),
      )
      .map((x) => x.entry);
    const retained = g.lastExam
      ? g.roster.filter((r) => !entries.some((x) => x.entry.id === r.id))
      : [];
    const rank = [winner.entry, ...qualified, ...retained];
    g.roster = rank.filter(
      (x, i) => rank.findIndex((y) => y.id === x.id) === i,
    );
    g.lastExam = {
      seed: seal.seed,
      entries: entries.map(({ entry, score }) => ({
        id: entry.id,
        policy: entry.policy,
        correct: score.correct,
        total: score.total,
        severe: score.severe,
        cost: score.cost,
        elapsedUs: score.elapsedUs,
      })),
    };
    return {
      result: {
        status: "RANKED",
        name: ABSOLUTE,
        holder: winner.entry,
        seed: seal.seed,
        entries,
      },
      actors: [],
    };
  }
  const m = lastMission(g);
  if (c.type === "pulse") {
    strict(c, ["type"]);
    if (!m || m.closed) return { result: { status: "IDLE" }, actors: [] };
    if (at >= m.deadline) {
      m.closed = closeReport(g, m, m.deadline, "DEADLINE");
      return { result: { status: "CLOSED", report: m.closed }, actors: [] };
    }
  }
  if (!chief) throw Error("Mando vacante, se requiere concurso");
  if (c.type === "settlement_key") {
    strict(c, ["type", "publicKey"]);
    if (g.key || createPublicKey(c.publicKey).asymmetricKeyType !== "ed25519")
      throw Error("Clave de tesorería inválida o ya designada");
    g.key = c.publicKey;
    return { result: { status: "KEY_REGISTERED" }, actors: [] };
  }
  if (c.type === "open_mission")
    return { result: openMission(g, c, at), actors: [] };
  if (!m || phase(m, at) === "CLOSED")
    throw Error("Misión cerrada o inexistente");
  if (c.type === "admit_source") {
    strict(
      c,
      Object.hasOwn(c, "previous")
        ? ["type", "document", "previous"]
        : ["type", "document"],
    );
    const doc = freezeDocument(c.document);
    const old = m.docs.findIndex((d) => d.id === doc.id);
    const previous = old < 0 ? 0 : m.docs[old].revision;
    if (Object.hasOwn(c, "previous") && c.previous !== previous)
      throw Error("Conflicto de revisión documental");
    doc.revision = previous + 1;
    if (old >= 0) {
      if (m.docs[old].source !== doc.source)
        throw Error("Cambio de origen no autorizado");
      if (m.docs[old].sha256 === doc.sha256)
        return { result: { status: "UNCHANGED", id: doc.id }, actors: [] };
      m.docs[old] = doc;
    } else {
      if (m.docs.length >= 256) throw Error("Cupo de fuentes completo");
      m.docs.push(doc);
    }
    return {
      result: {
        status: "ADMITTED",
        id: doc.id,
        sha256: doc.sha256,
        revision: doc.revision,
      },
      actors: [],
    };
  }
  if (c.type === "inquire") {
    strict(c, ["type", "id", "generation", "version", "documents", "query"]);
    if (
      !Array.isArray(c.documents) ||
      !c.documents.length ||
      new Set(c.documents).size !== c.documents.length
    )
      throw Error("Selección de fuentes inválida");
    const docs = c.documents.map((id) => {
      const d = m.docs.find((x) => x.id === id);
      if (!d) throw Error("Fuente sin autorización");
      return d;
    });
    const a = getAgent(state, c.id);
    if (
      a.status !== "LIVE" ||
      a.generation !== c.generation ||
      a.version !== c.version
    )
      throw Error("Identidad caducada");
    if (m.spent >= allowance(m, at))
      return { result: { status: "BUDGET_LIMIT" }, actors: [] };
    m.spent++;
    if (a.balance === 1)
      return { result: { status: "DEAD_ZERO", id: a.id }, actors: [a.id] };
    const report = tribunal(docs, c.query);
    return {
      result: {
        status: "ANSWERED",
        id: a.id,
        answer: report.referee,
        sensitivity: report.sensitivity,
        cost: 1,
      },
      actors: [a.id],
    };
  }
  if (c.type === "commerce")
    return { result: settlement(g, m, c, state), actors: [] };
  if (c.type === "halt") {
    strict(c, ["type", "reason"]);
    label(c.reason);
    m.closed = closeReport(g, m, at, c.reason);
    return { result: { status: "CLOSED", report: m.closed }, actors: [] };
  }
  if (c.type === "mandate") {
    strict(c, ["type", "budget", "reason"]);
    label(c.reason);
    integer(c.budget, Math.max(4, m.spent), 1000000, "techo");
    m.budget = c.budget;
    return {
      result: {
        status: "MANDATE",
        by: chief.id,
        budget: m.budget,
        reason: c.reason,
      },
      actors: [],
    };
  }
  if (c.type === "research" || c.type === "pulse") {
    strict(c, ["type"]);
    if (
      getAgent(state, chief.id).balance === 1 &&
      selection(g, m, at, chief.policy).length &&
      m.spent < allowance(m, at)
    ) {
      m.spent++;
      return {
        result: { status: "DEAD_ZERO", id: chief.id },
        actors: [chief.id],
      };
    }
    return research(state, m, at, chief);
  }
  throw Error("Decisión desconocida");
}
