import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pilotBook } from "../scripts/sale/pilot.mjs";
import { hash } from "../src/factory/reader.mjs";
import { checkOriginals, reconcileBankFile } from "../src/sale/originals.mjs";
const digest = (b) => createHash("sha256").update(b).digest("hex");
const profile = {
  delimiter: ",",
  columns: {
    reference: "folio",
    at: "fecha",
    amount: "importe",
    currency: "moneda",
    account: "cuenta",
  },
  amountFormat: "minor",
};
test("La conciliación compara cada centavo y referencia del archivo original y detecta un documento reemplazado", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "semar-fuentes-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const vault = join(root, "originales");
  mkdirSync(vault);
  const e = await pilotBook(join(root, "ejemplo.sqlite"));
  t.after(() => e.close());
  e.client("prueba");
  const add = (bytes, name = digest(bytes)) => {
    writeFileSync(join(vault, name), bytes);
    return name;
  };
  const terms = add("Condiciones de esta prueba sin fondos"),
    o = e.offer("demo", "prueba", { basis: terms }),
    order = e.order(o);
  e.advance();
  e.deliver(o, order, 100);
  add(JSON.stringify(["acta", "demo"]));
  const offerRecord = [
    ...e.desk.db
      .prepare("SELECT body FROM global_events ORDER BY seq")
      .iterate(),
  ]
    .map((r) => JSON.parse(r.body))
    .find((r) => r.kind === "sale-offer");
  const input = offerRecord.authorization.record.data.input;
  add(JSON.stringify(input, null, 2), hash(input));
  const bank = e.desk.read().sales.accounts.get("cuenta"),
    lines = [
      e.line("pago", "fee", 20, o.id),
      e.line("gasto-fabrica", "research", 2, null, "producto"),
    ];
  const iso = new Date(e.now()).toISOString(),
    csv =
      "folio,fecha,importe,moneda,cuenta\n" +
      [
        "pago," + iso + ",20,MXN,cuenta",
        "gasto-fabrica," + iso + ",-2,MXN,cuenta",
      ].join("\n") +
      "\n";
  const p = {
    account: "cuenta",
    previous: bank.tip,
    currency: "MXN",
    from: bank.until,
    until: e.now() + 1,
    opening: 90,
    closing: 108,
    lines,
    source: add(csv),
  };
  e.command("sale-bank", {
    account: "cuenta",
    proof: e.bank.proof("statement", p),
  });
  e.closeSale(o, 1);
  const conf = { directory: vault, bank: { cuenta: profile } };
  assert.equal(
    (await checkOriginals(e.desk, "DEMONSTRATION", conf)).status,
    "SOURCE_FILES_PENDING",
  );
  const a = e.desk.read().sales.accounts.get("cuenta");
  add(JSON.stringify(["horas", "demo", a.tip, 1]));
  let r = await checkOriginals(e.desk, "DEMONSTRATION", conf);
  assert.equal(r.status, "ORIGINALS_MATCHED");
  assert.equal(r.verifiedMovements, 2);
  writeFileSync(join(vault, p.source), csv.replace(",20,", ",99,"));
  r = await checkOriginals(e.desk, "DEMONSTRATION", conf);
  assert.equal(r.status, "SOURCE_DISAGREEMENT");
  assert.equal(r.matchedStatements, 0);
  assert.throws(
    () =>
      reconcileBankFile(Buffer.from(csv.replace(",20,", ",99,")), p, profile),
    /contradice/,
  );
  assert.throws(
    () =>
      reconcileBankFile(
        Buffer.from(csv.replace("gasto-fabrica", "pago")),
        p,
        profile,
      ),
    /repetido/,
  );
  assert.equal(
    (await checkOriginals(e.desk, "LIVE", conf)).status,
    "AWAIT_SOURCE_STATEMENT",
  );
});
