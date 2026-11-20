import { createHash } from "node:crypto";
import { creditRegister } from "./credits.mjs";

function expect(ok, message) {
  if (!ok) throw Error(message);
}
export function records(input, separator) {
  expect(
    typeof input === "string" && input.length <= 160_000_000,
    "CSV demasiado grande",
  );
  const out = [];
  let fields = [],
    value = "",
    quoted = false,
    closed = false,
    physical = 1,
    start = 1,
    started = false;
  function finish() {
    fields.push(value);
    out.push({ row: start, fields });
    fields = [];
    value = "";
    closed = false;
    started = false;
  }
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        if (c === "\n" || (c === "\r" && input[i + 1] !== "\n")) physical++;
        value += c;
      }
      continue;
    }
    if (c === separator) {
      fields.push(value);
      value = "";
      closed = false;
      started = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      finish();
      physical++;
      start = physical;
    } else if (c === '"') {
      expect(
        !closed && value === "",
        "Comillas inesperadas en fila " + physical,
      );
      quoted = true;
      started = true;
    } else {
      expect(!closed, "Contenido después de comillas en fila " + physical);
      value += c;
      started = true;
    }
  }
  expect(!quoted, "Campo sin comillas de cierre en fila " + start);
  if (started || fields.length) finish();
  return out;
}
function iso(s) {
  expect(
    typeof s === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s),
    "Se requiere fecha y hora UTC explícita",
  );
  const t = Date.parse(s),
    normalized = s.includes(".") ? s : s.slice(0, -1) + ".000Z";
  expect(
    Number.isSafeInteger(t) && new Date(t).toISOString() === normalized,
    "Fecha UTC inexistente",
  );
  return t;
}
const columns = [
  "id",
  "party",
  "sku",
  "price",
  "qty",
  "time",
  "invoice",
  "currency",
];
export function importCreditCsv(bytes, settings) {
  expect(
    bytes instanceof Uint8Array && bytes.byteLength <= 160_000_000,
    "CSV fuera de límite",
  );
  const configKeys = [
    "currency",
    "decimal",
    "delimiter",
    "fields",
    "from",
    "maxAgeDays",
    "until",
  ].sort();
  expect(
    JSON.stringify(Object.keys(settings).sort()) === JSON.stringify(configKeys),
    "Configuración CSV incompleta",
  );
  const { delimiter, decimal, fields } = settings;
  expect(
    [",", ";", "\t"].includes(delimiter) && [".", ","].includes(decimal),
    "Separador o decimal desconocido",
  );
  expect(
    JSON.stringify(Object.keys(fields).sort()) ===
      JSON.stringify(columns.toSorted()) &&
      new Set(Object.values(fields)).size === columns.length,
    "Mapeo de columnas incompleto o repetido",
  );
  const data = records(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    delimiter,
  );
  expect(data.length >= 2, "CSV sin datos");
  const header = data[0].fields;
  expect(new Set(header).size === header.length, "Encabezado ambiguo");
  const map = Object.fromEntries(
    columns.map((k) => {
      const index = header.indexOf(fields[k]);
      expect(index >= 0, "Columna ausente: " + fields[k]);
      return [k, index];
    }),
  );
  const packet = {
    source: createHash("sha256").update(bytes).digest("hex"),
    currency: settings.currency,
    from: iso(settings.from),
    until: iso(settings.until),
    maxAgeDays: settings.maxAgeDays,
    lines: data.slice(1).map(({ row, fields: values }) => {
      try {
        expect(
          values.length === header.length,
          "Número de columnas incorrecto",
        );
        const f = (k) => values[map[k]];
        expect(
          f("currency") === settings.currency,
          "Moneda distinta de la declarada",
        );
        const price = f("price").split(decimal);
        expect(
          price.length <= 2 &&
            /^\d{1,8}$/.test(price[0]) &&
            (price.length === 1 || /^\d{1,2}$/.test(price[1])),
          "Precio sin representación exacta en centavos",
        );
        expect(/^-?\d{1,8}$/.test(f("qty")), "Cantidad inválida");
        return {
          id: f("id"),
          party: f("party"),
          sku: f("sku"),
          price:
            Number(price[0]) * 100 + Number((price[1] ?? "").padEnd(2, "0")),
          qty: Number(f("qty")),
          time: iso(f("time")),
          invoice: f("invoice"),
          row,
        };
      } catch (e) {
        throw Error("Fila " + row + ". " + e.message);
      }
    }),
  };
  creditRegister(packet);
  return packet;
}
function cell(v) {
  let s = String(v);
  if (typeof v === "string" && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(s))
    s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function registerCsv(result) {
  const keys = [
    "id",
    "invoice",
    "row",
    "party",
    "sku",
    "price",
    "units",
    "minBacked",
    "maxBacked",
    "unavoidableUnmatched",
    "unavoidableCents",
    "ambiguous",
    "leftCensored",
  ];
  return (
    [keys, ...result.rows.map((r) => keys.map((k) => r[k]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n") + "\r\n"
  );
}
