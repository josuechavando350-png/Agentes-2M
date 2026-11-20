import { readFileSync, writeFileSync } from "node:fs";
import { fitFormula, generateTools } from "../../src/factory/synth.mjs";
import { hash, check } from "../../src/factory/reader.mjs";
const raw = JSON.parse(
  readFileSync(
    new URL("../../evidence/factory-iowa-sample.json", import.meta.url),
  ),
);
const [training, ...holdouts] = raw.periods,
  record = (r) => ({ precio: r[2], unidades: r[3], costo: r[4] });
const spec = {
  id: "importe",
  purpose: "Reconstruir el importe documentado de la venta",
  columns: [
    { id: "precio", dimension: { cent: 1, botella: -1 } },
    { id: "unidades", dimension: { botella: 1 } },
    { id: "costo", dimension: { cent: 1, botella: -1 } },
  ],
  resultUnit: { cent: 1 },
  examples: training.rows.map((r) => ({ record: record(r), out: r[5] })),
  maxNodes: 5,
  limit: 5000,
};
const strict = fitFormula(spec),
  formulas =
    strict.status === "CANDIDATE"
      ? strict
      : fitFormula(spec, { maxTrainingErrors: 4 });
check(
  ["CANDIDATE", "EXPLORATORY"].includes(formulas.status),
  "Los ejemplos públicos no identifican una fórmula",
);
const source = generateTools([formulas]);
const { apply } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const [mode, path] = process.argv.slice(2);
const forecast = {
  strict: strict.status,
  model: formulas.status,
  trainingErrors: formulas.trainingErrors,
  source: raw.sourceSha256,
  training: training.rows.length,
  rule: formulas.ast,
  tried: formulas.tried,
  generatedCode: hash(source),
  periods: holdouts.map((g) => ({
    year: g.year,
    points: g.rows.map((r) => [r[0], r[1], apply("importe", record(r))]),
  })),
};
if (mode === "freeze")
  writeFileSync(path, JSON.stringify(forecast) + "\n", { flag: "wx" });
else if (mode === "grade") {
  const sealed = JSON.parse(readFileSync(path));
  const commitment = JSON.parse(
    readFileSync(
      new URL("../../evidence/factory-iowa-seal.json", import.meta.url),
    ),
  );
  check(
    hash(sealed) === commitment.sha256 &&
      commitment.source === raw.sourceSha256,
    "Predicción distinta del compromiso publicado",
  );
  check(hash(sealed) === hash(forecast), "Predicciones distintas del sello");
  const periods = holdouts.map((g, i) => {
    const errors = g.rows.flatMap((r, j) =>
      r[5] === sealed.periods[i].points[j][2]
        ? []
        : [
            {
              invoice: r[0],
              expected: r[5],
              predicted: sealed.periods[i].points[j][2],
            },
          ],
    );
    return {
      year: g.year,
      cases: g.rows.length,
      correct: g.rows.length - errors.length,
      knownRuleCorrect: g.rows.filter((r) => r[2] * r[3] === r[5]).length,
      errors,
    };
  });
  console.log(
    JSON.stringify(
      {
        source: raw.attribution,
        training: training.rows.length,
        strict: strict.status,
        model: formulas.status,
        trainingErrors: formulas.trainingErrors,
        formula: formulas.ast,
        sealed: hash(sealed),
        periods,
        property: "agreement with recorded line amounts",
        receiptsCollected: null,
      },
      null,
      2,
    ),
  );
} else throw Error("Usa freeze RUTA o grade RUTA");
