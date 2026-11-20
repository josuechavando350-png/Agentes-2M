import { createHash } from "node:crypto";
import { check, num, key, hash, list, unique } from "../factory/reader.mjs";
import { strict } from "../policy.mjs";

export function validateDesign(design) {
  strict(design, [
    "actions",
    "fields",
    "costs",
    "currency",
    "response",
    "randomization",
  ]);
  unique(list(design.actions, 3, 3).map(key));
  check(
    design.randomization === "equal-thirds",
    "Se requiere asignación aleatoria equiprobable conocida",
  );
  check(/^[A-Z]{3}$/.test(design.currency), "Moneda inválida");
  key(design.response);
  list(design.costs, 3, 3).forEach((c) => num(c, 0, 1e6));
  check(design.costs[0] === 0, "La primera acción es el control sin contacto");
  const fields = list(design.fields, 2, 12);
  unique(fields.map((f) => key(f.id)));
  const predicates = fields.flatMap((f, j) => {
    strict(f, ["id", "cuts"]);
    list(f.cuts, 1, 8).forEach((v, i) => {
      num(v, -1e7, 1e7);
      check(i === 0 || v > f.cuts[i - 1], "Umbrales desordenados");
    });
    return f.cuts.map((cut) => ({ j, cut }));
  });
  check(predicates.length <= 30, "Máximo treinta predicados");
  return predicates;
}
export function validateRows(rows, design, observed = true) {
  validateDesign(design);
  list(rows, 1, 250000);
  unique(
    rows.map((r) => {
      strict(r, observed ? ["id", "x", "arm", "y"] : ["id", "x"]);
      key(r.id);
      list(r.x, design.fields.length, design.fields.length).forEach((n) =>
        num(n, -1e7, 1e7),
      );
      if (observed) {
        num(r.arm, 0, 2);
        num(r.y, 0, 1e8);
      }
      return r.id;
    }),
  );
  return rows;
}
export function flagsFor(x, predicates) {
  return predicates.reduce(
    (mask, p, i) => (x[p.j] >= p.cut ? mask | (1 << i) : mask),
    0,
  );
}
const empty = () => ({ counts: [0, 0, 0], sums: [0, 0, 0] });
function add(bucket, r) {
  bucket.counts[r.arm]++;
  bucket.sums[r.arm] += r.y;
}
function conditionalKeys(flags, fieldMasks) {
  const support = fieldMasks.map((mask) => (flags & mask) >>> 0);
  return [String(support[0]) + "," + support[1], String(flags)];
}
export function fitResponse(design, rows) {
  validateRows(rows, design);
  const predicates = validateDesign(design);
  const fieldMasks = design.fields.map((_, j) =>
    predicates.reduce((m, p, i) => (p.j === j ? m | (1 << i) : m), 0),
  );
  const global = empty(),
    levels = [{}, {}];
  for (const r of rows) {
    add(global, r);
    conditionalKeys(flagsFor(r.x, predicates), fieldMasks).forEach((k, i) =>
      add((levels[i][k] ??= empty()), r),
    );
  }
  check(
    global.counts.every((n) => n >= 2),
    "Falta soporte experimental para alguna oferta",
  );
  return { predicates, fieldMasks, global, levels, shrinkage: 40 };
}
export function means(model, flags) {
  let m = model.global.sums.map((s, a) => s / model.global.counts[a]);
  for (const [i, k] of conditionalKeys(flags, model.fieldMasks).entries()) {
    const bucket = model.levels[i][k];
    if (bucket)
      m = m.map(
        (prior, a) =>
          (bucket.sums[a] + model.shrinkage * prior) /
          (bucket.counts[a] + model.shrinkage),
      );
  }
  return m.map(Math.round);
}
export function adjusted(row, model, design) {
  const flags = flagsFor(row.x, model.predicates),
    expected = means(model, flags);
  // The research design records the assignment probability as 1/3. All training and scoring use pre-contact features.
  const scores = expected.map(
    (m, a) => m + (a === row.arm ? 3 * (row.y - m) : 0) - design.costs[a],
  );
  return { flags, expected, scores };
}
function pack(actions) {
  return actions.reduce((bits, a, i) => bits | (a << (2 * i)), 0);
}
export const constants = [0, 1, 2].map((a) => ({
  first: 0,
  second: 0,
  leaves: pack([a, a, a, a]),
}));
export function act(rule, flags) {
  const leaf =
    ((flags >>> rule.first) & 1) | (((flags >>> rule.second) & 1) << 1);
  return (rule.leaves >>> (2 * leaf)) & 3;
}
export function actionFor(policy, row, model, design) {
  const flags = flagsFor(row.x, model.predicates);
  if (policy.type === "tree") return act(policy.rule, flags);
  check(policy.type === "response", "Política desconocida");
  const value = means(model, flags).map((m, a) => m - design.costs[a]);
  return value.indexOf(Math.max(...value));
}
export function catalogue(design, limit) {
  num(limit, 1, 10000);
  const predicates = validateDesign(design);
  const pool = [];
  for (let first = 0; first < predicates.length; first++)
    for (let second = first + 1; second < predicates.length; second++) {
      if (predicates[first].j === predicates[second].j) continue;
      for (let code = 0; code < 81; code++) {
        const a = [0, 1, 2, 3].map((i) => Math.floor(code / 3 ** i) % 3);
        if (
          (a[0] === a[1] && a[2] === a[3]) ||
          (a[0] === a[2] && a[1] === a[3])
        )
          continue;
        const rule = { first, second, leaves: pack(a) };
        pool.push({
          rule,
          order: createHash("sha256")
            .update([first, second, rule.leaves].join("/"))
            .digest("hex"),
        });
      }
    }
  // Stable nested catalogues. Changing a cap only appends proposals.
  const rules = [
    ...constants,
    ...pool
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      .map((p) => p.rule),
  ];
  check(
    limit <= rules.length,
    "El catálogo no tiene suficientes políticas distintas",
  );
  return rules.slice(0, limit);
}
export function pairedInterval(values, z = 1.96) {
  check(
    values.length >= 2 && values.every(Number.isFinite),
    "Muestra insuficiente",
  );
  const mean = values.reduce((n, v) => n + v, 0) / values.length;
  const se = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) /
      (values.length * (values.length - 1)),
  );
  return {
    n: values.length,
    mean,
    se,
    lower: mean - z * se,
    upper: mean + z * se,
    z,
  };
}
export function scorePolicies(rows, policies, model, design) {
  validateRows(rows, design);
  const values = policies.map(() => []),
    counts = policies.map(() => [0, 0, 0]),
    matched = policies.map(() => 0);
  for (const r of rows) {
    const { scores } = adjusted(r, model, design);
    policies.forEach((p, i) => {
      const a = actionFor(p, r, model, design);
      values[i].push(scores[a]);
      counts[i][a]++;
      matched[i] += Number(a === r.arm);
    });
  }
  return { values, counts, matched };
}
export function compare(values, a, b, z = 1.96) {
  return pairedInterval(
    values[a].map((v, i) => v - values[b][i]),
    z,
  );
}
export function forecasts(rows, policies, model, design) {
  validateRows(rows, design, false);
  return policies.map((p) => ({
    id: hash(p),
    decisions: rows.map((r) => actionFor(p, r, model, design)),
  }));
}
