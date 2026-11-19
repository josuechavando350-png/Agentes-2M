import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Semar } from "../src/semar.mjs";
import { digest, canonical } from "../src/policy.mjs";
import { freshSeed, dossierScore, dominates } from "../src/blind.mjs";
import { freezeDocument, tribunal } from "../src/dossiers.mjs";
import { importSources, tenderDocuments } from "../src/sources.mjs";
import { ABSOLUTE, HOUR } from "../src/missions.mjs";

async function setup(t, budget = 168) {
  let now = 1800000000000,
    n = 0;
  const s = new Semar(":memory:", { clock: () => now });
  t.after(() => s.close());
  const cmd = (c, key = "op-" + ++n) => s.command(key, c);
  await cmd({ type: "init", reserve: 99999 });
  await cmd({ type: "open_mission", mission: "primera", budget });
  return {
    s,
    cmd,
    advance: (h) => {
      now += h * HOUR;
    },
    now: () => now,
  };
}
const add = (cmd, id, body) =>
  cmd({
    type: "admit_source",
    document: { id, source: "expediente/" + id, text: body },
  });
const rows = (subject, cost = 60) =>
  [
    "# Acta de observación",
    subject + ".buyer = Taller del Sur",
    subject + ".problem = Mantenimiento",
    subject + ".alternative = Interno",
    subject + ".units = 5",
    subject + ".price = 100",
    subject + ".cost = " + cost,
  ].join("\n");
