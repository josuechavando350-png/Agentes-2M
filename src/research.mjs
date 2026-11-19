import { integer } from "./policy.mjs";

// Small reproducible rulebooks for the independent school. External audited
// dossiers use exactly the same synthesize and predict commands.
export function researchCase(index) {
  integer(index, 0, 7, "experimento");
  const conditions = [
    [["a"], ["c"]],
    [
      ["a", "!c"],
      ["!a", "c"],
    ],
    [["a", "c"]],
    [["!a"], ["!c"]],
    [["!a", "!c"]],
    [
      ["a", "c"],
      ["!a", "!c"],
    ],
    [["!a"], ["c"]],
    [["a", "!c"]],
  ][index];
  return {
    facts: [{ literal: "a", source: "ejercicio observado" }],
    rules: conditions.map((list, i) => ({
      if: list,
      then: "objetivo",
      source: "criterio docente " + (i + 1),
    })),
    query: "objetivo",
  };
}
export async function researchRound(s, cycle) {
  integer(cycle, 1, 10_000_000, "ciclo");
  const sample = researchCase((cycle - 1) % 8);
  const teacher = 6_000_001 + (cycle % 490_000),
    student = 6_500_001 + (cycle % 490_000);
  const name = "investigacion-" + cycle;
  async function invoke(stage, id, fields) {
    const key = name + "-" + stage;
    const existing = s.receipt(key);
    if (existing) return existing;
    const a = s.agent(id);
    return s.command(key, {
      id,
      generation: a.generation,
      version: a.version,
      ...fields,
    });
  }
  const job = await invoke("docente", teacher, {
    type: "work",
    op: "inference",
    data: sample,
  });
  if (job.status !== "APPROVED") return { cycle, status: job.status };
  const evolved = await invoke("salud", student, {
    type: "synthesize",
    from: name + "-docente",
    features: ["a", "b", "c"],
  });
  if (evolved.status !== "EVOLVED")
    return { cycle, status: evolved.status, exam: evolved.exam ?? null };
  const child = await invoke("replica", evolved.first, {
    type: "predict",
    program: evolved.program,
    mask: 7,
  });
  if (child.status !== "APPROVED") throw Error("Hija sin prueba de trabajo");
  return {
    cycle,
    status: "COMPLETED",
    id: evolved.program,
    exam: evolved.exam,
    first: evolved.first,
    last: evolved.last,
    replicas: evolved.replicas,
    childValue: child.value,
  };
}
