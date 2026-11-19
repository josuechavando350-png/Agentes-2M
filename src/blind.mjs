import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { compute, oracle, digest, integer } from "./policy.mjs";
import { examCase, reverseInference } from "./inference.mjs";
import { runTree, scenario } from "./induction.mjs";
import { freezeDocument, investigate, referee } from "./dossiers.mjs";

export const freshSeed = () => randomBytes(24).toString("hex");
function stream(seed) {
  if (!/^[0-9a-f]{48}$/.test(seed)) throw Error("Sello de examen inválido");
  let i = 0;
  return () => Number.parseInt(digest({ seed, i: i++ }).slice(0, 8), 16);
}
export function sealedCases(seed) {
  const rand = stream(seed);
  return Array.from({ length: 16 }, (_, i) => {
    const subject = "s" + rand(),
      amount = (rand() % 9000) + 100,
      cost = rand() % 100,
      field = i % 3 ? "price" : "units";
    const row = (f, value) => ({ subject, field: f, value });
    const rows = [row(field, amount), row("unrelated", rand() % 100)];
    const other = [row("cost", cost)];
    if (i % 4 === 1) other.push(row(field, amount + 1));
    if (i % 4 === 2) rows.shift();
    if (i % 4 === 3) other.push(row(field, amount));
    const docs = [rows, other].map((rows, j) =>
      freezeDocument({
        id: "d" + rand(),
        source: "Salud/folio-" + rand() + "/" + j,
        rows,
      }),
    );
    const q = {
      subject,
      op: field === "units" ? "product" : "difference",
      fields: [field, "cost"],
    };
    return { docs, q, expected: referee(docs, q) };
  });
}
function sameAnswer(a, b) {
  return a?.status === b.status && a?.value === b.value;
}
function measure(fn) {
  const start = performance.now();
  const score = fn();
  return {
    ...score,
    elapsedUs: Math.max(1, Math.round((performance.now() - start) * 1000)),
  };
}
export function dossierScore(seed, policy) {
  const cases = sealedCases(seed);
  return measure(() => {
    let correct = 0,
      severe = 0,
      cost = 0;
    const pass = [];
    for (const { docs, q, expected } of cases) {
      const r = investigate(docs, q, policy),
        ok = sameAnswer(r, expected);
      correct += Number(ok);
      severe += Number(!ok && r.status === "SUPPORTED");
      cost += r.cost;
      pass.push(ok);
    }
    return { total: cases.length, correct, severe, cost, pass };
  });
}
export function dominates(candidate, old) {
  return (
    candidate.elapsedUs <= candidate.total * 250000 &&
    candidate.correct >= old.correct &&
    candidate.severe <= old.severe &&
    candidate.pass.every((ok, i) => ok || !old.pass[i]) &&
    (candidate.correct > old.correct ||
      candidate.severe < old.severe ||
      (candidate.correct === old.correct && candidate.cost < old.cost))
  );
}
// Use fresh, withheld input after the candidate is fixed. Preserve every existing
// learned program as well as native skills. A hypothesis sees no labels here.
export function mutationScore(seed, before, after, lesson, replay = false) {
  const rng = stream(seed),
    tasks = [];
  for (const op of after.skills)
    for (let i = 0; i < 4; i++) {
      const numbers = Array.from(
        { length: 3 + (rng() % 5) },
        () => (rng() % 31) - 15,
      );
      const input = op === "inference" ? examCase(numbers) : numbers;
      tasks.push({ op, input, expected: oracle(op, input) });
    }
  for (const p of after.programs ?? []) {
    const book = lesson(p.source);
    const masks = Array.from({ length: 1 << p.vars.length }, (_, mask) => mask);
    for (const mask of masks) {
      const input = scenario(book, p.vars, mask);
      tasks.push({ program: p.id, mask, expected: reverseInference(input) });
    }
  }
  const cases = sealedCases(seed);
  function run(a) {
    return measure(() => {
      let correct = 0,
        cost = 0,
        severe = 0;
      const pass = [];
      for (const t of tasks) {
        let answer;
        if (t.program) {
          const p = a.programs?.find((p) => p.id === t.program);
          if (p) answer = runTree(p.tree, t.mask);
        } else if (a.skills.includes(t.op)) answer = compute(t.op, t.input);
        const ok = answer === t.expected;
        pass.push(ok);
        correct += Number(ok);
        cost += Number(answer !== undefined);
        severe += Number(!ok && answer !== undefined);
      }
      for (const c of cases) {
        const r = investigate(c.docs, c.q);
        const ok = sameAnswer(r, c.expected);
        pass.push(ok);
        correct += Number(ok);
        cost += r.cost;
        severe += Number(!ok && r.status === "SUPPORTED");
      }
      return { total: pass.length, correct, cost, severe, pass };
    });
  }
  const old = run(before),
    candidate = run(after);
  if (
    candidate.cost - old.cost > candidate.total ||
    !dominates(replay ? { ...candidate, elapsedUs: 0 } : candidate, old) ||
    candidate.severe ||
    candidate.correct !== candidate.total
  )
    throw Error("Salud rechazó la mutación en casos reservados");
  return { seed, old, candidate };
}
// Wall time is observational; it isn't a reproducible audit metric. Every
// correctness bit and operation count must reproduce exactly.
export function verifyMetrics(actual, recorded) {
  integer(recorded.elapsedUs, 1, Number.MAX_SAFE_INTEGER, "tiempo observado");
  if (
    digest({ ...actual, elapsedUs: 0 }) !==
    digest({ ...recorded, elapsedUs: 0 })
  )
    throw Error("Métricas del examen alteradas");
}
