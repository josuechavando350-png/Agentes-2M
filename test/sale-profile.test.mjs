import test from "node:test";
import assert from "node:assert/strict";
import { suggestProfile } from "../src/sale/browser/profile.mjs";
import { importCreditCsv } from "../src/sale/credit-csv.mjs";
const bytes = (s) => new TextEncoder().encode(s),
  preferred = { fields: {}, maxAgeDays: 90 };
const header =
  "ID;Cliente;SKU;Precio Unitario;Quantity;Timestamp;Factura;Currency";
const row = "a;uno;s;1,05;4;2026-01-03T14:00:00Z;f;MXN";
test("El formulario reconoce columnas, decimal y los límites de las observaciones sin perder el original", () => {
  const raw = bytes(header + "\r\n" + row + "\r\n"),
    s = suggestProfile(raw, preferred);
  assert.deepEqual(
    [s.profile.currency, s.profile.delimiter, s.profile.decimal],
    ["MXN", ";", ","],
  );
  assert.equal(s.profile.from, "2026-01-03T14:00:00.000Z");
  assert.equal(s.profile.until, "2026-01-03T14:00:00.001Z");
  assert.equal(importCreditCsv(raw, s.profile).lines[0].price, 105);
});
test("Los nombres ambiguos y monedas mezcladas quedan para resolución del comprador", () => {
  const raw = bytes(
    header.replace("Cliente;", "Cliente;Cuenta;") +
      "\n" +
      row.replace("uno;", "uno;dos;") +
      "\n" +
      row.replace("uno;", "uno;dos;").replace("MXN", "USD"),
  );
  const s = suggestProfile(raw, preferred);
  assert.equal(s.profile.fields.party, "");
  assert.equal(s.profile.currency, "");
  assert.throws(() => importCreditCsv(raw, s.profile));
});
test("Una coma dentro de un encabezado entrecomillado no cambia el separador y las fechas ambiguas exigen revisión", () => {
  const text =
    header.replace("Cliente", '"comprador, país"') +
    "\r\n" +
    row.replace("2026-01-03T14:00:00Z", "03/01/26");
  const s = suggestProfile(bytes(text), {
    ...preferred,
    fields: { party: "comprador, país" },
  });
  assert.equal(s.profile.delimiter, ";");
  assert.equal(s.profile.fields.party, "comprador, país");
  assert.equal(s.profile.from, "");
  assert.equal(s.profile.until, "");
});
