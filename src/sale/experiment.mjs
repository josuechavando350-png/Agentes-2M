import { check, num, list } from "../factory/reader.mjs";
import { strict } from "../policy.mjs";

function gcd(a, b) {
  while (b) {
    const rem = a % b;
    a = b;
    b = rem;
  }
  return a;
}
function tail(sizes, threshold) {
  if (threshold <= 0) return 1n << BigInt(sizes.length);
  const total = sizes.reduce((s, n) => s + n, 0);
  if (total < threshold) return 0n;
  // Absorb all sums at or above the threshold. Each of the 2^n balanced pair assignments has equal weight.
  const counts = Array(threshold + 1).fill(0n);
  counts[0] = 1n;
  let reach = 0;
  for (const weight of sizes) {
    counts[threshold] *= 2n;
    for (let j = Math.min(reach, threshold - 1); j >= 0; j--)
      counts[Math.min(threshold, j + weight)] += counts[j];
    reach += weight;
  }
  return counts[threshold];
}
export function marginRandomization(differences, alphaDenominator = 20) {
  list(differences, 1, 128);
  num(alphaDenominator, 2, 1e11);
  const margins = differences
    .map((d) => num(d, -1e13, 1e13))
    .filter((d) => d !== 0);
  const weights = margins.map(Math.abs),
    worlds = 1n << BigInt(weights.length);
  const positive = margins.reduce((s, v) => s + Math.max(v, 0), 0);
  const total = weights.reduce((s, v) => s + v, 0),
    divisor = weights.reduce(gcd, 0) || 1;
  check(Number.isSafeInteger(total), "Escala monetaria excesiva");
  const scale = weights.map((v) => v / divisor),
    target = positive / divisor;
  const bucket = Math.max(1, Math.ceil(total / divisor / 32768));
  // Under a sharp null, flips with sum >= target coincide with outcomes at least as favorable as the observed sum.
  // Rounding every positive weight down/up bounds the count while keeping the threshold fixed.
  const cutoff = Math.ceil(target / bucket);
  const low = tail(
    scale.map((v) => Math.floor(v / bucket)),
    cutoff,
  );
  const high =
    bucket === 1
      ? low
      : tail(
          scale.map((v) => Math.ceil(v / bucket)),
          cutoff,
        );
  const sum = margins.reduce((s, v) => s + v, 0);
  return {
    pairs: differences.length,
    nonTies: weights.length,
    totalLiftCents: sum,
    meanPairLiftCents: sum / differences.length,
    permutations: worlds.toString(),
    lowerExceedances: low.toString(),
    upperExceedances: high.toString(),
    lowerP: Number(low) / Number(worlds),
    upperP: Number(high) / Number(worlds),
    exact: low === high,
    resolutionCents: bucket * divisor,
    alphaDenominator,
    passes: sum > 0 && high * BigInt(alphaDenominator) <= worlds,
    hypothesis:
      "Las dos intervenciones producen el mismo margen para cada unidad del ensayo aleatorizado por pares.",
  };
}
function integerTail(n, w) {
  let coefficient = 1n,
    sum = 0n;
  for (let i = 0; i <= n; i++) {
    if (i >= w) sum += coefficient;
    if (i < n) coefficient = (coefficient * BigInt(n - i)) / BigInt(i + 1);
  }
  return sum;
}
function binomial(n, p) {
  const out = Array(n + 1).fill(0);
  out[0] = 1;
  for (let i = 0; i < n; i++)
    for (let k = i + 1; k >= 0; k--)
      out[k] = (out[k] ?? 0) * (1 - p) + (k ? out[k - 1] * p : 0);
  return out;
}
export function planPilot(spec) {
  strict(spec, [
    "alphaDenominator",
    "eligibleIndependentBuyers",
    "winBps",
    "tieBps",
    "powerBps",
    "costPerPairCents",
    "minutesPerPair",
    "budgetCents",
    "minutes",
  ]);
  const {
    alphaDenominator,
    eligibleIndependentBuyers,
    winBps,
    tieBps,
    powerBps,
    costPerPairCents,
    minutesPerPair,
    budgetCents,
    minutes,
  } = spec;
  num(alphaDenominator, 2, 1e11);
  num(eligibleIndependentBuyers, 0, 1000000);
  num(winBps, 0, 10000);
  num(tieBps, 0, 10000);
  num(powerBps, 1, 10000);
  num(costPerPairCents, 0, 1e11);
  num(minutesPerPair, 1, 10080);
  num(budgetCents, 0, 1e11);
  num(minutes, 0, 10080);
  const maxPairs = Math.min(
    128,
    Math.floor(eligibleIndependentBuyers / 2),
    costPerPairCents ? Math.floor(budgetCents / costPerPairCents) : 128,
    Math.floor(minutes / minutesPerPair),
  );
  const conditional = [0],
    designs = [];
  for (let n = 1; n <= maxPairs; n++) {
    let lo = 0,
      hi = n + 1;
    const denom = 1n << BigInt(n);
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (integerTail(n, m) * BigInt(alphaDenominator) <= denom) hi = m;
      else lo = m + 1;
    }
    conditional[n] = binomial(n, winBps / 10000)
      .slice(lo)
      .reduce((a, b) => a + b, 0);
    const power = binomial(n, 1 - tieBps / 10000).reduce(
      (a, v, i) => a + v * conditional[i],
      0,
    );
    designs.push({
      pairs: n,
      buyers: 2 * n,
      requiredWinsIfNoTies: lo <= n ? lo : null,
      conditionalPower: power,
      cashCents: n * costPerPairCents,
      minutes: n * minutesPerPair,
    });
  }
  const chosen =
    designs.find((d) => d.conditionalPower >= powerBps / 10000) ?? null;
  return {
    status: chosen
      ? "FEASIBLE_SIGN_TEST_UNDER_ASSUMPTIONS"
      : "INSUFFICIENT_FOR_TARGET_POWER",
    chosen,
    bestFeasible:
      designs.toSorted(
        (a, b) => b.conditionalPower - a.conditionalPower || a.pairs - b.pairs,
      )[0] ?? null,
    maxPairs,
    interpretation:
      "La potencia corresponde a la prueba de signos bajo las tasas de empate y victoria declaradas. La suficiencia del margen y su contraste ponderado dependen de los resultados observados.",
  };
}
