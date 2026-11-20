import { strict } from "../policy.mjs";
import { check, key, num, list, unique, hash } from "../factory/reader.mjs";

export function validateInquiry(spec) {
  strict(spec, [
    "id",
    "actions",
    "worlds",
    "documents",
    "observed",
    "budgetCents",
    "minutes",
    "minIndependent",
  ]);
  key(spec.id);
  unique(list(spec.actions, 2, 8).map(key));
  check(spec.actions.includes("esperar"), "Falta la opción de esperar");
  num(spec.budgetCents, 0, 1e7);
  num(spec.minutes, 0, 10080);
  num(spec.minIndependent, 0, 4);
  unique(
    list(spec.worlds, 2, 12).map((w) => {
      strict(w, ["id", "net"]);
      key(w.id);
      strict(w.net, spec.actions);
      spec.actions.forEach((a) => num(w.net[a], -1e8, 1e8));
      check(w.net.esperar === 0, "Esperar debe conservar el saldo");
      return w.id;
    }),
  );
  const ids = spec.worlds.map((w) => w.id);
  unique(
    list(spec.documents, 0, 12).map((d) => {
      strict(d, ["id", "question", "roots", "cents", "minutes", "readings"]);
      key(d.id);
      check(
        typeof d.question === "string" &&
          d.question.trim() &&
          d.question.length <= 240,
        "Pregunta inválida",
      );
      unique(list(d.roots, 1, 4).map(key));
      num(d.cents, 0, 1e7);
      num(d.minutes, 1, 10080);
      strict(d.readings, ids);
      ids.forEach((id) => key(d.readings[id]));
      return d.id;
    }),
  );
  unique(
    list(spec.observed, 0, spec.documents.length).map((o) => {
      strict(o, ["id", "answer", "evidence"]);
      key(o.answer);
      check(
        /^[a-f0-9]{64}$/.test(o.evidence),
        "Se requiere una huella de la fuente",
      );
      return key(o.id);
    }),
  );
}
function sourceFamilies(docs) {
  const groups = [];
  for (const d of docs) {
    const roots = new Set(d.roots);
    for (let i = groups.length - 1; i >= 0; i--)
      if ([...groups[i]].some((x) => roots.has(x))) {
        for (const x of groups[i]) roots.add(x);
        groups.splice(i, 1);
      }
    groups.push(roots);
  }
  return groups.length;
}
export function planInquiry(spec, stepLimit = Infinity) {
  validateInquiry(spec);
  const { worlds, actions, documents } = spec,
    all = (1 << worlds.length) - 1;
  let initial = all,
    used = 0,
    funding = spec.budgetCents,
    time = spec.minutes;
  const sourceHashes = new Set();
  for (const o of spec.observed) {
    const i = documents.findIndex((d) => d.id === o.id);
    check(i >= 0, "Documento fuera de la investigación");
    check(!sourceHashes.has(o.evidence), "La misma constancia se reutilizó");
    sourceHashes.add(o.evidence);
    const d = documents[i];
    funding -= d.cents;
    time -= d.minutes;
    used |= 1 << i;
    const consistent = worlds.reduce(
      (m, w, j) => (d.readings[w.id] === o.answer ? m | (1 << j) : m),
      0,
    );
    initial &= consistent;
  }
  check(
    funding >= 0 && time >= 0,
    "Las observaciones exceden el presupuesto de investigación",
  );
  if (!initial)
    return {
      status: "CONTRADICTORY_EVIDENCE",
      next: "REOPEN_HYPOTHESES",
      budgetCents: funding,
      minutes: time,
      observations: hash(spec.observed),
    };
  const best = worlds.map((w) => Math.max(...actions.map((a) => w.net[a])));
  const cache = new Map();
  function solve(mask, seen) {
    const cacheKey = mask + "/" + seen;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const known = documents.filter((_, i) => seen & (1 << i));
    const left = spec.budgetCents - known.reduce((n, d) => n + d.cents, 0),
      remaining = spec.minutes - known.reduce((n, d) => n + d.minutes, 0);
    const familyCount = sourceFamilies(known),
      included = worlds
        .map((w, i) => ({ w, i }))
        .filter((v) => mask & (1 << v.i));
    const terminals = actions
      .filter((a) => a === "esperar" || familyCount >= spec.minIndependent)
      .map((action) => {
        const regret = Math.max(
          ...included.map(({ w, i }) => best[i] - w.net[action]),
        );
        return { action, regret, cost: 0, time: 0 };
      });
    const alternatives = [...terminals];
    const order = (a, b) =>
      a.regret - b.regret ||
      a.cost - b.cost ||
      a.time - b.time ||
      Number(!!a.document) - Number(!!b.document) ||
      String(a.action ?? a.document).localeCompare(
        String(b.action ?? b.document),
      );
    for (const [j, d] of documents.entries()) {
      if (
        seen & (1 << j) ||
        d.cents > left ||
        d.minutes > remaining ||
        (seen === used && d.cents > stepLimit)
      )
        continue;
      const partitions = new Map();
      for (const { w, i } of included) {
        const answer = d.readings[w.id];
        partitions.set(answer, (partitions.get(answer) ?? 0) | (1 << i));
      }
      // A corroborating document is valuable even for a single surviving hypothesis if it supplies independent evidence.
      if (
        partitions.size === 1 &&
        (familyCount >= spec.minIndependent ||
          sourceFamilies([...known, d]) <= familyCount)
      )
        continue;
      const branches = [...partitions].map(([answer, subset]) => {
        const result = solve(subset, seen | (1 << j));
        return { answer, subset, next: result.selected };
      });
      alternatives.push({
        document: d.id,
        regret: d.cents + Math.max(...branches.map((b) => b.next.regret)),
        cost: d.cents + Math.max(...branches.map((b) => b.next.cost)),
        time: d.minutes + Math.max(...branches.map((b) => b.next.time)),
        branches: branches.map((b) => ({
          answer: b.answer,
          worlds: worlds.filter((_, i) => b.subset & (1 << i)).map((w) => w.id),
          next: b.next.action ?? b.next.document,
          remainingRegret: b.next.regret,
        })),
      });
    }
    alternatives.sort(order);
    const result = { selected: alternatives[0], alternatives };
    cache.set(cacheKey, result);
    return result;
  }
  const { selected, alternatives } = solve(initial, used),
    question = documents.find((d) => d.id === selected.document);
  return {
    status: question
      ? "REQUEST_DOCUMENT"
      : selected.action === "esperar"
        ? "HOLD"
        : "DECIDE",
    next: selected.document ?? selected.action,
    question: question
      ? {
          id: question.id,
          text: question.question,
          roots: question.roots,
          cents: question.cents,
          minutes: question.minutes,
        }
      : null,
    viableWorlds: worlds.filter((_, i) => initial & (1 << i)).map((w) => w.id),
    budgetCents: funding,
    minutes: time,
    bestWithoutAnotherDocument: Math.min(
      ...alternatives.filter((a) => a.action).map((a) => a.regret),
    ),
    worstRegretCents: selected.regret,
    certificate: { states: cache.size, alternatives, input: hash(spec) },
    observations: hash(spec.observed),
  };
}
