import { check, num, hash } from "./reader.mjs";
// Independent integer interpreter and structural proof checker for the exported language.
export function exact(rule, groups) {
  const n = rule.weights.length;
  const value = (vector) => {
    let sum = 0n;
    for (let i = 0; i < n; i++) {
      let v = BigInt(vector[i]);
      if (i === rule.rateIndex) v = (v * BigInt(rule.bps)) / 10000n;
      sum += v * BigInt(rule.weights[i]);
    }
    return sum > 0n ? sum : 0n;
  };
  if (rule.group === "accounts")
    return Number(groups.reduce((n, g) => n + value(g.values), 0n));
  const sums = Array(n).fill(0n);
  for (const g of groups) g.values.forEach((v, i) => (sums[i] += BigInt(v)));
  return Number(value(sums));
}
export function certify(rule) {
  const proof = {
    language: "integer-ledger-1",
    program: hash(rule),
    maxObservedEvents: 4096,
    maxOpenRegisters: 8,
    maxEvent: 1000000000,
    coordinateDirections: rule.weights,
    maxAnswer: "4104000000000",
    maxNumerator: "41040000000000000",
  };
  verifyRule(rule, proof);
  return proof;
}
export function verifyRule(r, p) {
  check(
    p.language === "integer-ledger-1" &&
      hash(r) === p.program &&
      ["accounts", "portfolio"].includes(r.group),
    "Gramática no certificada",
  );
  num(r.weights.length, 2, 4);
  r.weights.forEach((w) => num(w, -1, 1));
  num(r.rateIndex, -1, r.weights.length - 1);
  num(r.bps, 1, 10000);
  check(
    (r.rateIndex === -1) === (r.bps === 10000) &&
      (r.rateIndex < 0 || r.weights[r.rateIndex] === 1),
    "Tasa sin prueba",
  );
  check(
    hash(r.weights) === hash(p.coordinateDirections),
    "Monotonía declarada incorrecta",
  );
  check(
    p.maxObservedEvents === 4096 &&
      p.maxOpenRegisters === 8 &&
      p.maxEvent === 1000000000,
    "Dominio no verificado",
  );
  // Each event belongs to exactly one coordinate; the absolute weighted sum is bounded by input mass.
  // Positive scaling, floor, positive part and summation preserve each coordinate's given direction.
  const mass =
    BigInt(p.maxObservedEvents + p.maxOpenRegisters) * BigInt(p.maxEvent);
  check(
    BigInt(p.maxAnswer) === mass &&
      BigInt(p.maxNumerator) === mass * 10000n &&
      mass <= BigInt(Number.MAX_SAFE_INTEGER) &&
      mass * 10000n < 2n ** 63n,
    "Cota aritmética inválida",
  );
  return {
    verified: true,
    maxAnswer: Number(mass),
    scope:
      "typed nonnegative input mass, monotone bounds and integer representation",
  };
}
