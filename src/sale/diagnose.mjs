import { strict } from "../policy.mjs";
import { check, num, key, unique, list, hash } from "../factory/reader.mjs";

function utc(s) {
  const t = Date.parse(s);
  check(
    typeof s === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(t) &&
      new Date(t).toISOString().slice(0, 10) === s,
    "Fecha inválida",
  );
  return t;
}
function code(x) {
  check(
    typeof x === "string" && x.length > 0 && x.length <= 128,
    "Referencia ausente",
  );
  return x;
}
export function priceEvidence(c) {
  strict(c, [
    "id",
    "invoice",
    "row",
    "day",
    "sku",
    "store",
    "listed",
    "units",
    "prior",
  ]);
  key(c.id);
  [c.invoice, c.sku, c.store].forEach(code);
  num(c.row, 0, 1e10);
  num(c.listed, 1, 1e7);
  num(c.units, 1, 1e4);
  const date = utc(c.day),
    refs = list(c.prior, 0, 128),
    seen = new Set(),
    by = new Map();
  for (const q of refs) {
    strict(q, ["invoice", "row", "sku", "store", "day", "unit"]);
    [q.invoice, q.store].forEach(code);
    num(q.row, 0, 1e10);
    num(q.unit, 1, 1e7);
    const t = utc(q.day);
    check(
      t < date &&
        date - t <= 21 * 86400000 &&
        q.sku === c.sku &&
        q.invoice !== c.invoice &&
        q.row !== c.row,
      "Referencia ajena o posterior al corte",
    );
    const id = q.store + "/" + q.day;
    check(!seen.has(id), "Comercio y día duplicados");
    seen.add(id);
    const bucket = by.get(q.unit) ?? {
      unit: q.unit,
      refs: [],
      buyers: new Set(),
      days: new Set(),
      latest: 0,
    };
    bucket.refs.push(q);
    bucket.buyers.add(q.store);
    bucket.days.add(q.day);
    bucket.latest = Math.max(bucket.latest, t);
    by.set(q.unit, bucket);
  }
  const ranked = [...by.values()].sort(
    (a, b) =>
      b.refs.length - a.refs.length || b.latest - a.latest || a.unit - b.unit,
  );
  const winner = ranked[0],
    stable =
      winner && (!ranked[1] || ranked[1].refs.length < winner.refs.length);
  const supported = winner
    ? {
        unit: winner.unit,
        documents: winner.refs.map((r) => ({ invoice: r.invoice, row: r.row })),
        shops: winner.buyers.size,
        days: winner.days.size,
        age: (date - winner.latest) / 86400000,
        agreement: winner.refs.length / refs.length,
      }
    : null;
  return {
    declared: c.listed,
    modal: stable ? supported : null,
    recent:
      refs.toSorted(
        (a, b) =>
          b.day.localeCompare(a.day) || a.invoice.localeCompare(b.invoice),
      )[0]?.unit ?? null,
  };
}
export function predictPrice(c, rule) {
  const evidence = priceEvidence(c),
    m = evidence.modal;
  const eligible =
    !!m &&
    m.shops >= rule.shops &&
    m.days >= rule.days &&
    m.age <= rule.age &&
    m.agreement * 100 >= rule.percent;
  const chosen = rule.usePrior && eligible ? m.unit : c.listed;
  const hypotheses = [{ method: "listed", cents: c.listed * c.units }];
  if (m)
    hypotheses.push({ method: "prior-consensus", cents: m.unit * c.units });
  if (evidence.recent !== null)
    hypotheses.push({
      method: "latest-transaction",
      cents: evidence.recent * c.units,
    });
  const divergent = new Set(hypotheses.map((h) => h.cents)).size > 1;
  return {
    id: c.id,
    cents: chosen * c.units,
    listedCents: c.listed * c.units,
    appliedPrior: !!(rule.usePrior && eligible && chosen !== c.listed),
    evidence,
    hypotheses,
    verifiedCause: divergent ? "AWAIT_PRIMARY_DOCUMENT" : "UNTESTED",
    question: divergent
      ? {
          document:
            "Tarifa vigente o factura original con el precio unitario aplicable",
          sku: c.sku,
          day: c.day,
          invoice: c.invoice,
          distinguish: [
            ...new Set(hypotheses.map((h) => h.cents / c.units)),
          ].sort((a, b) => a - b),
        }
      : null,
  };
}
function candidates() {
  const options = [
    { usePrior: false, shops: 1, days: 1, age: 21, percent: 50 },
  ];
  for (const shops of [2, 3, 5])
    for (const days of [1, 2, 3])
      for (const age of [2, 7, 21])
        for (const percent of [66, 80, 100])
          options.push({ usePrior: true, shops, days, age, percent });
  return options;
}
function labelsFor(cases, labels) {
  unique(cases.map((c) => c.id));
  unique(labels.map((r) => r.id));
  check(cases.length === labels.length, "Etiquetas incompletas");
  const by = new Map(
    labels.map((r) => {
      strict(r, ["id", "cents"]);
      key(r.id);
      return [r.id, num(r.cents, -1e11, 1e11)];
    }),
  );
  check(
    cases.every((c) => by.has(c.id)),
    "Caso sin desenlace",
  );
  return by;
}
export function learnPrice(groups) {
  list(groups, 2, 10);
  unique(groups.map((g) => g.id));
  unique(groups.flatMap((g) => g.cases.map((c) => c.id)));
  const data = groups.map((g) => ({
    cases: g.cases,
    truth: labelsFor(g.cases, g.labels),
  }));
  const tested = candidates().map((rule) => {
    const results = data.map((g) => {
      let exact = 0,
        absoluteError = 0;
      for (const c of g.cases) {
        const error = Math.abs(predictPrice(c, rule).cents - g.truth.get(c.id));
        exact += Number(error === 0);
        absoluteError += error;
      }
      return { exact, absoluteError };
    });
    return {
      rule,
      results,
      exact: results.reduce((a, r) => a + r.exact, 0),
      absoluteError: results.reduce((a, r) => a + r.absoluteError, 0),
    };
  });
  const base = tested[0],
    eligible = tested.filter((t) =>
      t.results.every(
        (r, i) =>
          r.exact >= base.results[i].exact &&
          r.absoluteError <= base.results[i].absoluteError,
      ),
    );
  const selected = eligible.sort(
    (a, b) => b.exact - a.exact || a.absoluteError - b.absoluteError,
  )[0];
  return {
    rule: selected.rule,
    tried: tested.length,
    training: selected.results,
    baseline: base.results,
    trainingHash: hash(groups),
    latestTrainingDay: groups
      .flatMap((g) => g.cases.map((r) => r.day))
      .sort()
      .at(-1),
  };
}
export function freezePrices(model, groups) {
  unique(groups.flatMap((g) => g.cases.map((c) => c.id)));
  check(
    groups.every((g) => g.cases.every((c) => c.day > model.latestTrainingDay)),
    "Periodo de prueba reutilizado",
  );
  const predictions = groups.map((g) => ({
    id: g.id,
    source: hash(g.cases),
    rows: g.cases.map((c) => predictPrice(c, model.rule)),
  }));
  return { model, predictions, seal: hash([model, predictions]) };
}
export function gradePrices(frozen, answers) {
  check(
    frozen.seal === hash([frozen.model, frozen.predictions]),
    "Predicciones alteradas",
  );
  unique(answers.map((a) => a.id));
  check(answers.length === frozen.predictions.length, "Faltan periodos");
  return frozen.predictions.map((g) => {
    const data = answers.find((a) => a.id === g.id);
    check(data, "Periodo desconocido");
    const truth = labelsFor(g.rows, data.labels);
    let exact = 0,
      baseline = 0,
      fixed = 0,
      broken = 0,
      absoluteError = 0,
      baselineError = 0,
      questions = 0;
    const errors = [];
    for (const r of g.rows) {
      const y = truth.get(r.id);
      exact += Number(r.cents === y);
      baseline += Number(r.listedCents === y);
      fixed += Number(r.cents === y && r.listedCents !== y);
      broken += Number(r.cents !== y && r.listedCents === y);
      absoluteError += Math.abs(r.cents - y);
      baselineError += Math.abs(r.listedCents - y);
      questions += Number(!!r.question);
      if (r.cents !== y)
        errors.push({
          id: r.id,
          predicted: r.cents,
          observed: y,
          primaryDocument:
            r.question?.document ?? "Factura original de la partida",
        });
    }
    return {
      period: g.id,
      cases: g.rows.length,
      exact,
      baseline,
      fixed,
      broken,
      absoluteError,
      baselineError,
      questions,
      errors,
    };
  });
}

export function diagnosticVerdict(periods) {
  check(periods.length >= 2, "Se requieren dos periodos reservados");
  const stable = periods.every(
    (p) => p.exact >= p.baseline && p.absoluteError <= p.baselineError,
  );
  const improved = periods.some(
    (p) => p.exact > p.baseline || p.absoluteError < p.baselineError,
  );
  return stable && improved ? "READY_FOR_NEW_FIELD_TEST" : "KEEP_LISTED_PRICE";
}
