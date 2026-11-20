import { columnNames } from "./profile.mjs";
const byId = (id) => document.getElementById(id);
const initial = JSON.parse(byId("initial").textContent);
const workerUrl = URL.createObjectURL(
  new Blob([byId("worker-source").textContent], { type: "text/javascript" }),
);
byId("config").value = JSON.stringify(initial.profile, null, 2);
let source = null,
  worker = null,
  currentPage = 0,
  currency = "",
  generation = 0,
  manualProfile = false;
const input = byId("input"),
  settings = byId("settings");
const profileControls = new Map();
function field(name, title, choices, header = false) {
  const label = document.createElement("label"),
    input = document.createElement(choices ? "select" : "input");
  label.textContent = title;
  input.id = "field-" + name;
  if (choices)
    for (const [value, text] of choices) {
      const option = new Option(text, value);
      input.add(option);
    }
  if (header) input.setAttribute("list", "headers");
  input.required = true;
  label.append(input);
  byId("controls").append(label);
  profileControls.set(name, input);
  input.oninput = () => {
    manualProfile = true;
    reset();
    const values = { fields: {} };
    for (const [k, c] of profileControls) {
      if (k.startsWith("col-")) values.fields[k.slice(4)] = c.value;
      else values[k] = k === "maxAgeDays" ? Number(c.value) : c.value;
    }
    byId("config").value = JSON.stringify(values, null, 2);
  };
  return input;
}
field("currency", "Moneda (ISO)");
field("maxAgeDays", "Plazo de conciliación (días)").type = "number";
field("from", "Inicio del periodo (UTC)");
field("until", "Fin del periodo (UTC)");
field("delimiter", "Separador de columnas", [
  [",", "Coma"],
  [";", "Punto y coma"],
  ["\t", "Tabulación"],
]);
field("decimal", "Separador decimal", [
  ["", "Elegir"],
  [".", "Punto"],
  [",", "Coma"],
]);
for (const [k, [label]] of Object.entries(columnNames))
  field("col-" + k, label, null, true);
