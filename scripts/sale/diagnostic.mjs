import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  learnPrice,
  predictPrice,
  freezePrices,
  gradePrices,
  diagnosticVerdict,
} from "../../src/sale/diagnose.mjs";
import { check } from "../../src/factory/reader.mjs";
const [stage, dir, sealPath] = process.argv.slice(2),
  read = (name) => JSON.parse(readFileSync(join(dir, name + ".json")));
const groups = (ids) => ids.map((id) => ({ id, cases: read(id + "-cases") }));
const labels = (ids) =>
  ids.map((id) => ({ id, labels: read(id + "-answers") }));
const development = ["dev-a", "dev-b"],
  future = ["future-a", "future-b"];
if (stage === "freeze") {
  const model = learnPrice(
    groups(development).map((g, i) => ({
      ...g,
      labels: labels(development)[i].labels,
    })),
  );
  const frozen = freezePrices(model, groups(future));
  writeFileSync(join(dir, "frozen.json"), JSON.stringify(frozen) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify(
      {
        seal: frozen.seal,
        training: model.trainingHash,
        periods: future,
        observations: frozen.predictions.map((g) => g.rows.length),
        hypotheses: [
          "precio declarado",
          "precio efectivo más reciente",
          "consenso de precios efectivos anteriores",
        ],
        excluded: "Indicador Anomalous derivado del importe objetivo",
      },
      null,
      2,
    ),
  );
} else if (stage === "grade") {
  const frozen = read("frozen"),
    commit = JSON.parse(readFileSync(sealPath));
  check(frozen.seal === commit.seal, "Sello diferente al publicado");
  const original = groups(["old-errors"])[0],
    a = labels(["old-errors"])[0].labels,
    by = new Map(a.map((r) => [r.id, r.cents]));
  const earlier = original.cases.map((c) => {
    const y = by.get(c.id),
      r = predictPrice(c, frozen.model.rule);
    return {
      id: c.id,
      observed: y,
      listed: r.listedCents,
      model: r.cents,
      consistent: r.hypotheses
        .filter((h) => h.cents === y)
        .map((h) => h.method),
      cause: r.verifiedCause,
      request: r.question,
    };
  });
  const periods = gradePrices(frozen, labels(future));
  console.log(
    JSON.stringify(
      {
        source: "Iowa Alcoholic Beverages Division / gatewaycat 1ee2a06",
        mode: "historical chronological",
        model: frozen.model,
        seal: frozen.seal,
        periods,
        verdict: diagnosticVerdict(periods),
        previouslyOpened: earlier,
        ownReceipts: null,
      },
      null,
      2,
    ),
  );
} else throw Error("Usa freeze DIRECTORIO o grade DIRECTORIO SELLO");
