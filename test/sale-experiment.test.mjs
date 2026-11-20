import test from "node:test";
import assert from "node:assert/strict";
import { marginRandomization, planPilot } from "../src/sale/experiment.mjs";
function brute(x) {
  const observed = x.reduce((s, v) => s + v, 0),
    weights = x.filter(Boolean),
    n = 2 ** weights.length;
  let tail = 0;
  for (let flip = 0; flip < n; flip++) {
    const score = weights.reduce(
      (s, v, i) => s + ((flip >> i) & 1 ? 1 : -1) * Math.abs(v),
      0,
    );
    if (score >= observed) tail++;
  }
  return tail / n;
}
test("La prueba ponderada encierra la enumeración exacta incluso con cifras grandes o causas empatadas", () => {
  let state = 94429;
  const draw = (n) =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n;
  for (let i = 0; i < 50; i++) {
    const scale = i % 2 === 0 ? 50 : 1000000,
      x = Array.from({ length: 1 + draw(12) }, () => draw(scale * 2) - scale);
    const check = marginRandomization(x),
      p = brute(x);
    assert.ok(check.lowerP <= p && p <= check.upperP);
    if (check.exact) assert.equal(check.lowerP, p);
    if (check.passes) assert.ok(p <= 0.05);
  }
  assert.equal(marginRandomization(Array(6).fill(40)).upperP, 1 / 64);
  assert.equal(marginRandomization(Array(6).fill(0)).passes, false);
  const noisy = [10, 10, 10, 10, 10, 10, 10, -60];
  assert.ok(noisy.reduce((a, b) => a + b) > 0);
  assert.equal(marginRandomization(noisy).passes, false);
});
test("El diseño de un piloto distingue elegibilidad, caja, potencia condicional y tiempo de campo", () => {
  const spec = {
    alphaDenominator: 20,
    eligibleIndependentBuyers: 200,
    winBps: 10000,
    tieBps: 0,
    powerBps: 9900,
    costPerPairCents: 200,
    minutesPerPair: 10,
    budgetCents: 50000,
    minutes: 1000,
  };
  let r = planPilot(spec);
  assert.equal(r.chosen.pairs, 5);
  assert.equal(r.chosen.conditionalPower, 1);
  assert.equal(planPilot({ ...spec, budgetCents: 999 }).chosen, null);
  assert.equal(planPilot({ ...spec, minutes: 49 }).maxPairs, 4);
  assert.equal(
    planPilot({ ...spec, eligibleIndependentBuyers: 8 }).chosen,
    null,
  );
  assert.equal(
    planPilot({ ...spec, winBps: 5000, powerBps: 600 }).chosen,
    null,
  );
  assert.equal(
    planPilot({ ...spec, tieBps: 10000 }).bestFeasible.conditionalPower,
    0,
  );
  assert.equal(planPilot({ ...spec, alphaDenominator: 40 }).chosen.pairs, 6);
});
