import { check, key, list, num, unique, hash } from "./reader.mjs";
export function expertPolicy(log) {
  const signals = unique(list(log.signals, 1, 6).map(key));
  const n = 2 ** signals.length,
    observations = new Map();
  unique(list(log.sessions, 2, 128).map((x) => key(x.id)));
  for (const session of log.sessions) {
    const seen = new Map(),
      events = list(session.events, 2, 24);
    for (const [i, e] of events.entries()) {
      if (i === events.length - 1) {
        check(
          ["ALLOW", "REVIEW"].includes(e.decision),
          "Demostración sin decisión final",
        );
        // A skipped field is unknown in this demonstration. It must not be filled with false.
        check(
          seen.size === signals.length,
          "Faltan observaciones de contexto del experto",
        );
        const mask = signals.reduce(
            (m, k, i) => m + (seen.get(k) ? 2 ** i : 0),
            0,
          ),
          prev = observations.get(mask);
        check(
          prev === undefined || prev === e.decision,
          "El experto dio decisiones incompatibles",
        );
        observations.set(mask, e.decision);
      } else {
        check(
          signals.includes(e.inspect) && typeof e.value === "boolean",
          "Traza de experto inválida",
        );
        seen.set(e.inspect, e.value);
      }
    }
  }
  // Infer the shortest conjunction or disjunction of signed conditions consistent with the expert.
  const matches = new Map();
  for (let code = 0; code < 3 ** signals.length; code++) {
    const terms = signals.flatMap((s, i) => {
      const t = Math.floor(code / 3 ** i) % 3;
      return t ? [{ i, positive: t === 1 }] : [];
    });
    for (const op of ["all", "any"]) {
      const table = Array.from({ length: n }, (_, mask) => {
        const vals = terms.map(
          (t) => Boolean(mask & (1 << t.i)) === t.positive,
        );
        return (op === "all" ? vals.every(Boolean) : vals.some(Boolean))
          ? "ALLOW"
          : "REVIEW";
      });
      if ([...observations].some(([mask, a]) => table[mask] !== a)) continue;
      const k = hash(table),
        old = matches.get(k);
      if (!old || terms.length < old.terms.length)
        matches.set(k, { op, terms, table });
    }
  }
  if (matches.size !== 1) {
    const choices = [...matches.values()];
    const mask = Array.from({ length: n }, (_, i) => i).find(
      (i) => new Set(choices.map((r) => r.table[i])).size > 1,
    );
    return {
      status: matches.size ? "ASK_EXPERT" : "OUTSIDE_LANGUAGE",
      compatible: matches.size,
      question:
        mask === undefined
          ? null
          : Object.fromEntries(
              signals.map((s, i) => [s, Boolean(mask & (1 << i))]),
            ),
    };
  }
  const policy = [...matches.values()][0];
  return {
    status: "IDENTIFIED",
    signals,
    ...policy,
    observed: observations.size,
  };
}
export function gate(policy, flags = {}) {
  if (!policy) return { allowed: true };
  const bits = policy.signals.map((s) => flags[s]);
  for (const b of bits)
    check(b === undefined || typeof b === "boolean", "Observación no booleana");
  const possible = [];
  for (let mask = 0; mask < policy.table.length; mask++)
    if (bits.every((b, i) => b === undefined || b === Boolean(mask & (1 << i))))
      possible.push(policy.table[mask]);
  if (possible.every((x) => x === "ALLOW")) return { allowed: true };
  return {
    allowed: false,
    reason: possible.includes("ALLOW") ? "ASK_EXPERT_FIELD" : "EXPERT_REVIEW",
    fields: policy.terms
      .map((t) => policy.signals[t.i])
      .filter((k) => flags[k] === undefined),
  };
}
