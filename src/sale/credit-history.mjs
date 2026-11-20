import { createHash } from "node:crypto";
import { creditRegister, traceCredits, verifyCredits } from "./credits.mjs";

const digest = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
function check(ok, message) {
  if (!ok) throw Error(message);
}

function scopes(current, previous) {
  check(
    previous.until === current.from,
    "El periodo anterior debe terminar exactamente donde empieza el actual",
  );
  check(
    previous.currency === current.currency &&
      previous.maxAgeDays === current.maxAgeDays,
    "La moneda o el plazo difieren entre archivos",
  );
  const currentView = creditRegister(current),
    previousView = creditRegister(previous);
  const lineId = (prefix, row) => prefix + "-" + row;
  const originals = new Map();
  const lines = [];
  for (const [prefix, packet] of [
    ["anterior", previous],
    ["actual", current],
  ]) {
    for (const line of packet.lines.toSorted((a, b) => a.row - b.row)) {
      const id = lineId(prefix, line.row);
      originals.set(id, {
        period: prefix,
        row: line.row,
        id: line.id,
        invoice: line.invoice,
      });
      lines.push({ ...line, id, row: lines.length + 1 });
    }
  }
  const key = [previousView.inputHash, currentView.inputHash];
  const combined = {
    ...current,
    from: previous.from,
    source: digest(["historial-completo-v1", ...key]),
    lines,
  };
  const selected = {
    ...combined,
    source: digest(["demanda-actual-v1", ...key]),
    lines: lines.filter(
      (r) => r.qty > 0 || originals.get(r.id).period === "actual",
    ),
  };
  return {
    packets: { current, previous, combined, selected },
    originals,
    currentView,
  };
}

// At each product and price the feasible credit allocations are a capacitated bipartite matching.
// The largest support of a subset is its rank in isolation. Its minimum among maximum matchings
// is total rank minus the complementary subset's rank. Future sales cannot back earlier credits.
function explain(context, reports, combinedCertificate) {
  const { current, previous, combined, selected } = reports;
  const { packets, originals, currentView } = context;
  const extendedRows = creditRegister(packets.combined).rows;
  const originalNotes = new Map(currentView.rows.map((r) => [r.row, r]));
  const witness = new Map();
  for (const group of combinedCertificate.groups) {
    for (const m of group.matches) {
      const credit = originals.get(m.credit),
        sale = originals.get(m.sale);
      if (credit.period !== "actual" || sale.period !== "anterior") continue;
      if (!witness.has(credit.row)) witness.set(credit.row, []);
      witness
        .get(credit.row)
        .push({
          row: sale.row,
          id: sale.id,
          invoice: sale.invoice,
          units: m.units,
        });
    }
  }
  const changes = [];
  for (const r of extendedRows) {
    const src = originals.get(r.id);
    if (src.period !== "actual") continue;
    const before = originalNotes.get(src.row);
    if (
      before.minBacked === r.minBacked &&
      before.maxBacked === r.maxBacked &&
      !witness.has(src.row)
    )
      continue;
    changes.push({
      row: src.row,
      id: src.id,
      invoice: src.invoice,
      units: r.units,
      unitPriceCents: r.price,
      before: [before.minBacked, before.maxBacked],
      after: [r.minBacked, r.maxBacked],
      earlierSalesInOneAssignment: witness.get(src.row) ?? [],
    });
  }
  changes.sort((a, b) => a.row - b.row);
  const lowerUnits = combined.backedUnits - previous.backedUnits;
  const lowerCents = combined.backedValueCents - previous.backedValueCents;
  check(
    lowerUnits >= 0 &&
      lowerUnits <= selected.backedUnits &&
      selected.backedUnits <= current.creditUnits &&
      lowerCents >= 0 &&
      lowerCents <= selected.backedValueCents &&
      selected.backedValueCents <= current.creditedValueCents,
    "Los límites de respaldo conjunto son incompatibles",
  );
  const summary = {
    mode: "DOCUMENTED_HISTORY_EXTENSION",
    currency: current.currency,
    maxAgeDays: current.maxAgeDays,
    notesInCurrentPeriod: current.credits,
    currentSource: current.source,
    previousSource: previous.source,
    previouslyBackedUnits: current.backedUnits,
    previouslyBackedCents: current.backedValueCents,
    currentBackedUnitsWithHistory: [lowerUnits, selected.backedUnits],
    currentBackedCentsWithHistory: [lowerCents, selected.backedValueCents],
    currentUnmatchedCentsWithHistory: [
      current.creditedValueCents - selected.backedValueCents,
      current.creditedValueCents - lowerCents,
    ],
    notesWithChangedBounds: changes.filter(
      (r) => r.before[0] !== r.after[0] || r.before[1] !== r.after[1],
    ).length,
    notesUsingPreviousSalesInWitness: witness.size,
    recoveredCents: null,
  };
  return { summary, changes };
}
export function extendCreditHistory(current, previous) {
  const ctx = scopes(current, previous);
  const proofs = {},
    reports = {};
  for (const [name, packet] of Object.entries(ctx.packets)) {
    const { certificate, report } = traceCredits(packet);
    proofs[name] = certificate;
    reports[name] = report;
  }
  return { format: 1, proofs, ...explain(ctx, reports, proofs.combined) };
}
export function verifyCreditHistory(current, previous, receipt) {
  check(
    receipt?.format === 1 && receipt.proofs,
    "Formato de certificado de historial desconocido",
  );
  const ctx = scopes(current, previous),
    reports = {};
  for (const [name, packet] of Object.entries(ctx.packets))
    reports[name] = verifyCredits(packet, receipt.proofs[name]);
  const expected = explain(ctx, reports, receipt.proofs.combined);
  check(
    digest(expected.summary) === digest(receipt.summary) &&
      digest(expected.changes) === digest(receipt.changes),
    "Los resultados o las referencias de las notas difieren de los certificados",
  );
  return expected.summary;
}
