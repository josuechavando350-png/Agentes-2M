import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import {
  traceCredits,
  verifyCredits,
  creditRegister,
} from "../../src/sale/credits.mjs";
const [stage, dir, smallFile, repetitionsText = "3"] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p)),
  digest = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
if (stage === "legacy" || stage === "compact") {
  const packet = read(join(dir, "packet.json")),
    started = performance.now();
  const solved = traceCredits(packet, { compact: stage === "compact" });
  const solveMs = performance.now() - started,
    startCheck = performance.now();
  const checked = verifyCredits(packet, solved.certificate);
  assert.deepEqual(checked, solved.report);
  const checkerMs = performance.now() - startCheck,
    serialized = JSON.stringify(solved.certificate);
  console.log(
    JSON.stringify({
      report: solved.report,
      certificateBytes: Buffer.byteLength(serialized),
      representedGroups: solved.certificate.groups.length,
      certificate: digest(solved.certificate),
      solveMs,
      checkerMs,
      peakMiB: process.resourceUsage().maxRSS / 1024,
    }),
  );
} else if (stage === "examine") {
  const repetitions = Number(repetitionsText);
  assert.ok(
    Number.isSafeInteger(repetitions) && repetitions >= 1 && repetitions <= 21,
  );
  const runs = { legacy: [], compact: [] };
  for (let i = 0; i < repetitions; i++) {
    for (const edition of i % 2
      ? ["compact", "legacy"]
      : ["legacy", "compact"]) {
      const child = execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), edition, dir],
        { timeout: 240000 },
      );
      runs[edition].push(JSON.parse(child));
    }
  }
  const full = read(join(dir, "packet.json")),
    small = read(smallFile);
  const register = creditRegister(full),
    reference = creditRegister(small);
  assert.deepEqual(register.rows, reference.rows);
  const base = runs.legacy[0].report;
  for (const x of Object.values(runs).flat()) assert.deepEqual(x.report, base);
  assert.equal(base.credits, reference.notes);
  for (const [name, measurements] of Object.entries(runs))
    for (const r of measurements)
      assert.equal(r.certificate, runs[name][0].certificate);
  const statistics = Object.fromEntries(
    Object.entries(runs).map(([key, rs]) => [
      key,
      {
        certificate: rs[0].certificate,
        certificateBytes: rs[0].certificateBytes,
        groupsInCertificate: rs[0].representedGroups,
        solveMs: rs.map((r) => r.solveMs),
        checkMs: rs.map((r) => r.checkerMs),
        peakMiB: rs.map((r) => r.peakMiB),
      },
    ]),
  );
  console.log(
    JSON.stringify(
      {
        mode: "FULL_ELIGIBLE_HISTORICAL_FILE",
        source: full.source,
        intake: read(join(dir, "intake.json")),
        lines: full.lines.length,
        subsetLines: small.lines.length,
        allCustomerProductPriceGroups: base.groups,
        creditNotes: base.credits,
        allNoteIntervalsIdentical: true,
        noteRegister: digest(register.rows),
        currency: base.currency,
        unmatchedUnits: base.unmatchedUnits,
        unmatchedValueCents: base.unmatchedValueCents,
        input: base.inputHash,
        runsPerFormat: repetitions,
        formats: statistics,
        scope:
          "Todos los movimientos admitidos se validan y forman parte de la huella en los dos formatos. El certificado compacto omite los grupos en los que no existe una sola cancelación.",
        ownRevenue: null,
      },
      null,
      2,
    ),
  );
} else
  throw Error(
    "Usa examine DIRECTORIO_CON_TODAS_LAS_FILAS EXPEDIENTE_DE_REFERENCIA [REPETICIONES]",
  );
