import { createHash } from "node:crypto";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { digest } from "./policy.mjs";

const paths = [
  "src/global-planner.mjs",
  "src/global-desk.mjs",
  "src/global-analysis.mjs",
  "src/global-method.mjs",
  "src/global-archive.mjs",
  "src/pilot-delivery.mjs",
  "src/global-replay.mjs",
  "src/dossiers.mjs",
  "src/nexus.mjs",
  "src/policy.mjs",
  "src/field-lab.mjs",
  "src/inference.mjs",
  ".cache/nexus.mjs",
];
const files = Object.fromEntries(
  paths.map((p) => [
    p,
    readFileSync(new URL("../" + p, import.meta.url), "utf8"),
  ]),
);
const sha = (s) => createHash("sha256").update(s).digest("hex");
export const engine = {
  files: Object.fromEntries(paths.map((p) => [p, sha(files[p])])),
  node: process.versions.node,
};
const compressed = gzipSync(JSON.stringify(files));
export function saveRuntime(db) {
  db.prepare("INSERT OR IGNORE INTO global_runtime VALUES(?,?)").run(
    digest(engine),
    compressed,
  );
}
export function archivedExecution(db, job) {
  const key = job.snapshot.engine;
  const row = db
    .prepare("SELECT archive FROM global_runtime WHERE id=?")
    .get(key);
  if (!row || digest(job.runtime) !== key)
    throw Error("Ejecutor archivado ausente");
  const contents = JSON.parse(
    gunzipSync(row.archive, { maxOutputLength: 8_000_000 }),
  );
  if (Object.keys(contents).length !== Object.keys(job.runtime.files).length)
    throw Error("Archivo incompleto");
  const root = mkdtempSync(join(tmpdir(), "semar-replay-"));
  try {
    for (const [p, code] of Object.entries(contents)) {
      if (!paths.includes(p) || sha(code) !== job.runtime.files[p])
        throw Error("Archivo de reproducción alterado");
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), code);
    }
    const raw = execFileSync(
      process.execPath,
      [
        "--permission",
        "--allow-fs-read=" + root,
        join(root, "src/global-replay.mjs"),
      ],
      {
        cwd: root,
        env: {},
        input: JSON.stringify(job.snapshot),
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 16_000_000,
      },
    );
    return JSON.parse(raw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
