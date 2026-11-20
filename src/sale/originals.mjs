import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { strict } from "../policy.mjs";
import { check, unique, hash } from "../factory/reader.mjs";
import { records, importCreditCsv } from "./credit-csv.mjs";
import { creditRegister } from "./credits.mjs";

const incoming = new Set(["fee", "funding", "unapplied"]);
export function reconcileBankFile(bytes, p, profile) {
  strict(profile, ["delimiter", "columns", "amountFormat"]);
  strict(profile.columns, ["reference", "at", "amount", "currency", "account"]);
  check(
    [",", ";", "\t"].includes(profile.delimiter) &&
      ["minor", "decimal-point", "decimal-comma"].includes(
        profile.amountFormat,
      ),
    "Perfil del extracto inválido",
  );
  const rows = records(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    profile.delimiter,
  );
  check(
    rows.length === p.lines.length + 1,
    "El original y el extracto tienen distintas cantidades de movimientos",
  );
  const names = rows[0].fields;
  unique(names);
  unique(Object.values(profile.columns));
  const indices = Object.fromEntries(
    Object.entries(profile.columns).map(([k, v]) => {
      const i = names.indexOf(v);
      check(i >= 0, "Columna bancaria ausente");
      return [k, i];
    }),
  );
  const lines = new Map(p.lines.map((l) => [l.id, l]));
  check(
    lines.size === p.lines.length,
    "Referencias repetidas en la declaración",
  );
  let total = 0;
  for (const r of rows.slice(1)) {
    check(r.fields.length === names.length, "Fila bancaria incompleta");
    const get = (k) => r.fields[indices[k]],
      ref = get("reference"),
      line = lines.get(ref);
    check(line, "Movimiento bancario inesperado o repetido");
    const raw = get("amount");
    let value;
    if (profile.amountFormat === "minor") {
      check(/^-?\d{1,13}$/.test(raw), "Importe en unidad mínima inválido");
      value = Number(raw);
    } else {
      const [whole, fraction, ...rest] = raw.split(
        profile.amountFormat === "decimal-point" ? "." : ",",
      );
      check(
        !rest.length &&
          /^-?\d{1,11}$/.test(whole) &&
          /^\d{2}$/.test(fraction ?? ""),
        "Importe decimal ambiguo",
      );
      value =
        (whole.startsWith("-") ? -1 : 1) *
        (Math.abs(Number(whole)) * 100 + Number(fraction));
    }
    check(
      get("at") === new Date(line.at).toISOString() &&
        get("currency") === p.currency &&
        get("account") === p.account &&
        value === line.cents * (incoming.has(line.kind) ? 1 : -1),
      "El original contradice la fecha, titular, moneda o importe registrado",
    );
    total += value;
    check(Number.isSafeInteger(total), "Total bancario fuera de dominio");
    lines.delete(ref);
  }
  check(
    !lines.size && p.opening + total === p.closing,
    "Los saldos bancarios no coinciden con el archivo",
  );
  return p.lines.length;
}
export function reconcileCreditFile(bytes, expected, profile) {
  const packet = importCreditCsv(bytes, profile);
  check(
    creditRegister(packet).inputHash === expected,
    "Las filas del archivo original difieren del expediente conciliado",
  );
  return packet.lines.length;
}

