import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Semar } from "../../src/semar.mjs";
import { GlobalDesk } from "../../src/global-desk.mjs";

const [mode, first, record] = process.argv.slice(2);
if (mode === "historical") {
  const { pilotBook } = await import(
    pathToFileURL(join(resolve(first), "scripts/sale/pilot.mjs"))
  );
  const root = record,
    e = await pilotBook(join(root, "prueba.sqlite"));
  try {
    e.client("cliente");
    const o = e.offer("venta", "cliente"),
      order = e.order(o);
    e.advance();
    e.deliver(o, order, 150);
    e.statement(
      [
        e.line("abono", "fee", 30, o.id),
        e.line("gasto-fabrica", "research", 2, null, "producto"),
      ],
      118,
    );
    e.closeSale(o, 1);
    const r = e.desk.sales("DEMONSTRATION"),
      audit = await e.desk.audit();
    assert.equal(r.campaignNetCents, 27);
    e.advance();
    const a = e.desk.read().sales.accounts.get("cuenta"),
      now = e.now(),
      proof = e.bank.proof("statement", {
        account: "cuenta",
        previous: a.tip,
        currency: "MXN",
        from: a.until,
        until: now + 1,
        opening: 118,
        closing: 113,
        lines: [e.line("reembolso", "refund", 5, o.id, "abono")],
        source: "a".repeat(64),
      });
    const close = e.desk.read().sales.offers.get(o.id).close;
    writeFileSync(
      join(root, "pasos.json"),
      JSON.stringify({
        at: now,
        tip: audit.tip,
        refund: e.message("sale-bank", "abono-posterior", {
          account: "cuenta",
          proof,
        }),
        close: e.message("sale-close", "cerrar-de-nuevo", {
          sale: o.id,
          through: now + 1,
          minutes: 1,
          hourlyCents: 60,
          evidence: "b".repeat(64),
          previous: close.digest,
        }),
      }),
      { mode: 0o600 },
    );
  } finally {
    e.close();
  }
} else if (mode === "verify") {
  const root = mkdtempSync(join(tmpdir(), "semar-migracion-"));
  let store, desk;
  try {
    execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "historical", first, root],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 },
    );
    const r = JSON.parse(readFileSync(join(root, "pasos.json"))),
      db = join(root, "prueba.sqlite");
    store = new Semar(db, { clock: () => r.at });
    desk = new GlobalDesk(db, store, { clock: () => r.at });
    assert.equal(store.audit().status, "VERIFIED");
    const before = await desk.audit();
    assert.equal(before.tip, r.tip);
    assert.equal(desk.sales("DEMONSTRATION").campaignNetCents, 27);
    desk.command(r.refund);
    desk.command(r.refund);
    assert.equal(desk.sales("DEMONSTRATION").campaignNetCents, null);
    desk.command(r.close);
    assert.equal(desk.sales("DEMONSTRATION").campaignNetCents, 22);
    assert.equal(desk.sales("LIVE").bankCollectedCents, 0);
    const updated = await desk.audit();
    assert.equal(updated.status, "VERIFIED");
    console.log(
      JSON.stringify(
        {
          status: "PASSED",
          historicalEvents: before.events,
          eventsAfterUpgrade: updated.events,
          oldTipVerified: true,
          priorCents: 27,
          correctedCents: 22,
          mode: "DEMONSTRATION",
          realOwnReceipts: null,
        },
        null,
        2,
      ),
    );
  } finally {
    desk?.close();
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
} else throw Error("Usa verify RUTA_A_LA_VERSION_HISTORICA");
