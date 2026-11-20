// Self-contained reader. The running product needs only Node's standard library.
import { createHash } from "node:crypto";
export const hash = (data) =>
  createHash("sha256").update(stable(data)).digest("hex");
function stable(x) {
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(x[k]))
        .join(",") +
      "}"
    );
  if (x === undefined || (typeof x === "number" && !Number.isFinite(x)))
    throw Error("Dato no representable");
  return JSON.stringify(x);
}
export function check(ok, message) {
  if (!ok) throw Error(message);
}
export function fields(object, allowed) {
  check(
    object &&
      typeof object === "object" &&
      !Array.isArray(object) &&
      Object.keys(object).every((k) => allowed.includes(k)),
    "Campos no admitidos",
  );
}
export function key(k) {
  check(
    typeof k === "string" && /^[a-z][a-z0-9_-]{0,62}$/.test(k),
    "Identificador inválido",
  );
  return k;
}
export function num(x, min, max) {
  check(
    Number.isSafeInteger(x) && x >= min && x <= max,
    "Entero fuera de dominio",
  );
  return x;
}
export function list(x, min, max) {
  check(
    Array.isArray(x) && x.length >= min && x.length <= max,
    "Tamaño de lista inválido",
  );
  return x;
}
export function unique(a) {
  check(new Set(a).size === a.length, "Identificadores repetidos");
  return a;
}
export const roles = ["account", "entry", "kind", "amount", "unit"];
const fold = (s) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function grams(x) {
  const s = "^" + fold(x) + "$";
  return new Set(
    Array.from({ length: Math.max(1, s.length - 2) }, (_, i) =>
      s.slice(i, i + 3),
    ),
  );
}
function distance(a, b) {
  const aa = grams(a),
    bb = grams(b);
  return (2 * [...aa].filter((x) => bb.has(x)).length) / (aa.size + bb.size);
}
function prototypes(rows, classes) {
  const items = new Map();
  for (const r of list(rows, 1, 256)) {
    fields(r, ["text", "label"]);
    check(
      typeof r.text === "string" &&
        r.text.length <= 100 &&
        fold(r.text) &&
        classes.includes(r.label),
      "Observación de experto inválida",
    );
    const word = fold(r.text);
    check(
      !items.has(word) || items.get(word) === r.label,
      "Demostraciones contradictorias",
    );
    items.set(word, r.label);
  }
  check(
    classes.every((c) => [...items.values()].includes(c)),
    "Faltan clases demostradas",
  );
  return [...items].sort(([a], [b]) => a.localeCompare(b, "en"));
}
export function trainReader(guide, kinds) {
  fields(guide, ["headers", "movements"]);
  unique(list(kinds, 2, 4).map(key));
  return {
    headers: prototypes(guide.headers, roles),
    movements: prototypes(guide.movements, kinds),
  };
}
function classify(text, model) {
  const scores = new Map();
  for (const [word, cls] of model) {
    const score = fold(text) === word ? 1 : distance(text, word);
    scores.set(cls, Math.max(score, scores.get(cls) ?? 0));
  }
  const [a, b] = [...scores].sort((x, y) => y[1] - x[1]);
  return a[1] >= 0.7 && a[1] - (b?.[1] ?? 0) >= 0.13 ? a[0] : null;
}
export function csv(text) {
  check(
    typeof text === "string" && text.length <= 1000000,
    "Tabla ausente o demasiado grande",
  );
  const table = [];
  let row = [],
    s = "",
    quoted = false,
    ended = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') s += c;
      else if (text[i + 1] === '"') {
        s += '"';
        i++;
      } else {
        quoted = false;
        ended = true;
      }
      continue;
    }
    if (c === '"') {
      check(!ended && !s.length, "Comillas fuera de campo");
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(s);
      s = "";
      ended = false;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(s);
      table.push(row);
      row = [];
      s = "";
      ended = false;
      continue;
    }
    check(!ended, "Texto tras comillas de cierre");
    s += c;
  }
  check(!quoted, "Tabla sin cerrar");
  if (ended || s.length || row.length) {
    row.push(s);
    table.push(row);
  }
  check(
    table.length > 0 && table.length <= 8193 && table[0].length <= 64,
    "Tabla fuera de dominio",
  );
  return table;
}
// Registers attest which records could still arrive. Equal entry keys are one movement per kind.
export function readDossier(c, model, kinds, unit) {
  fields(c, ["id", "sector", "period", "registers", "flags"]);
  key(c.id);
  key(c.sector);
  key(c.period);
  key(unit);
  const events = new Map(),
    issues = [],
    open = [],
    files = new Set(),
    refs = [];
  unique(list(c.registers, 1, 24).map((r) => key(r.id)));
  for (const kind of kinds)
    if (!c.registers.some((r) => r.kind === kind))
      issues.push({ kind, error: "MISSING_REGISTER" });
  for (const reg of c.registers) {
    fields(reg, ["id", "kind", "closed", "account", "limit", "files"]);
    check(
      kinds.includes(reg.kind) && typeof reg.closed === "boolean",
      "Registro sin tipo o cierre",
    );
    list(reg.files, 0, 16);
    if (!reg.closed) {
      check(
        typeof reg.account === "string" &&
          reg.account.length > 0 &&
          reg.account.length <= 128,
        "Falta cuenta del documento pendiente",
      );
      open.push({
        register: reg.id,
        kind: reg.kind,
        account: reg.account,
        limit: num(reg.limit, 0, 1e9),
      });
    }
    for (const f of reg.files) {
      fields(f, ["id", "csv"]);
      key(f.id);
      check(!files.has(f.id), "Archivo repetido");
      files.add(f.id);
      let table;
      try {
        table = csv(f.csv);
      } catch (error) {
        issues.push({ file: f.id, error: error.message });
        continue;
      }
      const columns = table[0].map((s) => classify(s, model.headers));
      const absent = roles.filter(
        (r) => columns.filter((k) => k === r).length !== 1,
      );
      if (absent.length) {
        issues.push({ file: f.id, fields: absent, error: "COLUMN_MAPPING" });
        continue;
      }
      const positions = roles.map((r) => columns.indexOf(r));
      const content = hash(f.csv);
      for (const [idx, row] of table.slice(1).entries()) {
        const ref = { register: reg.id, file: f.id, row: idx + 2, content };
        const [account, entry, raw, amount, currency] = positions.map(
          (i) => row[i]?.trim() ?? "",
        );
        const kind = classify(raw, model.movements);
        if (
          row.length !== columns.length ||
          !account ||
          !entry ||
          account.length > 128 ||
          entry.length > 128 ||
          kind !== reg.kind ||
          fold(currency) !== fold(unit) ||
          !/^\d{1,10}$/.test(amount) ||
          Number(amount) > 1e9
        ) {
          issues.push({ ...ref, error: "UNRESOLVED_ROW" });
          continue;
        }
        const id = JSON.stringify([kind, entry]),
          prior = events.get(id);
        if (
          prior &&
          (prior.account !== account || prior.amount !== Number(amount))
        ) {
          issues.push({
            ...ref,
            error: "CONFLICTING_ENTRY",
            prior: prior.refs[0],
          });
          continue;
        }
        if (prior) prior.refs.push(ref);
        else
          events.set(id, {
            account,
            entry,
            kind,
            amount: Number(amount),
            refs: [ref],
          });
        refs.push(ref);
      }
    }
  }
  check(events.size <= 4096 && open.length <= 8, "Expediente excede el límite");
  const accounts = new Map();
  for (const e of events.values()) {
    if (!accounts.has(e.account))
      accounts.set(
        e.account,
        kinds.map(() => 0),
      );
    accounts.get(e.account)[kinds.indexOf(e.kind)] += e.amount;
  }
  for (const r of open)
    if (!accounts.has(r.account))
      accounts.set(
        r.account,
        kinds.map(() => 0),
      );
  const groups = [...accounts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([account, values]) => ({ account, values }));
  const entries = [...events.values()];
  // Group by economic account, then discard its spelling and movement IDs to detect renamed copies.
  const rowsByAccount = new Map(groups.map((g) => [g.account, []]));
  for (const e of entries)
    rowsByAccount.get(e.account).push([e.kind, e.amount]);
  const pattern = hash(
    entries.length
      ? [...rowsByAccount.values()].map((rows) => rows.sort()).sort()
      : c.registers.flatMap((r) => r.files.map((f) => hash(f.csv))).sort(),
  );
  return {
    pattern,
    id: c.id,
    sector: c.sector,
    period: c.period,
    issues,
    open,
    groups,
    entries,
    refs,
    identity: hash(
      entries.map((e) => [e.account, e.kind, e.entry, e.amount]).sort(),
    ),
  };
}
