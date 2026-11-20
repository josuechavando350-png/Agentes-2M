import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Semar } from "../../src/semar.mjs";
import { DecisionBook } from "../../src/decision-book.mjs";
import { digest } from "../../src/policy.mjs";
import { dateAt, utc, DAY } from "../../src/decision-model.mjs";
const [stage, dir, dev, state] = process.argv.slice(2),
  read = (path, n) => JSON.parse(readFileSync(join(path, n + ".json")));
const series = "recompra-iowa",
  cohorts = [2018, 2019].flatMap((year) =>
    ["260", "421"].map((v) => ({
      id: "ia-" + v + "-" + year,
      merchant: "vendor-" + v,
      cutoff: year + "-04-01",
    })),
  );
const book = new DecisionBook(join(dir, "decisions.sqlite"));
try {
  if (stage === "freeze") {
    const hist = read(dev, "packet"),
      s = new Semar(":memory:");
    try {
      s.restore(
        JSON.parse(gunzipSync(readFileSync(join(state, "bitacora.json.gz")))),
        read(state, "avance").audit.tip,
      );
      const layout = s.layout();
      const inputs = cohorts.map((c) => ({
        brief: {
          ...c,
          niche: "iowa-wholesale",
          mode: "HISTORICAL",
          currency: "USD",
          seats: 40,
          minutes: 480,
          minutesPerAccount: 10,
          researchCents: 2000,
          source:
            "Iowa Alcoholic Beverages Division / gatewaycat data.parquet / SHA256 5c73d802109e24c5160d3920c8821e37d3b60132bfc287ae1b66bae95bb077aa",
          trial: null,
        },
        packet: {
          ...hist,
          niche: "iowa-wholesale",
          queries: read(dir, c.id + "-cases"),
        },
        probes: [],
      }));
      book.register({
        id: series,
        mode: "HISTORICAL",
        selection:
          "Primeras 200 tiendas elegibles por SHA-256 de ID, sin repetir entre proveedores ni años",
        cohorts: inputs.map(({ brief }) => ({
          id: brief.id,
          cutoff: brief.cutoff,
          accounts: 200,
          briefHash: digest(brief),
        })),
      });
      const seals = {};
      for (const input of inputs) {
        const id = input.brief.id,
          e = book.start(layout, series, input);
        assert.equal(e.data.plan.participants, 100000000);
        assert.equal(
          e.data.plan.decisions.filter((r) => r.action === "PRIORITIZE").length,
          40,
        );
        const event = book.seal(id, e.hash);
        seals[id] = event.data.planHash;
      }
      writeFileSync(
        join(dir, "commitments.json"),
        JSON.stringify(seals, null, 2) + "\n",
      );
      console.log(seals);
    } finally {
      s.close();
    }
  } else if (stage === "grade") {
    const expected = read(dir, "commitments");
    const reference = JSON.parse(
      readFileSync(
        new URL("../../evidence/decision-commitments.json", import.meta.url),
      ),
    );
    assert.deepEqual(expected, reference);
    const reports = [];
    for (const c of cohorts) {
      const { seal, plan } = book.sealed(c.id);
      assert.equal(digest(plan), expected[c.id]);
      const outcomes = read(dir, c.id + "-outcomes");
      const r = book.grade(c.id, seal, {
        asOf: dateAt(utc(c.cutoff) + 30 * DAY),
        source: "Iowa ledger / " + c.id,
        outcomes,
      }).data.result;
      const n = r.scores.deployed;
      const selected = plan.decisions.slice(0, 40);
      const raw = book.history(c.id)[0].data.input.packet.queries;
      const recent = raw
        .toSorted(
          (a, b) =>
            a.features.recency - b.features.recency || a.id.localeCompare(b.id),
        )
        .slice(0, 40);
      const recencyHits = recent.reduce((sum, x) => sum + outcomes[x.id], 0);
      reports.push({
        id: c.id,
        selected: 40,
        deployedHits: n.hits,
        recencyHits,
        buyersIn200: n.observed,
        omittedBuyers: r.omitted.length,
        empiricalBase: n.observed / n.cases,
        precision: n.precision,
        precision95: n.interval95,
        margin: r.margin,
        outcomeHash: r.outcomesHash,
        firstPriority: selected[0],
      });
    }
    const report = {
      series,
      unit: "30-day positive net purchasing from vendor through Iowa's wholesale channel",
      verdict: book.verdict(series),
      reports,
    };
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report.verdict));
  } else throw Error("Usa freeze o grade");
} finally {
  book.close();
}
