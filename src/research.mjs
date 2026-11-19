import { integer } from "./policy.mjs";

// Small reproducible rulebooks for the independent school. External audited
// dossiers use exactly the same synthesize and predict commands.
export function researchCase(index) {
  integer(index, 0, 261, "experimento");
  if (index >= 8) {
    const table = index - 7; // 1..254: every nonconstant truth table over three active inputs.
    const rules = [];
    for (let row = 0; row < 8; row++)
      if (table & (1 << row))
        rules.push({
          if: ["a", "c", "d"].map((v, i) => (row & (1 << i) ? "" : "!") + v),
          then: "objetivo",
          source: "currículo tabla " + table + " fila " + row,
        });
    return { facts: [], rules, query: "objetivo" };
  }
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
  const founders = s.status().founders ?? 10_000_000;
  integer(cycle, 1, founders, "ciclo");
  const index = (cycle - 1) % 262;
  const sample = researchCase(index);
  const previous =
    cycle > 2 ? s.receipt("investigacion-" + (cycle - 1) + "-salud") : null;
  const teacher = previous?.first ?? 6_000_001 + (cycle % 490_000);
  const sector = 1 + ((cycle + 7) % 10);
  const predecessor =
    cycle > 12 ? s.receipt("investigacion-" + (cycle - 10) + "-salud") : null;
  const ordinal =
    1500 +
    (cycle % 400_000) +
    (founders > 10_000_000 ? (1 + (cycle % 9)) * 1_000_000 : 0);
  const student =
    cycle <= 2
      ? 6_500_001 + (cycle % 490_000)
      : (predecessor?.last ?? s.founderId(sector, ordinal));
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
  if (!s.agent(student).skills.includes("inference")) {
    const prepared = await invoke("formacion", student, {
      type: "work",
      op: "inference",
      data: sample,
    });
    if (prepared.status !== "APPROVED")
      return { cycle, status: prepared.status };
  }
  const evolved = await invoke("salud", student, {
    type: "synthesize",
    from: name + "-docente",
    features: index < 8 ? ["a", "b", "c"] : ["a", "b", "c", "d"],
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
