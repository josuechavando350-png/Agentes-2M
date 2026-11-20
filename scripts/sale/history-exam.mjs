import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hash } from "../../src/factory/reader.mjs";
import {
  extendCreditHistory,
  verifyCreditHistory,
} from "../../src/sale/credit-history.mjs";

const packet = JSON.parse(readFileSync(process.argv[2]));
const month = (time) => new Date(time).toISOString().slice(0, 7);
const slice = (from, until) => {
  const lines = packet.lines.filter((r) => from <= r.time && r.time < until);
  return {
    ...packet,
    from,
    until,
    source: hash([packet.source, from, until, lines.map((r) => r.row)]),
    lines,
  };
};

// Two independent feasible assignments, one starting at each end of calendar time.
// Select the earliest (or latest) eligible remaining sale, always respecting its capacity.
function reconstruct(rows, cutoff, age, newestFirst) {
  const groups = new Map();
  for (const r of rows) {
    const k = JSON.stringify([r.party, r.sku, r.price]);
    if (!groups.has(k)) groups.set(k, { sales: [], credits: [] });
    const g = groups.get(k);
    (r.qty > 0 ? g.sales : g.credits).push(r);
  }
  let currentUnits = 0,
    currentCents = 0,
    allUnits = 0,
    allCents = 0;
  const order = newestFirst
    ? (a, b) => b.time - a.time || b.row - a.row
    : (a, b) => a.time - b.time || a.row - b.row;
  for (const { sales, credits } of groups.values()) {
    sales.sort(order);
    credits.sort(order);
    const available = sales.map((r) => r.qty);
    for (const r of credits) {
      let need = -r.qty;
      for (let i = 0; i < sales.length && need; i++) {
        const s = sales[i];
        if (!available[i] || s.time >= r.time || s.time < r.time - age)
          continue;
        const n = Math.min(available[i], need);
        available[i] -= n;
        need -= n;
        allUnits += n;
        allCents += n * r.price;
        if (r.time >= cutoff) {
          currentUnits += n;
          currentCents += n * r.price;
        }
      }
    }
  }
  return { currentUnits, currentCents, allUnits, allCents };
}

const periods = [];
let from = Date.UTC(
  new Date(packet.from).getUTCFullYear(),
  new Date(packet.from).getUTCMonth() + 1,
  1,
);
while (from < packet.until) {
  const date = new Date(from),
    until = Math.min(
      packet.until,
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    );
  const prior = slice(packet.from, from),
    current = slice(from, until),
    receipt = extendCreditHistory(current, prior);
  const s = verifyCreditHistory(current, prior, receipt),
    asOf = packet.lines.filter((r) => r.time < until);
  const early = reconstruct(asOf, from, packet.maxAgeDays * 86400000, false);
  const late = reconstruct(asOf, from, packet.maxAgeDays * 86400000, true);
  assert.equal(early.allUnits, late.allUnits);
  assert.equal(early.allCents, late.allCents);
  assert.deepEqual(
    [early.currentUnits, late.currentUnits],
    s.currentBackedUnitsWithHistory,
  );
  assert.deepEqual(
    [early.currentCents, late.currentCents],
    s.currentBackedCentsWithHistory,
  );
  periods.push({
    month: month(from),
    notes: s.notesInCurrentPeriod,
    previousRows: prior.lines.length,
    currentRows: current.lines.length,
    previouslyBackedCents: s.previouslyBackedCents,
    backedCentsWithHistory: s.currentBackedCentsWithHistory,
    additionalBoundedBelowCents: early.currentCents - s.previouslyBackedCents,
    changes: s.notesWithChangedBounds,
    notesWithEarlierSales: s.notesUsingPreviousSalesInWitness,
    lowerAndUpperAttainedIndependently: true,
    receipt: hash(receipt),
  });
  from = until;
}
console.log(
  JSON.stringify(
    {
      mode: "HISTORICAL_DOCUMENT_RECONCILIATION",
      source: packet.source,
      currency: packet.currency,
      windowDays: packet.maxAgeDays,
      periods,
      examinedNotes: periods.reduce((n, p) => n + p.notes, 0),
      sumOfMonthlyLowerIncreasesCents: periods.reduce(
        (n, p) => n + p.additionalBoundedBelowCents,
        0,
      ),
      ownRevenue: null,
      scope:
        "Cada mes usa el archivo disponible hasta su cierre. Las notas actuales pertenecen a meses distintos. Las cotas mensuales se estiman en cortes separados y no constituyen una asignación anual conjunta.",
    },
    null,
    2,
  ),
);
