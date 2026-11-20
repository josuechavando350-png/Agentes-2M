import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Semar } from "../src/semar.mjs";
import { digest, canonical } from "../src/policy.mjs";
import { DecisionBook } from "../src/decision-book.mjs";
import {
  buildDecision,
  commercialList,
  gradePlan,
  verdict,
  policyId,
} from "../src/commercial-decision.mjs";
import { DAY, utc, dateAt, grade } from "../src/decision-model.mjs";
function row(id, cutoff, strong = false) {
  const n = strong ? 12 : 1,
    off = strong ? 1 : 82;
  return {
    id,
    cutoff,
    features: {
      recency: off,
      orders: n,
      gross_pence: n * 10000,
      returns_permille: 0,
      recent_orders: strong ? n : 0,
      active_weeks: strong ? 8 : 1,
      sku_count: n,
      largest_share: strong ? 120 : 1000,
      gap_days: strong ? 7 : 90,
      last_pence: 7000,
    },
    references: [
      {
        invoice: "factura-" + id,
        firstRow: 4,
        day: dateAt(utc(cutoff) - off * DAY),
      },
    ],
  };
}
function example(id = "uno", mode = "HISTORICAL", cutoff = "2022-06-01") {
  const brief = {
    id,
    merchant: "empresa",
    niche: "recompras",
    cutoff,
    mode,
    currency: "MXN",
    seats: 1,
    minutes: 14,
    minutesPerAccount: 10,
    researchCents: 25,
    source: "libro autorizado",
    trial: null,
  };
  const queries = [row("a", cutoff), row("b", cutoff), row("c", cutoff)];
  return {
    brief,
    packet: {
      niche: brief.niche,
      historical: [row("h", "2020-01-01"), row("j", "2020-01-01", true)],
      outcomes: { h: 0, j: 1 },
      queries,
    },
    probes: [
      {
        id: "verificar-b",
        account: "b",
        source: "finanzas",
        question: "¿Confirma finanzas el historial corregido?",
        minutes: 4,
        cents: 25,
        alternative: row("b", cutoff, true),
      },
      {
        id: "igual-c",
        account: "c",
        source: "finanzas",
        question: "¿Se conserva la misma factura?",
        minutes: 2,
        cents: 15,
        alternative: row("c", cutoff),
      },
    ],
  };
}
function register(book, input, series = "serie") {
  const b = input.brief;
  return book.register({
    id: series,
    mode: b.mode,
    selection: "Toda la cartera",
    cohorts: [
      {
        id: b.id,
        cutoff: b.cutoff,
        briefHash: digest(b),
        accounts: input.packet.queries.length,
      },
    ],
  });
}
async function roster(t) {
  const s = new Semar(":memory:");
  t.after(() => s.close());
  await s.command("init", { type: "init", reserve: 1000 });
  return s.layout();
}
test("verified alternative changes the single list, pays once and survives replay and sealing", async (t) => {
  const layout = await roster(t),
    input = example(),
    dir = mkdtempSync(join(tmpdir(), "semar-dec-")),
    path = join(dir, "libro.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let book = new DecisionBook(path);
  t.after(() => book.close());
  register(book, input);
  const e = book.start(layout, "serie", input),
    p = e.data.plan;
  assert.equal(p.decisions[0].id, "a");
  assert.equal(p.decisions.length, 3);
  assert.equal(p.queue.find((q) => q.id === "igual-c").status, "SAME_DECISION");
  assert.deepEqual(p.queue[0].enter, ["b"]);
  assert.equal(p.queue[0].status, "VERIFY");
  assert.equal(p.decisions[0].calibration.scope, "EXTERNAL_REFERENCE");
  const a = {
    previous: e.hash,
    probe: "verificar-b",
    branch: "ALTERNATIVE",
    source: "finanzas",
    reference: "acuse-original",
    observedAt: "2022-05-31",
  };
  assert.throws(
    () => book.answer(layout, "uno", { ...a, previous: "123" }),
    /caducada/,
  );
  const next = book.answer(layout, "uno", a);
  assert.equal(next.data.plan.decisions[0].id, "b");
  assert.equal(next.data.plan.budget.spentCents, 25);
  assert.equal(next.data.plan.additionalComparisons, 2000);
  assert.equal(next.data.plan.participants, 6000);
  assert.deepEqual(
    next.data.plan.decisions.map((r) => r.probability),
    buildDecision(layout, input, "incumbent", [a]).decisions.map(
      (r) => r.probability,
    ),
  );
  assert.equal(book.answer(layout, "uno", a).hash, next.hash);
  book.close();
  book = new DecisionBook(path);
  const frozen = book.seal("uno", next.hash);
  assert.equal(
    commercialList(book.sealed("uno").plan).decisions[0].instruction.includes(
      "reposición",
    ),
    true,
  );
  assert.equal(book.seal("uno", next.hash).hash, frozen.hash);
  assert.throws(() => book.seal("uno", e.hash));
  const actual = {
    source: "facturas conciliadas",
    asOf: "2022-07-01",
    outcomes: { a: 0, b: 1, c: 1 },
  };
  assert.throws(
    () => book.grade("uno", frozen.hash, { ...actual, asOf: "2022-06-30" }),
    /incompleta/,
  );
  assert.throws(
    () => book.grade("uno", frozen.hash, { ...actual, outcomes: { b: 1 } }),
    /Cobertura/,
  );
  const result = book.grade("uno", frozen.hash, actual);
  assert.equal(result.data.result.scores.deployed.hits, 1);
  assert.deepEqual(result.data.result.omitted, ["c"]);
  assert.equal(result.data.result.margin, null);
  assert.equal(book.grade("uno", frozen.hash, actual).hash, result.hash);
  assert.throws(
    () =>
      book.grade("uno", frozen.hash, {
        ...actual,
        outcomes: { a: 1, b: 1, c: 1 },
      }),
    /distintos/,
  );
  assert.equal(book.verdict("serie").status, "KEEP_INCUMBENT");
});
test("prospective register, budget, signatures, freeze deadline and same-merchant calibration", async (t) => {
  const layout = await roster(t),
    { privateKey, publicKey } = generateKeyPairSync("ed25519");
  let now = utc("2025-05-30");
  const book = new DecisionBook(":memory:", {
    clock: () => now,
    authority: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  t.after(() => book.close());
  const x = example("piloto", "PROSPECTIVE", "2025-06-01");
  x.brief.researchCents = 24;
  register(book, x);
  const p = book.start(layout, "serie", x);
  assert.equal(p.data.plan.queue[0].status, "DEFER");
  const s = book.seal("piloto", p.hash);
  const actual = {
    asOf: "2025-07-01",
    source: "ventas",
    outcomes: { a: 1, b: 0, c: 1 },
  };
  const sig = sign(
    null,
    Buffer.from(
      canonical({
        kind: "outcomes",
        id: "piloto",
        anchor: s.hash,
        data: actual,
      }),
    ),
    privateKey,
  ).toString("base64");
  assert.throws(() => book.grade("piloto", s.hash, actual, [], sig), /fecha/);
  now = utc("2025-07-02");
  assert.throws(
    () => book.grade("piloto", s.hash, actual, [], "fake"),
    /firmada/,
  );
  book.grade("piloto", s.hash, actual, [], sig);
  const after = example("otra", "PROSPECTIVE", "2025-08-01");
  register(book, after, "otra-serie");
  const r = book.start(layout, "otra-serie", after);
  assert.equal(
    r.data.plan.decisions[0].calibration.scope,
    "SAME_MERCHANT_HISTORY",
  );
  now = utc("2025-08-02");
  assert.throws(() => book.seal("otra", r.hash), /vencido/);
});
test("oráculo compares equal budgets, disjoint accounts and distinguishes prospective evidence", () => {
  function result(id, merchant, cutoff) {
    const b = { ...example().brief, id, merchant, cutoff, seats: 40 },
      rows = Array.from({ length: 200 }, (_, i) => ({
        id: id + i,
        probability: i < 40 ? 0.99 : 0.01,
      }));
    const g = grade(
      rows,
      Object.fromEntries(rows.map((r, i) => [r.id, Number(i < 40)])),
      40,
    );
    return {
      brief: b,
      accounts: rows.map((r) => r.id),
      scores: { incumbent: { ...g, brier: 0.02 }, challenger: g },
      policy: policyId,
      seal: id,
      margin: null,
    };
  }
  const rs = ["a", "b"].flatMap((m) =>
    ["2022-04-01", "2023-04-01"].map((c) => result(m + c, m, c)),
  );
  assert.equal(verdict(rs).status, "READY_FOR_PROSPECTIVE_TRIAL");
  const unchanged = rs.map((r) => ({
    ...r,
    scores: { ...r.scores, challenger: r.scores.incumbent },
  }));
  assert.equal(verdict(unchanged).status, "KEEP_INCUMBENT");
  assert.throws(() => verdict([rs[0], rs[0]]), /repetidas/);
  assert.throws(
    () =>
      verdict([rs[0], { ...rs[1], brief: { ...rs[1].brief, minutes: 100 } }]),
    /incompatibles/,
  );
  assert.equal(
    verdict(
      rs.map((r) => ({ ...r, brief: { ...r.brief, mode: "PROSPECTIVE" } })),
    ).status,
    "QUALIFIED_IN_SCOPE",
  );
});
test("signed trial economics must match the selected cohort, scope and horizon", async (t) => {
  const layout = await roster(t),
    x = example();
  x.brief.trial = { id: "ensayo", mission: "semana" };
  const p = buildDecision(layout, x);
  const actual = {
      asOf: p.closeFrom,
      source: "libro",
      outcomes: { a: 1, b: 0, c: 0 },
    },
    trial = {
      trial: "ensayo",
      mission: "semana",
      scope: "recompras",
      pairs: [[{ subject: "a" }]],
      from: utc(x.brief.cutoff),
      until: utc(p.closeFrom),
      completed: 1,
      total: 1,
      observedPaidCents: 500,
      incrementalNetPerPairCents: 42,
      status: "KEEP_CONTROL",
    };
  assert.equal(
    gradePlan(p, actual, trial).margin.incrementalNetPerPairCents,
    42,
  );
  assert.throws(
    () => gradePlan(p, actual, { ...trial, scope: "otra" }),
    /incompatible/,
  );
  assert.equal(gradePlan(p, actual, { ...trial, completed: 0 }).margin, null);
});
