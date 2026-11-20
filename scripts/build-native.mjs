import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = join(root, ".cache");
mkdirSync(cache, { recursive: true });
const tmp = mkdtempSync(join(cache, "cpp-"));
try {
  execFileSync(
    process.env.CXX ?? "c++",
    [
      "-std=c++17",
      "-O3",
      "-pthread",
      "-Wall",
      "-Wextra",
      "native/main.cpp",
      "native/team.cpp",
      "native/snapshot.cpp",
      "native/population.cpp",
      "native/offers.cpp",
      "-lcrypto",
      "-lz",
      "-o",
      join(tmp, "semar-native"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  renameSync(join(tmp, "semar-native"), join(cache, "semar-native"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
