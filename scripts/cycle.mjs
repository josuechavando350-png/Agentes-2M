import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { enrollAndExercise, rolloutReport } from "../src/rollout.mjs";
import { runMission } from "../src/mission-cycle.mjs";
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
  await s.command("dotacion-unica-de-incubacion", { type: "reserve_births" });
  await s.command("mando-diablo-666", { type: "install_government" });
  const admission = await enrollAndExercise(s);
  const mission = await runMission(s, {
    publicFeed: process.argv.includes("--public-feed"),
    manifest: process.env.SEMAR_SOURCE_MANIFEST,
  });
  const status = s.status();
  const evolve =
    !process.argv.includes("--pulse") &&
    status.population < CAP &&
    status.treasury >= STIPEND * Math.min(BATCH, CAP - status.population);
  const cycle = (meta.cycle ?? 0) + Number(evolve);
  const result = evolve ? await researchRound(s, cycle) : (meta.result ?? null);
  const checkpoint = s.checkpoint();
  const censusPath = join(dir, "censo-100m.json");
  if (!existsSync(censusPath))
    writeFileSync(
      censusPath,
      JSON.stringify(rolloutReport(s, admission), null, 2) + "\n",
    );
  const out = {
    cycle,
    parentTip: meta.audit.tip,
    result,
    status: s.status(),
    audit: s.audit(),
  };
  if (meta.audit.tip !== checkpoint.tip) {
    writeFileSync(logPath, gzipSync(JSON.stringify(checkpoint.events)));
    writeFileSync(summaryPath, JSON.stringify(out, null, 2) + "\n");
  }
  const publicView = { ...mission, checkpoint: checkpoint.tip };
  writeFileSync(
    join(dir, "mando.json"),
    JSON.stringify(publicView, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      cycle,
      population: out.status.population,
      mission: mission.command.mission.id,
      phase: mission.command.mission.phase,
      latest: mission.latest,
      feed: mission.feed,
      audit: out.audit.status,
    }),
  );
} finally {
  s.close();
}
