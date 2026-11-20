import { createHash } from "node:crypto";

function requireValue(condition, message) {
  if (!condition) throw Error(message);
}
function integer(value, min, max) {
  requireValue(
    Number.isSafeInteger(value) && value >= min && value <= max,
    "Entero fuera de dominio",
  );
  return value;
}
function label(s) {
  requireValue(
    typeof s === "string" && s.length > 0 && s.length <= 128,
    "Identificador ausente",
  );
  return s;
}
function bound(rows, time, strict = false) {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (rows[m].time < time || (strict && rows[m].time === time)) lo = m + 1;
    else hi = m;
  }
  return lo;
}
const creditKey = (r) => JSON.stringify([r.party, r.sku, r.price]);
const compactFormat = "SEMAR-CREDIT-DEMAND-1";
function prepare(packet, demandOnly = false) {
  const { source, currency, from, until, maxAgeDays, lines } = packet;
  requireValue(
    /^[0-9a-f]{64}$/.test(source) && /^[A-Z]{3}$/.test(currency),
    "Origen o moneda inválidos",
  );
  integer(from, 0, 8e15);
  integer(until, from + 1, 8e15);
  integer(maxAgeDays, 1, 3650);
  requireValue(
    Array.isArray(lines) && lines.length <= 600000,
    "Demasiadas partidas",
  );
  const demand = demandOnly
    ? new Set(lines.filter((r) => r.qty < 0).map(creditKey))
    : null;
  const groupKeys = demandOnly ? new Set() : null;
  const all = new Map(),
    rows = new Set(),
    groups = new Map(),
    sha = createHash("sha256");
  sha.update(
    JSON.stringify([source, currency, from, until, maxAgeDays]) + "\n",
  );
  let gross = 0;
  for (const l of lines) {
    const { id, party, sku, price, qty, time, invoice, row } = l;
    [id, party, sku, invoice].forEach(label);
    integer(row, 1, 1e9);
    integer(time, from, until - 1);
    integer(price, 1, 1e7);
    integer(qty, -1e7, 1e7);
    requireValue(
      qty !== 0 && !all.has(id) && !rows.has(row),
      "Partida repetida o sin unidades",
    );
    gross += Math.abs(qty) * price;
    requireValue(
      Number.isSafeInteger(gross),
      "Importe fuera de representación exacta",
    );
    rows.add(row);
    all.set(id, l);
    const group = creditKey(l);
    groupKeys?.add(group);
    if (!demand || demand.has(group)) {
      if (!groups.has(group))
        groups.set(group, { key: group, sales: [], credits: [] });
      groups.get(group)[qty > 0 ? "sales" : "credits"].push(l);
    }
    sha.update(
      JSON.stringify([id, party, sku, price, qty, time, invoice, row]) + "\n",
    );
  }
  const order = (a, b) => a.time - b.time || a.row - b.row;
  for (const g of groups.values()) {
    g.sales.sort(order);
    g.credits.sort(order);
  }
  return {
    all,
    groups,
    totalGroups: groupKeys?.size ?? groups.size,
    age: maxAgeDays * 86400000,
    inputHash: sha.digest("hex"),
  };
}
function matching(sales, credits, age) {
  // Eligible intervals have FIFO expirations. For each demand use the earliest eligible unspent unit.
  const free = sales.map((s) => s.qty),
    matches = [],
    inbound = credits.map(() => []);
  let head = 0,
    units = 0;
  for (const [j, c] of credits.entries()) {
    while (
      head < sales.length &&
      (sales[head].time < c.time - age || free[head] === 0)
    )
      head++;
    let need = -c.qty;
    while (need && head < sales.length && sales[head].time < c.time) {
      const used = Math.min(need, free[head]);
      free[head] -= used;
      need -= used;
      units += used;
      matches.push({ sale: sales[head].id, credit: c.id, units: used });
      inbound[j].push(head);
      if (free[head] === 0) head++;
    }
  }
  return { free, matches, inbound, units };
}
function cover(sales, credits, flow, age) {
  // Residual reachability from unused sale units. Successor links visit each eligible credit only once.
  const seenSale = flow.free.map((q) => q > 0),
    seenCredit = Array(credits.length).fill(false),
    queue = [];
  seenSale.forEach((seen, i) => {
    if (seen) queue.push(i);
  });
  const next = Array.from({ length: credits.length + 1 }, (_, i) => i);
  function find(i) {
    while (next[i] !== i) {
      next[i] = next[next[i]];
      i = next[i];
    }
    return i;
  }
  for (let k = 0; k < queue.length; k++) {
    const s = sales[queue[k]],
      end = bound(credits, s.time + age, true);
    let j = find(bound(credits, s.time, true));
    while (j < end) {
      seenCredit[j] = true;
      for (const p of flow.inbound[j])
        if (!seenSale[p]) {
          seenSale[p] = true;
          queue.push(p);
        }
      next[j] = find(j + 1);
      j = find(j);
    }
  }
  return {
    sales: sales.filter((_, i) => !seenSale[i]).map((s) => s.id),
    credits: credits.filter((_, i) => seenCredit[i]).map((c) => c.id),
  };
}
function verifyGroup(g, certificate, age) {
  const sales = new Map(g.sales.map((s) => [s.id, s])),
    credits = new Map(g.credits.map((c) => [c.id, c]));
  const use = new Map(),
    taken = new Map();
  let matched = 0;
  for (const m of certificate.matches) {
    const s = sales.get(m.sale),
      c = credits.get(m.credit);
    requireValue(
      s && c && s.time < c.time && s.time >= c.time - age,
      "Enlace a partida inexistente, posterior o vencida",
    );
    integer(m.units, 1, 1e7);
    use.set(s.id, (use.get(s.id) ?? 0) + m.units);
    taken.set(c.id, (taken.get(c.id) ?? 0) + m.units);
    requireValue(
      use.get(s.id) <= s.qty && taken.get(c.id) <= -c.qty,
      "Unidad contabilizada dos veces",
    );
    matched += m.units;
  }
  const coverSales = new Set(certificate.cover.sales),
    coverCredits = new Set(certificate.cover.credits);
  requireValue(
    coverSales.size === certificate.cover.sales.length &&
      coverCredits.size === certificate.cover.credits.length,
    "Cobertura duplicada",
  );
  let upper = 0;
  for (const id of coverSales) {
    requireValue(sales.has(id), "Venta sin partida");
    upper += sales.get(id).qty;
  }
  for (const id of coverCredits) {
    requireValue(credits.has(id), "Cancelación sin partida");
    upper -= credits.get(id).qty;
  }
  const uncovered = g.credits.filter((c) => !coverCredits.has(c.id));
  for (const s of g.sales)
    if (!coverSales.has(s.id)) {
      const j = bound(uncovered, s.time, true);
      requireValue(
        j === uncovered.length || uncovered[j].time > s.time + age,
        "Enlace posible sin cota superior",
      );
    }
  requireValue(
    upper === matched && matched === certificate.units,
    "Falta la igualdad entre asignación factible y cota superior",
  );
  return matched;
}
function solveGroup(g, age) {
  const flow = matching(g.sales, g.credits, age);
  return {
    key: g.key,
    units: flow.units,
    matches: flow.matches,
    cover: cover(g.sales, g.credits, flow, age),
  };
}
// Number eligible sale units by chronological order. Both ends of every credit's interval are nondecreasing.
// An earliest-first prefix and latest-first suffix leave the largest possible gap for a credit removed from the chain.
// Its guaranteed contribution to a maximum matching is the remaining gap clipped to demand.
// Its maximum is its isolated rank: a matching of that credit extends to a maximum by augmenting other demands.
export function creditRegister(packet) {
  const { groups, inputHash, age } = prepare(packet, true),
    rows = [];
  let unavoidableCents = 0,
    ambiguousNotes = 0;
  for (const g of groups.values()) {
    const cumulative = [0];
    for (const sale of g.sales) cumulative.push(cumulative.at(-1) + sale.qty);
    let prefix = 0;
    const intervals = g.credits.map((c) => {
      const lo = cumulative[bound(g.sales, c.time - age)],
        hi = cumulative[bound(g.sales, c.time)];
      const left = Math.max(prefix, lo);
      prefix = left + Math.min(-c.qty, hi - left);
      return { lo, hi, left, c };
    });
    let suffix = cumulative.at(-1);
    for (let j = intervals.length - 1; j >= 0; j--) {
      const { lo, hi, left, c } = intervals[j],
        right = Math.min(suffix, hi),
        demand = -c.qty;
      const minBacked = Math.min(demand, Math.max(0, right - left)),
        maxBacked = Math.min(demand, hi - lo);
      suffix = right - Math.min(demand, right - lo);
      const unavoidableUnmatched = demand - maxBacked,
        ambiguous = minBacked !== maxBacked;
      ambiguousNotes += Number(ambiguous);
      unavoidableCents += unavoidableUnmatched * c.price;
      rows.push({
        id: c.id,
        invoice: c.invoice,
        row: c.row,
        party: c.party,
        sku: c.sku,
        price: c.price,
        units: demand,
        minBacked,
        maxBacked,
        unavoidableUnmatched,
        unavoidableCents: unavoidableUnmatched * c.price,
        ambiguous,
        leftCensored: c.time - packet.from < age,
      });
    }
  }
  rows.sort((a, b) => b.unavoidableCents - a.unavoidableCents || a.row - b.row);
  return {
    source: packet.source,
    inputHash,
    currency: packet.currency,
    maxAgeDays: packet.maxAgeDays,
    notes: rows.length,
    ambiguousNotes,
    unavoidableCents,
    rows,
  };
}
export function verifyCredits(packet, certificate) {
  requireValue(
    certificate &&
      (certificate.format === undefined ||
        certificate.format === compactFormat),
    "Formato de certificado desconocido",
  );
  const { groups, inputHash, age, totalGroups } = prepare(
    packet,
    certificate.format === compactFormat,
  );
  requireValue(
    certificate.inputHash === inputHash,
    "El certificado pertenece a otro expediente",
  );
  const by = new Map(certificate.groups.map((g) => [g.key, g]));
  requireValue(
    by.size === groups.size && by.size === certificate.groups.length,
    "Cobertura incompleta",
  );
  let units = 0,
    valueCents = 0,
    creditCents = 0,
    creditUnits = 0,
    credits = 0,
    nearStart = 0,
    looseUnits = 0;
  for (const g of groups.values()) {
    const c = by.get(g.key);
    requireValue(c, "Grupo omitido");
    const matched = verifyGroup(g, c, age),
      price = JSON.parse(g.key)[2];
    units += matched;
    valueCents += matched * price;
    for (const r of g.credits) {
      credits++;
      creditUnits -= r.qty;
      creditCents -= r.qty * r.price;
      if (r.time - packet.from < age) nearStart++;
      const first = bound(g.sales, r.time - age);
      if (first < g.sales.length && g.sales[first].time < r.time)
        looseUnits -= r.qty;
    }
  }
  return {
    inputHash,
    source: packet.source,
    currency: packet.currency,
    maxAgeDays: packet.maxAgeDays,
    groups: totalGroups,
    lines: packet.lines.length,
    credits,
    creditUnits,
    creditedValueCents: creditCents,
    backedUnits: units,
    backedValueCents: valueCents,
    unmatchedUnits: creditUnits - units,
    unmatchedValueCents: creditCents - valueCents,
    creditsNearStart: nearStart,
    looseLookupBackedUnits: looseUnits,
    overstatementByLooseLookup: looseUnits - units,
    mathematicalGapUnits: 0,
    meaning:
      "Máximo respaldo observable en este archivo, bajo el mismo comprador, producto y precio y la ventana declarada. La recuperación real requiere confirmación.",
  };
}
export function traceCredits(packet, { compact = false } = {}) {
  const { groups, inputHash, age } = prepare(packet, compact),
    certificate = {
      ...(compact ? { format: compactFormat } : {}),
      inputHash,
      groups: [...groups.values()].map((g) => solveGroup(g, age)),
    };
  return { certificate, report: verifyCredits(packet, certificate) };
}
// Preserve every cancellation and every sale that could share its buyer, product and price.
export function projectCreditFile(original) {
  const fullInput = creditRegister(original).inputHash;
  const required = new Set(
    original.lines.filter((r) => r.qty < 0).map(creditKey),
  );
  const packet = {
    ...original,
    lines: original.lines.filter((r) => required.has(creditKey(r))),
  };
  const retainedInput =
    packet.lines.length === original.lines.length
      ? fullInput
      : creditRegister(packet).inputHash;
  return {
    packet,
    projection: {
      format: "SEMAR-CREDIT-SOURCE-1",
      source: original.source,
      fullInput,
      retainedInput,
      fullRows: original.lines.length,
      retainedRows: packet.lines.length,
    },
  };
}
export function creditRange(packet, id) {
  const { groups, all, age } = prepare(packet),
    target = all.get(id);
  requireValue(target && target.qty < 0, "Cancelación desconocida");
  const g = groups.get(
    JSON.stringify([target.party, target.sku, target.price]),
  );
  function rank(credits) {
    const subset = { ...g, credits };
    const c = solveGroup(subset, age);
    return verifyGroup(subset, c, age);
  }
  const allRank = rank(g.credits),
    otherRank = rank(g.credits.filter((c) => c.id !== id)),
    aloneRank = rank([target]);
  const min = allRank - otherRank,
    max = aloneRank;
  return {
    id,
    invoice: target.invoice,
    row: target.row,
    source: packet.source,
    units: -target.qty,
    minBacked: min,
    maxBacked: max,
    unavoidableUnmatched: -target.qty - max,
    ambiguous: min !== max,
    leftCensored: target.time - packet.from < age,
    ranks: { all: allRank, without: otherRank, alone: aloneRank },
    request:
      max < -target.qty || min !== max
        ? "Solicitar referencia a la factura original y el detalle de la nota de crédito"
        : null,
  };
}
