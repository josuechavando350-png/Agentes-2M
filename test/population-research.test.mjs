import { Semar } from "../src/semar.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { signals } from "../src/account-market.mjs";
import { digest } from "../src/policy.mjs";
import {
  populationResearch,
  preparePopulation,
  verifyPopulation,
  smallTeamResearch,
  submitPopulation,
  populationVerdict,
} from "../src/population-research.mjs";
function row(id, cutoff, n) {
  const prev = new Date(Date.parse(cutoff) - 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    id,
    cutoff,
    features: Object.fromEntries(signals.map((f, i) => [f, (n + 2 * i) % 8])),
    references: [{ invoice: id, day: prev, firstRow: 2 }],
  };
}
const packet = {
  niche: "recompras",
  historical: [row("b", "2011-04-01", 4), row("a", "2011-04-01", 1)],
  outcomes: { a: 1, b: 0 },
  queries: [row("c", "2011-06-01", 1), row("d", "2011-06-02", 4)],
};
function layout() {
  const profiles = signals.map((_, i) => ({
    sector: i + 1,
    status: "LIVE",
    balance: 3,
  }));
  const runs = [];
  let last = 0;
  for (let pass = 0; pass < 2; pass++)
    for (let s = 0; s < 10; s++) {
      runs.push({ last: ++last, index: s, founder: false });
      last += 200;
      runs.push({ last, index: s, founder: true });
    }
  return { population: last, checkpoint: "a".repeat(64), runs, profiles };
}
test("every live founder in a fragmented roster contributes one unique recoverable comparison", () => {
  const roster = layout(),
    report = populationResearch(roster, packet, 3),
    v = verifyPopulation(roster, packet, report);
  assert.equal(v.participants, 4000);
  assert.equal(v.controlTeam.length, 10);
  assert.deepEqual(
    report.result.decisions.thousand.map((r) => r.probability),
    [1, 0],
  );
  assert.deepEqual(
    smallTeamResearch(roster, packet).decisions,
    report.result.decisions.ten,
  );
  assert.equal(smallTeamResearch(roster, packet).comparisons, 40);
  const receipt = verifyPopulation(roster, packet, report, 2020);
  assert.equal(receipt.id, 2020);
  assert.equal(receipt.leader, "L1");
  assert.equal(receipt.query, "d");
  assert.equal(receipt.reference, "a");
  assert.equal(receipt.rule, 8);
  assert.throws(
    () => verifyPopulation(roster, packet, report, 1),
    /sin asignación/,
  );
  const reordered = {
    ...packet,
    historical: packet.historical.toReversed(),
    queries: packet.queries.toReversed(),
  };
  assert.deepEqual(
    populationResearch(roster, reordered, 1).result,
    report.result,
  );
  const forged = structuredClone(report);
  forged.result.sectors[0].cells[0].hash = "0".repeat(64);
  forged.commitment = digest(forged.result);
  assert.throws(() => verifyPopulation(roster, packet, forged), /divergente/);
});
test("future labels, duplicate buyers, hidden outcomes, retired founders and insufficient coverage stop execution", () => {
  assert.throws(
    () => preparePopulation({ ...packet, queries: packet.historical }),
    /duplicada/,
  );
  assert.throws(
    () =>
      preparePopulation({ ...packet, queries: [row("c", "2011-04-15", 1)] }),
    /ventana/,
  );
  assert.throws(() =>
    preparePopulation({
      ...packet,
      queries: [{ ...packet.queries[0], outcome: 1 }],
    }),
  );
  const ro = layout();
  ro.profiles[3].status = "DEAD";
  ro.profiles[3].balance = 0;
  assert.throws(() => populationResearch(ro, packet, 1), /retirado/);
  const incomplete = layout();
  incomplete.runs.pop();
  assert.throws(
    () => populationResearch(incomplete, packet, 1),
    /insuficiente/,
  );
});

test("the ten leaders and Diablo receive a verified finding once in the active mission", async (t) => {
  const s = new Semar(":memory:");
  t.after(() => s.close());
  await s.command("inicio", { type: "init", reserve: 100 });
  await s.command("mision", {
    type: "open_mission",
    mission: "estudio",
    budget: 100,
  });
  const report = populationResearch(s.layout(), packet, 2);
  await assert.rejects(
    submitPopulation(s, "equivocada", packet, report),
    /Misión/,
  );
  const known = await submitPopulation(s, "estudio", packet, report);
  assert.equal(known.status, "ADMITTED");
  assert.deepEqual(await submitPopulation(s, "estudio", packet, report), known);
  for (const leader of [
    "Diablo 666",
    ...Array.from({ length: 10 }, (_, i) => "L" + (i + 1)),
  ])
    assert.equal(s.feed(leader).at(-1).result.sha256, known.sha256);
  assert.equal(s.audit().status, "VERIFIED");
});
test("greater computation needs lower error and must preserve hits and mistaken rejections", () => {
  const base = { pilotHits: 20, missedAfterAbandon: 10, brier: 0.3 },
    bad = { ...base, brier: 0.29, pilotHits: 19 };
  assert.equal(
    populationVerdict({
      incumbent: base,
      ten: base,
      hundred: bad,
      thousand: bad,
    }).status,
    "KEEP_INCUMBENT",
  );
  const better = { ...base, brier: 0.29 };
  assert.equal(
    populationVerdict({
      incumbent: base,
      ten: better,
      hundred: better,
      thousand: better,
    }).selected,
    "ten",
  );
});
