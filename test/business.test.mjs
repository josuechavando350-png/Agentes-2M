import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonical, digest } from "../src/policy.mjs";
import { Semar } from "../src/semar.mjs";
import {
  accountForecast,
  allocate,
  gradeAccounts,
  improves,
  signals,
} from "../src/account-market.mjs";
async function boot(t) {
  let time = 1800000000000,
    i = 0;
  const s = new Semar(":memory:", { clock: () => time });
  t.after(() => s.close());
  const run = (c, key = "op-" + ++i) => s.command(key, c);
  await run({ type: "init", reserve: 1000 });
  await run({ type: "open_mission", mission: "uno", budget: 1000 });
  return { s, run, later: () => (time += 8 * 86400000) };
}
const facts = {
  buyer: "Taller",
  prior_spend_mxn_cents: 60000,
  authority: "Dirección",
  alternative: "Manual",
  access: "yes",
  scope: "Conciliar 20 expedientes",
  price_mxn_cents: 50000,
  cost_mxn_cents: 12000,
  delivery_days: 4,
  acceptance: "Entrega de conciliación firmada",
};
const doc = (id, values, subject = "alfa") => ({
  type: "admit_source",
  document: {
    id,
    source: "expediente/" + id,
    rows: Object.entries(values).map(([field, value]) => ({
      field,
      value,
      subject,
    })),
  },
});
const review = {
  type: "business_review",
  size: 10,
  subject: "alfa",
  mission: "uno",
};
test("ten sectors cite evidence, queue revisions, abstain on conflicts and veto losing pilots", async (t) => {
  const { s, run } = await boot(t);
  await run(doc("valores", facts));
  await run(
    doc("otro", { buyer: "Otro", prior_spend_mxn_cents: 2000 }, "beta"),
  );
  assert.equal(s.businessQueue()[0].subject, "alfa");
  const a = await run(review, "revisar");
  assert.equal(a.detail.decision, "PILOT");
  assert.equal(a.detail.offer.expectedMarginMxnCents, 38000);
  assert.equal(
    new Set(a.detail.actors.map((id) => s.agent(id).sector)).size,
    10,
  );
  assert.equal(a.detail.checks.price_mxn_cents.refs[0].document, "valores");
  assert.equal(a.detail.forecast.paidProbability, null);
  assert.deepEqual(await run(review, "revisar"), a);
  assert.equal(s.mission().mission.spent, 10);
  assert.deepEqual(
    s.businessQueue().map((x) => x.subject),
    ["beta"],
  );
  await run(doc("ajuste", { price_mxn_cents: 49000 }));
  const q = await run(review);
  assert.equal(q.detail.decision, "INVESTIGATE");
  assert.equal(q.detail.offer, null);
  assert.equal(q.detail.gaps[0].reason, "CONFLICTED");
  await run(doc("valores", { ...facts, access: "no" }));
  assert.equal((await run(review)).detail.veto[0].reason, "ACCESS_DENIED");
  await run(
    doc("valores", { ...facts, price_mxn_cents: 49000, cost_mxn_cents: 60000 }),
  );
  assert.equal((await run(review)).detail.veto[0].reason, "NONPOSITIVE_MARGIN");
  const cp = s.checkpoint();
  const copy = new Semar(":memory:");
  try {
    copy.restore(cp.events, cp.tip);
    assert.deepEqual(copy.businessHistory(), s.businessHistory());
  } finally {
    copy.close();
  }
});
test("signed pilot feedback and late settlements preserve first forecast and distinguish censored cases", async (t) => {
  const { s, run, later } = await boot(t);
  await run(doc("prueba", facts));
  const a = await run(review);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await run({
    type: "settlement_key",
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  const signed = (type, record) => ({
    type,
    record,
    signature: sign(null, Buffer.from(canonical(record)), privateKey).toString(
      "base64",
    ),
  });
  const feedback = (stage, reference) =>
    signed("pilot_feedback", {
      mission: "uno",
      subject: "alfa",
      review: digest(a.detail),
      stage,
      reference,
    });
  await assert.rejects(run(feedback("accepted", "a")), /Etapa/);
  await assert.rejects(
    run({ ...feedback("sent", "s"), signature: "bad" }),
    /firmada/,
  );
  await run(feedback("sent", "envio"));
  await run(feedback("replied", "respuesta"));
  assert.equal(s.businessHistory()[0].observed, null);
  later();
  await run({ type: "pulse" });
  await run({ type: "open_mission", mission: "dos", budget: 1000 });
  await run(feedback("accepted", "aceptado"));
  const record = {
    mission: "uno",
    subject: "alfa",
    sale: "venta",
    stage: "paid",
    reference: "banco",
    currency: "MXN",
    cents: 49999,
    contributors: [a.detail.actors[0]],
  };
  await run(signed("business_settlement", record));
  await assert.rejects(
    run(signed("business_settlement", record)),
    /contabilizada/,
  );
  await run(
    signed("business_settlement", {
      ...record,
      stage: "expense",
      reference: "costo",
      cents: 10000,
    }),
  );
  assert.equal(s.businessHistory()[0].bookedNetMxnCents, 39999);
  assert.equal(s.businessHistory()[0].firstForecast.priceMxnCents, 50000);
  assert.equal(s.businessHistory()[0].observed, 1);
  await run(doc("segundo", facts));
  const next = await run({ ...review, mission: "dos" });
  assert.equal(next.detail.forecast.paidProbability, 2 / 3);
});
test("forecasts reject future evidence, rank within budget and count false abandonments", () => {
  const row = {
    id: "f",
    cutoff: "2011-10-01",
    references: [{ invoice: "123", firstRow: 2, day: "2011-09-30" }],
    features: Object.fromEntries(signals.map((s) => [s, 1])),
  };
  const model = {
    dimensions: 1,
    intercept: 0,
    mean: [0],
    scale: [1],
    weights: [1],
  };
  const r = accountForecast(row, model, [1]);
  assert.throws(() => accountForecast({ ...row, outcome: 1 }, model, [1]));
  assert.throws(
    () =>
      accountForecast(
        { ...row, references: [{ ...row.references[0], day: row.cutoff }] },
        model,
        [1],
      ),
    /corte/,
  );
  const d = allocate(
    Array.from({ length: 10 }, (_, i) => ({
      ...r,
      id: "u" + i,
      probability: (10 - i) / 10,
    })),
  );
  const labels = Object.fromEntries(d.map((p, i) => [p.id, i % 2]));
  const score = gradeAccounts(d, labels);
  assert.equal(score.pilotHits, 1);
  assert.equal(score.pilots, 2);
  assert.equal(score.missedAfterAbandon, 2);
  assert.equal(
    improves(
      { ...score, brier: score.brier - 0.1, missedAfterAbandon: 3 },
      score,
    ),
    false,
  );
});
