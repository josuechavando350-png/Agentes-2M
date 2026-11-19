import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { researchRound } from "../src/research.mjs";
import { STIPEND, BATCH, CAP } from "../src/policy.mjs";

const dir = resolve(process.argv[2] ?? ".cache/escuela");
mkdirSync(dir, { recursive: true });
const summaryPath = join(dir, "avance.json"),
  logPath = join(dir, "bitacora.json.gz");
const retained = existsSync(summaryPath);
if (retained !== existsSync(logPath)) throw Error("Checkpoint incompleto");
const meta = JSON.parse(
  readFileSync(
    retained
      ? summaryPath
      : new URL("../evidence/escuela-inicial.json", import.meta.url),
  ),
);
const log = gunzipSync(
  readFileSync(
    retained
      ? logPath
      : new URL("../evidence/escuela-inicial.json.gz", import.meta.url),
  ),
  { maxOutputLength: 64_000_000 },
);
const s = new Semar(":memory:");
try {
  s.restore(JSON.parse(log), meta.audit.tip);
  const cycle = (meta.cycle ?? 0) + 1;
  const status = s.status();
  if (
    status.treasury < STIPEND * Math.min(BATCH, CAP - status.population) ||
    status.population >= CAP
  ) {
    console.log("Padrón auditado. La reserva o el tope impiden otra cohorte.");
  } else {
    const result = await researchRound(s, cycle);
    const state = s.checkpoint();
    const out = {
      cycle,
      parentTip: meta.audit.tip,
      result,
      status: s.status(),
      audit: s.audit(),
    };
    // Publish both files in one Git commit. A failed or racing push leaves the old pair intact.
    writeFileSync(logPath, gzipSync(JSON.stringify(state.events)));
    writeFileSync(summaryPath, JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify(out));
  }
} finally {
  s.close();
}
