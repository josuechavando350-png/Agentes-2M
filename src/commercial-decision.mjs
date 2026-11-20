import { token, label } from "./dossiers.mjs";
import { strict, integer, digest } from "./policy.mjs";
import { accountVector } from "./account-market.mjs";
import { populationResearch } from "./population-research.mjs";
import policy from "../evidence/decision-model.json" with { type: "json" };
import {
  DAY,
  dateAt,
  utc,
  estimates,
  ordered,
  rescue,
  grade,
  reliability,
  interval,
} from "./decision-model.mjs";
export const policyId = digest(policy);
const fields = {
  recency: "días desde la última compra",
  orders: "pedidos",
  gross_pence: "importe bruto",
  returns_permille: "devoluciones por mil",
  recent_orders: "pedidos recientes",
  active_weeks: "semanas activas",
  sku_count: "productos distintos",
  largest_share: "concentración del mayor pedido",
  gap_days: "intervalo entre pedidos",
  last_pence: "importe del último pedido",
};
function checkInput(input) {
  strict(input, ["brief", "packet", "probes"]);
  const { brief: b, packet, probes } = input;
  strict(b, [
    "id",
    "merchant",
    "niche",
    "cutoff",
    "seats",
    "mode",
    "currency",
    "minutes",
    "minutesPerAccount",
    "researchCents",
    "source",
    "trial",
  ]);
  [b.id, b.niche, b.merchant].forEach(token);
  label(b.source, 250);
  if (
    utc(b.cutoff) < utc(policy.maturedAt) ||
    b.niche !== packet.niche ||
    !["PROSPECTIVE", "HISTORICAL"].includes(b.mode) ||
    !/^[A-Z]{3}$/.test(b.currency)
  )
    throw Error("Alcance o fecha inválidos");
  integer(b.seats, 1, packet.queries.length - 1, "cupo");
  integer(b.minutes, 0, 1e7, "presupuesto");
  integer(b.minutesPerAccount, 1, 10000, "minutos por cuenta");
  integer(b.researchCents, 0, 1e10, "centavos");
  if (b.seats * b.minutesPerAccount > b.minutes)
    throw Error("Presupuesto insuficiente para las plazas");
  if (b.trial !== null) {
    strict(b.trial, ["id", "mission"]);
    token(b.trial.id);
    token(b.trial.mission);
  }
  const ids = new Set(packet.queries.map((r) => r.id)),
    seen = new Set(policy.seen);
  for (const r of packet.queries) {
    if (r.cutoff !== b.cutoff || seen.has(r.id))
      throw Error("Corte distinto o cuenta expuesta en desarrollo");
  }
  if (
    !Array.isArray(probes) ||
    probes.length > 40 ||
    new Set(probes.map((p) => p.id)).size !== probes.length
  )
    throw Error("Consultas inválidas");
  for (const p of probes) {
    strict(p, [
      "id",
      "account",
      "question",
      "source",
      "minutes",
      "cents",
      "alternative",
    ]);
    token(p.id);
    label(p.question, 240);
    label(p.source, 250);
    integer(p.minutes, 1, 10000, "minutos");
    integer(p.cents, 0, 1e9, "costo");
    if (
      !ids.has(p.account) ||
      p.alternative.id !== p.account ||
      p.alternative.cutoff !== b.cutoff ||
      p.id.startsWith("auto-")
    )
      throw Error("Alternativa ajena al expediente");
    accountVector(p.alternative);
  }
  return b;
}
function potentialInquiries(input) {
  const proposals = [...input.probes],
    b = input.brief;
  for (const r of input.packet.queries) {
    const latest = r.references
      .filter((x) => !x.invoice.startsWith("C"))
      .reduce((a, x) => (x.day > (a?.day ?? "") ? x : a), null);
    if (!latest) continue;
    const days = (utc(b.cutoff) - utc(latest.day)) / DAY;
    if (days !== r.features.recency)
      proposals.push({
        id: "auto-" + digest(r.id).slice(0, 24),
        account: r.id,
        question:
          "¿La fecha de la última factura positiva corrige la recencia declarada?",
        source: latest.invoice,
        minutes: b.minutesPerAccount,
        cents: 0,
        alternative: { ...r, features: { ...r.features, recency: days } },
      });
  }
  return proposals;
}
function rank(rows, votes, k, method) {
  const rs = estimates(rows, votes, policy.model, policy.program, k);
  return ordered(
    rs.map((r) => {
      const incumbent = r.probability,
        challenger = rescue(r, policy.rule);
      return {
        ...r,
        incumbent,
        challenger,
        probability: method === "challenger" ? challenger : incumbent,
      };
    }),
  );
}
export function buildDecision(
  layout,
  input,
  method = "incumbent",
  answers = [],
  local = null,
) {
  const b = checkInput(input),
    all = potentialInquiries(input),
    replaced = new Map(),
    closed = new Set();
  let spentMinutes = 0,
    spentCents = 0;
  for (const a of answers) {
    const p = all.find((p) => p.id === a.probe);
    if (!p || closed.has(p.account)) throw Error("Consulta ya resuelta");
    closed.add(p.account);
    spentMinutes += p.minutes;
    spentCents += p.cents;
    if (a.branch === "ALTERNATIVE") replaced.set(p.account, p.alternative);
  }
  const rows = input.packet.queries.map((r) => replaced.get(r.id) ?? r),
    byId = new Map(rows.map((r) => [r.id, r])),
    packet = { ...input.packet, queries: rows };
  const pop = populationResearch(layout, packet),
    votes = pop.result.decisions.thousand,
    ranking = rank(rows, votes, b.seats, method),
    chosen = new Set(ranking.slice(0, b.seats).map((r) => r.id));
  const budget = {
    contactMinutes: b.seats * b.minutesPerAccount,
    spentMinutes,
    spentCents,
  };
  let time = b.minutes - budget.contactMinutes - spentMinutes,
    cash = b.researchCents - spentCents;
  if (time < 0 || cash < 0) throw Error("Investigación fuera del presupuesto");
  const queue = [];
  for (const p of all) {
    if (closed.has(p.account)) continue;
    const altVotes = populationResearch(layout, {
      ...packet,
      queries: [p.alternative],
    }).result.decisions.thousand[0];
    const alt = rank(
      rows.map((r) => (r.id === p.account ? p.alternative : r)),
      votes.map((v) => (v.id === p.account ? altVotes : v)),
      b.seats,
      method,
    );
    const sel = new Set(alt.slice(0, b.seats).map((r) => r.id)),
      enter = [...sel].filter((id) => !chosen.has(id)),
      leave = [...chosen].filter((id) => !sel.has(id));
    const gain = alt.reduce(
      (n, r) =>
        n +
        (enter.includes(r.id) ? 1 : leave.includes(r.id) ? -1 : 0) *
          r.probability,
      0,
    );
    queue.push({
      id: p.id,
      account: p.account,
      question: p.question,
      source: p.source,
      minutes: p.minutes,
      cents: p.cents,
      enter,
      leave,
      conditionalGain: gain,
      disagreement: ranking.find((r) => r.id === p.account).disagree,
      status: enter.length ? "PENDING" : "SAME_DECISION",
    });
  }
  queue.sort(
    (a, b) =>
      Number(b.disagreement) - Number(a.disagreement) ||
      b.conditionalGain / b.minutes - a.conditionalGain / a.minutes ||
      a.cents - b.cents ||
      a.id.localeCompare(b.id),
  );
  const reserved = new Set();
  for (const p of queue) {
    if (p.status !== "PENDING") continue;
    if (reserved.has(p.account) || time < p.minutes || cash < p.cents) {
      p.status = "DEFER";
      continue;
    }
    p.status = "VERIFY";
    reserved.add(p.account);
    time -= p.minutes;
    cash -= p.cents;
  }
  const decisions = ranking.map((r, i) => {
    const row = byId.get(r.id),
      selected = i < b.seats,
      other = ranking[selected ? b.seats : b.seats - 1],
      fact = fields[r.driver.field];
    const query = queue.find(
        (q) => q.account === r.id && q.status === "VERIFY",
      ),
      last = row.references.reduce((a, x) => (x.day > a.day ? x : a));
    return {
      id: r.id,
      rank: i + 1,
      action: selected ? "PRIORITIZE" : "RESERVE",
      deadline: b.cutoff,
      probability: r.probability,
      incumbent: r.incumbent,
      challenger: r.challenger,
      sectorProbability: r.collective,
      reason: {
        signal: fact,
        value: r.driver.value,
        logOddsContribution: r.driver.contribution,
        rescueApplied: method === "challenger" && r.challenger !== r.incumbent,
      },
      evidence: {
        source: b.source,
        dossier: r.source,
        references: row.references.length,
        latest: last,
      },
      nextEvidence: {
        question:
          query?.question ??
          "¿Una corrección documentada de " + fact + " cambiaría la prioridad?",
        probe: query?.id ?? null,
        rival: other.id,
        threshold: other.probability,
        direction: selected ? "BELOW" : "ABOVE",
        ties: "id ascendente",
      },
      calibration: {
        ...reliability(
          local?.bins ?? policy.calibration[method],
          r.probability,
          local || b.merchant === policy.merchant
            ? "SAME_MERCHANT_HISTORY"
            : "EXTERNAL_REFERENCE",
        ),
        basis: local?.seals ?? [policy.source],
      },
    };
  });
  return {
    policy: policyId,
    target: "positive-net-invoicing-next-30-days",
    brief: b,
    method,
    source: digest(input),
    checkpoint: layout.checkpoint,
    participants: pop.result.participants,
    participation: pop.commitment,
    closeFrom: dateAt(utc(b.cutoff) + 30 * DAY),
    budget: { ...budget, unreservedMinutes: time, unreservedCents: cash },
    answers,
    queue,
    decisions,
  };
}
export function gradePlan(plan, actual, t) {
  strict(actual, ["asOf", "source", "outcomes"]);
  label(actual.source, 250);
  if (utc(actual.asOf) < utc(plan.closeFrom)) throw Error("Ventana incompleta");
  const b = plan.brief,
    k = b.seats,
    scores = {};
  for (const key of ["incumbent", "challenger", "deployed"])
    scores[key] = grade(
      plan.decisions.map((r) => ({
        id: r.id,
        probability: key === "deployed" ? r.probability : r[key],
      })),
      actual.outcomes,
      k,
    );
  let margin = null;
  if (t) {
    const assigned = t.pairs
        .flat()
        .map((u) => u.subject)
        .sort(),
      selected = plan.decisions
        .slice(0, k)
        .map((r) => r.id)
        .sort();
    if (
      !b.trial ||
      t.trial !== b.trial.id ||
      t.mission !== b.trial.mission ||
      t.scope !== b.niche ||
      digest(assigned) !== digest(selected) ||
      t.from !== utc(b.cutoff) ||
      t.until !== utc(plan.closeFrom)
    )
      throw Error("Ensayo financiero incompatible");
    if (t.completed === t.total)
      margin = {
        currency: "MXN",
        trial: t.trial,
        paidCents: t.observedPaidCents,
        incrementalNetPerPairCents: t.incrementalNetPerPairCents,
        status: t.status,
      };
  }
  return {
    brief: b,
    policy: plan.policy,
    seal: digest(plan),
    asOf: actual.asOf,
    source: actual.source,
    outcomesHash: digest(actual.outcomes),
    accounts: plan.decisions.map((r) => r.id).sort(),
    scores,
    omitted: plan.decisions
      .slice(k)
      .filter((r) => actual.outcomes[r.id] === 1)
      .map((r) => r.id),
    margin,
  };
}
export function verdict(results) {
  if (!results.length) throw Error("Exámenes ausentes");
  const first = results[0],
    seen = new Set(),
    companies = new Set(),
    windows = new Set(),
    pairs = new Set();
  let hits = 0,
    seats = 0;
  const terms = (r) => {
    const b = r.brief;
    return [
      r.policy,
      b.niche,
      b.mode,
      b.currency,
      b.seats,
      b.minutes,
      b.minutesPerAccount,
      b.researchCents,
      r.accounts.length,
    ];
  };
  const cohorts = results.map((r) => {
    const b = r.brief,
      key = b.merchant + "/" + b.cutoff;
    if (
      digest(terms(r)) !== digest(terms(first)) ||
      r.policy !== policyId ||
      pairs.has(key) ||
      r.accounts.some((id) => seen.has(id))
    )
      throw Error("Cohortes incompatibles o repetidas");
    pairs.add(key);
    companies.add(b.merchant);
    windows.add(b.cutoff);
    r.accounts.forEach((id) => seen.add(id));
    const c = r.scores.challenger,
      a = r.scores.incumbent;
    hits += c.hits;
    seats += c.seats;
    return {
      id: b.id,
      merchant: b.merchant,
      cutoff: b.cutoff,
      observed: a.observed,
      cases: a.cases,
      incumbentHits: a.hits,
      hits: c.hits,
      seats: c.seats,
      precision95: c.interval95,
      incumbentBrier: a.brier,
      candidateBrier: c.brier,
      seal: r.seal,
      margin: r.margin,
      passes: c.precision >= 0.9 && c.hits >= a.hits && c.brier <= a.brier,
    };
  });
  const dates = [...windows].sort(),
    enough =
      companies.size >= 2 &&
      dates.length >= 2 &&
      dates.every((d, i) => !i || utc(d) - utc(dates[i - 1]) >= 30 * DAY) &&
      [...companies].every(
        (m) => cohorts.filter((c) => c.merchant === m).length >= 2,
      );
  const limits = interval(hits, seats),
    passed = enough && limits[0] >= 0.9 && cohorts.every((c) => c.passes);
  return {
    policy: policyId,
    niche: first.brief.niche,
    cohorts,
    hits,
    seats,
    precision: hits / seats,
    interval95: limits,
    status: passed
      ? first.brief.mode === "PROSPECTIVE"
        ? "QUALIFIED_IN_SCOPE"
        : "READY_FOR_PROSPECTIVE_TRIAL"
      : "KEEP_INCUMBENT",
  };
}
