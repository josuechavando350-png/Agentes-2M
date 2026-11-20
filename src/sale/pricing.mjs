import { check, key, num, list, unique } from "../factory/reader.mjs";
import { strict } from "../policy.mjs";
const scale = 10000;
export function fee(recovery, option) {
  return Math.min(
    option.capCents,
    Math.floor((recovery * option.shareBps) / scale),
  );
}
export function cost(recovery, option) {
  return (
    option.fixedCostCents +
    Math.ceil((recovery * option.variableCostBps) / scale)
  );
}
function validateOption(o) {
  strict(o, [
    "id",
    "capCents",
    "shareBps",
    "variableCostBps",
    "fixedCostCents",
  ]);
  key(o.id);
  num(o.capCents, 1, 1e10);
  num(o.shareBps, 1, scale);
  num(o.variableCostBps, 0, scale);
  num(o.fixedCostCents, 0, 1e10);
}
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// Before the cap, floor(a*n/B)-ceil(b*n/B) is either floor((a-b)*n/B) or one less.
// A point two units of slope away cannot improve an endpoint. Repeating a whole residue
// period changes profit by a fixed integer. Both arguments bound the exact search width.
export function boundaries(o, low, high) {
  const change = Math.ceil((o.capCents * scale) / o.shareBps);
  let min = Infinity,
    max = -Infinity,
    minAt = low,
    maxAt = low,
    examined = 0;
  function visit(n) {
    const value = fee(n, o) - cost(n, o);
    examined++;
    if (value < min) {
      min = value;
      minAt = n;
    }
    if (value > max) {
      max = value;
      maxAt = n;
    }
  }
  const end = Math.min(high, change - 1),
    share = o.shareBps,
    variable = o.variableCostBps;
  if (low <= end) {
    const slope = share - variable,
      period = scale / gcd(scale, gcd(share, variable));
    if (slope === 0) {
      visit(low);
      // A whole cent gives zero rounding loss; every other recovery loses one cent.
      const multiple = Math.ceil(low / period) * period;
      if (multiple > low && multiple <= end) visit(multiple);
      if (low % period === 0 && period > 1 && low < end) visit(low + 1);
    } else {
      const width = Math.min(period, Math.ceil((2 * scale) / Math.abs(slope)));
      const firstEnd = Math.min(end, low + width - 1);
      for (let n = low; n <= firstEnd; n++) visit(n);
      for (let n = Math.max(firstEnd + 1, end - width + 1); n <= end; n++)
        visit(n);
    }
  }
  const start = Math.max(low, change);
  if (start <= high) {
    visit(start);
    if (variable) {
      // The fee is constant. Only the first occurrence of the largest rounded cost is needed.
      const lastCost = Math.ceil((high * variable) / scale);
      const firstAtLastCost = Math.max(
        start,
        Math.floor(((lastCost - 1) * scale) / variable) + 1,
      );
      if (firstAtLastCost > start) visit(firstAtLastCost);
    }
  }
  return { lower: min, upper: max, minAt, maxAt, examined };
}
export function chooseOffer(terms, potential, available) {
  strict(terms, [
    "floorCents",
    "ceilingCents",
    "buyerFeeLimitCents",
    "buyerKeepsBps",
    "options",
  ]);
  num(potential, 1, 1e11);
  num(available, 0, 1e11);
  num(terms.floorCents, 0, potential);
  num(terms.ceilingCents, terms.floorCents, potential);
  num(terms.buyerFeeLimitCents, 0, 1e10);
  num(terms.buyerKeepsBps, 0, scale);
  unique(
    list(terms.options, 1, 24).map((o) => {
      validateOption(o);
      return o.id;
    }),
  );
  const candidates = terms.options.map((o) => {
    const maxCharge = fee(terms.ceilingCents, o),
      maxCost = cost(terms.ceilingCents, o);
    const reasons = [];
    if (maxCharge > terms.buyerFeeLimitCents) reasons.push("BUYER_FEE_LIMIT");
    // Require the quoted nominal fraction to respect the buyer's retained share even on small recoveries.
    if (o.shareBps > scale - terms.buyerKeepsBps)
      reasons.push("BUYER_RETAINED_SHARE");
    if (maxCost > available) reasons.push("UPFRONT_CAPACITY");
    return {
      id: o.id,
      maxCharge,
      maxCost,
      profit: boundaries(o, terms.floorCents, terms.ceilingCents),
      reasons,
    };
  });
  const eligible = candidates
    .filter((c) => !c.reasons.length)
    .sort(
      (a, b) =>
        b.profit.lower - a.profit.lower ||
        b.profit.upper - a.profit.upper ||
        a.maxCost - b.maxCost ||
        a.maxCharge - b.maxCharge ||
        a.id.localeCompare(b.id),
    );
  const winner = eligible[0];
  return {
    status: winner ? "DRAFT" : "NEED_TERMS",
    assumption:
      "margen bajo el intervalo propuesto de recuperación, condicionado al contrato; la aceptación y el cobro se observan por separado",
    selected: winner ? terms.options.find((o) => o.id === winner.id) : null,
    candidates,
  };
}
