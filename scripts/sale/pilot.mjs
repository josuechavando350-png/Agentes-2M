import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "../../src/policy.mjs";
import { hash } from "../../src/factory/reader.mjs";
import { corpus } from "../factory/fixtures.mjs";
import { exampleBook } from "../global/demo.mjs";

export function party() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    proof(purpose, data) {
      const record = {
        protocol: "SEMAR-SALE-1",
        book: "ejemplo",
        purpose,
        ...data,
      };
      return {
        record,
        signature: sign(
          null,
          Buffer.from(canonical(record)),
          privateKey,
        ).toString("base64"),
      };
    },
  };
}
export async function pilotBook(path) {
  let time = 1800000000000,
    seq = 0;
  const e = await exampleBook(path, () => time),
    bank = party(),
    buyers = new Map(),
    x = corpus("flujo-de-ventas");
  const command = (kind, data) => e.command(kind, "paso-" + ++seq, data).data;
  try {
    e.command("open", "abrir", e.grant);
    e.command("factory-reserve", "producto", { cap: 10, project: x.project });
    await e.desk.work("producto");
    command("factory-predict", { job: "producto", groups: x.batches });
    command("factory-score", { job: "producto", answers: x.answers });
    command("settle", {
      job: "producto",
      cents: 2,
      reference: "gasto-fabrica",
    });
    command("sale-account", {
      id: "cuenta",
      publicKey: bank.publicKey,
      mode: "DEMONSTRATION",
      currency: "MXN",
      from: time - 1000,
      balanceCents: 90,
    });
    function client(id, group = id) {
      const who = party();
      command("sale-client", {
        id,
        group,
        account: "cuenta",
        mode: "DEMONSTRATION",
        publicKey: who.publicKey,
      });
      buyers.set(id, who);
    }
    function offer(id, buyer, opts = {}) {
      return command("sale-offer", {
        id,
        job: "producto",
        buyer,
        account: "cuenta",
        input: { format: 2, dossier: x.batches[0].cases[0] },
        terms: {
          floorCents: 0,
          ceilingCents: 200,
          buyerFeeLimitCents: 80,
          buyerKeepsBps: 7000,
          options: [
            {
              id: "por-resultado",
              capCents: 60,
              shareBps: 2000,
              variableCostBps: 0,
              fixedCostCents: 2,
            },
            {
              id: "costosa",
              capCents: 80,
              shareBps: 3000,
              variableCostBps: 0,
              fixedCostCents: 15,
            },
          ],
        },
        expires: time + 86400000,
        service: "Conciliar por cuenta y documentar la recuperación confirmada",
        basis: hash(["ejemplo", id]),
        pilot: null,
        ...opts,
      });
    }
    function order(o) {
      return command("sale-order", {
        sale: o.id,
        proof: buyers
          .get(o.buyer)
          .proof("order", {
            sale: o.id,
            offer: o.digest,
            reference: "pedido-" + o.id,
            at: time,
          }),
      });
    }
    function deliver(o, order, amount) {
      return command("sale-delivery", {
        sale: o.id,
        proof: buyers
          .get(o.buyer)
          .proof("delivery", {
            sale: o.id,
            offer: o.digest,
            order: order.document,
            recoveryCents: amount,
            reference: "entrega-" + o.id,
            source: hash(["acta", o.id]),
            at: time,
          }),
      });
    }
    function statement(lines, amount) {
      const a = e.desk.read().sales.accounts.get("cuenta");
      return command("sale-bank", {
        account: "cuenta",
        proof: bank.proof("statement", {
          account: "cuenta",
          previous: a.tip,
          currency: "MXN",
          from: a.until,
          until: time + 1,
          opening: a.balance,
          closing: amount,
          lines,
          source: hash(["extracto", a.tip, lines]),
        }),
      });
    }
    function close(o, minutes = 1) {
      const current = e.desk.read().sales.offers.get(o.id),
        a = e.desk.read().sales.accounts.get("cuenta");
      return command("sale-close", {
        sale: o.id,
        through: a.until,
        minutes,
        hourlyCents: 60,
        evidence: hash(["horas", o.id, a.tip, minutes]),
        previous: current.close?.digest ?? null,
      });
    }
    const line = (id, kind, cents, sale = null, original = null) => ({
      id,
      kind,
      cents,
      sale,
      original,
      at: time,
    });
    return {
      ...e,
      command,
      bank,
      buyers,
      client,
      offer,
      order,
      deliver,
      statement,
      closeSale: close,
      line,
      now: () => time,
      advance: (ms = 1000) => (time += ms),
    };
  } catch (err) {
    e.close();
    throw err;
  }
}
export async function pilotDemo() {
  const dir = mkdtempSync(join(tmpdir(), "semar-sale-"));
  let env;
  try {
    env = await pilotBook(join(dir, "state.sqlite"));
    const e = env;
    e.client("cliente-a");
    e.client("cliente-b");
    const a = e.offer("propuesta-a", "cliente-a"),
      b = e.offer("propuesta-b", "cliente-b");
    const orderA = e.order(a),
      orderB = e.order(b);
    e.advance();
    const first = e.deliver(a, orderA, 150),
      second = e.deliver(b, orderB, 160);
    const lines = [
      e.line("ingreso-a", "fee", first.fee, a.id),
      e.line("ingreso-b", "fee", second.fee, b.id),
      e.line("insumo-a", "cost", 2, a.id),
      e.line("insumo-b", "cost", 2, b.id),
      e.line("gasto-fabrica", "research", 2, null, "producto"),
      e.line("comun", "overhead", 1),
    ];
    e.statement(lines, 90 + first.fee + second.fee - 7);
    e.closeSale(a);
    e.closeSale(b);
    const initial = e.desk.sales("DEMONSTRATION");
    assert.equal(initial.campaignNetCents, first.fee + second.fee - 9);
    assert.equal(initial.independentPayingGroups, 2);
    assert.equal(e.desk.sales().bankCollectedCents, 0);
    e.advance();
    e.statement(
      [e.line("devolucion-a", "refund", first.fee, a.id, "ingreso-a")],
      90 + second.fee - 7,
    );
    assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, null);
    e.closeSale(a);
    e.closeSale(b);
    const updated = e.desk.sales("DEMONSTRATION");
    assert.equal(updated.independentPayingGroups, 1);
    return {
      mode: "DEMONSTRATION",
      initial,
      afterRefund: updated,
      live: e.desk.sales(),
      audit: (await e.desk.audit()).status,
    };
  } finally {
    env?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await pilotDemo(), null, 2));
