import { createHash } from "node:crypto";

import {
  infer,
  reverseInference,
  validateCase,
  examCase,
} from "./inference.mjs";

export const LEGACY_INITIAL = 10_000_000;
export const INITIAL = 100_000_000;
export const CAP = 1_000_000_000_000;
export const BATCH = 666;
export const STIPEND = 10; // simulation credits, integers
export const SECTORS = Object.freeze([
  "Coordinación",
  "Salud",
  "Educación",
  "Ciencia",
  "Industria",
  "Energía",
  "Logística",
  "Finanzas",
  "Infraestructura",
  "Tecnología",
]);
export const LEADERS = Object.freeze(SECTORS.map((_, i) => "L" + (i + 1)));
export function sectorOf(id) {
  integer(id, 1, CAP, "id");
  return (Math.floor((id - 1) / 1_000_000) % 10) + 1;
}
export function integer(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error("Fuera de rango: " + field);
  return value;
}
export function strict(obj, keys) {
  if (
    !obj ||
    typeof obj !== "object" ||
    Array.isArray(obj) ||
    Object.keys(obj).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(obj, k))
  )
    throw Error("Campos inválidos o incompletos");
}
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  if (
    (value !== null &&
      !["string", "number", "boolean"].includes(typeof value)) ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw Error("Entrada no representable en JSON");
  return JSON.stringify(value);
}
export const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const OPS = Object.freeze([
  "count",
  "sum",
  "minimum",
  "maximum",
  "range",
  "median",
  "bestRun",
  "nonAdjacent",
  "inference",
]);
export function validateTask(op, data) {
  if (op === "inference") return validateCase(data);
  if (
    !OPS.includes(op) ||
    !Array.isArray(data) ||
    data.length < 1 ||
    data.length > 16
  )
    throw Error("Tarea fuera del dominio verificable");
  for (const n of data) integer(n, -1_000_000, 1_000_000, "dato");
}
export function initialSkills(sector) {
  return [
    ...new Set(["count", "sum", OPS[2 + ((sector - 1) % (OPS.length - 2))]]),
  ].sort();
}
export function compute(op, a) {
  switch (op) {
    case "inference":
      return infer(a).value;
    case "count":
      return a.length;
    case "sum":
      return a.reduce((x, y) => x + y, 0);
    case "minimum":
      return Math.min(...a);
    case "maximum":
      return Math.max(...a);
    case "range":
      return Math.max(...a) - Math.min(...a);
    case "median": {
      const s = a.toSorted((x, y) => x - y),
        mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    case "bestRun": {
      let best = 0,
        ending = 0;
      for (const x of a) {
        ending = Math.max(0, ending + x);
        best = Math.max(best, ending);
      }
      return best;
    }
    case "nonAdjacent": {
      let prev = 0,
        best = 0;
      for (const x of a) [prev, best] = [best, Math.max(best, prev + x)];
      return best;
    }
    default:
      throw Error("Método desconocido");
  }
}

// Independently implemented reference, intentionally different for the optimization cases.
export function oracle(op, a) {
  if (op === "inference") return reverseInference(a);
  const sorted = Array.from(a).sort((x, y) => x - y);
  switch (op) {
    case "count":
      return [...a.keys()].at(-1) + 1;
    case "sum": {
      let total = 0n;
      for (const x of a) total += BigInt(x);
      return Number(total);
    }
    case "minimum":
      return sorted[0];
    case "maximum":
      return sorted.at(-1);
    case "range":
      return sorted.at(-1) - sorted[0];
    case "median":
      return (
        (sorted[Math.floor((a.length - 1) / 2)] +
          sorted[Math.floor(a.length / 2)]) /
        2
      );
    case "bestRun": {
      let best = 0;
      for (let i = 0; i < a.length; i++) {
        let s = 0;
        for (let j = i; j < a.length; j++) {
          s += a[j];
          best = Math.max(best, s);
        }
      }
      return best;
    }
    case "nonAdjacent": {
      function visit(i) {
        return i >= a.length ? 0 : Math.max(visit(i + 1), a[i] + visit(i + 2));
      }
      return visit(0);
    }
    default:
      throw Error("Oráculo sin referencia");
  }
}
export function healthExam(before, after, seed) {
  if (
    after.length !== before.length + 1 ||
    new Set(after).size !== after.length ||
    !before.every((x) => after.includes(x)) ||
    !after.every((x) => OPS.includes(x))
  )
    throw Error("Mutación inválida");
  const bytes = Buffer.from(digest(seed), "hex");
  const examples = [
    [0],
    [-7, -2],
    [8, -5, 8],
    [1, 2, 3, 4],
    [-1000000, 1000000],
    Array(16).fill(1),
  ];
  for (let i = 0; i < 8; i++)
    examples.push(
      Array.from(
        { length: 1 + (bytes[i] % 12) },
        (_, j) => (bytes[(i + j * 3) % 32] % 31) - 15,
      ),
    );
  let oldScore = 0,
    newScore = 0;
  for (const op of after)
    for (const a of examples) {
      const sample = op === "inference" ? examCase(a) : a;
      if (compute(op, sample) !== oracle(op, sample))
        throw Error("Regresión en " + op);
      newScore++;
      if (before.includes(op)) oldScore++;
    }
  if (newScore <= oldScore) throw Error("Sin mejora medible");
  return {
    oldScore,
    newScore,
    examples: examples.length,
    seedDigest: digest(seed),
  };
}
