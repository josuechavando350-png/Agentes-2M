import { planSale, commercialScope } from "./book.mjs";
import { pilotAssignment } from "./field.mjs";

// Store the runtime with the journal. The replay input carries only jobs referenced by the signed command.
export function saleReplayInput(s, record, at, treasury, trials) {
  const related = new Set([
    record.data.job,
    ...(record.data.proof?.record?.lines ?? [])
      .filter((l) => l.kind === "research")
      .map((l) => l.original),
  ]);
  const jobs = [...related]
    .filter((id) => s.jobs.has(id))
    .map((id) => [id, s.jobs.get(id)]);
  const sales = Object.fromEntries(
    Object.entries(s.sales).map(([name, collection]) => [
      name,
      [...collection],
    ]),
  );
  return {
    saleReplay: true,
    record,
    at,
    treasury,
    trials: record.data.pilot
      ? trials.filter((t) => t.trial === record.data.pilot)
      : [],
    state: {
      open: s.open,
      openedAt: s.openedAt,
      commercialSpent: s.commercialSpent ?? 0,
      spent: s.spent,
      held: s.held,
      jobs,
      sales,
    },
  };
}
export function evaluateSale(input) {
  const { record, at, treasury, trials, state } = input;
  const sales = Object.fromEntries(
    Object.entries(state.sales).map(([k, v]) => [
      k,
      k === "references" ? new Set(v) : new Map(v),
    ]),
  );
  return planCommercialRecord(
    { ...state, sales, jobs: new Map(state.jobs) },
    record,
    at,
    treasury,
    trials,
  );
}
export function planCommercialRecord(s, record, at, treasury, trials) {
  const d = planSale(s, record, at, treasury, trials);
  if (record.kind === "sale-offer")
    d.assignment = pilotAssignment(
      trials,
      record.data.buyer,
      commercialScope(s.jobs.get(record.data.job)),
      record.data.pilot,
      at,
    );
  return d;
}
