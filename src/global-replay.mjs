import { readFileSync } from "node:fs";
import { executeMission } from "./global-analysis.mjs";
const snapshot = JSON.parse(readFileSync(0, "utf8"));
let output;
if (snapshot.factoryReplay) {
  const { predictExam, scoreExam } = await import("./factory/discover.mjs");
  if (snapshot.factoryReplay === "predict")
    output = predictExam(snapshot.candidate, snapshot.groups);
  else if (snapshot.factoryReplay === "score")
    output = scoreExam(
      snapshot.candidate,
      snapshot.predictions,
      snapshot.adapters,
      snapshot.answers,
    );
  else throw Error("Reproducción desconocida");
} else
  output = snapshot.factory
    ? await (await import("./factory/mission.mjs")).factoryExecution(snapshot)
    : await executeMission(snapshot);
process.stdout.write(JSON.stringify(output));
