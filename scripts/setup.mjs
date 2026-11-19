import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  rmSync,
  renameSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";

const pin = "71b4a10c31a67b6bde852ede1d998081df165798";
const url = "https://github.com/josuechavando350-png/nexus-engine.git";
const cache = fileURLToPath(new URL("../.cache/", import.meta.url));
const repo = join(cache, "nexus");
mkdirSync(cache, { recursive: true });
if (!existsSync(join(repo, ".git")))
  execFileSync("git", ["init", "--quiet", repo]);
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    maxBuffer: 64_000_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  git("cat-file", "-e", pin + "^{commit}");
} catch {
  git("fetch", "--quiet", "--depth=1", url, pin);
}
const tmp = mkdtempSync(join(cache, "build-"));
try {
  execFileSync("tar", ["-x", "-C", tmp], {
    input: git("archive", pin, "packages/ontology"),
  });
  const modules = [
    "chatbot-knowledge",
    "chatbot-guardrails",
    "chatbot-memory",
    "chatbot-bandit",
    "chatbot-reasoning",
    "persistence-query",
  ];
  const dir = join(tmp, "packages/ontology");
  const result = await build({
    stdin: {
      contents: modules.map((m) => "export * from './" + m + ".ts'").join("\n"),
      resolveDir: dir,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "external",
    alias: { "@nexus/ontology": dir },
    outfile: join(tmp, "nexus.mjs"),
    metafile: true,
    logLevel: "silent",
  });
  for (const { imports } of Object.values(result.metafile.outputs)) {
    for (const dep of imports)
      if (dep.external && !dep.path.startsWith("node:"))
        throw Error("Dependencia externa: " + dep.path);
  }
  renameSync(join(tmp, "nexus.mjs"), join(cache, "nexus.mjs"));
  console.log("Cinco capacidades construidas desde Nexus " + pin);
} finally {
  rmSync(tmp, { force: true, recursive: true });
}
