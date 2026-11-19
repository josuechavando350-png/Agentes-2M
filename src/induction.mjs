import { digest, integer } from "./policy.mjs";
import { reverseInference, validateCase } from "./inference.mjs";

export function scenario(book, features, mask) {
  integer(mask, 0, (1 << features.length) - 1, "escenario");
  const fixed = book.facts.filter(
    (f) => !features.includes(f.literal.replace(/^!/, "")),
  );
  const varied = features.map((name, bit) => ({
    literal: (mask & (1 << bit) ? "" : "!") + name,
    source: "escenario:" + mask,
  }));
  const result = {
    facts: [...fixed, ...varied],
    rules: book.rules,
    query: book.query,
  };
  validateCase(result);
  return result;
}
export function runTree(tree, mask) {
  let node = tree;
  while ("bit" in node) node = mask & (1 << node.bit) ? node.yes : node.no;
  return node.value;
}
// This learner receives training rows only. No reference rules or validation labels.
export function fit(rows, bits) {
  if (rows.every((r) => r.value === rows[0].value))
    return { tree: { value: rows[0].value }, nodes: 1 };
  let best;
  for (const bit of bits) {
    const yes = rows.filter((r) => r.mask & (1 << bit)),
      no = rows.filter((r) => !(r.mask & (1 << bit)));
    if (!yes.length || !no.length) continue;
    const rest = bits.filter((x) => x !== bit);
    const left = fit(no, rest),
      right = fit(yes, rest);
    const nodes = 1 + left.nodes + right.nodes;
    if (!best || nodes < best.nodes)
      best = { nodes, tree: { bit, no: left.tree, yes: right.tree } };
  }
  if (!best) throw Error("Ejemplos incompatibles");
  return best;
}
export function experiment(book, features) {
  validateCase(book);
  if (
    !Array.isArray(features) ||
    features.length < 2 ||
    features.length > 4 ||
    new Set(features).size !== features.length ||
    !features.every(
      (f) =>
        typeof f === "string" &&
        /^[a-z][a-z0-9_.-]{0,62}$/.test(f) &&
        f !== book.query &&
        !book.rules.some((r) => r.then.replace(/^!/, "") === f),
    )
  )
    throw Error("Variables inválidas");
  const vars = [...features].sort();
  const n = 1 << vars.length;
  const rows = Array.from({ length: n }, (_, mask) => ({
    mask,
    value: reverseInference(scenario(book, vars, mask)),
  }));
  const train = rows.filter((r) => r.mask % 4 !== 3),
    held = rows.filter((r) => r.mask % 4 === 3);
  const { tree, nodes } = fit(
    train,
    vars.map((_, i) => i),
  );
  const frequencies = new Map();
  for (const r of train)
    frequencies.set(r.value, (frequencies.get(r.value) ?? 0) + 1);
  const baseline = [...frequencies].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0][0];
  const correct = rows.filter((r) => runTree(tree, r.mask) === r.value).length;
  const baselineCorrect = rows.filter((r) => r.value === baseline).length;
  const exam = {
    training: train.length,
    heldOut: held.length,
    heldOutCorrect: held.filter((r) => runTree(tree, r.mask) === r.value)
      .length,
    total: n,
    correct,
    baselineCorrect,
    nodes,
  };
  const policy = {
    id: digest({ query: book.query, vars, table: rows.map((r) => r.value) }),
    vars,
    tree,
  };
  return { accepted: correct === n && correct > baselineCorrect, policy, exam };
}
export function policyManifest(policy, seed) {
  const masks = Array.from({ length: 1 << policy.vars.length }, (_, i) => i);
  // Every replica must reproduce the complete verified truth table.
  const expected = masks.map((m) => runTree(policy.tree, m));
  return digest(
    Array.from({ length: 666 }, (_, i) => {
      const table = masks.map((m) => runTree(policy.tree, m));
      if (table.some((v, m) => v !== expected[m]))
        throw Error("Réplica inconsistente");
      return digest({ seed, i, policy: policy.id, table });
    }),
  );
}
