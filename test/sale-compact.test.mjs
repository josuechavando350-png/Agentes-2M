import test from "node:test";
import assert from "node:assert/strict";
import {
  traceCredits,
  verifyCredits,
  creditRegister,
} from "../src/sale/credits.mjs";
const packet = {
  source: "1".repeat(64),
  currency: "MXN",
  maxAgeDays: 30,
  from: 0,
  until: 100,
  lines: [
    {
      id: "v",
      party: "a",
      sku: "a",
      price: 17,
      qty: 2,
      time: 2,
      invoice: "V",
      row: 2,
    },
    {
      id: "c",
      party: "a",
      sku: "a",
      price: 17,
      qty: -3,
      time: 3,
      invoice: "C",
      row: 3,
    },
    {
      id: "independiente",
      party: "b",
      sku: "a",
      price: 30,
      qty: 9,
      time: 1,
      invoice: "O",
      row: 4,
    },
  ],
};
test("Los certificados íntegro y compacto coinciden y comprometen también las ventas sin cancelación", () => {
  const complete = traceCredits(packet),
    compact = traceCredits(packet, { compact: true });
  assert.equal(complete.certificate.groups.length, 2);
  assert.equal(compact.certificate.groups.length, 1);
  assert.deepEqual(complete.report, compact.report);
  assert.equal(compact.report.groups, 2);
  const changed = structuredClone(packet);
  changed.lines[2].qty = 10;
  assert.throws(
    () => verifyCredits(changed, compact.certificate),
    /otro expediente/,
  );
  assert.throws(
    () => verifyCredits(packet, { ...compact.certificate, groups: [] }),
    /Cobertura/,
  );
  assert.throws(
    () =>
      verifyCredits(packet, { ...compact.certificate, format: "inexistente" }),
    /Formato/,
  );
  const duplicated = structuredClone(packet);
  duplicated.lines[2].id = "v";
  assert.throws(() => creditRegister(duplicated), /repetida/);
});
test("Todos los extremos quedan en cero si el archivo solo contiene ventas", () => {
  const sales = { ...packet, lines: packet.lines.filter((l) => l.qty > 0) },
    r = traceCredits(sales, { compact: true });
  assert.equal(r.certificate.groups.length, 0);
  assert.equal(r.report.groups, 2);
  assert.deepEqual(r.report, traceCredits(sales).report);
});
