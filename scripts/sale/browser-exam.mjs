import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { importCreditCsv, registerCsv } from "../../src/sale/credit-csv.mjs";
import {
  traceCredits,
  verifyCredits,
  creditRegister,
} from "../../src/sale/credits.mjs";

const [folderArg, historical, screenDir] = process.argv.slice(2),
  folder = resolve(folderArg);
const browser = [
  process.env.SEMAR_BROWSER,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));
assert.ok(
  browser,
  "Se requiere Chromium o SEMAR_BROWSER para el examen visual",
);
const root = mkdtempSync(join(tmpdir(), "semar-navegador-")),
  downloads = join(root, "descargas");
mkdirSync(downloads);
if (screenDir) mkdirSync(screenDir, { recursive: true });
const child = spawn(
  browser,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
    "--remote-debugging-pipe",
    "--user-data-dir=" + join(root, "perfil"),
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
const ended = once(child, "exit");
const requests = new Map(),
  remoteRequests = [];
let buf = "",
  seq = 0,
  session,
  diagnostics = "",
  stopping = false;
child.stderr.setEncoding("utf8");
child.stderr.on("data", (s) => (diagnostics = (diagnostics + s).slice(-4000)));
function abortPending(reason) {
  if (stopping) return;
  for (const settle of requests.values())
    settle({ error: { message: reason + " " + diagnostics } });
  requests.clear();
}
child.stdio[3].on("error", (e) => abortPending(e.message));
child.stdio[4].on("error", (e) => abortPending(e.message));
child.once("exit", (code, signal) =>
  abortPending("Navegador cerrado " + (signal ?? code)),
);
child.stdio[4].setEncoding("utf8");
child.stdio[4].on("data", (chunk) => {
  buf += chunk;
  let cut;
  while ((cut = buf.indexOf("\0")) !== -1) {
    const reply = JSON.parse(buf.slice(0, cut));
    buf = buf.slice(cut + 1);
    if (
      reply.method === "Network.requestWillBeSent" &&
      /^https?:/i.test(reply.params.request.url)
    )
      remoteRequests.push(reply.params.request.url);
    if (reply.id && requests.has(reply.id)) {
      const settle = requests.get(reply.id);
      requests.delete(reply.id);
      settle(reply);
    }
  }
});
function command(method, params = {}, attached = true) {
  const id = ++seq;
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(Error("Tiempo agotado en " + method));
    }, 20000);
    requests.set(id, (r) => {
      clearTimeout(timer);
      if (r.error) reject(Error(r.error.message));
      else accept(r.result);
    });
    child.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(attached ? { sessionId: session } : {}),
      }) + "\0",
    );
  });
}
async function evaluate(expression) {
  const r = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
    );
  return r.result.value;
}
async function until(condition, label) {
  const stop = Date.now() + 20000;
  while (Date.now() < stop) {
    if (await condition()) return;
    await pause(35);
  }
  throw Error("Tiempo agotado en " + label);
}
const truth = (expression, label) => until(() => evaluate(expression), label);
const click = (selector) =>
  evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()");
