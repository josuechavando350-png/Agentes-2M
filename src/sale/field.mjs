import { check, hash } from "../factory/reader.mjs";
import { salesReport } from "./book.mjs";

export function pilotAssignment(trials, subject, scope, id, at) {
  if (id === null) return null;
  const trial = trials.find(
    (t) => t.trial === id && t.scope === scope && t.from <= at && at < t.until,
  );
  const units = trial?.pairs.flat() ?? [],
    u = units.find((x) => x.subject === subject);
  check(
    u && u[u.arm].action === "OFFER",
    "El ensayo vigente no asignó una oferta a ese comprador",
  );
  return hash({
    id,
    subject,
    arm: u.arm,
    assignment: u[u.arm],
    from: trial.from,
    until: trial.until,
  });
}
// Compare each randomized unit's accounting close with independent bank entries through the trial window.
export function commercialReadiness(s, trials, mode = "LIVE") {
  const report = salesReport(s, mode),
    b = s.sales;
  const experimentIds = new Set(
    [...b.offers.values()]
      .filter((o) => o.mode === mode && o.pilot)
      .map((o) => o.pilot),
  );
  const linked = trials
    .filter((t) => experimentIds.has(t.trial))
    .map((t) => {
      const issues = [],
        groups = new Set();
      let matched = 0;
      for (const unit of t.units) {
        const buyer = b.clients.get(unit.subject),
          observation = unit.close;
        if (!buyer || buyer.mode !== mode || !observation || !unit.applied) {
          issues.push([unit.subject, "MISSING_CLOSE"]);
          continue;
        }
        if (groups.has(buyer.group)) {
          issues.push([unit.subject, "RELATED_BUYER"]);
          continue;
        }
        groups.add(buyer.group);
        const a = b.accounts.get(buyer.account);
        if (a.currency !== "MXN" || a.from > t.from || a.until < t.until) {
          issues.push([unit.subject, "BANK_WINDOW_OPEN"]);
          continue;
        }
        const feed = [...b.ledger.values()].filter(
          (l) => l.account === a.id && l.at >= t.from && l.at < t.until,
        );
        if (feed.some((l) => l.kind === "unapplied")) {
          issues.push([unit.subject, "UNASSIGNED_RECEIPT"]);
          continue;
        }
        const deals = [...b.offers.values()].filter(
          (o) =>
            o.buyer === buyer.id && o.quotedAt < t.until && o.mode === mode,
        );
        const ids = new Set(deals.map((o) => o.id)),
          lines = feed.filter((l) => ids.has(l.sale));
        const sum = (k) =>
          lines.filter((l) => l.kind === k).reduce((v, l) => v + l.cents, 0);
        const activity = [...b.activities.values()].find(
          (a) => a.pilot === t.trial && a.buyer === buyer.id,
        );
        const activityCost = activity
          ? feed
              .filter(
                (l) => l.kind === "field-cost" && l.original === activity.id,
              )
              .reduce((v, l) => v + l.cents, 0)
          : 0;
        const interfering = lines.some(
          (l) => b.offers.get(l.sale)?.pilot !== t.trial,
        );
        if (
          interfering ||
          observation.paid !== sum("fee") ||
          observation.refunds !== sum("refund") ||
          observation.cost !== sum("cost") + activityCost
        ) {
          issues.push([buyer.id, "CASH_DISAGREEMENT"]);
          continue;
        }
        const trialDeals = deals.filter((o) => o.pilot === t.trial);
        const closed = trialDeals.map((o) =>
          (o.closes ?? [o.close]).find((c) => c?.through === t.until),
        );
        if (
          (unit.action === "OFFER") !== Boolean(trialDeals.length) ||
          trialDeals.some((o) => o.quotedAt < t.from) ||
          closed.some((c) => !c)
        ) {
          issues.push([buyer.id, "OPEN_DELIVERY_OR_HOURS"]);
          continue;
        }
        const labor = closed.reduce(
          (v, c) => v + c.labor,
          activity?.labor ?? 0,
        );
        const earned = trialDeals.reduce(
          (v, o) => v + (o.delivery?.fee ?? 0),
          0,
        );
        if (
          observation.labor !== labor ||
          observation.paid - observation.refunds > earned
        ) {
          issues.push([buyer.id, "HOURS_OR_FEE_DISAGREEMENT"]);
          continue;
        }
        matched++;
      }
      return {
        id: t.trial,
        candidate: t.candidate,
        control: t.control,
        from: t.from,
        until: t.until,
        scope: t.scope,
        units: t.units.length,
        matched,
        issues,
        status:
          matched === t.units.length && t.status === "QUALIFIED_IN_SCOPE"
            ? "BANK_MATCHED_INCREMENTAL_MARGIN"
            : "AWAIT_INCREMENTAL_EVIDENCE",
      };
    });
  const independent = report.deals.filter(
    (d) => d.state === "POSITIVE_DIRECT_MARGIN",
  );
  const repeated = independent.some((a, i) =>
    independent
      .slice(i + 1)
      .some(
        (b) =>
          b.group !== a.group &&
          b.job &&
          Math.abs(a.quotedAt - b.quotedAt) >= 7 * 86400000,
      ),
  );
  const repeatedTrials = linked.some(
    (a, i) =>
      a.status === "BANK_MATCHED_INCREMENTAL_MARGIN" &&
      linked
        .slice(i + 1)
        .some(
          (b) =>
            b.status === "BANK_MATCHED_INCREMENTAL_MARGIN" &&
            b.scope === a.scope &&
            (a.until <= b.from || b.until <= a.from),
        ),
  );
  return {
    ...report,
    randomizedTrials: linked,
    repeatedAcrossWeeks: repeated,
    repeatedIncrementalTrials: repeatedTrials,
    commercialStatus:
      mode !== "LIVE"
        ? "DEMONSTRATION"
        : report.campaignNetCents > 0
          ? "POSITIVE_PILOT_NEEDS_REPLICATION"
          : report.quoted
            ? "AWAIT_RECONCILED_POSITIVE_MARGIN"
            : "NO_LIVE_PILOT",
  };
}
export function customerQuote(o) {
  check(o, "Oferta desconocida");
  const format = (n) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: o.currency,
      currencyDisplay: "code",
    }).format(n / 100);
  const selected = o.choice.selected,
    maxFee = Math.min(
      selected.capCents,
      Math.floor((o.terms.ceilingCents * selected.shareBps) / 10000),
    );
  return {
    buyer: o.buyer,
    reference: o.id,
    offerHash: o.digest,
    subject: o.service,
    text: [
      o.service + ".",
      "El expediente " +
        o.case +
        " contiene " +
        format(o.opportunityCents) +
        " por confirmar.",
      "Entregaremos el cálculo por cuenta y las referencias de cada movimiento para su revisión.",
      "La comisión es de " +
        selected.shareBps / 100 +
        " % sobre la recuperación que ustedes documenten, hasta " +
        format(maxFee) +
        ".",
      "Con una recuperación de " +
        format(o.terms.ceilingCents) +
        ", conservarían " +
        format(o.terms.ceilingCents - maxFee) +
        " después de nuestra comisión.",
      "La propuesta está vigente hasta " +
        new Date(o.expires).toISOString() +
        ". La aceptación identifica la referencia " +
        o.id +
        ".",
    ].join("\n\n"),
  };
}
