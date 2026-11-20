import { digest, strict, integer } from "./policy.mjs";
import { checkQuery, referee, token, label, ref } from "./dossiers.mjs";
import { inferRecipe } from "./pilot-delivery.mjs";

export function candidate(sources, d, at) {
  strict(d, [
    "scope",
    "fields",
    "incumbent",
    "examples",
    "testSubjects",
    "labelsHash",
    "until",
  ]);
  token(d.scope);
  if (
    !Array.isArray(d.fields) ||
    d.fields.length < 2 ||
    d.fields.length > 16 ||
    new Set(d.fields).size !== d.fields.length
  )
    throw Error("Variables inválidas");
  d.fields.forEach(token);
  if (
    !Array.isArray(d.testSubjects) ||
    d.testSubjects.length < 2 ||
    d.testSubjects.length > 256 ||
    new Set(d.testSubjects).size !== d.testSubjects.length ||
    !/^[a-f0-9]{64}$/.test(d.labelsHash)
  )
    throw Error("Reserva de examen inválida");
  d.testSubjects.forEach(token);
  integer(d.until, at + 1, at + 365 * 86400000, "vigencia del método");
  strict(d.incumbent, ["op", "fields"]);
  checkQuery({ subject: "caso", ...d.incumbent });
  if (d.incumbent.fields.some((f) => !d.fields.includes(f)))
    throw Error("Control fuera de alcance");
  const subjects = new Set([
    ...d.testSubjects,
    ...d.examples.map((v) => v.subject),
  ]);
  const selected = sources.filter(
    (s) =>
      s.scope === d.scope &&
      s.from <= at &&
      at < s.until &&
      s.document.rows.some(
        (r) => subjects.has(r.subject) && d.fields.includes(r.field),
      ),
  );
  const schema = {};
  const docs = selected.map((s) => {
    const rows = [],
      locators = [];
    for (const [i, r] of s.document.rows.entries()) {
      if (!d.fields.includes(r.field) || !subjects.has(r.subject)) continue;
      if (
        schema[r.field] &&
        digest(schema[r.field]) !== digest(s.schema[r.field])
      )
        throw Error("Esquema de entrenamiento contradictorio");
      schema[r.field] = s.schema[r.field];
      rows.push(r);
      locators.push(ref(s.document, i));
    }
    return { ...s.document, rows, locators };
  });
  const candidate = inferRecipe({ examples: d.examples }, docs, d.testSubjects);
  const predictions = d.testSubjects.map((subject) => {
    const run = (p) => referee(docs, { subject, op: p.op, fields: p.fields });
    return { subject, candidate: run(candidate), incumbent: run(d.incumbent) };
  });
  return {
    ...d,
    candidate,
    schema,
    predictions,
    basis: selected.map((s) => [s.document.id, s.version]),
  };
}
export function examine(c, d) {
  strict(d, ["proposal", "salt", "labels"]);
  label(d.salt, 200);
  if (
    c.labelsHash !== digest({ salt: d.salt, labels: d.labels }) ||
    Object.keys(d.labels).length !== c.testSubjects.length
  )
    throw Error("Clave reservada distinta");
  let gained = 0,
    lost = 0,
    severe = 0;
  const cases = c.predictions.map((p) => {
    if (!Object.hasOwn(d.labels, p.subject))
      throw Error("Caso reservado ausente");
    const expected = d.labels[p.subject];
    if (expected !== null)
      integer(
        expected,
        -Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        "resultado del Oráculo",
      );
    const matches = (r) =>
      expected === null
        ? r.status !== "SUPPORTED"
        : r.status === "SUPPORTED" && r.value === expected;
    const a = matches(p.incumbent),
      b = matches(p.candidate);
    gained += Number(!a && b);
    lost += Number(a && !b);
    severe += Number(!b && p.candidate.status === "SUPPORTED");
    return { subject: p.subject, incumbentCorrect: a, candidateCorrect: b };
  });
  return {
    proposal: d.proposal,
    admitted: gained > 0 && !lost && !severe,
    gained,
    lost,
    severe,
    cases,
  };
}
