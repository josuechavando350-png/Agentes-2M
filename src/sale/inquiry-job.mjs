import { digest, strict } from "../policy.mjs";
import { key, check, num } from "../factory/reader.mjs";
import { reviewDecision } from "../global-analysis.mjs";
import { planInquiry, validateInquiry } from "./investigation.mjs";
export function inquiryGoal(id) {
  return {
    scope: id,
    subject: "investigacion",
    objective:
      "Determinar qué documento puede cambiar la decisión comercial dentro del presupuesto",
    op: "difference",
    operands: [
      { field: "beneficio", unit: "centavos", stage: "documentado" },
      { field: "costo", unit: "centavos", stage: "documentado" },
    ],
    threshold: 1,
    minFamilies: 1,
    probes: [],
  };
}
export function inquirySnapshot(s, r, at) {
  const d = r.data;
  let spec,
    facts = [],
    parent = null;
  if (r.kind === "probe-reserve") {
    strict(d, ["spec", "cap"]);
    key(d.spec.id);
    check(
      d.spec.observed?.length === 0,
      "Se requiere una investigación nueva o la entrega anterior",
    );
    spec = structuredClone(d.spec);
    check(
      JSON.stringify(spec).length < 200000,
      "Investigación demasiado grande",
    );
  } else {
    strict(d, ["job", "document", "source", "version", "answer", "cap"]);
    parent = d.job;
    const j = s.jobs.get(parent),
      q = j?.output?.inquiry?.question;
    check(
      q &&
        j.status === "SETTLED" &&
        q.id === d.document &&
        j.settlement.cents === q.cents,
      "Falta liquidar el comprobante del documento solicitado",
    );
    check(
      ![...s.jobs.values()].some((v) => v.snapshot.inquiryParent === parent),
      "La decisión ya tiene una continuación",
    );
    const v = s.docs.get(d.source);
    check(
      v &&
        v.version === d.version &&
        v.until > at &&
        v.scope === j.snapshot.inquiry.id,
      "Documento externo ausente o vencido",
    );
    const statements = v.document.rows.filter(
      (row) => row.subject === v.scope && row.field === d.document,
    );
    check(
      statements.length &&
        statements.every((row) => row.value === d.answer) &&
        digest([...v.roots].sort()) === digest([...q.roots].sort()),
      "La fuente carece de respuesta inequívoca o procede de otro origen",
    );
    spec = structuredClone(j.snapshot.inquiry);
    facts = [...j.snapshot.inquiryFacts, { id: d.source, version: d.version }];
    for (const fact of facts) {
      const doc = s.docs.get(fact.id);
      check(
        doc?.version === fact.version && doc.until > at,
        "Cambio en la evidencia anterior",
      );
    }
    spec.observed.push({
      id: d.document,
      answer: d.answer,
      evidence: v.document.sha256,
    });
  }
  validateInquiry(spec);
  const prices = spec.observed.map((o) =>
    spec.documents.find((t) => t.id === o.id),
  );
  const spent = prices.reduce((n, d) => n + d.cents, 0),
    minutes = prices.reduce((n, d) => n + d.minutes, 0);
  spec.budgetCents = Math.min(
    spec.budgetCents,
    spent + s.open.budgetCents - s.spent - s.held,
  );
  spec.minutes = Math.min(
    spec.minutes,
    minutes + Math.max(0, Math.floor((s.open.until - at) / 60000)),
  );
  num(d.cap, 1, s.open.maxJobCents);
  return {
    inquiry: spec,
    inquiryParent: parent,
    inquiryFacts: facts,
    inquiryStepCap: d.cap,
  };
}
export async function inquiryExecution(snapshot) {
  const inquiry = planInquiry(snapshot.inquiry, snapshot.inquiryStepCap);
  const action =
    inquiry.status === "DECIDE"
      ? "ADVANCE"
      : inquiry.status === "HOLD"
        ? "STOP"
        : "NEED_EVIDENCE";
  const decision = {
    scope: snapshot.inquiry.id,
    action,
    stage: inquiry.status,
    next: inquiry.question ?? inquiry.next,
    worstRegretCents: inquiry.worstRegretCents ?? null,
  };
  return {
    inquiry,
    decision,
    ...(await reviewDecision(snapshot, action, {
      mandate: digest(snapshot.inquiry),
      plan: digest(inquiry),
      decision,
    })),
  };
}
