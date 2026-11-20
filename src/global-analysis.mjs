import { strict, digest, integer, LEADERS } from "./policy.mjs";
import {
  token,
  label,
  freezeDocument,
  checkQuery,
  investigate,
  referee,
} from "./dossiers.mjs";
import { compileBrief } from "./global-planner.mjs";
import { deliberate } from "./nexus.mjs";

const MAX = 1e10;
const tags = (items) => {
  if (
    !Array.isArray(items) ||
    items.length > 32 ||
    new Set(items).size !== items.length
  )
    throw Error("Lista de orígenes o supuestos inválida");
  items.forEach(token);
};
function fieldSchema(value) {
  strict(value, ["unit", "stage"]);
  token(value.unit);
  token(value.stage);
}
export function sourceVersion(s) {
  strict(s, [
    "scope",
    "document",
    "schema",
    "roots",
    "method",
    "assumptions",
    "from",
    "until",
    "previous",
  ]);
  token(s.scope);
  token(s.method);
  tags(s.roots);
  tags(s.assumptions);
  integer(s.from, 0, Number.MAX_SAFE_INTEGER, "fecha inicial");
  integer(s.until, s.from + 1, Number.MAX_SAFE_INTEGER, "vencimiento");
  const doc = freezeDocument(s.document);
  if (!s.schema || Object.keys(s.schema).length > 256)
    throw Error("Esquema documental inválido");
  for (const [field, info] of Object.entries(s.schema)) {
    token(field);
    fieldSchema(info);
  }
  if (doc.rows.some((r) => !Object.hasOwn(s.schema, r.field)))
    throw Error("Campo sin unidad y etapa");
  return { ...s, document: doc, version: digest(s) };
}
export function validateGoal(g) {
  strict(g, [
    "scope",
    "objective",
    "subject",
    "op",
    "operands",
    "threshold",
    "minFamilies",
    "probes",
  ]);
  token(g.scope);
  label(g.objective, 400);
  if (!Array.isArray(g.operands)) throw Error("Faltan operandos");
  checkQuery({
    subject: g.subject,
    op: g.op,
    fields: g.operands.map((o) => o.field),
  });
  for (const o of g.operands) {
    strict(o, ["field", "unit", "stage"]);
    fieldSchema({ unit: o.unit, stage: o.stage });
  }
  if (g.op === "difference" && g.operands[0].unit !== g.operands[1].unit)
    throw Error("No se pueden restar unidades distintas");
  integer(
    g.threshold,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    "umbral",
  );
  integer(g.minFamilies, 1, 10, "orígenes independientes");
  if (
    !Array.isArray(g.probes) ||
    g.probes.length > 32 ||
    new Set(g.probes.map((p) => p.id)).size !== g.probes.length
  )
    throw Error("Experimentos inválidos");
  for (const p of g.probes) {
    strict(p, [
      "id",
      "question",
      "field",
      "positiveBps",
      "positiveNetCents",
      "negativeNetCents",
      "costCents",
      "minutes",
    ]);
    token(p.id);
    label(p.question, 300);
    if (!g.operands.some((o) => o.field === p.field))
      throw Error("Prueba sin relación con la decisión");
    integer(p.positiveBps, 0, 10000, "probabilidad");
    for (const n of [p.positiveNetCents, p.negativeNetCents])
      integer(n, -MAX, MAX, "margen condicionado");
    integer(p.costCents, 0, MAX, "costo de investigar");
    integer(p.minutes, 1, 10080, "minutos");
  }
}
export function experiments(probes, budget, minutes, missing) {
  return probes
    .map((p) => {
      const w = p.positiveBps / 10000;
      const prior = w * p.positiveNetCents + (1 - w) * p.negativeNetCents;
      const informed =
        w * Math.max(0, p.positiveNetCents) +
        (1 - w) * Math.max(0, p.negativeNetCents);
      const gain = Math.round(informed - Math.max(0, prior) - p.costCents);
      return {
        ...p,
        expectedGainCents: gain,
        eligible:
          missing.includes(p.field) &&
          gain > 0 &&
          p.costCents <= budget &&
          p.minutes <= minutes,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.expectedGainCents - a.expectedGainCents ||
        a.minutes - b.minutes ||
        a.id.localeCompare(b.id),
    );
}
export function relevant(sources, g) {
  return sources
    .filter(
      (s) =>
        s.scope === g.scope &&
        s.document.rows.some(
          (r) =>
            r.subject === g.subject &&
            g.operands.some((o) => o.field === r.field),
        ),
    )
    .sort((a, b) => a.document.id.localeCompare(b.document.id));
}
// Connected components, including indirect overlap. Unknown lineage cannot certify independence.
function families(records) {
  const groups = [];
  for (const s of records.filter((s) => s.roots.length)) {
    const keys = new Set([
      "source/" + s.document.source,
      "method/" + s.method,
      ...s.roots.map((v) => "origin/" + v),
      ...s.assumptions.map((v) => "assumption/" + v),
    ]);
    const members = [s.document.id];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (![...groups[i].keys].some((v) => keys.has(v))) continue;
      for (const k of groups[i].keys) keys.add(k);
      members.push(...groups[i].members);
      groups.splice(i, 1);
    }
    groups.push({ keys, members });
  }
  return groups
    .map((g) => g.members.sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}
export const stamp = (sources, at) =>
  digest(sources.map((s) => [s.version, s.from <= at && at < s.until]));
export function assessMission(snapshot) {
  const { goal: g, sources, at, budget, minutes, worker, field } = snapshot;
  validateGoal(g);
  const q = {
    subject: g.subject,
    op: g.op,
    fields: g.operands.map((o) => o.field),
  };
  const live = sources.filter((s) => s.from <= at && at < s.until);
  const issues = [];
  const evidence = g.operands.map((o) => {
    const versions = live.filter((s) =>
      s.document.rows.some(
        (r) => r.subject === g.subject && r.field === o.field,
      ),
    );
    const valid = [];
    for (const s of versions) {
      const info = s.schema[o.field];
      const matches = s.document.rows.filter(
        (r) => r.subject === g.subject && r.field === o.field,
      );
      const issue =
        info.unit !== o.unit || info.stage !== o.stage
          ? "SCHEMA_DRIFT"
          : matches.length !== 1
            ? "DUPLICATE_FIELD"
            : !Number.isSafeInteger(matches[0].value)
              ? "NON_NUMERIC"
              : null;
      if (issue)
        issues.push({ field: o.field, document: s.document.id, issue });
      else valid.push(s);
    }
    const roots = families(valid);
    return {
      field: o.field,
      independent: roots.length,
      families: roots,
      versions: valid.map((s) => ({
        document: s.document.id,
        version: s.version,
        roots: s.roots,
        method: s.method,
        assumptions: s.assumptions,
      })),
      expired: sources
        .filter(
          (s) =>
            !live.includes(s) &&
            s.document.rows.some(
              (r) => r.subject === g.subject && r.field === o.field,
            ),
        )
        .map((s) => s.document.id),
    };
  });
  const docs = live.map((s) => s.document);
  // Each sector reads the original packet without seeing another sector's answer.
  const reviews = snapshot.team.map((member) => ({
    id: member.id,
    sector: member.sector,
    policy: member.policy,
    ...investigate(docs, q, member.policy),
  }));
  const blind = reviews[0];
  const checked = referee(docs, q);
  const missing = evidence
    .filter(
      (e) =>
        e.independent < g.minFamilies ||
        issues.some((i) => i.field === e.field),
    )
    .map((e) => e.field);
  for (const o of g.operands) {
    const r = referee(docs, {
      subject: g.subject,
      op: "lookup",
      fields: [o.field],
    });
    if (r.status !== "SUPPORTED" && !missing.includes(o.field))
      missing.push(o.field);
  }
  if (checked.status !== "SUPPORTED" && !missing.length)
    missing.push(...q.fields);
  const usable =
    !missing.length &&
    checked.status === "SUPPORTED" &&
    Number.isSafeInteger(checked.value);
  const action = !usable
    ? "NEED_EVIDENCE"
    : checked.value >= g.threshold
      ? "ADVANCE"
      : "STOP";
  const probes = experiments(g.probes, budget, minutes, missing);
  const next = probes.find((p) => p.eligible);
  const tasks = evidence.map((e, i) => ({
    owner: LEADERS[snapshot.team[i % snapshot.team.length].sector - 1],
    field: e.field,
    completion: {
      minFamilies: g.minFamilies,
      unit: g.operands[i].unit,
      stage: g.operands[i].stage,
    },
    state: missing.includes(e.field) ? "OPEN" : "VERIFIED",
  }));
  return {
    objective: g.objective,
    scope: g.scope,
    actor: worker.id,
    strategy: worker.policy,
    action,
    value: usable ? checked.value : null,
    threshold: g.threshold,
    decisionUnit:
      g.op === "product"
        ? g.operands.map((o) => o.unit).join("*")
        : g.operands[0].unit,
    hypotheses: [
      {
        claim: "AT_OR_ABOVE",
        test: { op: g.op, fields: q.fields, minimum: g.threshold },
      },
      {
        claim: "BELOW",
        test: { op: g.op, fields: q.fields, exclusiveMaximum: g.threshold },
      },
    ],
    plan: tasks,
    reviews,
    independentWorker: {
      status: blind.status,
      value: blind.value,
      rows: blind.cost,
    },
    oracle: {
      status: checked.status,
      value: checked.value,
      refs: checked.refs,
    },
    evidence,
    issues,
    missing,
    probes,
    next: next
      ? { action: "VERIFY", id: next.id, question: next.question }
      : {
          action: usable ? "REVIEW_DECISION" : "WAIT_FOR_SOURCE",
          fields: missing,
        },
    commercial:
      action === "ADVANCE" && field?.qualified
        ? {
            next: "REVIEW_QUALIFIED_METHOD",
            method: field.method.method,
            evidence: field.qualified,
          }
        : {
            next: action === "ADVANCE" ? "TEST_AGAINST_CONTROL" : "WAIT",
            method: null,
            evidence: null,
          },
    priorTrial: field,
    sourcesStamp: stamp(sources, at),
  };
}
export async function executeMission(snapshot) {
  const out = assessMission(snapshot);
  if (snapshot.portfolio) {
    const plan = compileBrief(
      snapshot.portfolio.brief,
      snapshot.portfolio.sources,
      snapshot.at,
    );
    if (
      plan.status !== "PLANNED" ||
      digest(plan.goal) !== digest(snapshot.goal)
    )
      throw Error("Plan distinto del mandato");
    out.planning = {
      alternatives: plan.alternatives,
      criterion: plan.criterion,
    };
  }
  return {
    decision: out,
    ...(await reviewDecision(snapshot, out.action, {
      sources: out.sourcesStamp,
      action: out.action,
      threshold: out.threshold,
    })),
  };
}
export async function reviewDecision(snapshot, action, evidence) {
  const n = await deliberate({
    sector: snapshot.worker.sector,
    key: "global-" + digest(snapshot).slice(0, 32),
    op: snapshot.goal.op,
    data: evidence,
    value: action,
    peer: snapshot.peer,
    states: snapshot.states,
    now: snapshot.at,
  });
  return {
    nexus: {
      grounding: n.grounding,
      roles: n.verdicts,
      deliberation: n.deliberation,
      evidence: n.evidenceDigest,
      arm: n.arm,
    },
    bandit: n.states,
  };
}
