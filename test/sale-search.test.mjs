import test from "node:test";
import assert from "node:assert/strict";
import { act, adjusted, catalogue, fitResponse } from "../src/sale/policy.mjs";
import {
  histogramSearch,
  runNative,
  prepareSearch,
  gradeSearch,
  explainFounder,
  recommendTrial,
} from "../src/sale/search.mjs";
import { priceEvidence, freezePrices } from "../src/sale/diagnose.mjs";
import {
  creditRegister,
  creditRange,
  traceCredits,
} from "../src/sale/credits.mjs";
import { importCreditCsv, registerCsv } from "../src/sale/credit-csv.mjs";
import { hash } from "../src/factory/reader.mjs";

const design = {
  actions: ["espera", "a", "b"],
  fields: [
    { id: "x", cuts: [1, 2] },
    { id: "z", cuts: [2, 3] },
  ],
  costs: [0, 0, 0],
  currency: "MXN",
  response: "valor",
  randomization: "equal-thirds",
};
const rows = (from, n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "r-" + (i + from),
    x: [i % 4, ((i + from) >> 2) % 4],
    arm: i % 3,
    y: 73,
  }));
const packet = {
  design,
  fit: rows(0, 60),
  search: rows(100, 60),
  validation: rows(200, 60),
  holdout: rows(300, 60).map(({ id, x }) => ({ id, x })),
  limits: [3, 30],
};
const layout = {
  profiles: Array.from({ length: 10 }, (_, i) => ({
    sector: i + 1,
    status: "LIVE",
    balance: 3,
  })),
  runs: Array.from({ length: 10 }, (_, i) => ({
    index: i,
    last: (i + 1) * 10000,
    founder: true,
  })),
  checkpoint: hash("local"),
};

