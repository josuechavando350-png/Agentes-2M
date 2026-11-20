import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Semar } from "../../src/semar.mjs";
import { prepareSearch, gradeSearch } from "../../src/sale/search.mjs";
import { hash, check } from "../../src/factory/reader.mjs";
const [stage, directory, statePath, commitment] = process.argv.slice(2);
const read = (name) =>
  JSON.parse(readFileSync(join(directory, name + ".json")));
const write = (name, o) =>
  writeFileSync(join(directory, name + ".json"), JSON.stringify(o) + "\n", {
    flag: "wx",
  });
const packet = read("packet");
if (stage === "freeze") {
  const store = new Semar(":memory:");
  try {
    const tip = JSON.parse(readFileSync(join(statePath, "avance.json"))).audit
      .tip;
    store.restore(
      JSON.parse(gunzipSync(readFileSync(join(statePath, "bitacora.json.gz")))),
      tip,
    );
    const run = prepareSearch(store.layout(), packet);
    write("frozen", run);
    const receipt = {
      policy: run.recipeHash,
      seal: run.seal,
      features: run.holdoutHash,
      source: "Hillstrom / MineThatData 2008",
      sample: run.support,
      comparisons: run.measurements.map((m) => m.participants),
      roster: tip,
    };
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    store.close();
  }
} else if (stage === "grade") {
  const r = read("frozen"),
    seal = JSON.parse(
      readFileSync(
        commitment ?? new URL("../../evidence/sale-seal.json", import.meta.url),
      ),
    );
  check(
    seal.seal === r.seal && seal.policy === r.recipeHash,
    "El examen difiere de su compromiso publicado",
  );
  const score = gradeSearch(r, packet.holdout, read("outcomes"));
  console.log(
    JSON.stringify(
      {
        ...score,
        baseline: r.simple,
        routing: r.routing,
        workers: r.measurements.map((m) => ({
          population: m.participants,
          rules: m.policies,
          distinctTrainingDecisions: m.distinctDecisions,
          independentCustomers: r.support.search,
          sourceExperiments: 1,
          selected: m.selected,
          equalsSingleWorker: m.singleWorkerExact,
          compressedAdditions: m.oneWorkerAdditions,
          scoresHash: m.scoresHash,
          sectorSeals: hash(m.sectors),
          populationMs: m.populationMs,
          oneWorkerMs: m.oneWorkerMs,
        })),
        hardware: r.hardware,
      },
      null,
      2,
    ),
  );
} else throw Error("Usa freeze DIR ESTADO o grade DIR ESTADO SELLO");
