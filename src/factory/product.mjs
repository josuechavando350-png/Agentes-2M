import { readDossier, check, hash, list } from "./reader.mjs";
import { evaluate } from "./rules.mjs";
import { gate } from "./expert.mjs";
import { verifyRule } from "./proof.mjs";
import { verifyOptimum } from "./workflow.mjs";
export function validateRelease(release) {
  check(
    release.format === "semar-product-1" &&
      release.grade.status === "QUALIFIED_IN_SCOPE",
    "Producto sin admisión",
  );
  check(
    hash(release.program) === release.grade.programHash &&
      hash(release.adapters) === release.grade.adaptersHash,
    "Programa o adaptadores distintos del examen",
  );
  verifyRule(release.program.rule, release.program.proof);
  verifyOptimum(release.flow, release.optimum.certificate);
}
export function inputCase(input) {
  if (input.format === 2) return input.dossier;
  if (input.format === 1) {
    const x = input.case;
    return {
      id: x.id,
      sector: x.sector,
      period: x.period,
      flags: x.flags ?? {},
      registers: x.ledgers.map((r) => ({
        id: r.name,
        kind: r.type,
        closed: r.finished,
        ...(!r.finished ? { account: r.account, limit: r.limit } : {}),
        files: r.tables.map((t) => ({ id: t.name, csv: t.text })),
      })),
    };
  }
  throw Error("Se requiere el formato de entrada 1 o 2");
}
export function prepare(release, input) {
  const dossier = inputCase(input),
    p = release.program;
  const sector = release.adapters.filter((a) => a.sector === dossier.sector);
  const adapter =
    sector.find((a) => a.period === dossier.period) ??
    (new Set(sector.map((a) => hash(a.reader))).size === 1 ? sector[0] : null);
  const reader = adapter?.reader ?? p.reader;
  if (!adapter && sector.length)
    throw Error("Indica un periodo con glosario verificado para este sector");
  return {
    dossier,
    parsed: readDossier(dossier, reader, p.kinds, p.unit),
    permission: gate(p.expert, dossier.flags),
    transfer:
      release.adapters.some((a) => a.sector === dossier.sector) ||
      dossier.sector === release.trainingSector
        ? "MEASURED_SECTOR"
        : "UNMEASURED_SECTOR",
  };
}
export function result(release, prepared, knownValue) {
  const { parsed, permission, transfer } = prepared,
    p = release.program;
  if (transfer === "UNMEASURED_SECTOR")
    return {
      case: parsed.id,
      status: "NEED_EVIDENCE",
      value: null,
      questions: [{ ask: "Examinar el nuevo sector con casos reservados" }],
      refs: parsed.refs,
      transfer,
    };
  if (!permission.allowed)
    return {
      case: parsed.id,
      status: "NEED_EVIDENCE",
      value: null,
      questions: [permission],
      refs: parsed.refs,
      transfer,
    };
  return { ...evaluate(parsed, p.rule, p.kinds, knownValue), transfer };
}
export function runProduct(release, input) {
  return result(release, prepare(release, input));
}
