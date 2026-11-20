import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
} else if (stage === "grade")
  console.log(
    JSON.stringify(
      gradeProspects(
        read(path),
        packet.holdout,
        read(join(dir, "answers.json")),
        read(commit).seal,
      ),
      null,
      2,
    ),
  );
else throw Error("Usa freeze DIRECTORIO o grade DIRECTORIO COMPROMISO");
