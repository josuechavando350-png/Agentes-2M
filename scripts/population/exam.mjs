import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Semar } from "../../src/semar.mjs";
import { admittedModel, gradeAccounts } from "../../src/account-market.mjs";
import { rankMethod, activeProgram } from "../../src/market-methods.mjs";
import archived from "../../evidence/participacion-100m.json" with { type: "json" };
import historical from "../../evidence/metodos-negocio.json" with { type: "json" };
import {
  populationResearch,
  verifyPopulation,
  smallTeamResearch,
  populationVerdict,
} from "../../src/population-research.mjs";
import { digest } from "../../src/policy.mjs";

const [stage, dir, stateDir, baseDir] = process.argv.slice(2);
const read = (dir, name) => JSON.parse(readFileSync(join(dir, name + ".json")));
function write(file, x) {
  const path = join(dir, file + ".json");
  writeFileSync(path + ".tmp", JSON.stringify(x) + "\n");
  renameSync(path + ".tmp", path);
}
if (stage === "packet") {
  const historical = read(dir, "train-cases").slice(0, 500),
    known = read(dir, "train-outcomes"),
    queries = read(dir, "population-cases");
  const seen = new Set(
    ["train", "validation", "test", "reserve"].flatMap((s) =>
      read(dir, s + "-cases").map((r) => r.id),
    ),
  );
  assert.equal(queries.length, 200);
  assert.equal(historical.length, 500);
  assert.ok(queries.every((r) => !seen.has(r.id)));
  write("packet", {
    niche: "comercio-minorista-uci",
    historical,
    outcomes: Object.fromEntries(historical.map((r) => [r.id, known[r.id]])),
    queries,
  });
} else if (stage === "run") {
  const s = new Semar(":memory:");
  try {
    const a = read(stateDir, "avance").audit;
    assert.deepEqual(
      s.restore(
        JSON.parse(
          gunzipSync(readFileSync(join(stateDir, "bitacora.json.gz")), {
            maxOutputLength: 64000000,
          }),
        ),
        a.tip,
      ),
      a,
    );
    const layout = s.layout(),
      packet = read(dir, "packet");
    const result = populationResearch(layout, packet);
    const control = verifyPopulation(layout, packet, result),
      small = smallTeamResearch(layout, packet);
    assert.deepEqual(small.decisions, result.result.decisions.ten);
    assert.equal(control.participants, 100000000);
    const samples = result.result.sectors.map((sector, i) =>
      verifyPopulation(layout, packet, result, sector.ranges.at(-1)[1] - i),
    );
    const previous = read(baseDir, "negocios"),
      model = admittedModel(read(baseDir, "account-policy"), previous);
    const incumbent = rankMethod(
      packet.queries,
      model,
      activeProgram(historical, model, previous.scope),
    );
    write("participacion", result);
    write("sealed", {
      source: result.result.source,
      commitment: result.commitment,
      control,
      small,
      samples,
      incumbent,
      incumbentHash: digest(incumbent),
    });
    console.log(
      JSON.stringify({
        participants: control.participants,
        comparisonsPerSector: control.controlTeam[0].comparisons,
        measurement: result.measurement,
        oracleMs: control.elapsedMs,
        commitment: result.commitment,
      }),
    );
  } finally {
    s.close();
  }
} else if (stage === "judge") {
  const report = read(dir, "participacion"),
    frozen = read(dir, "sealed"),
    r = report.result;
  assert.equal(report.commitment, digest(r));
  assert.equal(report.commitment, frozen.commitment);
  assert.equal(frozen.source, r.source);
  if (archived.input === r.source && archived.commitment !== report.commitment)
    throw Error("La reserva ya se evaluó con otros pronósticos");
  assert.equal(frozen.control.commitment, report.commitment);
  assert.equal(frozen.incumbentHash, digest(frozen.incumbent));
  const y = read(dir, "population-outcomes"),
    grade = (d) => gradeAccounts(d, y);
  assert.deepEqual(frozen.small.decisions, r.decisions.ten);
  const scores = {
    incumbent: grade(frozen.incumbent),
    ...Object.fromEntries(
      Object.entries(r.decisions).map(([k, v]) => [k, grade(v)]),
    ),
  };
  const summary = {
    schema: r.schema,
    source: "Daqing Chen. Online Retail, UCI. DOI 10.24432/C5BW33. CC BY 4.0",
    checkpoint: r.checkpoint,
    input: r.source,
    commitment: report.commitment,
    training: r.historical,
    queries: r.queries,
    participants: r.participants,
    leaders: r.sectors.map((s) => ({
      leader: s.leader,
      sector: s.sector,
      signal: s.signal,
      participants: s.participants,
    })),
    independentlyRecomputed: frozen.control.cells,
    smallTeam: {
      actors: frozen.small.actors,
      comparisons: frozen.small.comparisons,
    },
    sameWorkWithTen: frozen.control.controlTeam,
    scope: r.scope,
    scores,
    decision: populationVerdict(scores),
    paidEvidence: null,
  };
  write("dictamen", summary);
  console.log(JSON.stringify(summary));
} else throw Error("Usa packet, run o judge");
