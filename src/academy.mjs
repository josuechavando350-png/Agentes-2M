import { OPS, initialSkills, integer } from "./policy.mjs";
import { examCase } from "./inference.mjs";

// A local school run. Students request a skill from another sector, then a child
// receives an unseen input. Stable round IDs make a partially finished run resumable.
export async function trainRound(s, round) {
  const founders = s.status().founders ?? 10_000_000;
  integer(round, 1, founders, "ronda");
  const teacherSector = 1 + ((round - 1) % 10);
  const learnerSector = (teacherSector % 10) + 1;
  const offset = Math.floor((round - 1) / 10) + 1;
  const teacherId = s.founderId(teacherSector, offset);
  const studentId = s.founderId(learnerSector, offset);
  const op = initialSkills(teacherSector).find(
    (x) => !initialSkills(learnerSector).includes(x),
  );
  if (!OPS.includes(op))
    throw Error("No hay habilidad transferible en esta ronda");
  const inputs = [round % 23, -4, 7, round % 17, 1];
  const sample = (a) => (op === "inference" ? examCase(a) : a);
  async function task(stage, id, data) {
    const key = "escuela-" + round + "-" + stage;
    const prior = s.receipt(key);
    if (prior) return prior;
    const a = s.agent(id);
    return s.command(key, {
      type: "work",
      id,
      generation: a.generation,
      version: a.version,
      op,
      data: sample(data),
    });
  }
  const lesson = await task("docente", teacherId, inputs);
  if (lesson.status !== "APPROVED")
    return { round, status: lesson.status, stage: "docente" };
  const student = await task("alumno", studentId, inputs.toReversed());
  if (student.status !== "APPROVED")
    return { round, status: student.status, stage: "alumno" };
  let child;
  if (student.first)
    child = await task("replica", student.first, [4, -9, 2, round % 19, 3]);
  const council = await s.command("escuela-" + round + "-consejo", {
    type: "council",
    sector: learnerSector,
    op,
  });
  return {
    round,
    op,
    status: child && child.status !== "APPROVED" ? child.status : "COMPLETED",
    teacher: teacherId,
    student: studentId,
    version: student.version,
    replicas: student.replicas ?? 0,
    child: child?.id ?? null,
    leaders: council.replies.length,
  };
}
