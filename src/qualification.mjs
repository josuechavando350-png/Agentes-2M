import { compute, oracle, OPS, SECTORS } from "./policy.mjs";

// Bounded, reproducible inputs. Workers execute their own method for every ID.
// Reference answers are computed independently and cached per case, never per worker.
const CASE_COUNT = 4096;
const METHODS = SECTORS.map((_, index) => OPS[2 + (index % (OPS.length - 2))]);
function cases(i) {
  const a = (i % 23) - 11,
    b = ((i >>> 3) % 29) - 14,
    c = ((i >>> 6) % 31) - 15;
  const data = [a, b, c, -b, a + c, 1 - c];
  const facts = [];
  if (i & 1) facts.push({ literal: "documentado", source: "acta" });
  if (i & 2) facts.push({ literal: "completo", source: "inventario" });
  if (i & 4) facts.push({ literal: "!listo", source: "inspección" });
  const graph = {
    facts,
    rules: [
      { if: ["documentado"], then: "trazable", source: "criterio A" },
      { if: ["trazable", "completo"], then: "listo", source: "criterio B" },
    ],
    query: "listo",
  };
  return new Map(
    [...new Set(METHODS)].map((op) => {
      const input = op === "inference" ? graph : data;
      return [op, { input, expected: oracle(op, input) }];
    }),
  );
}
export function qualification() {
  const bank = Array.from({ length: CASE_COUNT }, (_, i) => cases(i));
  const counts = Object.fromEntries([...new Set(METHODS)].map((op) => [op, 0]));
  return {
    counts,
    evaluate(a) {
      const op = METHODS[a.sector - 1],
        index = (Math.imul(a.id, 2654435761) >>> 0) % CASE_COUNT;
      const { input, expected } = bank[index].get(op);
      if (!a.skills.includes(op) || compute(op, input) !== expected)
        throw Error("Examen de especialidad fallido: " + a.id);
      counts[op]++;
      return expected;
    },
  };
}