export async function checkOriginals(desk, mode, config) {
  check(["LIVE", "DEMONSTRATION"].includes(mode), "Modo de libro desconocido");
  const governance = desk.store.audit();
  const audit = await desk.audit(),
    s = desk.read(),
    sources = new Map(),
    statements = [],
    creditJobs = new Map();
  function need(sha, kind) {
    if (!sha) return;
    check(/^[a-f0-9]{64}$/.test(sha), "Huella de un original inválida");
    if (!sources.has(sha)) sources.set(sha, new Set());
    sources.get(sha).add(kind);
  }
  const b = s.sales,
    accounts = new Set(
      [...b.accounts.values()].filter((a) => a.mode === mode).map((a) => a.id),
    );
  for (const a of b.accounts.values())
    if (a.mode === mode) need(a.identitySource, "identidad del custodio");
  for (const c of b.clients.values())
    if (c.mode === mode) need(c.identitySource, "identidad del comprador");
  for (const o of b.offers.values())
    if (o.mode === mode) {
      need(o.termsBasis, "base de la propuesta");
      need(o.delivery?.source, "recuperación aceptada");
      for (const close of o.closes ?? (o.close ? [o.close] : []))
        need(close.evidence, "horas y tarifa");
      const job = s.jobs.get(o.job);
      if (job.snapshot.credit) {
        const source = job.snapshot.credit.source;
        need(source, "archivo de conciliación");
        if (!creditJobs.has(source)) creditJobs.set(source, new Map());
        creditJobs.get(source).set(o.job, job.output.credit.report.inputHash);
      } else need(o.inputHash, "expediente JSON del comprador");
    }
  for (const a of b.activities.values())
    if (a.mode === mode) need(a.source, "horas de campo");
  for (const row of desk.db
    .prepare("SELECT body FROM global_events ORDER BY seq")
    .iterate()) {
    const e = JSON.parse(row.body);
    if (!accounts.has(e.data.account)) continue;
    if (e.kind === "sale-bank") {
      need(e.data.source, "extracto bancario");
      statements.push(e.authorization.record.data.proof.record);
    }
    if (e.kind === "sale-assign")
      need(e.data.source, "distribución del depósito");
  }
  const missing = [],
    invalid = [],
    missingProfiles = [],
    seen = new Set();
  let verifiedMovements = 0,
    matchedStatements = 0,
    matchedCreditJobs = 0,
    matchedCreditRows = 0;
  const perSource = new Map(statements.map((p) => [p.source, p]));
  for (const [sha, kinds] of sources) {
    let bytes;
    try {
      if (!config?.directory)
        throw Object.assign(Error("Original pendiente"), { code: "ENOENT" });
      const file = join(config.directory, sha),
        stat = lstatSync(file);
      check(
        stat.isFile() && stat.size <= 160000000,
        "Se requiere un archivo regular de hasta 160 MB",
      );
      bytes = readFileSync(file);
      const fingerprint =
        kinds.size === 1 && kinds.has("expediente JSON del comprador")
          ? hash(JSON.parse(bytes))
          : createHash("sha256").update(bytes).digest("hex");
      check(fingerprint === sha, "El contenido difiere de la huella");
      const p = perSource.get(sha);
      if (p) {
        const profile = config.bank?.[p.account];
        if (profile) {
          verifiedMovements += reconcileBankFile(bytes, p, profile);
          matchedStatements++;
        } else missingProfiles.push({ sha, account: p.account, kind: "bank" });
      }
      for (const [job, expected] of creditJobs.get(sha) ?? []) {
        const profile = config.credit?.[job];
        if (!profile) missingProfiles.push({ sha, job, kind: "credit" });
        else {
          matchedCreditRows += reconcileCreditFile(bytes, expected, profile);
          matchedCreditJobs++;
        }
      }
      seen.add(sha);
    } catch (error) {
      const item = { sha, uses: [...kinds], detail: error.message };
      (error.code === "ENOENT" ? missing : invalid).push(item);
    }
  }
  check(
    desk.read().tip === audit.tip && desk.store.audit().tip === governance.tip,
    "El libro o las asignaciones cambiaron durante la lectura de originales",
  );
  const status = invalid.length
    ? "SOURCE_DISAGREEMENT"
    : missing.length
      ? "SOURCE_FILES_PENDING"
      : missingProfiles.length
        ? "SOURCE_PROFILE_REQUIRED"
        : statements.length && seen.size
          ? "ORIGINALS_MATCHED"
          : "AWAIT_SOURCE_STATEMENT";
  return {
    tip: audit.tip,
    governanceTip: governance.tip,
    mode,
    status,
    requiredFiles: sources.size,
    matchedFiles: seen.size,
    statements: statements.length,
    matchedStatements,
    verifiedMovements,
    matchedCreditJobs,
    matchedCreditRows,
    missingProfiles,
    missing,
    invalid,
    scope:
      "Identidad de los bytes y coincidencia de todas las referencias, fechas, monedas e importes de los extractos registrados. Las filas de los expedientes de conciliación se reconstruyen desde sus CSV. La autenticidad externa depende de los emisores acreditados.",
  };
}
