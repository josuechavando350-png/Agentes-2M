import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { rolloutReport } from "../src/rollout.mjs";

const dir = process.argv[2];
if (!dir)
  throw Error(
    "Indica el directorio que contiene censo-100m.json y bitacora.json.gz",
  );
const read = (name) => readFileSync(join(dir, name));
const report = JSON.parse(read("censo-100m.json"));
const tip = JSON.parse(read("avance.json")).audit.tip;
const events = JSON.parse(
  gunzipSync(read("bitacora.json.gz"), { maxOutputLength: 64_000_000 }),
);
const school = new Semar(":memory:");
try {
  if (report.checkpoint === tip) school.restore(events, tip);
  else {
    const end = events.findIndex((e) => e.prev === report.checkpoint);
    if (end < 1) throw Error("El censo no pertenece a este historial");
    school.restore(events.slice(0, end), report.checkpoint);
  }
  assert.deepEqual(
    rolloutReport(school, school.receipt("fundadores-100m")),
    report,
  );
  console.log(
    report.scan.tested +
      " identidades examinadas. SHA-256 " +
      report.scan.sha256,
  );
} finally {
  school.close();
}
