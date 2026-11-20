import { founderRanges } from "../population-research.mjs";
import { hash, check, num } from "../factory/reader.mjs";
import { catalogue, adjusted } from "./policy.mjs";
import { auditSector, histogramSearch } from "./search.mjs";

export function verifyParticipation(
  layout,
  packet,
  report,
  expected,
  population,
) {
  num(population, 10, 100000000);
  const stage = report.measurements.find((m) => m.participants === population),
    cert = expected.workers.find((m) => m.population === population);
  check(
    stage &&
      cert &&
      expected.seal === report.seal &&
      hash(report.recipe) === report.recipeHash &&
      hash([packet.fit, packet.search, packet.validation]) ===
        report.recipe.training,
    "Catálogo o datos distintos del examen",
  );
  check(
    stage.checkpoint === layout.checkpoint &&
      hash(stage.sectors) === cert.sectorSeals,
    "Padrón o recibos distintos de los publicados",
  );
  const rows = packet.search.map((r) =>
      adjusted(r, report.recipe.model, packet.design),
    ),
    rules = catalogue(packet.design, stage.policies);
  check(
    rows.length * rules.length === population && rows.length % 10 === 0,
    "Cobertura de tareas distinta del padrón",
  );
  const ranges = founderRanges(layout, population / 10),
    n = rows.length / 10,
    total = histogramSearch(rows, rules).sums;
  check(
    hash(total) === cert.scoresHash && hash(total) === stage.scoresHash,
    "Totales distintos de los publicados",
  );
  const sectors = ranges.map((rs, i) => {
    const sector = stage.sectors[i];
    check(
      sector.sector === i + 1 &&
        sector.participants === population / 10 &&
        hash(sector.ranges) === hash(rs),
      "Rangos de identidades alterados",
    );
    const seal = auditSector(rows.slice(i * n, (i + 1) * n), rules, rs);
    check(
      seal === sector.seal,
      "Un fundador tiene una contribución distinta en el sector " + (i + 1),
    );
    return {
      sector: i + 1,
      people: rs.reduce((v, [a, b]) => v + b - a + 1, 0),
      seal,
    };
  });
  return {
    status: "ALL_CONTRIBUTIONS_REPRODUCED",
    recipe: report.recipeHash,
    checkpoint: layout.checkpoint,
    population,
    customers: rows.length,
    policies: rules.length,
    scoreHash: stage.scoresHash,
    nativeSectorCommitment: cert.sectorSeals,
    sectors,
    source:
      "Reproducción independiente en JavaScript de cada identidad, acción y contribución sellada en C++.",
  };
}
