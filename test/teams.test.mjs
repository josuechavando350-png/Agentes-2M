import test from "node:test";
import assert from "node:assert/strict";
import { Semar } from "../src/semar.mjs";
import { digest } from "../src/policy.mjs";

async function setup(t, budget = 600) {
  const s = new Semar(":memory:", { clock: () => 1800000000000 });
  t.after(() => s.close());
  let serial = 0;
  const run = (command, key = "op-" + ++serial) => s.command(key, command);
  await run({ type: "init", reserve: 10000 });
  await run({ type: "open_mission", mission: "primera", budget });
  for (const [id, price] of [
    ["uno", 10],
    ["dos", 11],
  ]) {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      subject: "beta",
      field: "price",
      value: i,
    }));
    rows[id === "uno" ? 0 : 59] = {
      subject: "alfa",
      field: "price",
      value: price,
    };
    await run({
      type: "admit_source",
      document: { id, source: "fuente/" + id, rows },
    });
  }
  const request = (size, extra = {}) => ({
    type: "team_inquiry",
    mission: "primera",
    size,
    rowBudget: 120,
    creditBudget: 100,
    documents: ["uno", "dos"],
    query: { subject: "alfa", op: "lookup", fields: ["price"] },
    ...extra,
  });
  return { s, run, request };
}

test("one, ten and one hundred members account for all rows, citations and charges exactly once", async (t) => {
  const { s, run, request } = await setup(t);
  let last;
  assert.deepEqual(s.missionSources(), [
    { id: "uno", rows: 60 },
    { id: "dos", rows: 60 },
  ]);
  for (const size of [1, 10, 100]) {
    const before = s.status().spent;
    const [r, duplicate] = await Promise.all([
      run(request(size), "equipo-" + size),
      run(request(size), "equipo-" + size),
    ]);
    assert.deepEqual(duplicate, r);
    assert.equal(r.status, "TEAM_ANSWERED");
    assert.equal(r.answer.status, "CONFLICTED");
    assert.deepEqual(
      r.answer.refs.map((x) => [x.document, x.row]),
      [
        ["uno", 1],
        ["dos", 60],
      ],
    );
    assert.equal(r.answer.value, null);
    assert.equal(r.credits, size);
    assert.equal(s.status().spent - before, size);
    assert.equal(new Set(r.assignments.map((a) => a.id)).size, size);
    assert.equal(r.assignments[0].id, s.status().absolute.holder.id);
    let offset = 0;
    const counts = new Map();
    for (const a of r.assignments) {
      assert.equal(a.first, offset);
      assert.ok(a.end > offset);
      offset = a.end;
      counts.set(a.sector, (counts.get(a.sector) ?? 0) + 1);
      assert.ok(s.agent(a.id).balance < 10);
    }
    assert.equal(offset, 120);
    assert.equal(counts.size, Math.min(size, 10));
    if (size > 1) assert.ok([...counts.values()].every((n) => n === size / 10));
    last = r;
  }
  assert.equal(s.mission().mission.spent, 111);
  const cp = s.checkpoint(),
    good = new Semar(":memory:"),
    bad = new Semar(":memory:");
  try {
    good.restore(cp.events, cp.tip);
    assert.deepEqual(good.receipt("equipo-100"), last);
    const altered = structuredClone(cp.events);
    altered
      .at(-1)
      .steps.find((x) => x.kind === "government")
      .seal.hits[0].pop();
    assert.throws(
      () => bad.restore(altered, digest(altered.at(-1))),
      /Evidencia omitida/,
    );
  } finally {
    good.close();
    bad.close();
  }
  const closed = await run({ type: "halt", reason: "Semana concluida" });
  assert.deepEqual(closed.report.lastTeam, s.mission().mission.lastTeam);
  await assert.rejects(run(request(10)), /cerrada/);
});

test("authorization, phase limits and vacant seats never create billable output", async (t) => {
  const { s, run, request } = await setup(t, 40);
  const before = s.status().spent;
  for (const [size, extra, expected] of [
    [1, { rowBudget: 119 }, "BUDGET_LIMIT"],
    [10, { creditBudget: 9 }, "BUDGET_LIMIT"],
    [100, {}, "BUDGET_LIMIT"],
  ])
    assert.equal((await run(request(size, extra))).status, expected);
  for (const [extra, pattern] of [
    [{ documents: ["secreto"] }, /autorización/],
    [{ documents: ["uno", "uno"] }, /Selección/],
    [{ mission: "otra" }, /distinta/],
  ]) {
    await assert.rejects(run(request(10, extra)), pattern);
  }
  await run({
    type: "admit_source",
    document: { id: "corto", source: "nota", text: "alfa.price = 7" },
  });
  assert.equal(
    (await run(request(10, { documents: ["corto"] }))).status,
    "TOO_FEW_ROWS",
  );
  assert.equal(s.status().spent, before);
  assert.equal(s.mission().mission.spent, 0);
  const approved = await run(request(10));
  assert.equal(approved.status, "TEAM_ANSWERED");
  assert.equal((await run(request(1))).status, "BUDGET_LIMIT");
});

test("the last credit retires the incumbent before a team can issue an answer", async (t) => {
  const { s, run, request } = await setup(t);
  const id = s.status().absolute.holder.id;
  for (let i = 0; i < 9; i++)
    await run({
      type: "work",
      id,
      generation: 1,
      version: 1,
      op: "sum",
      data: [1, 1],
    });
  assert.equal(s.agent(id).balance, 1);
  assert.deepEqual(await run(request(10)), { status: "DEAD_ZERO", id });
  assert.equal(s.agent(id).status, "DEAD");
  assert.equal(s.mission().mission.spent, 1);
  assert.equal(s.mission().mission.lastTeam, undefined);
  const next = await run(request(10));
  assert.notEqual(next.assignments[0].id, id);
  assert.equal(next.credits, 10);
  assert.equal(s.audit().status, "VERIFIED");
});
