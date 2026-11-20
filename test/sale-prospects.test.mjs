import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareProspects,
  gradeProspects,
  rankProspects,
  uniformQueueDistribution,
  queueMetrics,
} from "../src/sale/prospects.mjs";
import { hash } from "../src/factory/reader.mjs";

const rows = (start, n, observed) =>
  Array.from({ length: n }, (_, i) => {
    const x = [i % 2, i % 3];
    return {
      id: "c-" + (start + i),
      x,
      ...(observed ? { accepted: x[0] } : {}),
    };
  });
const data = {
  source: hash("test"),
  schema: [
    ["uno", [1]],
    ["dos", [1, 2]],
  ],
  fit: rows(0, 150, true),
  select: rows(150, 200, true),
  calibrate: rows(350, 100, true),
  holdout: rows(450, 407, false),
};
const frozen = prepareProspects(data),
  answers = data.holdout.map(({ id, x }) => ({ id, accepted: x[0] }));

test("Priorizar preserva el cupo, el orden reproducible y la separación del entrenamiento", () => {
  const fp = hash(frozen.recipe),
    a = rankProspects(frozen.recipe, fp, data.holdout, 20);
  assert.deepEqual(
    a,
    rankProspects(frozen.recipe, fp, data.holdout.toReversed(), 20),
  );
  assert.equal(a.selected.length, 20);
  assert.equal(a.receipts, null);
  assert.deepEqual(
    rankProspects(frozen.recipe, fp, data.holdout, 0).selected,
    [],
  );
  assert.throws(() =>
    rankProspects(frozen.recipe, "a".repeat(64), data.holdout, 20),
  );
  assert.throws(() => rankProspects(frozen.recipe, fp, data.holdout, 408));
  const extra = structuredClone(data);
  extra.holdout[0].accepted = 1;
  assert.throws(() => prepareProspects(extra));
  const overlap = structuredClone(data);
  overlap.select[0].id = overlap.fit[0].id;
  assert.throws(() => prepareProspects(overlap));
  const changed = structuredClone(data);
  changed.holdout[0].x[1] = 8;
  const fresh = prepareProspects(changed);
  assert.equal(hash(fresh.recipe), fp);
  assert.notEqual(fresh.seal, frozen.seal);
});
test("La calificación identifica cambios y solo acepta las respuestas del examen sellado", () => {
  const r = gradeProspects(
    frozen,
    data.holdout,
    answers.toReversed(),
    frozen.seal,
  );
  assert.equal(r.totals.selected.selected, 81);
  assert.equal(r.totals.selected.hits, 81);
  assert.equal(r.additionalRecordedSubscriptionsVsSimple, 0);
  assert.equal(r.comparisonPassed, false);
  const changed = structuredClone(frozen);
  changed.targets.selected[0].rank += 1;
  assert.throws(() =>
    gradeProspects(changed, data.holdout, answers, frozen.seal),
  );
  assert.throws(() =>
    gradeProspects(frozen, data.holdout.toReversed(), answers, frozen.seal),
  );
  assert.throws(() =>
    gradeProspects(frozen, data.holdout, answers.slice(1), frozen.seal),
  );
  assert.throws(() =>
    gradeProspects(
      frozen,
      data.holdout,
      [...answers.slice(1), answers[1]],
      frozen.seal,
    ),
  );
  assert.throws(() =>
    gradeProspects(
      { ...frozen, support: { ...frozen.support, holdout: 0 } },
      data.holdout,
      answers,
      frozen.seal,
    ),
  );
  assert.throws(() =>
    queueMetrics(
      [frozen.targets.selected[0], frozen.targets.selected[0]],
      answers.slice(0, 2),
    ),
  );
});
test("El control uniforme calcula la distribución sin reemplazo en cada bloque", () => {
  const one = uniformQueueDistribution([1, 1, 0, 0, 0], 1);
  assert.equal(one.expectedHits, 0.4);
  assert.equal(one.probabilityAtLeastObserved, 0.4);
  assert.deepEqual(one.central95, [0, 1]);
  const none = uniformQueueDistribution([0, 1, 1], 1);
  assert.equal(none.expectedHits, 0);
  assert.deepEqual(none.central95, [0, 0]);
  assert.equal(none.probabilityAtLeastObserved, 0);
  const two = uniformQueueDistribution(
    [...Array(100).fill(1), 1, 1, 0, 0, 0],
    21,
  );
  assert.deepEqual(two.central95, [20, 21]);
  assert.equal(two.probabilityAtLeastObserved, 0.4);
});
