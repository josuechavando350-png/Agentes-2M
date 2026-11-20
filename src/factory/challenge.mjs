import { compute } from "./rules.mjs";
import { exact } from "./proof.mjs";
import { hash } from "./reader.mjs";
// Oracle consumes integer vectors directly, without access to search scores.
export function challenge(rule, examples, implementation = compute) {
  const width = rule.weights.length;
  const cases = [[], ...examples];
  let seed = parseInt(hash(rule).slice(0, 8), 16);
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 192; i++) {
    const groups = Array.from({ length: (i % 6) + 1 }, (_, j) => ({
      account: "a" + j,
      values: rule.weights.map(
        () =>
          [0, 1, 99, 100, 9999, 10000, 10001, 1e9, rand() % 100000][rand() % 9],
      ),
    }));
    cases.push(groups, groups.toReversed());
  }
  for (let j = 0; j < width; j++)
    cases.push([
      {
        account: "limite",
        values: rule.weights.map((_, i) => (j === i ? 4104e9 : 0)),
      },
    ]);
  const fails = (g) => implementation(rule, g) !== exact(rule, g);
  const bad = cases.find(fails);
  if (!bad) return { passed: true, cases: cases.length, bank: hash(cases) };
  let reduced = structuredClone(bad);
  for (let j = reduced.length - 1; j >= 0; j--) {
    const r = reduced.filter((_, i) => i !== j);
    if (fails(r)) reduced = r;
  }
  for (const g of reduced)
    for (let i = 0; i < width; i++) {
      const old = g.values[i];
      for (const v of [0, 1, 2, 10, 99, 100]) {
        if (v >= old) continue;
        g.values[i] = v;
        if (fails(reduced)) break;
        g.values[i] = old;
      }
    }
  return {
    passed: false,
    cases: cases.length,
    witness: reduced,
    expected: exact(rule, reduced),
    actual: implementation(rule, reduced),
  };
}
