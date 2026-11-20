import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { validateRelease, prepare, result, runProduct } from "./product.mjs";
import { ProductStore } from "./product-store.mjs";
import { qualifyNative, selectedBinary, nativeBatch } from "./native.mjs";
import { hash, check, list } from "./reader.mjs";
import { verifyOptimum, optimize } from "./workflow.mjs";
const root = dirname(fileURLToPath(import.meta.url)),
  read = (p) => JSON.parse(readFileSync(p, "utf8"));
async function main([cmd = "check", ...args]) {
  const manifest = read(join(root, "manifest.json"));
  const required = [
    "reader.mjs",
    "rules.mjs",
    "proof.mjs",
    "expert.mjs",
    "workflow.mjs",
    "native.mjs",
    "product-store.mjs",
    "product.mjs",
    "product-cli.mjs",
    "tools.mjs",
    "kernel.cpp",
    "release.json",
  ];
  check(
    Object.keys(manifest.files).length === required.length &&
      required.every((n) => Object.hasOwn(manifest.files, n)),
    "Manifiesto incompleto",
  );
  for (const [path, digest] of Object.entries(manifest.files)) {
    check(/^[A-Za-z0-9.-]+$/.test(path), "Ruta de producto inválida");
    check(
      createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex") === digest,
      "Archivo alterado: " + path,
    );
  }
  const release = read(join(root, "release.json")),
    version = hash(release);
  validateRelease(release);
  check(version === manifest.release, "Versión inválida");
  if (cmd === "check")
    return {
      version,
      proof: release.program.proof,
      optimized: verifyOptimum(release.flow, release.optimum.certificate),
      grade: release.grade,
    };
  if (cmd === "qualify-native")
    return qualifyNative(root, release.program.rule);
  if (cmd === "plan") return optimize(read(args[0]));
  if (cmd === "tool") {
    const { apply } = await import("./tools.mjs");
    return { tool: args[0], value: apply(args[0], read(args[1])) };
  }
  if (cmd === "run") return runProduct(release, read(args[0]));
  if (cmd === "batch") {
    const rows = list(read(args[0]), 1, 16384).map((x) => prepare(release, x)),
      bin = selectedBinary(root, release.program.rule);
    const complete = rows.filter(
      (x) =>
        x.permission.allowed &&
        !x.parsed.issues.length &&
        !x.parsed.open.length,
    );
    const values =
      bin && complete.length
        ? nativeBatch(
            bin,
            complete.map((x) => x.parsed.groups),
          )
        : [];
    const mapped = new Map(complete.map((x, i) => [x, values[i]]));
    return {
      engine: bin && complete.length ? "cpp" : "reference",
      results: rows.map((x) => result(release, x, mapped.get(x))),
    };
  }
  if (!["install", "switch", "append", "history"].includes(cmd))
    throw Error(
      "Usa check, run, batch, plan, qualify-native, install, switch, append o history",
    );
  if (!args[0]) throw Error("Indica la base SQLite local");
  const store = new ProductStore(args[0]);
  try {
    if (cmd === "install") return store.switch(version, release);
    if (cmd === "switch") return store.switch(args[1]);
    if (cmd === "append") return store.append(read(args[1]));
    return store.history();
  } finally {
    store.close();
  }
}
try {
  console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
