import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Semar } from "../src/semar.mjs";
import { NativeWorker } from "../src/native.mjs";
import {
  runBatch,
  packBatch,
  scanShard,
  mergeShards,
} from "../src/distribution.mjs";

async function fixture(t, budget = 80) {
  const root = mkdtempSync(join(tmpdir(), "semar-reparto-test-")),
    path = join(root, "libro.sqlite");
  const opts = { clock: () => 1800000000000 };
  const s = new Semar(path, opts);
  t.after(() => {
    s.close();
    rmSync(root, { force: true, recursive: true });
  });
  await s.command("init", { type: "init", reserve: 10000 });
  await s.command("abrir", { type: "open_mission", mission: "uno", budget });
  const jobs = [];
  for (let i = 0; i < 12; i++) {
    const id = "folio-" + i,
      document = {
        id,
        source: "fuente/" + id,
        text: "# precio\nalfa.price = " + i,
      };
    const { revision, sha256 } = await s.command("doc-" + i, {
      type: "admit_source",
      document,
    });
    jobs.push({
      key: "caso-" + i,
      command: {
        type: "dispatch_inquiry",
        id: 710 + i,
        generation: 1,
        version: 1,
        mission: "uno",
        document: id,
        revision,
        sha256,
        query: { subject: "alfa", op: "lookup", fields: ["price"] },
      },
    });
  }
  return { s, jobs, path, opts };
}
test("loss of the active C++ process retries on a second slot and an on-disk restart costs zero extra credits", async (t) => {
  const { s, jobs, path, opts } = await fixture(t);
  let fault = false,
    backups = 0;
  function workerFor(host) {
    const native = new NativeWorker();
    if (host === "dos") backups++;
    return {
      host,
      close: () => native.close(),
      scan(packet) {
        const pending = native.scan(packet);
        if (!fault && host === "uno") {
          fault = true;
          native.close();
        }
        return pending;
      },
    };
  }
  const result = await runBatch(s, jobs, ["uno", "dos"], { workerFor });
  assert.ok(fault && backups > 1);
  assert.equal(result.results.filter((r) => r.attempts === 2).length, 1);
  for (const [i, row] of result.results.entries()) {
    assert.equal(row.receipt.answer.value, i);
    assert.equal(row.receipt.assignments[0].id, 710 + i);
    assert.equal(s.agent(710 + i).balance, 9);
    assert.ok(
      row.queueMs >= 0 && row.elapsedMs >= row.queueMs + row.commitMs - 0.001,
    );
  }
  const tip = s.checkpoint().tip;
  const restarted = new Semar(path, opts);
  try {
    const again = await runBatch(restarted, jobs, ["local"]);
    assert.ok(again.results.every((r) => r.cached && r.attempts === 0));
    assert.equal(restarted.checkpoint().tip, tip);
    assert.equal(restarted.mission().mission.spent, 12);
  } finally {
    restarted.close();
  }
});
test("missing, duplicate and wrongly bound shards fail before writing, tampered evidence fails audit and valid replay resumes", async (t) => {
  const { s, jobs } = await fixture(t);
  const pack = packBatch(s, jobs);
  assert.deepEqual(
    Object.keys(pack.tickets[0].packet).sort(),
    ["subject", "fields", "keys"].sort(),
  );
  const [p, q] = await Promise.all([
    scanShard(pack, 0, 2),
    scanShard(pack, 1, 2),
  ]);
  for (const parts of [
    [p],
    [p, p],
    [q, { ...p, batch: "z" }],
    [q, { ...p, results: [...p.results].reverse() }],
  ])
    await assert.rejects(mergeShards(s, jobs, pack, parts));
  assert.equal(s.mission().mission.spent, 0);
  const broken = structuredClone(q);
  broken.results[1].seal.hits = [[]];
  await assert.rejects(
    mergeShards(s, jobs, pack, [p, broken]),
    /Evidencia omitida/,
  );
  assert.equal(s.mission().mission.spent, 3);
  await mergeShards(s, jobs, pack, [q, p]);
  assert.equal(s.mission().mission.spent, 12);
  const cp = s.checkpoint();
  const again = new Semar(":memory:", { clock: s.clock });
  try {
    again.restore(cp.events, cp.tip);
    assert.equal(again.agent(710).balance, 9);
  } finally {
    again.close();
  }
});
test("a revision change, exhausted identity or competing writer cannot spend on stale output", async (t) => {
  const { s, jobs } = await fixture(t, 16);
  const old = packBatch(s, jobs),
    part = await scanShard(old, 0, 1);
  const j = jobs[0];
  await s.command("cambio", {
    type: "admit_source",
    previous: 1,
    document: {
      id: "folio-0",
      source: "fuente/folio-0",
      text: "alfa.price = 99",
    },
  });
  await assert.rejects(
    s.confirmDossier(j.key, j.command, part.results[0].seal),
    /caducada/,
  );
  const duplic = jobs[1];
  const receipts = await Promise.all([
    s.confirmDossier(duplic.key, duplic.command, part.results[1].seal),
    s.confirmDossier(duplic.key, duplic.command, part.results[1].seal),
  ]);
  assert.deepEqual(receipts[0], receipts[1]);
  assert.equal(s.mission().mission.spent, 1);
  await assert.rejects(runBatch(s, [duplic, duplic], ["local"]), /repetida/);
  const actor = jobs[2].command.id;
  for (let i = 0; i < 9; i++)
    await s.command("trabajo-" + i, {
      type: "work",
      id: actor,
      generation: 1,
      version: 1,
      op: "sum",
      data: [1],
    });
  const dead = await s.confirmDossier(
    jobs[2].key,
    jobs[2].command,
    part.results[2].seal,
  );
  assert.equal(dead.status, "DEAD_ZERO");
  assert.equal(s.agent(actor).balance, 0);
  const more = await runBatch(s, jobs.slice(3), [
    "local",
    "local",
    "local",
    "local",
  ]);
  assert.equal(
    more.results.filter((r) => r.receipt.status === "BUDGET_LIMIT").length,
    7,
  );
  assert.equal(s.mission().mission.spent, 4);
});