async function file(selector, path) {
  const { root } = await command("DOM.getDocument"),
    { nodeId } = await command("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
  await command("DOM.setFileInputFiles", { nodeId, files: [path] });
}
async function screenshot(name) {
  if (screenDir) {
    const { data } = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    writeFileSync(join(screenDir, name + ".png"), Buffer.from(data, "base64"));
  }
}
const loadJSON = (p) => JSON.parse(readFileSync(p));
const html = pathToFileURL(join(folder, "auditor.html")).href;
let notesFromHistory = null;
try {
  const { targetId } = await command(
    "Target.createTarget",
    { url: "about:blank" },
    false,
  );
  session = (
    await command("Target.attachToTarget", { targetId, flatten: true }, false)
  ).sessionId;
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command(
    "Browser.setDownloadBehavior",
    { behavior: "allow", downloadPath: downloads },
    false,
  );
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1152,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Page.navigate", { url: html });
  await truth(
    "document.getElementById('config')?.value.includes('Moneda')",
    "carga del formulario",
  );
  await file("#input", join(folder, "ejemplo-turno.csv"));
  await truth(
    "document.querySelector('#options').open && document.querySelector('#status').textContent.includes('Se sugirió')",
    "reconocimiento de columnas",
  );
  assert.equal(
    await evaluate("document.querySelector('#field-currency').value"),
    "MXN",
  );
  assert.equal(
    await evaluate("document.querySelector('#field-col-currency').value"),
    "Moneda",
  );
  await evaluate(
    "document.querySelector('#field-maxAgeDays').value='15';document.querySelector('#field-maxAgeDays').dispatchEvent(new Event('input'))",
  );
  const visual = await evaluate(
    "JSON.parse(document.querySelector('#config').value)",
  );
  assert.equal(visual.maxAgeDays, 15);
  assert.equal(visual.currency, "MXN");
  assert.equal(visual.fields.currency, "Moneda");
  await click("#run");
  await truth(
    "document.querySelector('#rows').children.length===3 && !document.querySelector('#results').hidden",
    "archivo sin configuración JSON",
  );
  await click("#example");
  await truth(
    "document.querySelector('#rows').children.length===3 && !document.querySelector('#results').hidden",
    "conciliación del ejemplo",
  );
  assert.equal(
    await evaluate("document.querySelector('#count').textContent"),
    "3",
  );
  await screenshot("escritorio");
  await evaluate(
    "document.querySelector('#filter').value='NOTA-C';document.querySelector('#filter').dispatchEvent(new Event('input'))",
  );
  await truth(
    "document.querySelector('#rows').children.length===1",
    "filtro por factura",
  );
  assert.equal(
    await evaluate("document.querySelector('#rows td').textContent"),
    "NOTA-C",
  );
  await click("#cert");
  await click("#csv");
  for (const f of ["certificado.json", "revision.csv"])
    await until(() => existsSync(join(downloads, f)), "descarga de " + f);
  const sample = loadJSON(join(folder, "expediente-turno.json")),
    cert = loadJSON(join(downloads, "certificado.json"));
  assert.deepEqual(verifyCredits(sample, cert), traceCredits(sample).report);
  assert.equal(
    readFileSync(join(downloads, "revision.csv"), "utf8"),
    registerCsv(creditRegister(sample)),
  );
  await file("#check", join(downloads, "certificado.json"));
  await truth(
    "document.querySelector('#verification').textContent.includes('válido')",
    "certificado correcto",
  );
  cert.inputHash = "0".repeat(64);
  writeFileSync(join(root, "ajeno.json"), JSON.stringify(cert));
  await file("#check", join(root, "ajeno.json"));
  await truth(
    "document.querySelector('#verification').classList.contains('error')",
    "certificado alterado",
  );
  await command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await screenshot("movil");
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
  const profile = loadJSON(join(folder, "columnas.json"));
  if (historical && historical !== "-") {
    const official = loadJSON(historical),
      iso = (v) => new Date(v).toISOString();
    const csv =
      "Linea,Cuenta,Producto,Precio,Cantidad,FechaUTC,Documento,Moneda\r\n" +
      official.lines
        .map((l) =>
          [
            l.id,
            l.party,
            l.sku,
            (l.price / 100).toFixed(2),
            l.qty,
            iso(l.time),
            l.invoice,
            official.currency,
          ]
            .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\r\n") +
      "\r\n";
    const config = {
      ...profile,
      from: iso(official.from),
      until: iso(official.until),
      currency: official.currency,
      maxAgeDays: official.maxAgeDays,
    };
    const historicalFile = join(root, "comprador.csv");
    writeFileSync(historicalFile, csv);
    const native = traceCredits(
      importCreditCsv(Buffer.from(csv), config),
    ).report;
    await evaluate(
      "document.querySelector('#config').value=" +
        JSON.stringify(JSON.stringify(config)) +
        ";document.querySelector('#config').dispatchEvent(new Event('input'))",
    );
    await file("#input", historicalFile);
    await click("#run");
    await truth(
      "document.querySelector('#fingerprint').textContent.includes(" +
        JSON.stringify(native.source) +
        ") && document.querySelector('#rows').children.length===20",
      "historial completo",
    );
    await click("#next");
    await truth(
      "document.querySelector('#page-info').textContent.startsWith('21–40')",
      "segunda página",
    );
    rmSync(join(downloads, "certificado.json"));
    await click("#cert");
    await until(
      () => existsSync(join(downloads, "certificado.json")),
      "certificado histórico",
    );
    const imported = importCreditCsv(Buffer.from(csv), config);
    assert.deepEqual(
      verifyCredits(imported, loadJSON(join(downloads, "certificado.json"))),
      native,
    );
    notesFromHistory = native.credits;
  }
  assert.equal(remoteRequests.length, 0);
  console.log(
    JSON.stringify(
      {
        status: "PASSED",
        delivery: "LOCAL_HTML_FILE",
        exampleNotes: 3,
        importedCsvThroughForm: true,
        matchedCsvAndCertificate: true,
        alteredCertificateRejected: true,
        mobileWidth: 390,
        remotePageRequests: 0,
        notesFromHistory,
      },
      null,
      2,
    ),
  );
} finally {
  stopping = true;
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  await ended.catch(() => {});
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
}
