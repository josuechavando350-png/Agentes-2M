import { check, num, key, list, unique } from "./reader.mjs";
function domain(w) {
  const stages = unique(list(w.stages, 1, 10).map((s) => key(s.id)));
  w.stages.forEach((s) => num(s.cost, 0, 1000000));
  num(w.budget, 0, 10000000);
  unique(list(w.traces, 1, 48).map((t) => key(t.id)));
  let work = 0;
  const traces = w.traces.map((t) => {
    const jobs = new Map();
    unique(list(t.tasks, 1, 64).map((j) => key(j.id)));
    for (const j of t.tasks) {
      check(stages.includes(j.stage), "Etapa desconocida");
      num(j.minutes, 0, 1000000);
      num(j.improved, 0, j.minutes);
      unique(list(j.after, 0, 32).map(key));
      jobs.set(j.id, j);
    }
    const order = [],
      done = new Set();
    while (order.length < jobs.size) {
      const j = t.tasks.find(
        (x) => !done.has(x.id) && x.after.every((id) => done.has(id)),
      );
      check(j, "Dependencia ausente o cíclica");
      order.push(j);
      done.add(j.id);
    }
    work += jobs.size;
    return { id: t.id, order, jobs };
  });
  check(
    work * 2 ** stages.length <= 300000,
    "Examen de combinaciones demasiado grande",
  );
  return { stages, traces };
}
const price = (w, mask) =>
  w.stages.reduce((n, s, i) => n + ((mask >> i) & 1) * s.cost, 0);
function schedule(t, stages, mask) {
  const done = new Map(),
    prior = new Map();
  let end = null;
  for (const j of t.order) {
    let p = null;
    for (const id of j.after)
      if (p === null || done.get(id) > done.get(p)) p = id;
    const duration =
      mask & (1 << stages.indexOf(j.stage)) ? j.improved : j.minutes;
    done.set(j.id, (p === null ? 0 : done.get(p)) + duration);
    prior.set(j.id, p);
    if (end === null || done.get(j.id) > done.get(end)) end = j.id;
  }
  const path = [];
  for (let p = end; p !== null; p = prior.get(p)) path.unshift(p);
  return { time: done.get(end), path, ends: Object.fromEntries(done) };
}
export function optimize(w) {
  const { traces, stages } = domain(w),
    alternatives = [];
  let winner = null;
  for (let mask = 0; mask < 2 ** stages.length; mask++) {
    const cost = price(w, mask);
    if (cost > w.budget) continue;
    const solutions = traces.map((t) => schedule(t, stages, mask));
    const time = solutions.reduce((n, r) => n + r.time, 0);
    alternatives.push({ mask, paths: solutions.map((r) => r.path) });
    if (
      !winner ||
      time < winner.minutes ||
      (time === winner.minutes && cost < winner.cost)
    )
      winner = {
        mask,
        minutes: time,
        cost,
        ends: solutions.map((r) => r.ends),
      };
  }
  const certificate = { winner, alternatives };
  const proof = verifyOptimum(w, certificate);
  return {
    selected: stages.filter((_, i) => winner.mask & (1 << i)),
    ...proof,
    certificate,
  };
}
// A feasible finish schedule gives an upper bound. Any dependency path gives a lower bound.
export function verifyOptimum(w, c) {
  const { traces, stages } = domain(w),
    { winner, alternatives } = c;
  num(winner.mask, 0, 2 ** stages.length - 1);
  check(
    price(w, winner.mask) === winner.cost && winner.cost <= w.budget,
    "Plan inviable",
  );
  const masks = new Map(alternatives.map((a) => [a.mask, a.paths]));
  check(
    masks.size === alternatives.length && winner.ends.length === traces.length,
    "Certificado duplicado",
  );
  const duration = (j, mask) =>
    mask & (1 << stages.indexOf(j.stage)) ? j.improved : j.minutes;
  let upper = 0;
  for (const [i, t] of traces.entries()) {
    const ends = winner.ends[i];
    for (const j of t.order) {
      num(ends[j.id], 0, 64e6);
      check(
        ends[j.id] - duration(j, winner.mask) >=
          Math.max(0, ...j.after.map((id) => ends[id])),
        "Calendario infactible",
      );
    }
    upper += Math.max(...t.order.map((j) => ends[j.id]));
  }
  let lower = Infinity,
    baseline = 0,
    count = 0;
  for (let m = 0; m < 2 ** stages.length; m++) {
    if (price(w, m) > w.budget) continue;
    const paths = masks.get(m);
    check(paths?.length === traces.length, "Alternativa sin cota");
    count++;
    let bound = 0;
    for (const [i, t] of traces.entries()) {
      let prev = null;
      for (const id of unique(list(paths[i], 1, t.order.length))) {
        const j = t.jobs.get(id);
        check(
          j && (prev === null || j.after.includes(prev)),
          "Camino inválido",
        );
        bound += duration(j, m);
        prev = id;
      }
    }
    if (m === 0) baseline = bound;
    lower = Math.min(lower, bound);
  }
  check(
    count === masks.size && lower === upper && upper === winner.minutes,
    "Óptimo sin demostrar",
  );
  // Verify exact baseline independently via a feasible unmodified schedule too.
  const original = traces.reduce((n, t) => n + schedule(t, stages, 0).time, 0);
  check(original === baseline, "Tiempo de partida sin certificar");
  return {
    baselineMinutes: baseline,
    optimalMinutes: upper,
    savedMinutes: baseline - upper,
    lowerBound: lower,
    upperBound: upper,
    gap: upper - lower,
    alternatives: count,
  };
}
