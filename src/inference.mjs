// Explicit negation, no implicit closed-world assumption. A proof is valid relative
// to its supplied premises. Contradictory premises do not entail unrelated conclusions.
function literal(v) {
  if (typeof v !== "string" || !/^!?[a-z][a-z0-9_.-]{0,62}$/.test(v))
    throw Error("Literal inválido");
}
function fields(obj, keys) {
  if (!obj || Object.keys(obj).sort().join("|") !== keys.sort().join("|"))
    throw Error("Premisa incompleta");
}
function source(v) {
  if (typeof v !== "string" || !v.trim() || v.length > 256)
    throw Error("Fuente inválida");
}
export function validateCase(c) {
  fields(c, ["facts", "rules", "query"]);
  literal(c.query);
  if (c.query.startsWith("!"))
    throw Error("La consulta usa un nombre positivo");
  if (
    !Array.isArray(c.facts) ||
    c.facts.length > 64 ||
    !Array.isArray(c.rules) ||
    c.rules.length > 48
  )
    throw Error("Caso fuera de límites");
  for (const f of c.facts) {
    fields(f, ["literal", "source"]);
    literal(f.literal);
    source(f.source);
  }
  for (const r of c.rules) {
    fields(r, ["if", "then", "source"]);
    literal(r.then);
    source(r.source);
    if (!Array.isArray(r.if) || r.if.length < 1 || r.if.length > 8)
      throw Error("Condición inválida");
    r.if.forEach(literal);
  }
}
function verdict(yes, no) {
  return yes ? (no ? "CONFLICTED" : "SUPPORTED") : no ? "REFUTED" : "UNKNOWN";
}

export function infer(c) {
  const known = new Map();
  c.facts.forEach((f, i) => {
    if (!known.has(f.literal))
      known.set(f.literal, { literal: f.literal, fact: i });
  });
  let progress;
  do {
    progress = false;
    c.rules.forEach((r, i) => {
      if (!known.has(r.then) && r.if.every((x) => known.has(x))) {
        known.set(r.then, { literal: r.then, rule: i });
        progress = true;
      }
    });
  } while (progress);
  const proof = [],
    included = new Set();
  function trace(v) {
    const node = known.get(v);
    if (!node || included.has(v)) return;
    included.add(v);
    if ("rule" in node) c.rules[node.rule].if.forEach(trace);
    proof.push(node);
  }
  trace(c.query);
  trace("!" + c.query);
  return {
    value: verdict(known.has(c.query), known.has("!" + c.query)),
    proof,
  };
}

// Independent goal-directed evaluation with a finite proof-depth bound and memoization.
export function reverseInference(c) {
  const facts = new Set(c.facts.map((f) => f.literal));
  const byHead = Map.groupBy(c.rules, (r) => r.then);
  const memo = new Map();
  function prove(v, depth) {
    if (facts.has(v)) return true;
    if (depth === 0 || !byHead.has(v)) return false;
    const key = v + ":" + depth;
    if (!memo.has(key))
      memo.set(
        key,
        byHead.get(v).some((r) => r.if.every((p) => prove(p, depth - 1))),
      );
    return memo.get(key);
  }
  return verdict(
    prove(c.query, byHead.size),
    prove("!" + c.query, byHead.size),
  );
}
export function verifyDerivation(c, result) {
  const seen = new Set();
  for (const node of result.proof) {
    if (seen.has(node.literal)) throw Error("Paso repetido");
    if ("fact" in node) {
      if (c.facts[node.fact]?.literal !== node.literal)
        throw Error("Hecho ajeno al expediente");
    } else {
      const rule = c.rules[node.rule];
      if (
        !rule ||
        rule.then !== node.literal ||
        !rule.if.every((p) => seen.has(p))
      )
        throw Error("Derivación inválida");
    }
    seen.add(node.literal);
  }
  if (
    verdict(seen.has(c.query), seen.has("!" + c.query)) !== result.value ||
    reverseInference(c) !== result.value
  )
    throw Error("Oráculo rechazó la prueba");
}
export function examCase(numbers) {
  const facts = numbers
    .filter((n) => n >= 0)
    .map((n) => ({ literal: "v" + n, source: "salud:muestra" }));
  if (numbers[0] % 2 === 0)
    facts.push({ literal: "!meta", source: "salud:contraejemplo" });
  return {
    facts,
    rules: [
      {
        if: ["v" + Math.abs(numbers.at(-1))],
        then: "intermedio",
        source: "salud:regla1",
      },
      { if: ["intermedio"], then: "meta", source: "salud:regla2" },
      { if: ["ciclo"], then: "ciclo", source: "salud:ciclo" },
    ],
    query: "meta",
  };
}