const query = (subject) => ({
  subject,
  op: "difference",
  fields: ["price", "cost"],
});
test("fresh sealed cases expose contradictions, omissions and independent source withdrawal", () => {
  const a = freshSeed(),
    b = freshSeed();
  assert.notEqual(a, b);
  const first = dossierScore(a, "first"),
    indexed = dossierScore(a, "indexed");
  assert.equal(first.severe, 4);
  assert.equal(indexed.correct, 16);
  assert.ok(dominates(indexed, first));
  const doc = (id, text) => freezeDocument({ id, source: id, text });
  const docs = [doc("one", rows("alpha")), doc("two", "alpha.price = 110")];
  const r = tribunal(docs, query("alpha"));
  assert.equal(r.proposer.value, 40);
  assert.equal(r.investigator.status, "CONFLICTED");
  assert.equal(r.referee.status, "CONFLICTED");
  assert.equal(r.sensitivity.find((x) => x.omit === "two").value, 40);
  assert.ok(
    r.referee.refs.some((x) => x.row === 6 && x.quote === "alpha.price = 100"),
  );
  assert.equal(tribunal(docs, query("beta")).referee.status, "UNKNOWN");
  assert.equal(
    tribunal(
      [doc("bad", "alpha.price = sin dato\nalpha.cost = 20")],
      query("alpha"),
    ).referee.status,
    "UNKNOWN",
  );
});
test("Diablo runs parallel challengers, holds one office, delegates and passes to a living successor", async (t) => {
  const { s, cmd } = await setup(t);
  const candidates = [
    { id: 800, generation: 1, policy: "crosscheck" },
    { id: 801, generation: 1, policy: "indexed" },
  ];
  const contest = await cmd({ type: "contest", candidates }, "concurso");
  assert.equal(contest.holder.id, 801);
  assert.equal(contest.entries.length, 3);
  assert.deepEqual(
    await cmd({ type: "contest", candidates }, "concurso"),
    contest,
  );
  assert.equal(s.status().leaders.filter((l) => l.supreme).length, 10);
  assert.equal(s.feed(ABSOLUTE).at(-1).result.holder.id, 801);
  assert.equal(s.status().absolute.holder.policy, "indexed");
  for (let i = 0; i < 10; i++)
    await cmd({
      type: "work",
      id: 801,
      version: 1,
      generation: 1,
      op: "sum",
      data: [1, 2],
    });
  assert.equal(s.agent(801).status, "DEAD");
  assert.equal(s.status().absolute.holder.id, 800);
  assert.equal(s.awareness(801).canDeliver, false);
  const journal = s.checkpoint();
  const copy = new Semar(":memory:");
  try {
    copy.restore(journal.events, journal.tip);
    assert.deepEqual(copy.status(), s.status());
  } finally {
    copy.close();
  }
});
test("mission chooses and funds two pilots, revises evidence, accounts one payment once, closes at 168h and learns", async (t) => {
  const { s, cmd, now, advance } = await setup(t);
  const start = now();
  await add(cmd, "proveedor", rows("alpha") + "\n" + rows("beta", 120));
  const alpha = await cmd({ type: "research" });
  const beta = await cmd({ type: "research" });
  assert.equal(alpha.finding.decision, "VALIDATE_BUYER");
  assert.equal(beta.finding.decision, "ABANDON");
  assert.equal(s.mission().mission.portfolio.winner, "alpha");
  assert.equal(s.mission().mission.spent, 8);
  assert.equal(new Set(alpha.finding.crew).size, 3);
  assert.ok(s.awareness(alpha.finding.crew[0]).commitments.length);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await cmd({
    type: "settlement_key",
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  const record = (stage, reference, cents) => ({
    mission: "primera",
    subject: "alpha",
    sale: "venta",
    stage,
    reference,
    cents,
    currency: "MXN",
    contributors: alpha.finding.crew,
  });
  const book = (r) =>
    cmd({
      type: "commerce",
      record: r,
      signature: sign(null, Buffer.from(canonical(r)), privateKey).toString(
        "base64",
      ),
    });
  await assert.rejects(
    cmd({
      type: "commerce",
      record: record("paid", "fake", 1000),
      signature: "fake",
    }),
    /firmada/,
  );
  await book(record("estimate", "estimacion", 12000));
  await book(record("quote", "cotizacion", 11000));
  await book(record("order", "pedido", 10000));
  assert.equal(s.mission().mission.finance.paid, 0);
  await book(record("paid", "banco-234", 10000));
  await book(record("expense", "banco-235", 4000));
  await assert.rejects(
    book(record("paid", "banco-234", 10000)),
    /contabilizada/,
  );
  await add(cmd, "inspector", "alpha.price = 110");
  assert.equal(
    (await cmd({ type: "research" })).finding.proof.referee.status,
    "CONFLICTED",
  );
  advance(24);
  assert.equal(s.mission().mission.phase, "VALIDATION");
  advance(72);
  assert.equal(s.mission().mission.phase, "COMMERCIAL");
  advance(72);
  assert.equal(s.mission().mission.close.closedAt, start + 168 * HOUR);
  await assert.rejects(cmd({ type: "research" }), /cerrada/);
  const close = await cmd({ type: "pulse" });
  assert.equal(close.report.sectors.length, 10);
  assert.equal(close.report.finance.net, 6000);
  assert.equal(
    close.report.forecasts.find((f) => f.subject === "alpha").brier,
    0.25,
  );
  assert.equal(s.awareness(666).alive, true);
  await cmd({ type: "open_mission", mission: "segunda", budget: 100 });
  await add(cmd, "tercera", rows("gamma"));
  assert.equal((await cmd({ type: "research" })).finding.forecast, 2 / 3);
});
test("explicit manifest reads only authorized files, receipts survive retries, every question pays and cites the original line", async (t) => {
  const { s, cmd } = await setup(t);
  const dir = mkdtempSync(join(tmpdir(), "semar-mando-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "expedientes");
  mkdirSync(root);
  writeFileSync(join(root, "taller.txt"), rows("alpha"));
  const manifest = join(root, "allow.json");
  writeFileSync(
    manifest,
    JSON.stringify([{ id: "doc", format: "text", source: "taller.txt" }]),
  );
  assert.deepEqual(
    await importSources(s, manifest),
    await importSources(s, manifest),
  );
  writeFileSync(join(dir, "otro.txt"), rows("beta"));
  writeFileSync(
    manifest,
    JSON.stringify([{ id: "otro", format: "text", source: "../otro.txt" }]),
  );
  await assert.rejects(importSources(s, manifest), /fuera/);
  const request = {
    type: "inquire",
    id: 900,
    generation: 1,
    version: 1,
    documents: ["doc"],
    query: query("alpha"),
  };
  await assert.rejects(
    cmd({ ...request, documents: ["secreto"] }),
    /autorización/,
  );
  const ans = await cmd(request);
  assert.equal(ans.answer.value, 40);
  assert.equal(ans.answer.refs[0].row, 6);
  assert.equal(s.agent(900).balance, 9);
  for (let i = 0; i < 9; i++) await cmd(request);
  assert.equal(s.agent(900).status, "DEAD");
  assert.equal(s.mission().mission.spent, 10);
  assert.equal(s.audit().status, "VERIFIED");
});
test("both legacy skill admission and attempted tampering pass through the blind gate before a cohort is registered", async (t) => {
  const { s, cmd } = await setup(t);
  await cmd({
    type: "work",
    id: 5000001,
    generation: 1,
    version: 1,
    op: "nonAdjacent",
    data: [9, 1, 2],
  });
  const result = await cmd({
    type: "learn",
    id: 91,
    generation: 1,
    version: 1,
    op: "nonAdjacent",
  });
  assert.equal(result.replicas, 666);
  assert.ok(result.blind.candidate.correct > result.blind.old.correct);
  assert.equal(result.blind.candidate.severe, 0);
  assert.ok(result.blind.candidate.elapsedUs > 0);
  const checkpoint = s.checkpoint(),
    events = structuredClone(checkpoint.events);
  const last = events.at(-1);
  last.steps.find((x) => x.kind === "cohort").blind.candidate.correct = 0;
  last.result.blind.candidate.correct = 0;
  const copy = new Semar(":memory:");
  try {
    assert.throws(() => copy.restore(events, digest(last)), /alteradas/);
  } finally {
    copy.close();
  }
});
test("public tender notices retain source pointers and cannot manufacture profit", () => {
  const at = 1800000000000,
    record = {
      status: "vigente",
      uuid_procedimiento: "abc",
      fecha_apertura: new Date(at + HOUR).toISOString(),
      dependencia: "Comprador",
      nombre_procedimiento: "Servicio",
      postor_url: "https://postor.com.mx/licitacion/abc",
      amount_tier: 3,
    };
  const [doc] = tenderDocuments({ success: true, data: [record] }, at);
  assert.equal(
    tenderDocuments({ success: true, data: [record] }, at + 2 * HOUR).length,
    0,
  );
  const d = freezeDocument(doc);
  assert.ok(d.locators.some((r) => r.pointer === "/dependencia"));
  assert.equal(tribunal([d], query(doc.id)).referee.status, "UNKNOWN");
});
