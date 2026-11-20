import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleBook, exampleGoal } from "../scripts/global/demo.mjs";
import { party } from "../scripts/sale/pilot.mjs";
import { hash } from "../src/factory/reader.mjs";
import {
  remainingBudget,
  freeBudget,
  committedOrders,
  salesState,
} from "../src/sale/book.mjs";
test("Un egreso real autenticado retira el padrón al agotar el mandato y un depósito posterior no resucita identidades", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "semar-saldo-cero-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = 1800000000000;
  const e = await exampleBook(join(dir, "prueba.sqlite"), () => now);
  t.after(() => e.close());
  const verifier = party(),
    bank = party();
  e.command("open", "abrir", {
    ...e.grant,
    commercialBudget: "bank-outlays-v1",
    commercialAuthority: verifier.publicKey,
    budgetCents: 100,
  });
  const enrollment = verifier.proof("enrollment", {
    role: "bank",
    id: "cuenta",
    group: "cuenta",
    publicKey: bank.publicKey,
    from: now - 100,
    until: e.grant.until,
    source: hash("prueba"),
  });
  e.command("sale-account", "cuenta", {
    id: "cuenta",
    publicKey: bank.publicKey,
    mode: "LIVE",
    currency: "MXN",
    from: now - 20,
    balanceCents: 500,
    enrollment,
  });
  function statement(id, kind, cents, at) {
    const a = e.desk.read().sales.accounts.get("cuenta"),
      closing = a.balance + (kind === "funding" ? 1 : -1) * cents;
    e.command("sale-bank", id, {
      account: "cuenta",
      proof: bank.proof("statement", {
        account: "cuenta",
        previous: a.tip,
        currency: "MXN",
        from: a.until,
        until: now + 1,
        opening: a.balance,
        closing,
        lines: [{ id, kind, sale: null, original: null, cents, at }],
        source: hash(id),
      }),
    });
  }
  statement("anterior", "overhead", 300, now - 10);
  assert.equal(e.desk.view().commercialSpentCents, 0);
  now += 1000;
  statement("primero", "overhead", 70, now);
  assert.equal(e.desk.view().freeCents, 30);
  assert.throws(
    () => e.command("reserve", "excede", { goal: exampleGoal(), cap: 31 }),
    /Presupuesto/,
  );
  now += 1000;
  statement("ultimo", "overhead", 135, now);
  assert.equal(e.desk.view().status, "DEAD");
  assert.equal(e.desk.view().freeCents, 0);
  assert.equal(e.desk.view().overrunCents, 105);
  assert.equal(e.store.agent(1).status, "DEAD");
  assert.throws(() => e.store.layout(), /Presupuesto/);
  now += 1000;
  statement("deposito", "funding", 500, now);
  assert.equal(e.desk.view().status, "DEAD");
  assert.throws(
    () => e.command("reserve", "prohibida", { goal: exampleGoal(), cap: 1 }),
    /presupuesto cero/,
  );
  const audit = await e.desk.audit();
  assert.equal(audit.status, "VERIFIED");
});
test("Los pedidos aceptados comparten un solo límite; el costo incurrido sustituye la reserva", () => {
  const s = {
    open: { budgetCents: 100, commercialBudget: "bank-outlays-v1" },
    spent: 5,
    held: 12,
    commercialSpent: 20,
    sales: salesState(),
  };
  const offer = (id, account, mode, maxCost) => ({
    id,
    account,
    mode,
    order: { maxCost },
    close: null,
  });
  for (const o of [
    offer("a", "primera", "LIVE", 40),
    offer("b", "segunda", "LIVE", 15),
    offer("d", "demo", "DEMONSTRATION", 80),
  ])
    s.sales.offers.set(o.id, o);
  s.sales.ledger.set("g", { sale: "a", kind: "cost", cents: 15 });
  assert.equal(remainingBudget(s), 75);
  assert.equal(committedOrders(s), 40);
  assert.equal(freeBudget(s), 23);
  assert.equal(freeBudget(s, new Set(["b"])), 38);
  s.sales.offers.get("a").close = {};
  assert.equal(freeBudget(s), 48);
});
