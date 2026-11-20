import { check, num, key, hash } from "./reader.mjs";
export function validateRule(r, width) {
  check(
    r &&
      ["accounts", "portfolio"].includes(r.group) &&
      Array.isArray(r.weights) &&
      r.weights.length === width,
    "Programa inválido",
  );
  r.weights.forEach((w) => num(w, -1, 1));
  num(r.rateIndex, -1, width - 1);
  num(r.bps, 1, 10000);
  check(
    (r.rateIndex === -1) === (r.bps === 10000) &&
      (r.rateIndex < 0 || r.weights[r.rateIndex] === 1),
    "Tasa inválida",
  );
  return r;
}
function dot(values, rule) {
  return Math.max(
    0,
    values.reduce(
      (v, x, i) =>
        v +
        rule.weights[i] *
          (i === rule.rateIndex
            ? Number((BigInt(x) * BigInt(rule.bps)) / 10000n)
            : x),
      0,
    ),
  );
}
export function compute(rule, groups) {
  if (!groups.length) return 0;
  if (rule.group === "portfolio") {
    const totals = rule.weights.map((_, i) =>
      groups.reduce((n, g) => n + g.values[i], 0),
    );
    return dot(totals, rule);
  }
  return groups.reduce((v, g) => v + dot(g.values, rule), 0);
}
export function evaluate(parsed, rule, kinds, knownValue) {
  validateRule(rule, kinds.length);
  const base = {
    case: parsed.id,
    refs: parsed.refs,
    entries: parsed.entries.map((e) => ({
      account: e.account,
      entry: e.entry,
      kind: e.kind,
      amount: e.amount,
      refs: e.refs,
    })),
    program: hash(rule),
  };
  if (parsed.issues.length)
    return {
      ...base,
      status: "NEED_EVIDENCE",
      value: null,
      questions: parsed.issues,
      worlds: [],
    };
  const relevant = parsed.open.filter(
    (r) => r.limit > 0 && rule.weights[kinds.indexOf(r.kind)] !== 0,
  );
  const observed = knownValue ?? compute(rule, parsed.groups);
  if (relevant.length) {
    // Two attainable completions. Monotonicity in each nonnegative register gives exact extremes.
    const worlds = [-1, 1].map((sign) => {
      const groups = structuredClone(parsed.groups);
      const completion = relevant.map((r) => {
        const i = kinds.indexOf(r.kind),
          amount = rule.weights[i] * sign > 0 ? r.limit : 0;
        groups.find((g) => g.account === r.account).values[i] += amount;
        return { register: r.register, amount };
      });
      return { value: compute(rule, groups), completion };
    });
    if (worlds[0].value !== worlds[1].value)
      return {
        ...base,
        status: "NEED_EVIDENCE",
        value: null,
        worlds,
        questions: relevant.map((r) => ({
          register: r.register,
          account: r.account,
          ask: "Obtener el cierre del registro y conciliar sus movimientos",
        })),
      };
  }
  const allocations =
    rule.group === "accounts"
      ? parsed.groups.map((g) => ({
          account: g.account,
          value: compute(rule, [g]),
        }))
      : [{ account: null, value: observed }];
  return {
    ...base,
    findings: allocations
      .filter((a) => a.value > 0)
      .map((a) => ({
        ...a,
        entries: parsed.entries
          .filter((e) => a.account === null || e.account === a.account)
          .map((e) => ({ kind: e.kind, id: e.entry })),
      })),
    status: observed > 0 ? "FOUND" : "CLEAR",
    value: observed,
    worlds: [],
    questions: [],
  };
}
export function enumerate(width, rates) {
  const candidates = [];
  for (let mask = 0; mask < 3 ** width; mask++) {
    const weights = Array.from(
      { length: width },
      (_, i) => (Math.floor(mask / 3 ** i) % 3) - 1,
    );
    if (!weights.includes(1)) continue;
    const variants = [{ rateIndex: -1, bps: 10000 }];
    for (const bps of rates)
      for (let i = 0; i < width; i++)
        if (weights[i] === 1) variants.push({ rateIndex: i, bps });
    for (const v of variants)
      for (const group of ["accounts", "portfolio"]) {
        if (
          group === "portfolio" &&
          !weights.includes(-1) &&
          v.rateIndex === -1
        )
          continue;
        candidates.push({ group, weights, ...v });
      }
  }
  return candidates;
}
function shrink(rows, fails) {
  let result = structuredClone(rows);
  for (let i = result.length - 1; i >= 0; i--) {
    const next = result.filter((_, j) => j !== i);
    if (fails(next)) result = next;
  }
  for (const g of result)
    for (let i = 0; i < g.values.length; i++) {
      const old = g.values[i];
      for (const n of [
        ...new Set([0, 1, 2, 10, 100, Math.floor(old / 2)]),
      ].filter((v) => v < old)) {
        g.values[i] = n;
        if (fails(result)) break;
        g.values[i] = old;
      }
    }
  return result;
}
export function contrast(a, b, examples, width) {
  const differs = (g) => compute(a, g) !== compute(b, g);
  const library = [...examples];
  for (const n of [1, 17, 100, 10001]) {
    for (let i = 0; i < width; i++)
      for (let j = 0; j < width; j++) {
        const v = Array(width).fill(0),
          w = [...v];
        v[i] = n;
        w[j] = 2 * n;
        library.push([
          { account: "a", values: v },
          { account: "b", values: w },
        ]);
      }
  }
  const seed = library.find(differs);
  if (!seed) return null;
  const groups = shrink(seed, differs);
  return { groups, first: compute(a, groups), second: compute(b, groups) };
}
export function learnRule(cases, kinds, rates, maxEvaluations) {
  num(maxEvaluations, 1, 2e6);
  rates.forEach((x) => num(x, 1, 9999));
  const attempts = [],
    matches = [];
  let evaluations = 0;
  for (const rule of enumerate(kinds.length, rates)) {
    let firstFailure = null;
    for (const ex of cases) {
      if (++evaluations > maxEvaluations)
        return {
          status: "SEARCH_BUDGET_EXHAUSTED",
          attempts,
          evaluations: evaluations - 1,
        };
      const value = compute(rule, ex.parsed.groups);
      if (value !== ex.value) {
        firstFailure = {
          case: ex.parsed.id,
          predicted: value,
          observed: ex.value,
        };
        break;
      }
    }
    attempts.push({ rule, firstFailure });
    if (!firstFailure) matches.push(rule);
  }
  if (matches.length !== 1) {
    const first = matches[0];
    let question = null;
    for (const other of matches.slice(1)) {
      question = contrast(first, other, [], kinds.length);
      if (question) break;
    }
    return {
      status: matches.length ? "ASK_EXPERT" : "OUTSIDE_LANGUAGE",
      candidates: matches.length,
      question,
      attempts,
      evaluations,
    };
  }
  return { status: "CANDIDATE", rule: matches[0], attempts, evaluations };
}
export function knownMethods(kinds, extra = []) {
  const width = kinds.length,
    base = [
      {
        name: "esperar",
        rule: {
          group: "portfolio",
          weights: Array(width).fill(0),
          rateIndex: -1,
          bps: 10000,
        },
      },
    ];
  for (const rule of enumerate(width, []))
    if (rule.weights.filter((w) => w !== 0).length <= 2)
      base.push({ name: "referencia-" + base.length, rule });
  for (const x of extra) {
    key(x.name);
    validateRule(x.rule, width);
    check(!base.some((y) => y.name === x.name), "Método conocido repetido");
    base.push(x);
  }
  return base;
}
