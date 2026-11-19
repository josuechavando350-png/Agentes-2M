import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { Semar } from "../src/semar.mjs";
import { canonical, digest } from "../src/policy.mjs";
import { traceSources } from "../src/field-lab.mjs";
import exam from "../evidence/metodos-negocio.json" with { type: "json" };
import { admittedForecast } from "../src/market-methods.mjs";

const facts = {
  buyer: "Empresa",
  prior_spend_mxn_cents: 8000,
  authority: "Compras",
  access: "yes",
  alternative: "Manual",
  scope: "Conciliar",
  price_mxn_cents: 2000,
  cost_mxn_cents: 1000,
  delivery_days: 2,
  acceptance: "Firma de recepción",
};
const document = (id, subject, values) => ({
  id,
  source: "expediente/" + id,
  rows: Object.entries(values).map(([field, value]) => ({
    subject,
    field,
    value,
  })),
});
async function start(t) {
  let i = 0,
    now = 1800000000000;
  const s = new Semar(":memory:", { clock: () => now });
  t.after(() => s.close());
  const run = (c, key = "op-" + ++i) => s.command(key, c);
  await run({ type: "init", reserve: 5000 });
  await run({ type: "open_mission", mission: "uno", budget: 1000 });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  await run({
    type: "settlement_key",
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  });
  const seal = (type, record) => ({
    type,
    record,
    signature: sign(null, Buffer.from(canonical(record)), privateKey).toString(
      "base64",
    ),
  });
  const review = async (subject, values = facts, size = 1) => {
    await run({
      type: "admit_source",
      document: document("d-" + subject, subject, values),
    });
    return (
      await run({ type: "business_review", mission: "uno", size, subject })
    ).detail;
  };
  return {
    s,
    run,
    review,
    seal,
    advance: () => (now += 86400000),
    at: () => now,
  };
}
function restore(s) {
  const cp = s.checkpoint(),
    copy = new Semar(":memory:");
  try {
    copy.restore(cp.events, cp.tip);
    assert.deepEqual(copy.fieldTrials(), s.fieldTrials());
    assert.deepEqual(copy.status(), s.status());
  } finally {
    copy.close();
  }
}
const arm = (method, supported, expectedNetCents) => ({
  method,
  field: "access",
  supported,
  missing: "HOLD",
  probe: "Verificar acceso escrito",
  minutes: 6,
  outlayCents: 25,
  expectedPaidBps: 2000,
  expectedNetCents,
});
test("randomized field policy uses signed costs, all assigned buyers, isolated scope and late corrections", async (t) => {
  const { s, run, review, seal, advance, at } = await start(t),
    pairs = Array.from({ length: 6 }, (_, i) => ["u" + i, "v" + i]);
  for (const subject of pairs.flat()) await review(subject);
  const r = {
    mission: "uno",
    id: "ensayo",
    scope: "segmento-a",
    pairs,
    control: arm("base", "ASK", 100),
    candidate: arm("nueva", "OFFER", 140),
    consent: "permiso-privado-123",
    days: 1,
    hourlyCents: 600,
    availableCashCents: 1020,
    availableMinutes: 72,
    minLiftCents: 50,
  };
  assert.deepEqual(s.fieldLesson("otro").active, null);
  await assert.rejects(
    run(seal("trial_open", { ...r, availableCashCents: 1019 })),
    /insuficiente/,
  );
  await assert.rejects(
    run({ ...seal("trial_open", r), signature: "bad" }),
    /firmada/,
  );
  const req = seal("trial_open", r),
    frozen = await run(req, "abrir");
  assert.deepEqual(await run(req, "abrir"), frozen);
  const units = frozen.pairs.flat();
  assert.equal(units.filter((u) => u.arm === "control").length, 6);
  const occurredAt = at() + 500;
  function close(
    subject,
    settlements = [],
    previous = null,
    evidence = "cierre-" + subject,
  ) {
    return seal("trial_observed", {
      trial: r.id,
      subject,
      previous,
      settlements,
      humanMinutes: 6,
      applied: true,
      delivered: true,
      evidence,
    });
  }
  await assert.rejects(run(close(units[0].subject)), /ventana/);
  advance();
  const settle = (subject, stage, cents, reference) =>
    run(
      seal("business_settlement", {
        mission: "uno",
        subject,
        sale: subject,
        stage,
        cents,
        reference,
        currency: "MXN",
        contributors: [1],
      }),
    );
  const proofs = new Map(),
    closes = new Map();
  for (const u of units) {
    const lines = [];
    if (u.arm === "candidate") {
      for (const [stage, category, cents] of [
        ["paid", "payment", 390],
        ["expense", "cost", 50],
        ["expense", "refund", 40],
      ]) {
        const reference = u.subject + category;
        await settle(u.subject, stage, cents, reference);
        lines.push({ stage, category, reference, occurredAt });
      }
      await assert.rejects(run(close(u.subject)), /incompleta/);
    }
    assert.equal(s.fieldTrials()[0].status, "AWAIT_EVIDENCE");
    const x = await run(close(u.subject, lines));
    proofs.set(u.subject, lines);
    closes.set(u.subject, x.revision);
  }
  const final = s.fieldTrials()[0];
  assert.equal(final.status, "QUALIFIED_IN_SCOPE");
  assert.equal(final.incrementalNetPerPairCents, 300);
  assert.equal(final.netForecastErrorCents.candidate, 100);
  assert.equal(final.oneSidedSignP, 1 / 64);
  assert.equal(s.fieldLesson(r.scope).active.method, "nueva");
  assert.equal(s.fieldLesson("otro").active, null);
  const subject = units.find((u) => u.arm === "candidate").subject;
  await settle(subject, "expense", 10000, "devolucion");
  assert.equal(s.fieldTrials()[0].status, "AWAIT_EVIDENCE");
  assert.equal(s.fieldLesson(r.scope).active.method, "base");
  const lines = proofs.get(subject).concat([
    {
      stage: "expense",
      category: "refund",
      reference: "devolucion",
      occurredAt,
    },
  ]);
  await run(close(subject, lines, closes.get(subject), "cierre-corregido"));
  assert.equal(s.fieldTrials()[0].status, "KEEP_CONTROL");
  assert.equal(s.fieldLesson(r.scope).active.method, "base");
  restore(s);
});
test("independent roots, rival questions, executable delivery and documented cancellation survive replay", async (t) => {
  const { s, run, seal, review } = await start(t);
  const good = await review("cliente", facts, 10);
  await run(
    seal("source_lineage", {
      mission: "uno",
      document: "d-cliente",
      sha256: good.checks.access.refs[0].sha256,
      roots: ["orden-original"],
    }),
  );
  assert.equal(
    s.fieldHypotheses("cliente").experiments[0].lineage.attestedIndependent,
    1,
  );
  assert.deepEqual(
    traceSources(
      {
        lineage: [
          { sha256: "1", roots: ["a"] },
          { sha256: "2", roots: ["b"] },
          { sha256: "3", roots: ["a", "b"] },
        ],
      },
      ["1", "2", "3", "4", "4"].map((sha256) => ({ sha256 })),
    ),
    { attestedIndependent: 1, untraced: 1, roots: [["a", "b"]] },
  );
  const cmd = { mission: "uno", subject: "cliente", review: digest(good) };
  const suite = {
    documents: [document("examen", "nuevo", { precio: 500, costo: 300 })],
    cases: [
      { subject: "nuevo", status: "SUPPORTED", value: 200 },
      { subject: "desconocido", status: "UNKNOWN", value: null },
    ],
  };
  const salt = "sal reservada para muestra nueva";
  await run({
    type: "admit_source",
    document: document("insumos", "partida", { precio: 40, costo: 35 }),
  });
  for (const [subject, precio, costo] of [
    ["aprendiz-a", 90, 20],
    ["aprendiz-b", 45, 24],
  ]) {
    await run({
      type: "admit_source",
      document: document(subject, subject, { precio, costo }),
    });
  }
  const spec = {
    ...cmd,
    id: "producto",
    spec: {
      examples: [
        { subject: "aprendiz-a", value: 70 },
        { subject: "aprendiz-b", value: 21 },
      ],
    },
    documents: ["insumos", "aprendiz-a", "aprendiz-b"],
    subjects: ["partida"],
    testHash: digest([salt, suite]),
  };
  await assert.rejects(
    run(
      seal("delivery_spec", {
        ...spec,
        spec: {
          examples: [
            { subject: "aprendiz-a", value: 123 },
            { subject: "aprendiz-b", value: 21 },
          ],
        },
      }),
    ),
    /receta única/,
  );
  const frozen = await run(seal("delivery_spec", spec));
  assert.deepEqual(frozen.program, {
    version: 1,
    op: "difference",
    fields: ["precio", "costo"],
  });
  const built = await run({
    type: "delivery_build",
    mission: "uno",
    id: "producto",
  });
  assert.equal(built.artifact.rows[0].value, 5);
  assert.equal(built.artifact.rows[0].refs.length, 2);
  const accepted = {
    mission: "uno",
    id: "producto",
    artifact: built.artifact.sha256,
    suite,
    salt,
    buyerAccepted: true,
    evidence: "aceptacion-firmada",
  };
  await assert.rejects(
    run(seal("delivery_accept", { ...accepted, salt: "otro" })),
    /Examen/,
  );
  assert.equal(
    (await run(seal("delivery_accept", accepted))).status,
    "DELIVERY_ACCEPTED",
  );
  assert.equal(s.pilotProduct("uno", "producto").exam.correct, 2);
  const p = {
    ...cmd,
    id: "gasto",
    sponsor: 6543,
    cents: 950,
    reference: "permiso-de-gasto",
  };
  await run(seal("risk_pledge", p));
  const bad = await review("cliente", { ...facts, access: "no" }, 10);
  const reward = seal("truth_reward", {
    mission: "uno",
    pledge: p.id,
    review: digest(bad),
    reason: "ACCESS_DENIED",
    cancellation: "orden-cancelada",
    avoidedCents: 950,
  });
  const receiver = bad.checks.access.actor,
    before = s.agent(receiver).balance,
    spent = s.status().spent;
  assert.equal((await run(reward)).status, "VERIFIED_REFUTATION");
  assert.equal(s.agent(receiver).balance, before + 1);
  assert.equal(s.agent(p.sponsor).balance, 9);
  assert.equal(s.status().spent, spent);
  await assert.rejects(run(reward), /reutilizada/);
  restore(s);
});
test("operational forecasts reject a model without an admitted exam", () => {
  assert.throws(() => admittedForecast({}, {}, exam.candidate), /sin examen/);
});
