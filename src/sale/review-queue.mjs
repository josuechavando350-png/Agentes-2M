import { createHash } from "node:crypto";
import { creditRegister } from "./credits.mjs";

const check = (v, m) => {
  if (!v) throw Error(m);
};
const integer = (v, lo, hi) =>
  check(
    Number.isSafeInteger(v) && v >= lo && v <= hi,
    "Minutos o ventana de análisis inválidos",
  );
const sha = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function prepare(packet, spec) {
  const fields = [
    "minutes",
    "startBuyerMinutes",
    "openInvoiceMinutes",
    "perLineMinutes",
    "windowsDays",
    "completeLookback",
  ];
  check(
    JSON.stringify(Object.keys(spec).sort()) === JSON.stringify(fields.sort()),
    "Falta el costo de revisión o cambió el alcance",
  );
  integer(spec.minutes, 0, 1440);
  integer(spec.startBuyerMinutes, 0, 1440);
  integer(spec.openInvoiceMinutes, 1, 1440);
  integer(spec.perLineMinutes, 0, 1440);
  check(
    typeof spec.completeLookback === "boolean" &&
      Array.isArray(spec.windowsDays) &&
      spec.windowsDays.length &&
      spec.windowsDays.length <= 4,
    "Ventanas de revisión inválidas",
  );
  spec.windowsDays.forEach((d, i) => {
    integer(d, 1, 3650);
    check(!i || d > spec.windowsDays[i - 1], "Plazos repetidos o desordenados");
  });
  // Enlarging a window can only increase the isolated coverage of a credit. The longest horizon is its least favorable one.
  const view = creditRegister({
      ...packet,
      maxAgeDays: spec.windowsDays.at(-1),
    }),
    docs = new Map();
  for (const row of view.rows) {
    const id = JSON.stringify([row.party, row.invoice]);
    if (!docs.has(id))
      docs.set(id, {
        id,
        party: row.party,
        invoice: row.invoice,
        rows: [],
        cents: 0,
        face: 0,
      });
    const d = docs.get(id);
    d.rows.push(row.row);
    d.face += row.units * row.price;
    if (!spec.completeLookback || !row.leftCensored)
      d.cents += row.unavoidableCents;
  }
  const groups = new Map(),
    byId = new Map();
  for (const d of docs.values()) {
    d.cost = spec.openInvoiceMinutes + spec.perLineMinutes * d.rows.length;
    if (!d.cents || d.cost + spec.startBuyerMinutes > spec.minutes) continue;
    d.rows.sort((a, b) => a - b);
    byId.set(d.id, d);
    if (!groups.has(d.party)) groups.set(d.party, []);
    groups.get(d.party).push(d);
  }
  check(
    byId.size * (spec.minutes + 1) <= 40000000,
    "El examen excede 40 millones de estados; reduce el periodo o el turno",
  );
  const parties = [...groups]
    .sort(([a], [b]) => compare(a, b))
    .map(([, items]) => items.sort((a, b) => compare(a.id, b.id)));
  return { view, spec, parties, byId };
}
function optimal(data) {
  const { minutes, startBuyerMinutes } = data.spec;
  const best = Array(minutes + 1).fill(null);
  best[0] = { cents: 0, parent: null, id: null };
  for (const docs of data.parties) {
    const open = Array(minutes + 1).fill(null);
    for (const d of docs) {
      for (let m = minutes; m >= d.cost; m--) {
        const first = best[m - d.cost - startBuyerMinutes],
          again = open[m - d.cost];
        const prev =
          first && (!again || first.cents >= again.cents) ? first : again;
        if (prev && (!open[m] || prev.cents + d.cents > open[m].cents))
          open[m] = { cents: prev.cents + d.cents, parent: prev, id: d.id };
      }
    }
    for (let m = 0; m <= minutes; m++)
      if (open[m] && (!best[m] || open[m].cents > best[m].cents))
        best[m] = open[m];
  }
  let winner = best[0],
    duration = 0;
  for (let m = 1; m <= minutes; m++)
    if (best[m] && best[m].cents > winner.cents) {
      winner = best[m];
      duration = m;
    }
  const selected = [];
  for (let node = winner; node.id !== null; node = node.parent)
    selected.push(node.id);
  return {
    cents: winner.cents,
    minutes: duration,
    selected: selected.reverse(),
  };
}
function greedy(data) {
  let cents = 0,
    minutes = 0;
  const buyers = new Set();
  for (const d of [...data.byId.values()].sort(
    (a, b) => b.face - a.face || compare(a.id, b.id),
  )) {
    const extra =
      d.cost + (buyers.has(d.party) ? 0 : data.spec.startBuyerMinutes);
    if (minutes + extra > data.spec.minutes) continue;
    cents += d.cents;
    minutes += extra;
    buyers.add(d.party);
  }
  return { cents, minutes };
}
export function reviewQueue(packet, spec) {
  const data = prepare(packet, spec),
    winner = optimal(data);
  const selected = winner.selected.map((id) => {
    const d = data.byId.get(id);
    return {
      party: d.party,
      invoice: d.invoice,
      sourceRows: d.rows,
      documentMinutes: d.cost,
      reviewCents: d.cents,
    };
  });
  const result = {
    source: packet.source,
    inputHash: data.view.inputHash,
    currency: packet.currency,
    spec,
    eligibleDocuments: data.byId.size,
    eligibleBuyers: data.parties.length,
    selected,
    minutes: winner.minutes,
    reviewCents: winner.cents,
    faceValueBaseline: greedy(data),
    recoveredCents: null,
  };
  return { ...result, certificate: sha(result) };
}
// Independent checker: find each buyer's nondominated (minutes, value) combinations, then combine the frontiers.
export function verifyQueue(packet, spec, request) {
  const data = prepare(packet, spec),
    { certificate, ...result } = request;
  check(
    certificate === sha(result) &&
      result.inputHash === data.view.inputHash &&
      result.source === packet.source &&
      result.currency === packet.currency &&
      sha(result.spec) === sha(spec),
    "Plan o expediente distinto",
  );
  check(
    result.eligibleDocuments === data.byId.size &&
      result.eligibleBuyers === data.parties.length &&
      sha(result.faceValueBaseline) === sha(greedy(data)) &&
      result.recoveredCents === null,
    "Cifras de comparación distintas",
  );
  const buyers = new Set(),
    used = new Set();
  let spent = 0,
    value = 0;
  for (const r of result.selected) {
    const id = JSON.stringify([r.party, r.invoice]),
      d = data.byId.get(id);
    check(
      d &&
        !used.has(id) &&
        d.cost === r.documentMinutes &&
        d.cents === r.reviewCents &&
        sha(d.rows) === sha(r.sourceRows),
      "Documento duplicado, alterado o ajeno",
    );
    used.add(id);
    buyers.add(d.party);
    spent += d.cost;
    value += d.cents;
  }
  spent += buyers.size * spec.startBuyerMinutes;
  check(
    spent <= spec.minutes &&
      spent === result.minutes &&
      value === result.reviewCents,
    "El plan excede sus límites",
  );
  const global = Array(spec.minutes + 1).fill(-1);
  global[0] = 0;
  for (const docs of data.parties) {
    const local = Array(spec.minutes + 1).fill(-1);
    local[0] = 0;
    for (const d of docs)
      for (let m = spec.minutes - spec.startBuyerMinutes; m >= d.cost; m--)
        if (local[m - d.cost] >= 0)
          local[m] = Math.max(local[m], local[m - d.cost] + d.cents);
    let ceiling = 0;
    const options = [];
    for (let m = 1; m <= spec.minutes - spec.startBuyerMinutes; m++)
      if (local[m] > ceiling) {
        ceiling = local[m];
        options.push([m + spec.startBuyerMinutes, ceiling]);
      }
    const prior = global.slice();
    for (const [cost, amount] of options)
      for (let i = 0; i + cost <= spec.minutes; i++)
        if (prior[i] >= 0)
          global[i + cost] = Math.max(global[i + cost], prior[i] + amount);
  }
  const bound = Math.max(...global);
  check(
    value === bound && global.indexOf(bound) === spent,
    "Existe otro plan que revisa más importe o consume menos tiempo",
  );
  return {
    status: "OPTIMAL_IN_SCOPE",
    reviewCents: value,
    upperCents: bound,
    minutes: spent,
    documents: used.size,
    buyers: buyers.size,
    certificate,
  };
}
