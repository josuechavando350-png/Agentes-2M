import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleBook } from "../scripts/global/demo.mjs";
import { party, pilotBook } from "../scripts/sale/pilot.mjs";
import { hash } from "../src/factory/reader.mjs";
import { verifiedWeek } from "../src/sale/portfolio.mjs";
import { commercialReadiness } from "../src/sale/field.mjs";
import { archivedExecution, engine } from "../src/global-archive.mjs";
import { saleReplayInput, evaluateSale } from "../src/sale/replay.mjs";
import { digest } from "../src/policy.mjs";
function db(t) {
  const d = mkdtempSync(join(tmpdir(), "semar-prueba-contable-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, "prueba.sqlite");
}
test("Un verificador designado en el mandato debe acreditar las claves para registros LIVE", async (t) => {
  const now = 1795000000000,
    e = await exampleBook(db(t), () => now);
  t.after(() => e.close());
  const verifier = party(),
    bank = party(),
    buyer = party(),
    other = party(),
    until = e.grant.until;
  e.command("open", "abrir", {
    ...e.grant,
    commercialAuthority: verifier.publicKey,
    commercialBudget: "bank-outlays-v1",
  });
  const enroll = (who, role, id, group, key) =>
    who.proof("enrollment", {
      role,
      id,
      group,
      publicKey: key,
      from: now - 50,
      until: until + 500,
      source: hash(["prueba-sin-dinero", id]),
    });
  const account = {
    id: "prueba",
    mode: "LIVE",
    publicKey: bank.publicKey,
    currency: "MXN",
    balanceCents: 0,
    from: now - 5,
  };
  assert.throws(
    () =>
      e.command("sale-account", "no-acreditada", {
        ...account,
        enrollment: enroll(other, "bank", "prueba", "prueba", bank.publicKey),
      }),
    /firma/,
  );
  const good = {
    ...account,
    enrollment: enroll(verifier, "bank", "prueba", "prueba", bank.publicKey),
  };
  const record = e.message("sale-account", "cuenta", good).record,
    snapshot = saleReplayInput(
      e.desk.read(),
      record,
      now,
      e.store.settlementAuthority(),
      [],
    );
  const actual = e.command("sale-account", "cuenta", good);
  const witness = { runtime: engine, snapshot: { engine: digest(engine) } };
  assert.deepEqual(
    archivedExecution(e.desk.db, witness, snapshot),
    actual.data,
  );
  assert.deepEqual(evaluateSale(snapshot), actual.data);
  const customer = {
    id: "comprador",
    group: "empresa",
    account: "prueba",
    mode: "LIVE",
    publicKey: buyer.publicKey,
  };
  assert.throws(
    () =>
      e.command("sale-client", "falso", {
        ...customer,
        enrollment: enroll(
          verifier,
          "buyer",
          "comprador",
          "otro",
          buyer.publicKey,
        ),
      }),
    /Identidad/,
  );
  e.command("sale-client", "valido", {
    ...customer,
    enrollment: enroll(
      verifier,
      "buyer",
      "comprador",
      "empresa",
      buyer.publicKey,
    ),
  });
  assert.equal(e.desk.readiness().commercialStatus, "NO_LIVE_PILOT");
  assert.equal((await e.desk.audit()).status, "VERIFIED");
  e.desk.db
    .prepare("UPDATE global_runtime SET archive=? WHERE id=?")
    .run(Buffer.from("dañado"), digest(engine));
  await assert.rejects(() => e.desk.audit());
});
test("El reparto de un depósito conserva los saldos, permite un reembolso parcial y mantiene su referencia", async (t) => {
  const path = db(t), e = await pilotBook(path);
  t.after(() => e.close());
  e.client("uno");
  e.client("dos");
  const a = e.offer("a", "uno"),
    b = e.offer("b", "dos"),
    aa = e.offer("repetida", "uno"),
    oa = e.order(a),
    ob = e.order(b);
  assert.throws(() => e.order(aa), /ya aceptó/);
  e.command("sale-decline", {
    sale: aa.id,
    proof: e.buyers.get("uno").proof("decline", {
      sale: aa.id,
      offer: aa.digest,
      reference: "rechazo",
      at: e.now(),
    }),
  });
  e.advance();
  e.deliver(a, oa, 150);
  e.deliver(b, ob, 150);
  e.statement(
    [
      e.line("lote", "unapplied", 65),
      e.line("gasto-fabrica", "research", 2, null, "producto"),
    ],
    153,
  );
  for (const o of [a, b, aa]) e.closeSale(o, 0);
  assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, null);
  const propose = (parts) =>
    e.command("sale-assign", {
      account: "cuenta",
      proof: e.bank.proof("allocation", {
        account: "cuenta",
        original: "lote",
        parts,
        at: e.now(),
        source: hash("prueba-de-distribucion"),
      }),
    });
  const parts = [
    { id: "abono-a", kind: "fee", sale: a.id, cents: 30 },
    { id: "abono-b", kind: "fee", sale: b.id, cents: 30 },
    { id: "aporte", kind: "funding", sale: null, cents: 5 },
  ];
  assert.throws(() => propose(parts.slice(1)), /conservar/);
  propose(parts);
  const afterSplit = await verifiedWeek(path, "DEMONSTRATION");
  assert.equal(afterSplit.receipts.length, 2);
  assert.throws(() => propose(parts), /asignado/);
  assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, 58);
  assert.equal(e.desk.read().sales.accounts.get("cuenta").balance, 153);
  e.advance();
  e.statement([e.line("dev", "refund", 9, a.id, "abono-a")], 144);
  for (const o of [a, b, aa]) e.closeSale(o, 0);
  assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, 49);
  assert.equal((await e.desk.audit()).status, "VERIFIED");
});
test("Un estudio no califica cuando discrepan horas, moneda, intervención o dinero del comprador", async (t) => {
  const e = await pilotBook(db(t));
  t.after(() => e.close());
  e.client("uno");
  const original = e.offer("venta", "uno"),
    order = e.order(original),
    from = e.now();
  e.advance();
  const delivery = e.deliver(original, order, 100);
  e.statement(
    [
      e.line("pago", "fee", delivery.fee, original.id),
      e.line("gasto-fabrica", "research", 2, null, "producto"),
    ],
    108,
  );
  e.closeSale(original, 2);
  const s = e.desk.read(),
    o = s.sales.offers.get(original.id),
    until = o.close.through;
  o.pilot = "ensayo";
  const trial = {
    trial: "ensayo",
    candidate: "c",
    control: "a",
    scope: "g",
    from,
    until,
    status: "QUALIFIED_IN_SCOPE",
    units: [
      {
        subject: "uno",
        arm: "candidate",
        action: "OFFER",
        applied: true,
        close: {
          paid: 20,
          refunds: 0,
          cost: 0,
          labor: 2,
          entries: [{ kind: "fee", reference: "pago", at: e.now(), cents: 20 }],
        },
      },
    ],
  };
  const read = (view = trial) =>
    commercialReadiness(s, [view], "DEMONSTRATION").randomizedTrials[0];
  assert.equal(read().matched, 1);
  assert.equal(read().status, "AWAIT_INCREMENTAL_EVIDENCE");
  for (const changed of [
    { applied: false },
    { action: "WAIT" },
    { close: { paid: 19, refunds: 0, cost: 0, labor: 2 } },
    { close: { paid: 20, refunds: 0, cost: 0, labor: 0 } },
  ]) {
    assert.equal(
      read({ ...trial, units: [{ ...trial.units[0], ...changed }] }).status,
      "AWAIT_INCREMENTAL_EVIDENCE",
    );
  }
  s.sales.accounts.get("cuenta").currency = "USD";
  assert.equal(read().status, "AWAIT_INCREMENTAL_EVIDENCE");
});
