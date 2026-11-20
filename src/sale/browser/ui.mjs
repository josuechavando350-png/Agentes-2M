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
  generation = 0;
const input = byId("input"),
  settings = byId("settings");
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
      data.operation === "audit" ? "status" : "verification",
      data.error,
      true,
    );
    if (data.operation === "audit") byId("run").disabled = !source;
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
async function audit() {
  reset();
  const version = generation;
  try {
    const profile = JSON.parse(byId("config").value);
    if (!source || source.size > 160000000)
      throw Error("Selecciona un CSV de hasta 160 MB");
    byId("run").disabled = true;
    message("status", "Conciliando partidas…");
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
    worker.postMessage({ type: "audit", buffer, profile }, [buffer]);
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
};
settings.onchange = async () => {
  const file = settings.files[0];
  if (!file) return;
  reset();
  const version = generation;
  try {
    if (file.size > 200000) throw Error("Configuración demasiado grande");
    const value = JSON.parse(await file.text());
    if (version === generation)
      byId("config").value = JSON.stringify(value, null, 2);
  } catch (e) {
    if (version === generation) {
      byId("config").value = "";
      message("status", e.message, true);
    }
  }
  settings.value = "";
};
byId("config").oninput = reset;
byId("example").onclick = () => {
  input.value = "";
  source = new Blob([initial.csv]);
  byId("filename").textContent = "ejemplo-turno.csv · ejemplo de la entrega";
  byId("config").value = JSON.stringify(initial.profile, null, 2);
  audit();
};
byId("run").onclick = audit;
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