test("Todos los puntajes y los sellos por fundador son invariantes al orden de los hilos", () => {
  const model = fitResponse(design, packet.fit),
    data = packet.search.map((r) =>
      adjusted({ ...r, y: r.x[1] * (r.arm + 1) }, model, design),
    ),
    rules = catalogue(design, 70);
  const oracle = rules.map((rule) =>
    data.reduce((v, r) => v + r.scores[act(rule, r.flags)], 0),
  );
  assert.deepEqual(histogramSearch(data, rules).sums, oracle);
  const a = runNative(layout, data, rules, 1, true),
    b = runNative(layout, data, rules, 7, true),
    c = runNative(layout, data, rules, 4, false);
  assert.deepEqual(a.total, oracle);
  assert.deepEqual(c.total, oracle);
  assert.deepEqual(a.sectors, b.sectors);
  assert.throws(
    () =>
      runNative(
        {
          ...layout,
          profiles: layout.profiles.map((p) => ({ ...p, balance: 0 })),
        },
        data,
        rules,
        1,
        true,
      ),
    /retirado/,
  );
});
test("La ruta comprimida conserva las decisiones selladas y el control ante un efecto nulo", () => {
  const booked = prepareSearch(layout, packet),
    quick = prepareSearch(null, packet, "compressed");
  assert.equal(booked.seal, quick.seal);
  assert.equal(booked.execution, "population");
  assert.equal(quick.execution, "compressed");
  assert.equal(quick.measurements.at(-1).participants, 0);
  assert.deepEqual(
    booked.measurements.map((r) => r.scoresHash),
    quick.measurements.map((r) => r.scoresHash),
  );
  const labels = rows(300, 60).map(({ id, arm, y }) => ({ id, arm, y }));
  const grade = gradeSearch(booked, packet.holdout, labels.toReversed());
  assert.equal(grade.selected, "simple");
  assert.equal(grade.selectedVsNoContact.mean, 0);
  assert.equal(grade.relativeToSimple, "KEEP_SIMPLE");
  assert.equal(explainFounder(booked, packet, 1800, 1).customer, "r-100");
  assert.equal(
    recommendTrial(quick, [{ id: "nuevo", x: [1, 2] }], quick.recipeHash)
      .offers[0].sameDecision,
    true,
  );
  assert.throws(() =>
    recommendTrial(quick, [{ id: "nuevo", x: [1, 2] }], "bad"),
  );
  assert.throws(() => gradeSearch(booked, packet.holdout, labels.slice(1)));
  assert.throws(() =>
    gradeSearch(booked, packet.holdout, [
      { ...labels[0], x: [1, 2] },
      ...labels.slice(1),
    ]),
  );
  assert.throws(() =>
    gradeSearch({ ...booked, seal: "bad" }, packet.holdout, labels),
  );
  const reused = structuredClone(packet);
  reused.holdout[0].id = reused.search[0].id;
  assert.throws(() => prepareSearch(null, reused, "compressed"));
});
test("Se descartan precios futuros, referencias repetidas y periodos de entrenamiento reutilizados", () => {
  const c = {
    id: "p",
    invoice: "a",
    sku: "pieza",
    store: "s",
    row: 2,
    day: "2020-02-04",
    listed: 300,
    units: 2,
    prior: [
      {
        invoice: "b",
        row: 3,
        sku: "pieza",
        unit: 100,
        store: "t",
        day: "2020-02-03",
      },
    ],
  };
  assert.equal(priceEvidence(c).recent, 100);
  for (const q of [
    { day: c.day },
    { sku: "otra" },
    { row: c.row },
    { invoice: c.invoice },
  ]) {
    assert.throws(() =>
      priceEvidence({ ...c, prior: [{ ...c.prior[0], ...q }] }),
    );
  }
  assert.throws(() =>
    priceEvidence({
      ...c,
      prior: [...c.prior, { ...c.prior[0], invoice: "c", row: 4 }],
    }),
  );
  assert.throws(() =>
    freezePrices({ latestTrainingDay: c.day }, [
      { id: "de-nuevo", cases: [c] },
    ]),
  );
});
test("El registro completo atribuye los mismos límites por nota que tres pruebas independientes de flujo", () => {
  for (let seed = 0; seed < 100; seed++) {
    let random = seed + 3;
    const draw = (n) =>
      (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) % n;
    const p = {
      source: hash(seed),
      currency: "MXN",
      from: 0,
      until: 100 * 86400000,
      maxAgeDays: 1 + draw(12),
      lines: Array.from({ length: 36 }, (_, i) => ({
        id: "l" + i,
        invoice: "I" + i,
        party: "p",
        sku: "s",
        price: 90,
        row: i + 2,
        qty: (i % 2 === 0 ? 1 : -1) * (1 + draw(14)),
        time: draw(40) * 86400000,
      })),
    };
    const register = creditRegister(p),
      total = traceCredits(p).report;
    assert.ok(register.unavoidableCents <= total.unmatchedValueCents);
    for (const c of register.rows) {
      const separate = creditRange(p, c.id);
      assert.deepEqual(
        [c.minBacked, c.maxBacked],
        [separate.minBacked, separate.maxBacked],
      );
    }
  }
});
test("El adaptador de CSV conserva renglones físicos, exige moneda y fechas completas y neutraliza fórmulas en la salida", () => {
  const fields = {
    id: "id",
    party: "cuenta",
    sku: "sku",
    price: "precio",
    qty: "unidades",
    time: "fecha",
    invoice: "factura",
    currency: "moneda",
  };
  const config = {
    currency: "MXN",
    from: "2020-02-01T00:00:00Z",
    until: "2020-03-01T00:00:00Z",
    maxAgeDays: 15,
    fields,
    delimiter: ";",
    decimal: ",",
  };
  const csv =
    '\ufeffid;cuenta;sku;precio;unidades;fecha;factura;moneda\r\na;"p;uno";s;1,25;2;2020-02-01T01:00:00Z;"v\r\n1";MXN\r\nb;"p;uno";s;1,25;-3;2020-02-02T01:00:00Z;=comando;MXN\r\n';
  const input = Buffer.from(csv),
    p = importCreditCsv(input, config);
  assert.deepEqual(
    p.lines.map((l) => [l.row, l.price]),
    [
      [2, 125],
      [4, 125],
    ],
  );
  assert.ok(registerCsv(creditRegister(p)).includes("'=comando"));
  for (const bad of [
    csv.replace("2020-02-02", "2020-02-31"),
    csv.replace("MXN\r", "USD\r"),
    csv.replace("1,25", "1,258"),
    csv.replace("a;", 'aX";'),
  ])
    assert.throws(() => importCreditCsv(Buffer.from(bad), config));
});
