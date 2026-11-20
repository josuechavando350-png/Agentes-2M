import { accountForecast } from "./account-market.mjs";
import { admittedForecast } from "./market-methods.mjs";
import { digest, integer } from "./policy.mjs";
export const DAY = 86400000;
export function utc(s) {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw Error("Fecha inválida");
  return Date.parse(s);
}
export const dateAt = (t) => new Date(t).toISOString().slice(0, 10);
export const ordered = (rs) =>
  rs.toSorted(
    (a, b) => b.probability - a.probability || a.id.localeCompare(b.id),
  );
export function interval(h, n) {
  if (!n) return null;
  const z = 1.959963984540054,
    p = h / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    w = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - w), Math.min(1, c + w)];
}
const bins = () =>
  Array.from({ length: 10 }, (_, i) => ({
    from: i / 10,
    to: (i + 1) / 10,
    cases: 0,
    bought: 0,
  }));
const bin = (p) => Math.min(9, Math.floor(p * 10));
export function grade(rows, labels, k) {
  integer(k, 1, rows.length, "plazas");
  if (
    Object.keys(labels).length !== rows.length ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw Error("Cobertura incompleta");
  const histogram = bins();
  let hits = 0,
    observed = 0,
    brier = 0;
  for (const [i, r] of ordered(rows).entries()) {
    const y = integer(labels[r.id], 0, 1, "desenlace"),
      p = r.probability;
    if (!Number.isFinite(p) || p < 0 || p > 1)
      throw Error("Probabilidad inválida");
    const b = histogram[bin(p)];
    b.cases++;
    b.bought += y;
    brier += (p - y) ** 2;
    observed += y;
    if (i < k) hits += y;
  }
  return {
    cases: rows.length,
    seats: k,
    hits,
    observed,
    omittedBuyers: observed - hits,
    precision: hits / k,
    interval95: interval(hits, k),
    brier: brier / rows.length,
    bins: histogram,
  };
}
export function reliability(hist, p, scope) {
  const b = hist[bin(p)];
  return {
    ...b,
    observedRate: b.cases ? b.bought / b.cases : null,
    interval95: interval(b.bought, b.cases),
    scope,
  };
}
const descriptions = {
  cadencia: "Recencia entre media y una vez y media la mediana de intervalos",
  aceleracion: "El intervalo más reciente es menor que el anterior",
  concentracion: "Al menos dos tercios de los pedidos ocurrieron en 30 días",
  retorno: "Devolución en la última fecha documentada",
  diversidad: "Al menos dos productos distintos por ocasión de compra",
};
function flags(r) {
  const days = [
    ...new Set(
      r.references
        .filter((v) => !v.invoice.startsWith("C"))
        .map((v) => utc(v.day) / DAY),
    ),
  ].sort((a, b) => a - b);
  const gaps = days.slice(1).map((x, i) => x - days[i]),
    a = gaps.toSorted((x, y) => x - y),
    m = (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2;
  const last = r.references.reduce((v, x) => (x.day > v ? x.day : v), ""),
    f = r.features;
  return {
    cadencia: gaps.length >= 2 && f.recency >= m / 2 && f.recency <= m * 1.5,
    aceleracion: gaps.length >= 2 && gaps.at(-1) < gaps.at(-2),
    concentracion: f.orders >= 2 && f.recent_orders * 3 >= 2 * f.orders,
    retorno: r.references.some(
      (x) => x.day === last && x.invoice.startsWith("C"),
    ),
    diversidad: f.sku_count >= 2 * f.orders,
  };
}
export function estimates(rows, votes, model, program, k) {
  const v = new Map(votes.map((x) => [x.id, x.probability]));
  if (
    v.size !== rows.length ||
    votes.length !== rows.length ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw Error("Cobertura de opiniones distinta");
  const a = rows.map((r) => {
    const p = v.get(r.id);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw Error("Voto inválido");
    const forecast = admittedForecast(r, model, program),
      driver = accountForecast(r, model, [1]).parts.toSorted(
        (x, y) => Math.abs(y.contribution) - Math.abs(x.contribution),
      )[0];
    return { ...forecast, driver, flags: flags(r), collective: p };
  });
  const first = new Set(
      ordered(a)
        .slice(0, k)
        .map((r) => r.id),
    ),
    second = new Set(
      ordered(votes)
        .slice(0, k)
        .map((r) => r.id),
    );
  return a.map((r) => ({
    ...r,
    omitted: !first.has(r.id) && !second.has(r.id),
    disagree: first.has(r.id) !== second.has(r.id),
  }));
}
export const rescue = (r, rule) =>
  r.omitted && rule && r.flags[rule.key]
    ? Math.min(0.995, r.probability + rule.lift)
    : r.probability;
export function learn(samples, cal, model, program) {
  const rows = estimates(
      samples.rows,
      samples.votes,
      model,
      program,
      samples.seats,
    ),
    miss = rows.filter((r) => r.omitted),
    labels = samples.labels;
  grade(rows, labels, samples.seats);
  const train = miss.filter(
      (r) => parseInt(digest(r.id).slice(0, 8), 16) % 3 !== 0,
    ),
    valid = miss.filter((r) => !train.includes(r));
  const tested = Object.entries(descriptions).map(([key, description]) => {
    const matched = train.filter((r) => r.flags[key]),
      hold = valid.filter((r) => r.flags[key]),
      buys = (rs) => rs.reduce((s, r) => s + labels[r.id], 0);
    const lift =
        matched.reduce((n, r) => n + labels[r.id] - r.probability, 0) /
        (matched.length + 20),
      rule = { key, lift };
    return {
      ...rule,
      description,
      discovery: matched.length,
      discoveryBuys: buys(matched),
      validation: hold.length,
      validationBuys: buys(hold),
      gain: hold.reduce(
        (s, r) =>
          s +
          (r.probability - labels[r.id]) ** 2 -
          (rescue(r, rule) - labels[r.id]) ** 2,
        0,
      ),
    };
  });
  const rule =
    tested
      .filter(
        (x) =>
          x.discovery >= 8 && x.validation >= 4 && x.lift > 0 && x.gain > 0,
      )
      .toSorted((a, b) => b.gain - a.gain || a.key.localeCompare(b.key))[0] ??
    null;
  const seen = new Set(rows.map((r) => r.id));
  if (cal.rows.some((r) => seen.has(r.id)))
    throw Error("Calibración contaminada");
  const c = estimates(cal.rows, cal.votes, model, program, cal.seats);
  return {
    schema: "SEMAR-OMISION-1",
    merchant: "uci-retail",
    model,
    program,
    rule,
    tested,
    source: digest([samples, cal]),
    studied: miss.length,
    omittedBuyers: miss.reduce((s, r) => s + labels[r.id], 0),
    calibrationCases: c.length,
    maturedAt: dateAt(
      Math.max(...[...samples.rows, ...cal.rows].map((r) => utc(r.cutoff))) +
        30 * DAY,
    ),
    seen: [...seen, ...c.map((r) => r.id)].sort(),
    calibration: {
      incumbent: grade(c, cal.labels, cal.seats).bins,
      challenger: grade(
        c.map((r) => ({ ...r, probability: rescue(r, rule) })),
        cal.labels,
        cal.seats,
      ).bins,
    },
  };
}
