import { digest, strict } from "../policy.mjs";
import { key, check } from "../factory/reader.mjs";
import { reviewDecision } from "../global-analysis.mjs";
import { traceCredits } from "./credits.mjs";
export function creditGoal(scope) {
  return {
    scope,
    subject: "cancelaciones",
    objective:
      "Conciliar las notas de crédito con ventas documentadas bajo las condiciones autorizadas",
    op: "difference",
    operands: [
      { field: "cancelado", unit: "centavos", stage: "documentado" },
      { field: "respaldado", unit: "centavos", stage: "documentado" },
    ],
    threshold: 1,
    minFamilies: 1,
    probes: [],
  };
}
export function creditMandate(data, at) {
  strict(data, ["scope", "buyer", "packet", "cap"]);
  key(data.scope);
  if (data.buyer !== null) key(data.buyer);
  check(
    data.packet.until <= at + 1 &&
      JSON.stringify(data.packet).length <= 7000000,
    "Periodo posterior o paquete demasiado grande para el libro",
  );
  return {
    creditScope: data.scope,
    creditBuyer: data.buyer,
    credit: data.packet,
  };
}
export async function creditExecution(snapshot) {
  const credit = traceCredits(snapshot.credit),
    r = credit.report,
    open = r.unmatchedValueCents > 0;
  const decision = {
    scope: snapshot.creditScope,
    action: open ? "NEED_EVIDENCE" : "STOP",
    stage: open ? "REVIEW_SOURCE_INVOICES" : "FULLY_BACKED_IN_SCOPE",
    next: open
      ? "Solicitar los originales de las partidas sin respaldo observable"
      : "Conservar la conciliación",
    reviewCents: r.unmatchedValueCents,
  };
  return {
    credit,
    decision,
    ...(await reviewDecision(snapshot, decision.action, {
      source: r.inputHash,
      certificate: digest(credit.certificate),
      decision,
    })),
  };
}
