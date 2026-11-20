import test from "node:test";
import assert from "node:assert/strict";
import {
  extendCreditHistory,
  verifyCreditHistory,
} from "../src/sale/credit-history.mjs";

const day = 86400000,
  split = 5 * day,
  currentEnd = 10 * day;
const make = (old, rows, window = 3) => ({
  source: (old ? "a" : "b").repeat(64),
  currency: "MXN",
  from: old ? 0 : split,
  until: old ? split : currentEnd,
  maxAgeDays: window,
  lines: rows.map(([time, qty, price = 10], i) => ({
    row: i + 2,
    id: "r-" + i,
    invoice: "invoice-" + i,
    sku: "sku",
    party: "party",
    price,
    qty,
    time: time * day,
  })),
});

test("Agregar ventas y cancelaciones anteriores conserva las referencias y la incertidumbre conjunta", () => {
  const old = make(true, [
      [2, 2],
      [3, -1],
    ]),
    now = make(false, [[5, -2]]);
  const receipt = extendCreditHistory(now, old);
  assert.deepEqual(receipt.summary.currentBackedUnitsWithHistory, [1, 2]);
  assert.deepEqual(receipt.summary.currentUnmatchedCentsWithHistory, [0, 10]);
  assert.deepEqual(receipt.changes[0].earlierSalesInOneAssignment, [
    { row: 2, id: "r-0", invoice: "invoice-0", units: 1 },
  ]);
  assert.deepEqual(verifyCreditHistory(now, old, receipt), receipt.summary);
  const fake = structuredClone(receipt);
  fake.changes[0].earlierSalesInOneAssignment[0].row = 999;
  assert.throws(() => verifyCreditHistory(now, old, fake), /referencias/);
  const reduced = structuredClone(receipt);
  reduced.proofs.previous.groups[0].matches = [];
  assert.throws(() => verifyCreditHistory(now, old, reduced));
  assert.throws(() => extendCreditHistory(now, { ...old, until: split - 1 }));
  assert.throws(() => extendCreditHistory(now, { ...old, currency: "USD" }));
  const empty = extendCreditHistory(make(false, []), make(true, []));
  assert.deepEqual(empty.summary.currentBackedUnitsWithHistory, [0, 0]);
});

// Enumerate all feasible unit assignments on small inputs, including unfilled demands.
// Record the least and greatest current support among assignments with maximum total flow.
function enumerate(old, now) {
  const sales = [],
    demands = [];
  for (const p of [old, now])
    for (const l of p.lines) {
      if (l.qty > 0) for (let i = 0; i < l.qty; i++) sales.push(l);
      else
        for (let i = 0; i < -l.qty; i++)
          demands.push({ ...l, current: p === now });
    }
  let max = -1,
    low = 0,
    high = 0,
    lowCents = 0,
    highCents = 0;
  function visit(index, used, units, current, cents) {
    if (index === demands.length) {
      if (units > max) {
        max = units;
        low = high = current;
        lowCents = highCents = cents;
      } else if (units === max) {
        low = Math.min(low, current);
        high = Math.max(high, current);
        lowCents = Math.min(lowCents, cents);
        highCents = Math.max(highCents, cents);
      }
      return;
    }
    const d = demands[index];
    visit(index + 1, used, units, current, cents);
    for (let i = 0; i < sales.length; i++) {
      const s = sales[i];
      if (
        used & (1 << i) ||
        s.price !== d.price ||
        s.time >= d.time ||
        s.time < d.time - now.maxAgeDays * day
      )
        continue;
      visit(
        index + 1,
        used | (1 << i),
        units + 1,
        current + Number(d.current),
        cents + (d.current ? d.price : 0),
      );
    }
  }
  visit(0, 0, 0, 0, 0);
  return { units: [low, high], cents: [lowCents, highCents] };
}
test("Los dos extremos coinciden con todas las asignaciones factibles en archivos pequeños", () => {
  let seed = 2571;
  const choose = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * n);
  };
  for (let i = 0; i < 800; i++) {
    const entries = (start) =>
      Array.from({ length: choose(4) + 1 }, () => [
        start + choose(5),
        (choose(2) ? 1 : -1) * (1 + choose(2)),
        choose(2) ? 10 : 17,
      ]);
    const window = 1 + choose(6),
      old = make(true, entries(0), window),
      now = make(false, entries(5), window);
    const expected = enumerate(old, now),
      r = extendCreditHistory(now, old);
    assert.deepEqual(
      r.summary.currentBackedUnitsWithHistory,
      expected.units,
      "caso " + i,
    );
    assert.deepEqual(
      r.summary.currentBackedCentsWithHistory,
      expected.cents,
      "caso " + i,
    );
  }
});
