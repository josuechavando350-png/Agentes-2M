import { INITIAL, LEGACY_INITIAL, BATCH, STIPEND, SECTORS } from "./policy.mjs";

const INPUT = {
  facts: [
    { literal: "documentado", source: "acta de prueba" },
    { literal: "inspeccionado", source: "registro de prueba" },
    { literal: "!listo", source: "observación discrepante" },
  ],
  rules: [
    { if: ["documentado"], then: "trazable", source: "criterio A" },
    { if: ["trazable", "inspeccionado"], then: "listo", source: "criterio B" },
  ],
  query: "listo",
};
const QUERIES = [
  ["listo", "CONFLICTED"],
  ["trazable", "SUPPORTED"],
  ["ausente", "UNKNOWN"],
];

export async function enrollAndExercise(s) {
  const admission =
    s.receipt("fundadores-100m") ??
    (await s.command("fundadores-100m", {
      type: "expand_founders",
    }));
  const last = s.receipt("fundadores-100m-consejo");
  const teacherKey = "fundadores-100m-docente";
  if (!last) {
    const needsTraining = SECTORS.reduce((n, _, i) => {
      const student = s.agent(
        s.founderId(i + 1, LEGACY_INITIAL / SECTORS.length + 1),
      );
      return n + Number(!student.skills.includes("inference"));
    }, 0);
    if (s.status().treasury < needsTraining * BATCH * STIPEND)
      throw Error(
        "Reserva insuficiente para las pruebas de formación de los sectores",
      );
    async function request(key, id, fields) {
      const previous = s.receipt(key);
      if (previous) return previous;
      const a = s.agent(id);
      return s.command(key, {
        ...fields,
        id,
        generation: a.generation,
        version: a.version,
      });
    }
    const teacher = await request(teacherKey, s.founderId(7, 997), {
      type: "work",
      op: "inference",
      data: INPUT,
    });
    if (teacher.value !== "CONFLICTED" || teacher.status !== "APPROVED")
      throw Error("Expediente sin maestro aprobado");
    for (let sector = 1; sector <= SECTORS.length; sector++) {
      const id = s.founderId(sector, LEGACY_INITIAL / SECTORS.length + 1);
      const [query, answer] = QUERIES[(sector - 1) % QUERIES.length];
      const result = await request("fundadores-100m-sector-" + sector, id, {
        type: "recall",
        from: teacherKey,
        query,
      });
      if (result.value !== answer || result.status !== "APPROVED")
        throw Error("Sector sin prueba aprobada: " + sector);
    }
    const council = await s.command("fundadores-100m-consejo", {
      type: "council",
      sector: 1,
      op: "inference",
    });
    if (council.replies.length !== SECTORS.length)
      throw Error("Consejo incompleto");
  }
  return admission;
}

export function rolloutReport(s, admission) {
  const status = s.status(),
    scan = s.census(1, status.population, { examine: true });
  if (
    scan.identities !== status.population ||
    scan.tested !== status.live ||
    scan.sectors.some((g) => g.founders !== INITIAL / SECTORS.length) ||
    Object.values(scan.byMethod).reduce((a, b) => a + b, 0) !== status.live
  )
    throw Error("Censo incompleto");
  const sectors = SECTORS.map((_, i) => {
    const r = s.receipt("fundadores-100m-sector-" + (i + 1));
    if (
      r?.status !== "APPROVED" ||
      r.verdicts.length !== 3 ||
      r.verdicts.some((v) => v.verdict !== "ACCEPT")
    )
      throw Error("Recibo sectorial inválido");
    return {
      leader: "L" + (i + 1),
      id: r.id,
      conclusion: r.value,
      version: r.version,
      replicas: r.replicas ?? 0,
      evidence: r.evidenceDigest,
    };
  });
  return {
    schema: 1,
    checkpoint: status.tip,
    admission,
    founders: INITIAL,
    scan,
    sectors,
  };
}
