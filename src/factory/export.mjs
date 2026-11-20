import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hash, check } from "./reader.mjs";
import { generateTools } from "./synth.mjs";
import { cpp } from "./native.mjs";
import { validateRelease } from "./product.mjs";
const names = [
  "reader.mjs",
  "rules.mjs",
  "proof.mjs",
  "expert.mjs",
  "workflow.mjs",
  "native.mjs",
  "product-store.mjs",
  "product.mjs",
  "product-cli.mjs",
];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const modules = names.map((n) => [
  n,
  readFileSync(new URL(n, import.meta.url)),
]);
export const runtimeStamp = hash([
  ...modules.map(([n, b]) => [n, sha(b)]),
  ...["synth.mjs", "export.mjs"].map((n) => [
    n,
    sha(readFileSync(new URL(n, import.meta.url))),
  ]),
]);
export function exportProduct(job, directory) {
  const f = job?.output?.factory;
  check(
    f &&
      job.grade?.status === "QUALIFIED_IN_SCOPE" &&
      job.grade.seal === job.predictions?.seal,
    "Se requiere examen completo aprobado",
  );
  check(
    job.snapshot.productRuntime === runtimeStamp,
    "Se necesita la versión certificada de la fábrica",
  );
  const release = {
    format: "semar-product-1",
    project: f.project,
    trainingSector: f.scope,
    program: f.program,
    adapters: job.adapters,
    grade: job.grade,
    flow: job.snapshot.factory.workflow,
    optimum: f.workflow,
  };
  validateRelease(release);
  const dir = resolve(directory),
    parent = dirname(dir);
  check(!existsSync(dir), "El destino ya existe");
  mkdirSync(parent, { recursive: true });
  const tmp = mkdtempSync(join(parent, ".semar-build-"));
  try {
    const files = {};
    function add(n, b) {
      writeFileSync(join(tmp, n), b);
      files[n] = sha(b);
    }
    for (const [name, content] of modules) add(name, content);
    add("tools.mjs", generateTools(release.program.tools ?? []));
    add("kernel.cpp", cpp(release.program.rule));
    add("release.json", JSON.stringify(release, null, 2) + "\n");
    const version = hash(release);
    const manifest = {
      release: version,
      files,
      certificate: job.grade.seal,
      components: [
        {
          component: "source and learned rule",
          origin: "SEMAR Agentes-2M / local factory",
          runtimeStamp,
        },
        { component: "training inputs and glossaries", origin: f.provenance },
        {
          component: "JavaScript and SQLite",
          origin: "local Node.js 24 runtime and its bundled SQLite",
        },
        {
          component: "optional native building and runtime",
          origin: "host C++17 compiler and system C++ runtime",
        },
      ],
      outsideServices: [],
      entry: "node product-cli.mjs",
      unit: release.program.unit,
    };
    writeFileSync(
      join(tmp, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    renameSync(tmp, dir);
    return { version, dir, manifest: hash(manifest) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