function showProfile(profile, names) {
  byId("config").value = JSON.stringify(profile, null, 2);
  for (const [k, c] of profileControls)
    c.value =
      (k.startsWith("col-") ? profile.fields?.[k.slice(4)] : profile[k]) ?? "";
  if (names)
    byId("headers").replaceChildren(...names.map((n) => new Option(n, n)));
}
showProfile(initial.profile, Object.values(initial.profile.fields));
function message(id, value, failed = false) {
  const target = byId(id);
  target.textContent = value;
  target.classList.toggle("error", failed);
}
function reset() {
  generation++;
  worker?.terminate();
  worker = null;
  byId("results").hidden = true;
  byId("run").disabled = !source;
  byId("inspect").disabled = !source;
  byId("check").value = "";
  byId("filter").value = "";
  currentPage = 0;
  message("status", "");
  message("verification", "");
}
function money(cents) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(cents / 100);
}
function page(number) {
  worker?.postMessage({
    type: "page",
    page: number,
    filter: byId("filter").value,
  });
}
function receive({ data }) {
  if (data.type === "error") {
    message(
      ["audit", "inspect"].includes(data.operation) ? "status" : "verification",
      data.error,
      true,
    );
    if (["audit", "inspect"].includes(data.operation))
      byId("run").disabled = !source;
  } else if (data.type === "inspect") {
    showProfile(data.profile, data.names);
    byId("options").open = true;
    byId("run").disabled = false;
    message(
      "status",
      "Se sugirió el periodo entre la primera y la última fila fechada. Revisa las columnas y ajusta las fechas al periodo que cubre tu exportación.",
    );
  } else if (data.type === "audit") {
    const r = data.summary;
    currency = r.currency;
    byId("count").textContent = r.credits.toLocaleString("es-MX");
    byId("backed").textContent = money(r.backedValueCents);
    byId("pending").textContent = money(r.unmatchedValueCents);
    byId("fingerprint").textContent = "SHA-256 del CSV · " + r.source;
    byId("results").hidden = false;
    byId("run").disabled = false;
    message(
      "status",
      r.lines.toLocaleString("es-MX") +
        " partidas conciliadas. Certificado de asignación máxima verificado.",
    );
    page(0);
  } else if (data.type === "page") {
    currentPage = data.page;
    const body = byId("rows");
    body.replaceChildren();
    for (const row of data.rows) {
      const tr = document.createElement("tr");
      for (const s of [
        row.invoice,
        row.party,
        row.sku,
        row.row,
        row.units,
        row.minBacked + "–" + row.maxBacked,
        money(row.unavoidableCents),
      ]) {
        const td = document.createElement("td");
        td.textContent = s;
        tr.append(td);
      }
      body.append(tr);
    }
    const first = data.total ? data.page * 20 + 1 : 0,
      last = Math.min(data.total, (data.page + 1) * 20);
    byId("page-info").textContent = data.total
      ? first +
        "–" +
        last +
        " de " +
        data.total.toLocaleString("es-MX") +
        " notas"
      : "Sin notas coincidentes";
    byId("prev").disabled = data.page === 0;
    byId("next").disabled = last >= data.total;
  } else if (data.type === "existing")
    message(
      "verification",
      "Certificado válido para las " +
        data.lines.toLocaleString("es-MX") +
        " partidas de este archivo.",
    );
  else if (data.type === "download") {
    const url = URL.createObjectURL(
        new Blob([data.content], { type: data.mime }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = data.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
async function processSource(operation) {
  reset();
  const version = generation;
  try {
    const profile =
      operation === "inspect"
        ? initial.profile
        : JSON.parse(byId("config").value);
    if (!source || source.size > 160000000)
      throw Error("Selecciona un CSV de hasta 160 MB");
    byId("run").disabled = true;
    message(
      "status",
      operation === "inspect"
        ? "Leyendo las columnas del archivo…"
        : "Conciliando partidas…",
    );
    const buffer = await source.arrayBuffer();
    if (version !== generation) return;
    worker = new Worker(workerUrl);
    worker.onmessage = receive;
    worker.onerror = (e) => {
      byId("run").disabled = false;
      message(
        "status",
        e.message || "El navegador no pudo iniciar la conciliación local",
        true,
      );
    };
    worker.postMessage({ type: operation, buffer, profile }, [buffer]);
  } catch (e) {
    if (version === generation) {
      byId("run").disabled = !source;
      message("status", e.message, true);
    }
  }
}
input.onchange = () => {
  source = input.files[0] ?? null;
  byId("filename").textContent = source?.name ?? "Ningún archivo seleccionado";
  reset();
  if (source && !manualProfile) processSource("inspect");
};
byId("inspect").onclick = () => {
  manualProfile = false;
  processSource("inspect");
};
settings.onchange = async () => {
  const file = settings.files[0];
  if (!file) return;
  reset();
  const version = generation;
  try {
    if (file.size > 200000) throw Error("Configuración demasiado grande");
    const value = JSON.parse(await file.text());
    if (version === generation) {
      manualProfile = true;
      showProfile(value);
    }
  } catch (e) {
    if (version === generation) {
      byId("config").value = "";
      message("status", e.message, true);
    }
  }
  settings.value = "";
};
byId("config").oninput = () => {
  manualProfile = true;
  reset();
  try {
    const p = JSON.parse(byId("config").value);
    for (const [k, c] of profileControls)
      c.value = (k.startsWith("col-") ? p.fields?.[k.slice(4)] : p[k]) ?? "";
  } catch {}
};
byId("example").onclick = () => {
  input.value = "";
  source = new Blob([initial.csv]);
  byId("filename").textContent = "ejemplo-turno.csv · ejemplo de la entrega";
  manualProfile = false;
  showProfile(initial.profile, Object.values(initial.profile.fields));
  byId("options").open = false;
  processSource("audit");
};
byId("run").onclick = () => processSource("audit");
byId("filter").oninput = () => page(0);
byId("prev").onclick = () => page(currentPage - 1);
byId("next").onclick = () => page(currentPage + 1);
byId("csv").onclick = () =>
  worker?.postMessage({ type: "download", kind: "csv" });
byId("cert").onclick = () =>
  worker?.postMessage({ type: "download", kind: "certificate" });
byId("check").onchange = async (e) => {
  const obj = e.target,
    file = obj.files[0],
    version = generation;
  try {
    if (!file) return;
    if (file.size > 160000000) throw Error("Certificado demasiado grande");
    const json = await file.text();
    if (version === generation) worker?.postMessage({ type: "existing", json });
  } catch (err) {
    if (version === generation) message("verification", err.message, true);
  }
  obj.value = "";
};
