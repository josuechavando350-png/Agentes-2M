import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { reviewQueue, verifyQueue } from "../../src/sale/review-queue.mjs";
import { hash } from "../../src/factory/reader.mjs";
const packet = JSON.parse(readFileSync(process.argv[2])),
  runs = [];
for (const minutes of [30, 60, 120, 240]) {
  const spec = {
    minutes,
    startBuyerMinutes: 5,
    openInvoiceMinutes: 3,
    perLineMinutes: 1,
    windowsDays: [30, 90],
    completeLookback: true,
  };
  const start = performance.now(),
    q = reviewQueue(packet, spec),
    verified = verifyQueue(packet, spec, q);
  runs.push({
    spec,
    ...verified,
    eligibleDocuments: q.eligibleDocuments,
    eligibleBuyers: q.eligibleBuyers,
    faceValueBaseline: q.faceValueBaseline,
    advantageInDocumentedCents: q.reviewCents - q.faceValueBaseline.cents,
    elapsedMs: performance.now() - start,
  });
}
console.log(
  JSON.stringify(
    {
      mode: "HISTORICAL_DOCUMENT_SELECTION",
      source: packet.source,
      currency: packet.currency,
      method: hash("semar-facturas-dos-etapas-1"),
      assumption:
        "Calendario hipotético de revisión aplicado al archivo histórico. El importe mide volumen por documentar, no recuperación ni ingresos.",
      runs,
      ownReceipts: null,
    },
    null,
    2,
  ),
);
