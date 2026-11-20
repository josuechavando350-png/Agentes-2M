import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import { createHash } from "node:crypto";
import { compute, validateRule } from "./rules.mjs";
import { exact } from "./proof.mjs";
import { check, hash } from "./reader.mjs";
export function cpp(r) {
  validateRule(r, r.weights.length);
  const n = r.weights.length;
  const terms = r.weights.map(
    (w, i) =>
      w +
      "LL*(" +
      (i === r.rateIndex
        ? "v[" + i + "]*" + r.bps + "LL/10000LL"
        : "v[" + i + "]") +
      ")",
  );
  return `// Generated from a verified integer-ledger-1 recipe.
#include <algorithm>
#include <array>
#include <iostream>
using Row=std::array<long long,${n}>;
long long value(const Row& v){return std::max(0LL,${terms.join("+")});}
int main(){
  std::ios::sync_with_stdio(false); std::cin.tie(nullptr);
  int cases; if(!(std::cin>>cases)||cases<0||cases>16384)return 2;
  for(int c=0;c<cases;c++){
    int n; if(!(std::cin>>n)||n<0||n>4104)return 2;
    Row totals{};long long sum=0,mass=0;
    for(int i=0;i<n;i++){Row v{};
      for(std::size_t j=0;j<v.size();j++){if(!(std::cin>>v[j])||v[j]<0||v[j]>4104000000000LL)return 2;
        mass+=v[j];if(mass>4104000000000LL)return 2;totals[j]+=v[j];}
      ${r.group === "accounts" ? "sum+=value(v);" : ""}
    }
    std::cout<<${r.group === "accounts" ? "sum" : "value(totals)"}<<'\\n';
  }
  std::string trailing;if(std::cin>>trailing)return 2;
}
`;
}
export function nativeBatch(bin, sets) {
  const input = [
    sets.length,
    ...sets.flatMap((groups) => [
      groups.length,
      ...groups.map((g) => g.values.join(" ")),
    ]),
  ].join("\n");
  const p = spawnSync(bin, [], {
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2_000_000,
  });
  check(!p.error && p.status === 0, "Falló la evaluación nativa");
  const values = p.stdout.trim()
    ? p.stdout.trim().split(/\s+/).map(Number)
    : [];
  check(
    values.length === sets.length && values.every(Number.isSafeInteger),
    "Respuesta C++ inválida",
  );
  return values;
}
const fileHash = (p) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
export function host() {
  return hash([
    process.arch,
    process.platform,
    cpus()[0]?.model ?? "unknown",
    process.versions.node,
  ]);
}
export function qualifyNative(root, rule, observed = []) {
  const build = mkdtempSync(join(root, ".build-"));
  try {
    const source = cpp(rule);
    check(
      readFileSync(join(root, "kernel.cpp"), "utf8") === source,
      "Fuente C++ distinta del programa",
    );
    const binary = join(build, "kernel"),
      compiler = process.env.CXX || "c++";
    const compiled = spawnSync(
      compiler,
      ["-O3", "-std=c++17", join(root, "kernel.cpp"), "-o", binary],
      { encoding: "utf8", timeout: 60000 },
    );
    check(
      compiled.status === 0,
      "Se requiere un compilador C++17 local: " +
        (compiled.stderr ?? "").slice(0, 300),
    );
    const rows = [[], ...observed];
    let state = 23874623;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let i = 0; i < 600; i++)
      rows.push(
        Array.from({ length: (i % 12) + 1 }, (_, j) => ({
          account: String(j),
          values: rule.weights.map(() => rand() % 1000000),
        })),
      );
    for (let i = 0; i < rule.weights.length; i++)
      rows.push([
        {
          account: "max",
          values: rule.weights.map((_, j) => (i === j ? 4104000000000 : 0)),
        },
      ]);
    const expected = rows.map((g) => exact(rule, g)),
      verified = nativeBatch(binary, rows);
    check(
      hash(verified) === hash(expected) &&
        hash(rows.map((g) => compute(rule, g))) === hash(expected),
      "Paridad nativa incorrecta",
    );
    const js = [],
      native = [];
    for (let i = 0; i < 7; i++) {
      let t = performance.now();
      const a = rows.map((g) => compute(rule, g));
      js.push(performance.now() - t);
      t = performance.now();
      const b = nativeBatch(binary, rows);
      native.push(performance.now() - t);
      check(hash(a) === hash(b), "Paridad inestable");
    }
    const median = (a) => a.sort((x, y) => x - y)[3];
    const referenceMs = median(js),
      nativeMs = median(native);
    const receipt = {
      rule: hash(rule),
      source: hash(source),
      binary: fileHash(binary),
      host: host(),
      cases: rows.length,
      nativeMs,
      referenceMs,
      selected: nativeMs < referenceMs ? "cpp" : "reference",
      benchmark: "complete local batch call including IPC",
    };
    // A content-addressed binary and an atomic receipt prevent partially published selections.
    renameSync(binary, join(root, "kernel-" + receipt.binary));
    writeFileSync(join(build, "native.json"), JSON.stringify(receipt));
    renameSync(join(build, "native.json"), join(root, "native.json"));
    return receipt;
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
}
export function selectedBinary(root, rule) {
  let r;
  try {
    r = JSON.parse(readFileSync(join(root, "native.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  if (r.selected !== "cpp" || r.host !== host() || r.rule !== hash(rule))
    return null;
  check(
    r.source === hash(cpp(rule)) && /^[0-9a-f]{64}$/.test(r.binary),
    "Certificado nativo inválido",
  );
  const bin = join(root, "kernel-" + r.binary);
  check(fileHash(bin) === r.binary, "Binario alterado");
  return bin;
}
