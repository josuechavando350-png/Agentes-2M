import { createHash } from "node:crypto";
import { digest, integer, strict } from "./policy.mjs";

export function label(s, limit = 180) {
  if (typeof s !== "string" || !s.trim() || s.length > limit)
    throw Error("Texto ausente o demasiado largo");
  return s;
}
export function token(s) {
  if (typeof s !== "string" || !/^[a-z][a-z0-9_-]{0,62}$/.test(s))
    throw Error("Identificador inválido");
  return s;
}
export function freezeDocument(doc) {
  if (Object.hasOwn(doc, "publicRecord")) {
    strict(doc, ["id", "source", "publicRecord"]);
    const record = doc.publicRecord;
    token(doc.id);
    label(doc.source, 256);
    if (
      new URL(doc.source).origin !== "https://postor.com.mx" ||
      ![record.postor_url, record.fuente].includes(doc.source)
    )
      throw Error("Ficha de Postor inválida");
    const fields = {
      dependencia: "buyer",
      nombre_procedimiento: "problem",
      tipo_procedimiento: "alternative",
      fecha_apertura: "opening",
      source_url: "primary",
      numero_procedimiento: "procedure",
      status: "public_status",
    };
    const rows = [],
      locators = [];
    for (const [key, field] of Object.entries(fields)) {
      if (typeof record[key] !== "string" || !record[key].trim()) continue;
      rows.push({ subject: doc.id, field, value: record[key] });
      locators.push({
        row: rows.length,
        pointer: "/" + key,
        quote: record[key],
      });
    }
    const converted = freezeDocument({ id: doc.id, source: doc.source, rows });
    return {
      ...converted,
      locators,
      sha256: digest(record),
      attribution: "Postor Abierto · CC BY 4.0",
    };
  }
  if (Object.hasOwn(doc, "text")) {
    strict(doc, ["id", "source", "text"]);
    token(doc.id);
    label(doc.source, 256);
    label(doc.text, 64000);
    const rows = [],
      locators = [];
    for (const [i, line] of doc.text.split(/\r?\n/).entries()) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const match =
        /^([a-z][a-z0-9_-]{0,62})\.([a-z][a-z0-9_-]{0,62})\s*=\s*(.+)$/.exec(
          line,
        );
      if (!match) throw Error("Línea de evidencia inválida: " + (i + 1));
      const raw = match[3].trim(),
        value = /^-?(0|[1-9]\d*)$/.test(raw) ? Number(raw) : raw;
      rows.push({ subject: match[1], field: match[2], value });
      locators.push({ row: i + 1, quote: line });
    }
    const expanded = freezeDocument({ id: doc.id, source: doc.source, rows });
    return {
      ...expanded,
      locators,
      sha256: createHash("sha256").update(doc.text).digest("hex"),
    };
  }
  strict(doc, ["id", "source", "rows"]);
  token(doc.id);
  label(doc.source, 256);
  if (!Array.isArray(doc.rows) || !doc.rows.length || doc.rows.length > 256)
    throw Error("Documento sin filas válidas");
  for (const row of doc.rows) {
    strict(row, ["subject", "field", "value"]);
    token(row.subject);
    token(row.field);
    if (typeof row.value === "number")
      integer(row.value, -1_000_000_000, 1_000_000_000, "importe o cantidad");
    else label(row.value, 4000);
  }
  return { ...doc, sha256: digest(doc) };
}
export function checkQuery(q) {
  strict(q, ["subject", "op", "fields"]);
  token(q.subject);
  const arity = { lookup: 1, difference: 2, product: 2 };
  if (
    !Object.hasOwn(arity, q.op) ||
    !Array.isArray(q.fields) ||
    q.fields.length !== arity[q.op] ||
    new Set(q.fields).size !== q.fields.length
  )
    throw Error("Consulta inválida");
  q.fields.forEach(token);
}
function calculate(q, values) {
  if (q.op === "lookup") return values[0];
  if (!values.every(Number.isSafeInteger)) return null;
  const v =
    q.op === "difference" ? values[0] - values[1] : values[0] * values[1];
  return Number.isSafeInteger(v) ? v : null;
}
function ref(doc, idx) {
  return {
    document: doc.id,
    source: doc.source,
    sha256: doc.sha256,
    ...(doc.locators?.[idx] ?? { row: idx + 1 }),
  };
}
function assess(q, columns, first = false) {
  const refs = columns.flat().map((x) => x.ref);
  const groups = columns.map((c) => new Set(c.map((x) => x.value)));
  if (!first && groups.some((g) => g.size > 1))
    return { status: "CONFLICTED", value: null, refs };
  if (groups.some((g) => !g.size))
    return { status: "UNKNOWN", value: null, refs };
  const value = calculate(
    q,
    columns.map((c) => c[0].value),
  );
  return { status: value === null ? "UNKNOWN" : "SUPPORTED", value, refs };
}
export const POLICIES = ["first", "crosscheck", "indexed"];
// These strategies never receive answer labels or other investigators' findings.
export function investigate(docs, q, policy = "indexed") {
  checkQuery(q);
  if (!POLICIES.includes(policy)) throw Error("Estrategia desconocida");
  let cost = 0;
  const columns = q.fields.map(() => []);
  if (policy === "indexed") {
    const keys = new Map(q.fields.map((f, i) => [f, i]));
    for (const doc of docs)
      doc.rows.forEach((r, i) => {
        cost++;
        if (r.subject === q.subject && keys.has(r.field))
          columns[keys.get(r.field)].push({ value: r.value, ref: ref(doc, i) });
      });
  } else {
    for (const [k, field] of q.fields.entries())
      for (const doc of docs) {
        for (const [i, r] of doc.rows.entries()) {
          cost++;
          if (r.subject === q.subject && r.field === field) {
            columns[k].push({ value: r.value, ref: ref(doc, i) });
            if (policy === "first") break;
          }
        }
        if (policy === "first" && columns[k].length) break;
      }
  }
  return { ...assess(q, columns, policy === "first"), cost };
}
// The referee checks agreement on each operand directly against source rows. The
// counterfactual removes each cited document and reruns the question independently.
export function referee(docs, q) {
  checkQuery(q);
  const inspected = docs
    .flatMap((doc) => doc.rows.map((r, i) => ({ ...r, ref: ref(doc, i) })))
    .filter((r) => r.subject === q.subject);
  const values = [],
    refs = [];
  let missing = false,
    conflict = false;
  for (const field of q.fields) {
    const matches = inspected.filter((r) => r.field === field);
    refs.push(...matches.map((r) => r.ref));
    if (!matches.length) missing = true;
    else {
      values.push(matches[0].value);
      if (matches.some((r) => r.value !== matches[0].value)) conflict = true;
    }
  }
  let status = conflict ? "CONFLICTED" : missing ? "UNKNOWN" : "SUPPORTED";
  let value = null;
  if (status === "SUPPORTED") {
    if (q.op === "lookup") value = values[0];
    else {
      if (values.every(Number.isSafeInteger)) {
        const [a, b] = values.map(BigInt),
          n = Number(q.op === "difference" ? a - b : a * b);
        if (Number.isSafeInteger(n)) value = n;
      }
      if (value === null) status = "UNKNOWN";
    }
  }
  return { status, value, refs };
}
export function tribunal(docs, q) {
  const proposer = investigate(docs, q, "first"),
    investigator = investigate(docs, q, "indexed"),
    tested = referee(docs, q);
  if (
    investigator.status !== tested.status ||
    investigator.value !== tested.value ||
    digest(investigator.refs) !== digest(tested.refs)
  )
    throw Error("Dictámenes incompatibles");
  const sensitivity = [...new Set(tested.refs.map((r) => r.document))].map(
    (omit) => {
      const { status, value } = referee(
        docs.filter((d) => d.id !== omit),
        q,
      );
      return { omit, status, value };
    },
  );
  return { proposer, investigator, referee: tested, sensitivity };
}
