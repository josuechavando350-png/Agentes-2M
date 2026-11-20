import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const dir = resolve(process.argv[2]),
  parent = dirname(dir),
  root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(dir)) throw Error("El directorio de entrega ya existe");
mkdirSync(parent, { recursive: true });
const tmp = mkdtempSync(join(parent, ".auditor-")),
  sha = (b) => createHash("sha256").update(b).digest("hex");
try {
  for (const n of [
    "credit-cli.mjs",
    "credits.mjs",
    "credit-csv.mjs",
    "review-queue.mjs",
  ])
    copyFileSync(join(root, "src/sale", n), join(tmp, n));
  const base = {
    party: "empresa-ejemplo",
    sku: "servicio-ejemplo",
    price: 10000,
  };
  const row = (id, qty, t, n) => ({
    ...base,
    id,
    qty,
    time: Date.UTC(2026, 0, t),
    invoice: id.toUpperCase(),
    row: n,
  });
  const example = {
    source: sha("Ejemplo didáctico interno"),
    currency: "MXN",
    from: Date.UTC(2026, 0, 1),
    until: Date.UTC(2026, 1, 1),
    maxAgeDays: 30,
    lines: [
      row("venta-a", 5, 1, 2),
      row("venta-b", 3, 2, 3),
      row("credito-a", -4, 3, 4),
      row("credito-b", -6, 4, 5),
    ],
  };
  writeFileSync(
    join(tmp, "ejemplo.json"),
    JSON.stringify(example, null, 2) + "\n",
  );
  const call = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [join(tmp, "credit-cli.mjs"), ...args], {
        cwd: tmp,
        encoding: "utf8",
      }),
    );
  const report = call("audit", "ejemplo.json", "certificado.json");
  assert.equal(report.unmatchedUnits, 2);
  assert.deepEqual(call("check", "ejemplo.json", "certificado.json"), report);
  const interval = call("explain", "ejemplo.json", "credito-b");
  assert.equal(interval.ambiguous, true);
  copyFileSync(join(root, "docs/auditor-creditos.md"), join(tmp, "LEEME.md"));
  const settings = {
    currency: "MXN",
    from: new Date(example.from).toISOString(),
    until: new Date(example.until).toISOString(),
    maxAgeDays: 30,
    decimal: ".",
    delimiter: ",",
    fields: {
      id: "Linea",
      party: "Cuenta",
      sku: "Producto",
      price: "Precio",
      qty: "Cantidad",
      time: "FechaUTC",
      invoice: "Documento",
      currency: "Moneda",
    },
  };
  writeFileSync(
    join(tmp, "columnas.json"),
    JSON.stringify(settings, null, 2) + "\n",
  );
  const csv =
    [
      "Linea,Cuenta,Producto,Precio,Cantidad,FechaUTC,Documento,Moneda",
      ...example.lines.map((l) =>
        [
          l.id,
          l.party,
          l.sku,
          (l.price / 100).toFixed(2),
          l.qty,
          new Date(l.time).toISOString(),
          l.invoice,
          "MXN",
        ].join(","),
      ),
    ].join("\r\n") + "\r\n";
  writeFileSync(join(tmp, "ejemplo.csv"), csv);
  call("import", "ejemplo.csv", "columnas.json", "importado.json");
  const imported = call("audit", "importado.json");
  assert.equal(imported.unmatchedUnits, report.unmatchedUnits);
  call("register", "importado.json", "revision.csv");
  const shift = {
    minutes: 60,
    startBuyerMinutes: 5,
    openInvoiceMinutes: 3,
    perLineMinutes: 1,
    windowsDays: [7, 30],
    completeLookback: false,
  };
  writeFileSync(join(tmp, "turno.json"), JSON.stringify(shift, null, 2) + "\n");
  const turnCsv =
    csv +
    "credito-c,segunda-empresa,servicio-ejemplo,50.00,-3,2026-01-30T00:00:00.000Z,NOTA-C,MXN\r\n";
  writeFileSync(join(tmp, "ejemplo-turno.csv"), turnCsv);
  call("import", "ejemplo-turno.csv", "columnas.json", "expediente-turno.json");
  const queue = call(
    "queue",
    "expediente-turno.json",
    "turno.json",
    "cola.json",
  );
  assert.equal(queue.reviewCents, 15000);
  assert.equal(queue.documents, 1);
  assert.equal(queue.minutes, 9);
  assert.equal(queue.status, "OPTIMAL_IN_SCOPE");
  assert.deepEqual(
    queue,
    call("queue-check", "expediente-turno.json", "turno.json", "cola.json"),
  );
  const names = [
    "review-queue.mjs",
    "turno.json",
    "cola.json",
    "credits.mjs",
    "credit-cli.mjs",
    "credit-csv.mjs",
    "ejemplo.json",
    "ejemplo.csv",
    "ejemplo-turno.csv",
    "expediente-turno.json",
    "columnas.json",
    "importado.json",
    "revision.csv",
    "certificado.json",
    "LEEME.md",
  ];
  const manifest = {
    name: "SEMAR auditor de notas de crédito",
    version: 1,
    requires: "Node 24",
    externalServices: [],
    files: Object.fromEntries(
      names.map((n) => [n, sha(readFileSync(join(tmp, n)))]),
    ),
  };
  writeFileSync(
    join(tmp, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  renameSync(tmp, dir);
  console.log(
    JSON.stringify({
      dir,
      files: names.length + 1,
      unitsCertified: report.backedUnits,
      unmatchedInExample: report.unmatchedUnits,
      manifest: sha(JSON.stringify(manifest)),
    }),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
