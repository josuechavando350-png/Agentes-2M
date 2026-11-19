import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { dossierScore, freshSeed } from "./blind.mjs";
if (!isMainThread && workerData?.semarExam)
  parentPort.postMessage(dossierScore(workerData.seed, workerData.policy));

export async function contestSeal(baseline, candidates) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 8)
    throw Error("Candidaturas inválidas");
  const seed = freshSeed();
  const scores = await Promise.all(
    [baseline, ...candidates].map(
      ({ policy }) =>
        new Promise((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: { semarExam: true, seed, policy },
            execArgv: [],
          });
          w.once("message", resolve);
          w.once("error", reject);
          w.once("exit", (code) => {
            if (code) reject(Error("Examinador interrumpido"));
          });
        }),
    ),
  );
  return { seed, scores };
}
