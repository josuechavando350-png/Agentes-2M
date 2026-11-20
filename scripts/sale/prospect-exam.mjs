import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { hash } from "../../src/factory/reader.mjs";
import { prepareProspects, gradeProspects } from "../../src/sale/prospects.mjs";
const [stage, dir, commit] = process.argv.slice(2),
  read = (f) => JSON.parse(readFileSync(f)),
  packet = read(join(dir, "packet.json")),
  path = join(dir, "frozen.json");
if (stage === "freeze") {
  const f = prepareProspects(packet);
  writeFileSync(path, JSON.stringify(f) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        source: packet.source,
        seal: f.seal,
        recipe: hash(f.recipe),
        features: f.features,
        support: f.support,
        modelsExamined: f.modelsExamined,
        acceptance: f.acceptance,
        labelsExcluded: [
          "resultado actual",
          "duración de la llamada",
          "datos socioeconómicos individuales",
          "variables macroeconómicas",
        ],
        capacity:
          "Hasta una quinta parte de cada lote de 100 registros sucesivos",
      },
      null,
      2,
    ),
  );
} else if (stage === "grade") {
  const frozen = read(path),
    published = read(commit);
  for (const name of [
    "acceptance",
    "features",
    "support",
    "modelsExamined",
    "seal",
  ])
    assert.deepEqual(frozen[name], published[name], name);
  assert.equal(frozen.recipe.source, published.source);
  assert.equal(hash(frozen.recipe), published.recipe);
  console.log(
    JSON.stringify(
      gradeProspects(
        frozen,
        packet.holdout,
        read(join(dir, "answers.json")),
        published.seal,
      ),
      null,
      2,
    ),
  );
} else throw Error("Usa freeze DIRECTORIO o grade DIRECTORIO COMPROMISO");
