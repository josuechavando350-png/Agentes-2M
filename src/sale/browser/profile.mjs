import { records } from "../credit-csv.mjs";

export const columnNames = {
  id: ["ID de línea", "Linea", "id", "lineid", "linea_id"],
  party: ["Cuenta", "Cuenta", "cliente", "customerid", "party"],
  sku: ["Producto", "Producto", "sku", "stockcode"],
  price: ["Precio unitario", "Precio", "unitprice", "price", "preciounitario"],
  qty: ["Cantidad", "Cantidad", "quantity", "qty"],
  time: ["Fecha UTC", "FechaUTC", "fecha", "invoicedate", "time", "timestamp"],
  invoice: ["Factura o nota", "Documento", "factura", "invoice", "invoiceno"],
  currency: ["Moneda", "Moneda", "currency", "divisa"],
};
const normal = (s) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function firstRecord(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (text[i] === "\n" || text[i] === "\r"))
      return text.slice(0, i);
  }
  return text;
}
export function suggestProfile(bytes, preferred) {
  if (bytes.byteLength > 160000000)
    throw Error("Selecciona un CSV de hasta 160 MB");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const header = firstRecord(text);
  const options = [",", ";", "\t"]
    .flatMap((delimiter) => {
      try {
        const names = records(header, delimiter)[0]?.fields;
        return names ? [{ delimiter, names }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.names.length - a.names.length);
  if (
    !options.length ||
    options[0].names.length < 2 ||
    options[0].names.length === options[1]?.names.length
  )
    throw Error("Indica el separador y las columnas de tu archivo");
  const { delimiter, names } = options[0];
  const fields = Object.fromEntries(
    Object.entries(columnNames).map(([k, aliases]) => {
      if (names.includes(preferred.fields[k])) return [k, preferred.fields[k]];
      const accepted = new Set(aliases.map(normal));
      const matches = names.filter((n) => accepted.has(normal(n)));
      return [k, matches.length === 1 ? matches[0] : ""];
    }),
  );
  const prices = new Set(),
    currencies = new Set();
  let from = Infinity,
    until = -Infinity,
    validDates = true;
  const dateIndex = names.indexOf(fields.time),
    amountIndex = names.indexOf(fields.price),
    currencyIndex = names.indexOf(fields.currency);
  for (const { fields: values } of records(text, delimiter).slice(1)) {
    const date = values[dateIndex],
      t = Date.parse(date);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(date ?? "") ||
      !Number.isFinite(t)
    )
      validDates = false;
    else {
      from = Math.min(from, t);
      until = Math.max(until, t);
    }
    currencies.add(values[currencyIndex]);
    const price = values[amountIndex] ?? "";
    for (const d of [".", ","]) if (price.includes(d)) prices.add(d);
  }
  const single = currencies.size === 1 ? [...currencies][0] : "";
  const currency = /^[A-Z]{3}$/.test(single ?? "") ? single : "";
  const complete = validDates && Number.isFinite(from);
  return {
    names,
    profile: {
      currency,
      from: complete ? new Date(from).toISOString() : "",
      until: complete ? new Date(until + 1).toISOString() : "",
      maxAgeDays: preferred.maxAgeDays,
      delimiter,
      decimal:
        prices.size === 0 ? "." : prices.size === 1 ? [...prices][0] : "",
      fields,
    },
  };
}
