import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const read = (file) => JSON.parse(readFileSync(file));
const sha = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
function finished(x, seconds) {
  assert.equal(x.status, "PASSED");
  assert.equal(x.seconds ?? x.targetSeconds, seconds);
  assert.ok(x.elapsedSeconds >= seconds);
  const wall = (Date.parse(x.updated) - Date.parse(x.started)) / 1000;
  assert.ok(
    Math.abs(wall - x.elapsedSeconds) < 5,
    "Duración incompatible con los dos relojes",
  );
}
function cash(x, seconds) {
  finished(x, seconds);
  assert.equal(x.mode, "DEMONSTRATION");
  assert.equal(x.ownRevenue, null);
  assert.ok(x.books > 0);
  assert.equal(x.competingWriters, 4 * x.books);
  assert.equal(x.identicalRetries, x.books);
  assert.equal(x.interruptedWrites, x.books);
  assert.equal(x.wrongReturnsRejected, x.books);
  assert.equal(x.verifiedCloses, 2 * x.books);
  assert.equal(x.transfers, x.books * 5);
}
function validate(r) {
  assert.equal(r.format, 1);
  const { firstAttempt, factory, workshopCash, releaseCash, population } = r;
  assert.equal(firstAttempt.status, "FAILED");
  assert.equal(firstAttempt.seed, factory.seed);
  assert.ok(firstAttempt.rounds < factory.rounds && firstAttempt.rounds > 0);
  assert.equal(
    firstAttempt.error,
    "Movimientos de entrenamiento o examen reutilizados",
  );
  assert.ok(Date.parse(firstAttempt.updated) < Date.parse(factory.started));
  finished(factory, 7200);
  assert.equal(factory.records, 36 * factory.rounds);
  assert.equal(factory.tools, 24 * factory.rounds);
  assert.equal(factory.negativeChecks, factory.rounds);
  assert.ok(factory.fullExports >= 1);
  cash(workshopCash, 4500);
  cash(releaseCash, 2100);
  finished(population, 3900);
  assert.equal(population.populationPerRound, 100000000);
  assert.equal(population.scoredContributions, population.rounds * 100000000);
  assert.equal(
    population.independentlyHashedContributions,
    population.rounds * 10000000,
  );
  assert.equal(population.scoresCompared, population.rounds * 10000);
  assert.equal(population.periodicOriginal, Math.ceil(population.rounds / 5));
  assert.equal(
    population.semanticChanges,
    population.rounds - population.periodicOriginal,
  );
  assert.equal(population.timingsMs.length, population.rounds);
  assert.ok(population.timingsMs.every((n) => Number.isFinite(n) && n > 0));
  assert.match(r.release, /^[0-9a-f]{40}$/);
  assert.ok(
    Object.values(r.runtimes).every((m) =>
      Object.values(m).every((h) => /^[0-9a-f]{64}$/.test(h)),
    ),
  );
  assert.equal(r.ownSalesVerifiedByTheseTests, null);
  return r;
}
function fingerprint(dir, paths) {
  return Object.fromEntries(paths.map((p) => [p, sha(join(dir, p))]));
}
const [mode, location, release] = process.argv.slice(2);
if (mode === "collect") {
  const root = location;
  const { stack, ...firstAttempt } = read(join(root, "endurance.json"));
  const cashSources = [
    "scripts/sale/cash-stress.mjs",
    "scripts/sale/pilot.mjs",
    "src/sale/book.mjs",
    "src/sale/replay.mjs",
    "src/global-desk.mjs",
    ".cache/semar-native",
    ".cache/nexus.mjs",
  ];
  const result = validate({
    format: 1,
    release,
    firstAttempt,
    factory: read(join(root, "endurance-v2.json")),
    workshopCash: read(join(root, "cash-soak.json")),
    releaseCash: read(join(root, "release-cash-soak.json")),
    population: read(join(root, "population-soak.json")),
    runtimes: {
      workshopCash: fingerprint(join(root, "cash-build"), cashSources),
      releaseCash: fingerprint(join(root, "release-soak"), cashSources),
      factoryLearning: fingerprint(".", [
        "scripts/factory/endurance.mjs",
        "scripts/factory/fixtures.mjs",
        "src/factory/discover.mjs",
        "src/factory/reader.mjs",
      ]),
      population: fingerprint(".", [
        "scripts/sale/scale-endurance.mjs",
        "src/sale/search.mjs",
        "native/offers.cpp",
        ".cache/semar-native",
      ]),
    },
    ownSalesVerifiedByTheseTests: null,
    scope:
      "La fábrica repite expedientes generados y exporta herramientas durante dos horas. Los libros contables usan pedidos y movimientos generados para la prueba. La última serie contable parte de una copia congelada de la versión publicada. El censo vuelve a usar los mismos fundadores y modifica los datos entre rondas.",
  });
  console.log(JSON.stringify(result, null, 2));
} else if (mode === "verify") {
  const r = validate(read(location));
  console.log(
    "Verificadas duraciones, contadores e identidades de las series terminadas: " +
      r.release,
  );
} else throw Error("Usa collect DIRECTORIO SHA_PUBLICO o verify RESULTADO");
