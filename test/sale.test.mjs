import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hash } from "../src/factory/reader.mjs";
import {
  traceCredits,
  verifyCredits,
  creditRange,
} from "../src/sale/credits.mjs";
import { fee, cost, boundaries, chooseOffer } from "../src/sale/pricing.mjs";
import { planInquiry } from "../src/sale/investigation.mjs";
import { pilotBook, pilotDemo, party } from "../scripts/sale/pilot.mjs";
import { corpus } from "../scripts/factory/fixtures.mjs";
import { discover, predictExam } from "../src/factory/discover.mjs";
import { exampleBook } from "../scripts/global/demo.mjs";
import { combineWeeks } from "../src/sale/portfolio.mjs";

function folder(t) {
  const d = mkdtempSync(join(tmpdir(), "semar-ventas-test-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, "libro.sqlite");
}
function ledger(rows, days = 1) {
  const start = 1600000000000,
    unit = 3600000;
  return {
    source: hash("un original"),
    currency: "MXN",
    from: start,
    until: start + 100 * unit,
    maxAgeDays: days,
    lines: rows.map(([h, qty], i) => ({
      id: "r-" + i,
      party: "cliente",
      sku: "pieza",
      invoice: "orden-" + i,
      row: i + 2,
      price: 90,
      qty,
      time: start + h * unit,
    })),
  };
}
function exhaustive(packet, id) {
  const sale = packet.lines.filter((x) => x.qty > 0),
    credit = packet.lines.filter((x) => x.qty < 0);
  const slots = credit.flatMap((c) => Array(-c.qty).fill(c));
  const left = sale.map((l) => l.qty);
  let best = -1,
    min = 0,
    max = 0;
  function visit(i, n, target) {
    if (i === slots.length) {
      if (n > best) {
        best = n;
        min = target;
        max = target;
      } else if (n === best) {
        min = Math.min(min, target);
        max = Math.max(max, target);
      }
      return;
    }
    visit(i + 1, n, target);
    const c = slots[i];
    for (const [j, l] of sale.entries())
      if (
        left[j] > 0 &&
        l.time < c.time &&
        l.time >= c.time - packet.maxAgeDays * 86400000
      ) {
        left[j]--;
        visit(i + 1, n + 1, target + Number(c.id === id));
        left[j]++;
      }
  }
  visit(0, 0, 0);
  return { best, min, max };
}
test("Flujo y certificado de cancelaciones coinciden con todas las asignaciones posibles", () => {
  for (let seed = 0; seed < 120; seed++) {
    let r = seed + 1;
    const draw = (k) => (r = (r * 1664525 + 1013904223) >>> 0) % k;
    const p = ledger([
      ...Array.from({ length: 3 }, () => [draw(48), 1 + draw(2)]),
      ...Array.from({ length: 3 }, () => [draw(65), -1 - draw(2)]),
    ]);
    const { report, certificate } = traceCredits(p);
    assert.deepEqual(verifyCredits(p, certificate), report);
    for (const c of p.lines.filter((l) => l.qty < 0)) {
      const { best, min, max } = exhaustive(p, c.id),
        range = creditRange(p, c.id);
      assert.equal(report.backedUnits, best);
      assert.deepEqual([range.minBacked, range.maxBacked], [min, max]);
    }
  }
  const p = ledger([
      [0, 2],
      [1, -1],
      [2, -2],
    ]),
    r = traceCredits(p),
    wrong = structuredClone(r.certificate);
  wrong.groups[0].cover = { sales: [], credits: [] };
  assert.throws(() => verifyCredits(p, wrong));
  const fake = structuredClone(r.certificate);
  fake.groups[0].matches[0].units = 3;
  assert.throws(() => verifyCredits(p, fake));
  p.lines.push({ ...p.lines[0], id: "otro" });
  assert.throws(() => traceCredits(p), /repetida/);
});
test("La comisión contingente demuestra los extremos incluso al cruzar su tope con redondeos", () => {
  for (let i = 0; i < 18; i++) {
    const o = {
      id: "resultado",
      capCents: 8000 + i * 127,
      shareBps: 1000 + i * 103,
      variableCostBps: i * 79,
      fixedCostCents: i,
    };
    const lo = 100 + i,
      hi = 120000 + i;
    let min = Infinity,
      max = -Infinity;
    for (let n = lo; n <= hi; n++) {
      const m = fee(n, o) - cost(n, o);
      min = Math.min(min, m);
      max = Math.max(max, m);
    }
    const b = boundaries(o, lo, hi);
    assert.deepEqual([b.lower, b.upper], [min, max]);
    assert.equal(fee(b.minAt, o) - cost(b.minAt, o), min);
  }
  const c = {
    id: "caro",
    capCents: 200,
    shareBps: 8000,
    variableCostBps: 0,
    fixedCostCents: 30,
  };
  const p = chooseOffer(
    {
      floorCents: 0,
      ceilingCents: 200,
      buyerFeeLimitCents: 50,
      buyerKeepsBps: 3000,
      options: [c],
    },
    300,
    10,
  );
  assert.equal(p.status, "NEED_TERMS");
  assert.equal(p.candidates[0].reasons.length, 3);
});
function inquiry() {
  return {
    id: "recuperacion",
    actions: ["esperar", "reclamar"],
    worlds: [
      { id: "correcto", net: { esperar: 0, reclamar: -100 } },
      { id: "exceso", net: { esperar: 0, reclamar: 100 } },
    ],
    documents: [
      {
        id: "tarifa",
        question: "¿Qué tarifa firmó el proveedor?",
        roots: ["proveedor"],
        cents: 2,
        minutes: 2,
        readings: { correcto: "normal", exceso: "distinta" },
      },
      {
        id: "copia",
        question: "Revisar el duplicado",
        roots: ["proveedor"],
        cents: 4,
        minutes: 1,
        readings: { correcto: "normal", exceso: "distinta" },
      },
      {
        id: "recibo",
        question: "¿Qué confirmó el comprador?",
        roots: ["comprador"],
        cents: 3,
        minutes: 1,
        readings: { correcto: "normal", exceso: "distinta" },
      },
    ],
    observed: [],
    budgetCents: 10,
    minutes: 20,
    minIndependent: 1,
  };
}
test("Investigación minimax exige pruebas independientes y reabre mundos contradictorios", () => {
  const q = inquiry();
  let p = planInquiry(q);
  assert.equal(p.next, "tarifa");
  assert.equal(p.worstRegretCents, 2);
  assert.equal(p.bestWithoutAnotherDocument, 100);
  q.observed = [
    { id: "tarifa", answer: "distinta", evidence: hash("original") },
  ];
  assert.equal(planInquiry(q).next, "reclamar");
  q.minIndependent = 2;
  assert.equal(planInquiry(q).next, "recibo");
  q.observed.push({ id: "copia", answer: "distinta", evidence: hash("copia") });
  assert.equal(planInquiry(q).next, "recibo");
  q.observed.push({ id: "recibo", answer: "normal", evidence: hash("recibo") });
  assert.equal(planInquiry(q).status, "CONTRADICTORY_EVIDENCE");
  const nothing = inquiry();
  nothing.budgetCents = 0;
  assert.equal(planInquiry(nothing).next, "esperar");
});
test("Una investigación firmada enlaza el costo y la fuente exacta, se reproduce y caduca al cambiarla", async (t) => {
  let now = 1800000000000;
  const e = await exampleBook(folder(t), () => now);
  t.after(() => e.close());
  e.command("open", "abrir", e.grant);
  const spec = inquiry();
  e.command("probe-reserve", "primero", { spec, cap: 4 });
  const initial = await e.desk.work("primero");
  assert.equal(initial.inquiry.next, "tarifa");
  e.command("settle", "pagar", {
    job: "primero",
    cents: 2,
    reference: "recibo-tarifa",
  });
  const src = {
    scope: spec.id,
    document: {
      id: "original",
      source: "sistema-documental",
      rows: [{ subject: spec.id, field: "tarifa", value: "distinta" }],
    },
    from: now,
    until: now + 10000,
    previous: null,
    roots: ["proveedor"],
    method: "contrato",
    assumptions: [],
    schema: { tarifa: { unit: "clase", stage: "documentado" } },
  };
  const v = e.command("source", "fuente", src).data.version;
  const follow = {
    job: "primero",
    source: "original",
    document: "tarifa",
    answer: "distinta",
    version: v,
    cap: 4,
  };
  assert.throws(
    () =>
      e.command("probe-observe", "invalida", { ...follow, answer: "normal" }),
    /inequívoca/,
  );
  e.command("probe-observe", "segundo", follow);
  assert.equal((await e.desk.work("segundo")).inquiry.next, "reclamar");
  assert.throws(
    () => e.command("probe-observe", "otro", follow),
    /continuación/,
  );
  assert.equal((await e.desk.replay("segundo")).verified, true);
  now += 11000;
  assert.equal((await e.desk.delivery("segundo")).action, "REVIEW_REQUIRED");
  assert.equal((await e.desk.audit()).status, "VERIFIED");
});
test("El cierre comercial distingue cobros, margen, reembolsos y dinero de prueba", async () => {
  const x = await pilotDemo();
  assert.equal(x.audit, "VERIFIED");
  assert.equal(x.live.bankCollectedCents, 0);
  assert.equal(x.initial.campaignNetCents, 53);
  assert.equal(x.afterRefund.campaignNetCents, 23);
  assert.equal(x.initial.scopes[0].netLowerCents, 53);
});
test("Firmas, pedidos, costos compartidos y pérdidas se concilian de extremo a extremo", async (t) => {
  const e = await pilotBook(folder(t));
  t.after(() => e.close());
  e.client("ana");
  e.client("bea");
  const a = e.offer("a", "ana"),
    b = e.offer("b", "bea");
  assert.match(e.desk.quote("a").text, /comisión/);
  const bad = e.buyers
    .get("bea")
    .proof("order", {
      sale: a.id,
      offer: a.digest,
      reference: "pedido",
      at: e.now(),
    });
  assert.throws(
    () => e.command("sale-order", { sale: a.id, proof: bad }),
    /firma/,
  );
  const plan = e.desk.bestSale({
    offers: ["a", "b"],
    work: {
      a: { minutes: 1, preparationCents: 1 },
      b: { minutes: 1, preparationCents: 1 },
    },
    minutes: 1,
    maxOutlayCents: 10,
    maxLossCents: 1,
    worlds: [
      { id: "uno", source: hash(1), recovery: { a: 200, b: 20 } },
      { id: "dos", source: hash(2), recovery: { a: 130, b: null } },
    ],
  });
  assert.deepEqual(plan.selected, ["a"]);
  assert.equal(plan.worstNetCents, -1);
  const o = e.order(a);
  e.advance();
  const delivery = e.deliver(a, o, 150);
  const lines = [e.line("pago", "fee", delivery.fee, a.id)];
  assert.throws(() => e.statement(lines, 1), /saldos/);
  e.statement(lines, 120);
  e.closeSale(a);
  assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, null);
  e.advance();
  assert.throws(
    () => e.statement([e.line("pago", "fee", delivery.fee, a.id)], 150),
    /duplicado/,
  );
  assert.throws(
    () => e.statement([e.line("ret", "refund", 31, a.id, "pago")], 89),
    /superior/,
  );
  const wrong = e.line("gasto-fabrica", "research", 3, null, "producto");
  assert.throws(() => e.statement([wrong], 117), /conciliado/);
  e.command("sale-decline", {
    sale: b.id,
    proof: e.buyers
      .get("bea")
      .proof("decline", {
        sale: b.id,
        offer: b.digest,
        at: e.now(),
        reference: "no-b",
      }),
  });
  e.statement(
    [
      e.line("gasto-fabrica", "research", 2, null, "producto"),
      e.line("costo-b", "cost", 3, b.id),
    ],
    115,
  );
  e.closeSale(a, 1);
  e.closeSale(b, 4);
  assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, 20);
  assert.equal((await e.desk.audit()).status, "VERIFIED");
});
test("El padrón a cero permite conciliar pruebas recibidas y bloquea nuevas obligaciones", async (t) => {
  const e = await pilotBook(folder(t));
  t.after(() => e.close());
  e.client("cliente");
  const a = e.offer("a", "cliente"),
    order = e.order(a);
  e.command("factory-reserve", {
    cap: 98,
    project: corpus("cierre-distinto").project,
  });
  const job = [...e.desk.read().jobs.values()].at(-1);
  await e.desk.work(job.id);
  e.command("settle", { job: job.id, cents: 98, reference: "final" });
  assert.equal(e.desk.view().status, "DEAD");
  assert.throws(() => e.offer("otra", "cliente"), /presupuesto cero/);
  e.advance();
  e.deliver(a, order, 120);
  e.statement([e.line("cobro-final", "fee", 24, a.id)], 114);
  assert.equal(e.desk.sales("DEMONSTRATION").bankCollectedCents, 24);
});
test("Libros repetidos, extractos solapados y firmas sin grupo independiente impiden declarar réplica", () => {
  const week = (i) => ({
    book: "m-" + i,
    authority: "tesoreria",
    tip: "tip-" + i,
    currency: "MXN",
    mode: "LIVE",
    programs: { p: "credito" },
    buyers: { c: { group: "g-" + i, signer: "k-" + i } },
    windows: [{ source: "bank", from: i * 1e9, until: (i + 1) * 1e9 }],
    receipts: ["ref-" + i],
    report: {
      scopes: [{ scope: "credito", netLowerCents: 33 }],
      campaignNetCents: 33,
      bankCollectedCents: 40,
      deals: [
        {
          state: "POSITIVE_DIRECT_MARGIN",
          job: "p",
          buyer: "c",
          quotedAt: i * 1e9,
          pilot: "ensayo",
          program: "r",
        },
      ],
      randomizedTrials: [
        {
          id: "ensayo",
          scope: "credito",
          status: "BANK_MATCHED_INCREMENTAL_MARGIN",
          from: i * 1e9,
          until: (i + 1) * 1e9,
          control: "control",
          candidate: "nueva",
        },
      ],
    },
  });
  const a = week(1),
    b = week(2);
  assert.equal(
    combineWeeks([a, b]).status,
    "REPLICATED_INCREMENTAL_MARGIN_IN_SCOPE",
  );
  assert.throws(() => combineWeeks([a, a]));
  assert.throws(() => combineWeeks([a, { ...b, receipts: a.receipts }]));
  assert.throws(() => combineWeeks([a, { ...b, windows: a.windows }]));
  b.buyers.c.signer = a.buyers.c.signer;
  assert.equal(combineWeeks([a, b]).repeated, false);
});
test("Se conserva la semilla que detectó una duplicación entre expedientes de examen", () => {
  const f = corpus("355e335641480f369092a4c5/9835");
  assert.equal(
    predictExam(discover(f.project), f.batches).frozen.batches.length,
    3,
  );
});
