import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { boundaries, fee, cost } from "../../src/sale/pricing.mjs";
import { hash } from "../../src/factory/reader.mjs";

// Original period-enumeration method, retained only as an independent comparison.
function reference(o, low, high) {
  const pivot = Math.ceil((o.capCents * 10000) / o.shareBps);
  let lower = Infinity,
    upper = -Infinity,
    examined = 0;
  for (const [lo, hi] of [
    [low, Math.min(high, pivot - 1)],
    [Math.max(low, pivot), high],
  ]) {
    const end = Math.min(hi, lo + 9999);
    const visit = (n) => {
      const value = fee(n, o) - cost(n, o);
      lower = Math.min(lower, value);
      upper = Math.max(upper, value);
      examined++;
    };
    for (let n = lo; n <= end; n++) visit(n);
    for (let n = Math.max(end + 1, hi - 9999); n <= hi; n++) visit(n);
  }
  return { lower, upper, examined };
}
let seed = 34621;
const random = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return Math.floor((seed / 4294967296) * n);
};
const nearParallel = (share, variable) => [
  share,
  Math.max(0, Math.min(10000, variable)),
];
const generate = (i) => {
  let share = 1 + random(10000),
    variable = random(10001);
  if (i % 6 === 0) [share, variable] = nearParallel(share, share);
  if (i % 6 === 1)
    [share, variable] = nearParallel(
      share,
      share + (Math.floor(i / 6) % 2 ? 1 : -1),
    );
  if (i % 6 === 2)
    [share, variable] = nearParallel(share, share + (random(17) - 8));
  if (i % 6 === 3) variable = 0;
  if (i % 6 === 4) {
    share = 100 * (1 + random(100));
    variable = 100 * random(101);
  }
  const low = i % 4 === 0 ? 0 : random(1e10),
    high = Math.min(1e11, low + 1 + random(i % 5 === 0 ? 25 : 7e10));
  const capCents =
    i % 3 === 0
      ? 1 + random(10000)
      : Math.min(
          1e10,
          1 + random(Math.max(1, Math.floor((high * share) / 10000))),
        );
  return {
    o: {
      capCents,
      shareBps: share,
      variableCostBps: variable,
      fixedCostCents: random(1e5),
    },
    low,
    high,
  };
};
const cases = Array.from({ length: 1536 }, (_, i) => generate(i)),
  outcomes = [];
let explored = 0,
  previous = 0,
  maxExplored = 0;
for (const { o, low, high } of cases) {
  const a = boundaries(o, low, high),
    b = reference(o, low, high);
  assert.deepEqual([a.lower, a.upper], [b.lower, b.upper]);
  for (const [n, z] of [
    [a.minAt, a.lower],
    [a.maxAt, a.upper],
  ]) {
    assert.ok(n >= low && n <= high);
    assert.equal(fee(n, o) - cost(n, o), z);
  }
  explored += a.examined;
  previous += b.examined;
  maxExplored = Math.max(maxExplored, a.examined);
  outcomes.push([a.lower, a.upper]);
}
const batch = cases
  .filter(
    (_, i) => i % 24 === 0 || i % 24 === 5 || i % 24 === 9 || i % 24 === 13,
  )
  .slice(0, 64);
const run = (f) => {
  let sum = 0;
  const start = performance.now();
  for (const { o, low, high } of batch) {
    const v = f(o, low, high);
    sum += v.lower + v.upper;
  }
  return { ms: performance.now() - start, sum };
};
const timings = { current: [], reference: [] };
for (let i = -3; i < 31; i++) {
  const methods =
    i % 2
      ? [
          ["current", boundaries],
          ["reference", reference],
        ]
      : [
          ["reference", reference],
          ["current", boundaries],
        ];
  const runs = methods.map(([name, fn]) => [name, run(fn)]);
  assert.equal(runs[0][1].sum, runs[1][1].sum);
  if (i >= 0) for (const [name, r] of runs) timings[name].push(r.ms);
}
const quantile = (v, p) =>
  v.toSorted((a, b) => a - b)[Math.ceil(p * v.length) - 1];
console.log(
  JSON.stringify(
    {
      mode: "LOCAL_CONTRACT_CALCULATION",
      cases: cases.length,
      comparison:
        "Revisión individual de cotas y comprobación de los importes que alcanzan ambos extremos.",
      inputs: hash(cases),
      outcomes: hash(outcomes),
      evaluations: {
        current: explored,
        reference: previous,
        maximumPerContract: maxExplored,
      },
      timing: {
        batch: batch.length,
        repetitions: 31,
        cpu: cpus()[0].model,
        node: process.version,
        methods: Object.fromEntries(
          Object.entries(timings).map(([name, v]) => [
            name,
            { medianMs: quantile(v, 0.5), p95Ms: quantile(v, 0.95) },
          ]),
        ),
      },
      actualOrders: null,
    },
    null,
    2,
  ),
);
