import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { enrollAndExercise } from "../src/rollout.mjs";
import { INITIAL, LEGACY_INITIAL, STIPEND, BATCH } from "../src/policy.mjs";
import { qualification } from "../src/qualification.mjs";

function legacy(t) {
  const s = new Semar(":memory:");
  t.after(() => s.close());
  const read = (n) =>
    readFileSync(new URL("../evidence/" + n, import.meta.url));
  const old = JSON.parse(read("escuela-inicial.json"));
  s.restore(
    JSON.parse(gunzipSync(read("escuela-inicial.json.gz"))),
    old.audit.tip,
  );
  return { s, old };
}
const expand = { type: "expand_founders" };
test("a checkpoint with pre-existing clones and exhausted identities expands exactly once and survives replay", async (t) => {
  const { s } = legacy(t);
  const originalChild = s.agent(LEGACY_INITIAL + 1);
  for (let i = 0; i < STIPEND; i++)
    await s.command("consume-" + i, {
      type: "work",
      id: 500,
      generation: 1,
      version: 1,
      op: "sum",
      data: [1, 4],
    });
  const dead = s.agent(500);
  assert.equal(dead.status, "DEAD");
  await assert.rejects(s.command("insuficiente", expand), /Reserva/);
  await s.command("dotacion", { type: "reserve_births" });
  const before = s.status(),
    old = s.checkpoint();
  const [r, same] = await Promise.all([
    s.command("ampliacion", expand),
    s.command("ampliacion", expand),
  ]);
  assert.deepEqual(r, same);
  assert.equal(r.lo, before.population + 1);
  assert.equal(r.hi - r.lo + 1, 90_000_000);
  assert.deepEqual(s.agent(500), dead);
  assert.deepEqual(s.agent(LEGACY_INITIAL + 1), originalChild);
  assert.equal(s.status().treasury, before.treasury - r.credits);
  assert.equal(
    s.status().population,
    INITIAL + (before.population - LEGACY_INITIAL),
  );
  assert.equal(s.status().live, s.status().population - 1);
  assert.equal(s.founderId(1, 1_000_001), r.lo);
  assert.equal(s.founderId(10, 10_000_000), r.hi);
  assert.throws(() => s.founderId(1, 10_000_001));
  assert.equal(s.agent(r.hi).sector, 10);
  assert.equal((await s.command("otra", expand)).status, "ALREADY_EXPANDED");
  const copy = new Semar(":memory:");
  t.after(() => copy.close());
  const cp = s.checkpoint();
  assert.deepEqual(cp.events.slice(0, old.events.length), old.events);
  copy.restore(cp.events, cp.tip);
  assert.deepEqual(copy.status(), s.status());
  assert.deepEqual(copy.agent(r.lo), s.agent(r.lo));
  const slice = copy.census(499, 501, { examine: true });
  assert.equal(slice.tested, 2);
  assert.equal(slice.identities, 3);
});

test("ten sectors train with old evidence, certify exact batches and can retry without duplicate spending", async (t) => {
  const { s, old } = legacy(t);
  await s.command("dotacion", { type: "reserve_births" });
  const r = await enrollAndExercise(s);
  assert.equal(r.status, "EXPANDED");
  for (let i = 1; i <= 10; i++) {
    const x = s.receipt("fundadores-100m-sector-" + i);
    assert.ok(x.id >= r.lo && x.id <= r.hi);
    assert.equal(s.agent(x.id).sector, i);
    assert.equal(x.status, "APPROVED");
    assert.equal(x.verdicts.length, 3);
    assert.equal(x.caseSource, "fundadores-100m-docente");
    assert.equal(x.replicas ?? 0, i === 7 ? 0 : BATCH);
    if (x.first) assert.equal(s.agent(x.first).sector, i);
  }
  const current = s.status();
  assert.equal(
    current.population,
    INITIAL + old.audit.registeredReplicas + 9 * BATCH,
  );
  await enrollAndExercise(s);
  assert.deepEqual(s.status(), current);
});

test("fresh registries can address every sector across each of the ten 10M stripes", async (t) => {
  const s = new Semar(":memory:");
  t.after(() => s.close());
  assert.throws(() => s.founderId(1, 1));
  await s.command("genesis", { type: "init", reserve: 66600 });
  for (let block = 0; block < 10; block++)
    for (let sector = 1; sector <= 10; sector++)
      for (const edge of [1, 1_000_000]) {
        const ordinal = block * 1_000_000 + edge;
        const id = s.founderId(sector, ordinal);
        assert.equal(
          id,
          block * LEGACY_INITIAL + (sector - 1) * 1_000_000 + edge,
        );
        assert.equal(s.agent(id).sector, sector);
      }
  assert.equal(s.status().foundersPerSector, 10_000_000);
  assert.equal(
    (await s.command("sin-cambios", expand)).status,
    "ALREADY_EXPANDED",
  );
  const exam = qualification();
  assert.throws(
    () => exam.evaluate({ id: 1, sector: 1, skills: [] }),
    /Examen/,
  );
});
