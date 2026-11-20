import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { Semar } from "../../src/semar.mjs";
import { verifyParticipation } from "../../src/sale/participation.mjs";
const [folder, statePath, evidencePath, population = "100000000"] =
    process.argv.slice(2),
  read = (p) => JSON.parse(readFileSync(p));
const store = new Semar(":memory:");
try {
  store.restore(
    JSON.parse(gunzipSync(readFileSync(join(statePath, "bitacora.json.gz")))),
    read(join(statePath, "avance.json")).audit.tip,
  );
  const start = performance.now(),
    verified = verifyParticipation(
      store.layout(),
      read(join(folder, "packet.json")),
      read(join(folder, "frozen.json")),
      read(evidencePath),
      Number(population),
    );
  console.log(
    JSON.stringify(
      { ...verified, milliseconds: performance.now() - start },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
