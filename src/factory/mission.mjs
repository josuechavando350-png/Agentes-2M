import { reviewDecision } from "../global-analysis.mjs";
import { hash } from "./reader.mjs";
import { discover } from "./discover.mjs";
export function factoryGoal(project) {
  return {
    scope: project.id,
    subject: "fabrica",
    objective:
      "Descubrir y refutar una herramienta para el expediente autorizado",
    op: "difference",
    operands: [
      { field: "resultado", unit: "unidades", stage: "documentado" },
      { field: "control", unit: "unidades", stage: "documentado" },
    ],
    threshold: 1,
    minFamilies: 1,
    probes: [],
  };
}
export async function factoryExecution(snapshot) {
  const project = snapshot.factory,
    previous = snapshot.factoryPredecessor;
  const factory = discover(
    previous
      ? {
          ...project,
          precedents: [
            ...project.precedents,
            {
              name: "titular-" + previous.programHash.slice(0, 20),
              rule: previous.rule,
            },
          ],
        }
      : project,
  );
  const decision = {
    scope: snapshot.goal.scope,
    action: factory.status === "CANDIDATE" ? "ADVANCE" : "NEED_EVIDENCE",
    stage: factory.status,
    programHash: factory.programHash ?? null,
    attempts: factory.search.attempts.length,
    next:
      factory.search.question ??
      factory.expert?.question ??
      factory.formulas?.find((f) => f.question)?.question ??
      (factory.status === "CANDIDATE"
        ? "PREDICT_AND_SEAL"
        : "REVISE_DEMONSTRATIONS"),
  };
  const review = await reviewDecision(snapshot, decision.action, {
    demonstrations: hash(factory.training),
    search: hash(factory.search),
    workflow: hash(factory.workflow),
    decision,
  });
  return { factory, decision, ...review };
}
