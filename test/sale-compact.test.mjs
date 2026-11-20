import test from "node:test";
import assert from "node:assert/strict";
import {
  traceCredits,
  projectCreditFile,
  verifyCredits,
  creditRegister,
} from "../src/sale/credits.mjs";
import { importCreditCsv } from "../src/sale/credit-csv.mjs";
import { reconcileCreditFile } from "../src/sale/originals.mjs";
import { creditMandate } from "../src/sale/credit-job.mjs";
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
test("El libro reconstruye cada admisión desde el original y detecta una nota omitida", () => {
  const fields = {
    id: "id",
    party: "parte",
    sku: "producto",
    price: "precio",
    qty: "cantidad",
    time: "fecha",
    invoice: "documento",
    currency: "moneda",
  };
  const config = {
    currency: "MXN",
    delimiter: ",",
    decimal: ".",
    maxAgeDays: 30,
    from: "2026-01-01T00:00:00.000Z",
    until: "2026-02-01T00:00:00.000Z",
    fields,
  };
  const bytes = Buffer.from(
    "id,parte,producto,precio,cantidad,fecha,documento,moneda\n" +
      "v,a,x,1.00,2,2026-01-01T00:00:00Z,V,MXN\n" +
      "c,a,x,1.00,-4,2026-01-02T00:00:00Z,C,MXN\n" +
      "b,b,y,1.00,8,2026-01-02T00:00:00Z,V2,MXN\n",
  );
  const original = importCreditCsv(bytes, config),
    admitted = projectCreditFile(original);
  assert.deepEqual(
    admitted.packet.lines.map((l) => l.id),
    ["v", "c"],
  );
  const mandate = creditMandate(
    { scope: "notas", buyer: "cliente", cap: 1, ...admitted },
    original.until,
  );
  assert.equal(
    reconcileCreditFile(
      bytes,
      admitted.projection.retainedInput,
      config,
      mandate.creditProjection,
    ),
    3,
  );
  assert.throws(
    () =>
      reconcileCreditFile(bytes, admitted.projection.retainedInput, config, {
        ...admitted.projection,
        fullRows: 4,
      }),
    /original/i,
  );
  assert.throws(
    () =>
      creditMandate(
        {
          scope: "notas",
          buyer: null,
          cap: 1,
          packet: original,
          projection: admitted.projection,
        },
        original.until,
      ),
    /proyección/i,
  );
  const fake = projectCreditFile({
    ...original,
    lines: original.lines.filter((l) => l.id !== "c"),
  });
  assert.throws(
    () =>
      reconcileCreditFile(
        bytes,
        fake.projection.retainedInput,
        config,
        fake.projection,
      ),
    /original/i,
  );
});
test("Todos los extremos quedan en cero si el archivo solo contiene ventas", () => {
  const sales = { ...packet, lines: packet.lines.filter((l) => l.qty > 0) },
    r = traceCredits(sales, { compact: true });
  assert.equal(r.certificate.groups.length, 0);
  assert.equal(r.report.groups, 2);
  assert.deepEqual(r.report, traceCredits(sales).report);
});
