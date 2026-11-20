import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Semar } from "../../src/semar.mjs";
import { scaleExam } from "../../src/global-scale.mjs";

const [dir, history, state, out, measurement] = process.argv.slice(2);
const read = (d, n) => JSON.parse(readFileSync(join(d, n + ".json")));
const store = new Semar(":memory:");
try {
  store.restore(
    JSON.parse(gunzipSync(readFileSync(join(state, "bitacora.json.gz")))),
    read(state, "avance").audit.tip,
  );
  const layout = store.layout(),
    prior = read(history, "packet");
  const cohorts = [],
    timing = [];
  for (const year of [2018, 2019])
    for (const vendor of ["260", "421"]) {
      const id = "ia-" + vendor + "-" + year;
      const packet = {
        ...prior,
        niche: "iowa-wholesale",
        queries: read(dir, id + "-cases"),
      };
      const result = scaleExam(layout, packet, read(dir, id + "-outcomes"));
      const { arms, hardware, ...manifest } = result;
      timing.push({
        id,
        hardware,
        arms: arms.map((a) => ({
          name: a.name,
          elapsedMs: a.elapsedMs,
          nativeMs: a.nativeMs ?? null,
        })),
      });
      cohorts.push({
        id,
        niche: packet.niche,
        references: packet.historical.length,
        cases: packet.queries.length,
        maturedAt: year + "-05-01",
        ...manifest,
        arms: arms.map(({ elapsedMs, nativeMs, ...a }) => a),
      });
    }
  writeFileSync(
    out,
    JSON.stringify(
      {
        scope: "Iowa, four historical 200-store cohorts, previously opened",
        cohorts,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(measurement, JSON.stringify(timing, null, 2) + "\n");
} finally {
  store.close();
}
