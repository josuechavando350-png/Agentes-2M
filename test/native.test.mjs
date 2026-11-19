import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { materialize, openPacked } from "../src/packed.mjs";
import { NativeWorker } from "../src/native.mjs";
import { OPS, oracle } from "../src/policy.mjs";
const work = (id) => ({
  type: "work",
  id,
  generation: 1,
  version: 1,
  op: "sum",
  data: [-4, 6],
});

test("native numeric and logical work agrees with the independent oracle, including cycles and explicit contradictions", async () => {
  const worker = new NativeWorker();
  try {
    for (const op of OPS.filter((x) => x !== "inference"))
      for (let n = 1; n <= 16; n++) {
        const data = Array.from({ length: n }, (_, i) =>
          i % 3 === 0 ? -1000000 : i % 3 === 1 ? 1000000 : n - i,
        );
        assert.equal(await worker.run(op, data), oracle(op, data));
      }
    for (let mask = 0; mask < 8; mask++) {
      const facts = ["a", "b", "!goal"]
        .filter((_, i) => mask & (1 << i))
        .map((literal) => ({ literal, source: "acta" }));
      const rules = [
        { if: ["a", "b"], then: "x", source: "A" },
        { if: ["x"], then: "goal", source: "B" },
        { if: ["goal"], then: "x", source: "C" },
      ].reverse();
      const data = { facts, rules, query: "goal" };
      assert.equal(
        await worker.run("inference", data),
        oracle("inference", data),
      );
    }
  } finally {
    worker.close();
  }
});
test("packed records survive transport, expose full profiles, exclude dead agents from the exam, and match across thread counts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "semar-packed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = {
    sector: 1,
    balance: 10,
    skills: ["count", "minimum", "sum"],
    generation: 1,
    version: 1,
    status: "LIVE",
    publicKey: null,
  };
  const dead = { ...profile, balance: 0, status: "DEAD", generation: 3 };
  const child = {
    ...profile,
    version: 5,
    programs: [{ id: "programa-local" }],
  };
  const layout = {
    schema: "SEMAR-ROWS-1",
    rowBytes: 8,
    population: 300007,
    checkpoint: "a".repeat(64),
    profiles: [profile, dead, child],
    runs: [
      { last: 100, index: 0, founder: true },
      { last: 101, index: 1, founder: true },
      { last: 300007, index: 2, founder: false },
    ],
  };
  const path = join(dir, "test.gz");
  const one = await materialize(layout, path, 1);
  const two = await materialize(layout, path, 2);
  assert.equal(one.sha256Uncompressed, two.sha256Uncompressed);
  assert.equal(two.tested, layout.population - 1);
  assert.equal(two.founders, 101);
  assert.equal(two.bodyBytes, 8 * layout.population);
  const bin = join(dir, "test.bin");
  writeFileSync(bin, gunzipSync(readFileSync(path)));
  const reader = openPacked(bin);
  try {
    assert.deepEqual(reader.agent(1), { id: 1, ...profile });
    assert.deepEqual(reader.agent(101), { id: 101, ...dead });
    assert.deepEqual(reader.agent(300007), { id: 300007, ...child });
    assert.throws(() => reader.agent(300008));
    assert.throws(() => reader.agent(0));
  } finally {
    reader.close();
  }
});
test("warm receipts, audit results and state views stay isolated across processes, mutations and rejected replays", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "semar-cache-"));
  const file = join(dir, "db.sqlite");
  const a = new Semar(file),
    b = new Semar(file);
  t.after(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await a.command("inicio", { type: "init", reserve: 66600 });
  const [first, retry] = await Promise.all([
    a.command("accion", work(1)),
    b.command("accion", work(1)),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(a.agent(1).balance, 9);
  const cp = a.checkpoint(),
    old = a.audit();
  a.receipt("accion").balance = 0;
  a.feed("L1").at(-1).result.balance = 0;
  a.status().absolute.holder.id = 1;
  cp.events[1].steps[0].agent.balance = 0;
  first.balance = 0;
  assert.equal(a.receipt("accion").balance, 9);
  assert.equal(a.audit().tip, old.tip);
  const external = await b.command("trabajo", work(1));
  assert.equal(external.balance, 8);
  assert.equal(a.agent(1).balance, 8);
  await assert.rejects(a.command("trabajo", work(2)), /repetida/);
  assert.equal(b.agent(2).balance, 10);
  assert.deepEqual(a.audit(), b.audit());
});
