import { once } from "node:events";
import { check, key, num, hash } from "../factory/reader.mjs";
import { strict } from "../policy.mjs";
import { act, flagsFor, validateDesign } from "./policy.mjs";

export function compileServing(
  report,
  packet,
  recipeHash,
  minPerArm = 8,
  supportMode = "policy-inputs",
) {
  check(
    ["policy-inputs", "observed-cell"].includes(supportMode),
    "Alcance de soporte desconocido",
  );
  num(minPerArm, 1, 10000);
  const recipe = report.recipe;
  check(
    recipeHash === report.recipeHash &&
      recipeHash === hash(recipe) &&
      hash(packet.design) === hash(recipe.design) &&
      hash([packet.fit, packet.search, packet.validation]) === recipe.training,
    "Se requieren la receta y los datos sellados",
  );
  const ranges = recipe.design.fields.map(() => ({
    min: Infinity,
    max: -Infinity,
  }));
  for (const r of packet.fit)
    r.x.forEach((x, j) => {
      ranges[j].min = Math.min(ranges[j].min, x);
      ranges[j].max = Math.max(ranges[j].max, x);
    });
  const model = {
    format: "SEMAR-SERVING-1",
    recipe,
    recipeHash,
    ranges,
    minPerArm,
    supportMode,
  };
  return { ...model, seal: hash(model) };
}
function which(policy, flags, means, costs) {
  if (policy.type === "tree") return act(policy.rule, flags);
  check(policy.type === "response", "Tipo de política desconocido");
  const net = means.map((m, i) => m - costs[i]);
  return net.indexOf(Math.max(...net));
}
export function openServing(compiled, expectedSeal) {
  const { seal, ...body } = compiled,
    recipe = body.recipe;
  check(
    seal === expectedSeal &&
      hash(body) === seal &&
      body.format === "SEMAR-SERVING-1" &&
      hash(recipe) === body.recipeHash,
    "Modelo de servicio distinto de su sello",
  );
  const { design, model } = recipe,
    predicates = validateDesign(design);
  check(
    hash(predicates) === hash(model.predicates) &&
      body.ranges.length === design.fields.length,
    "Variables del modelo alteradas",
  );
  body.ranges.forEach((r) => {
    num(r.min, -1e7, 1e7);
    num(r.max, r.min, 1e7);
  });
  num(body.minPerArm, 1, 10000);
  // The table has one entry per actually observed pre-contact feature vector. Its size is independent of requests.
  const supported = new Map(),
    groups = new Map();
  const policies = [recipe.policy, recipe.incumbent];
  const share =
    body.supportMode === "policy-inputs" &&
    policies.every((p) => p.type === "tree");
  let mask = 0;
  if (share)
    for (const { rule } of policies) {
      const leaves = [0, 1, 2, 3].map((i) => (rule.leaves >>> (i * 2)) & 3);
      if (leaves[0] !== leaves[1] || leaves[2] !== leaves[3])
        mask |= 1 << rule.first;
      if (leaves[0] !== leaves[2] || leaves[1] !== leaves[3])
        mask |= 1 << rule.second;
    }
  const prior = model.global.sums.map((s, i) => s / model.global.counts[i]);
  for (const [cell, bucket] of Object.entries(model.levels[1])) {
    const flags = Number(cell);
    if (share) {
      const k = flags & mask,
        counts = groups.get(k) ?? [0, 0, 0];
      bucket.counts.forEach((v, i) => (counts[i] += v));
      groups.set(k, counts);
    }
    const parent =
      model.levels[0][
        String((flags & model.fieldMasks[0]) >>> 0) +
          "," +
          ((flags & model.fieldMasks[1]) >>> 0)
      ];
    const coarse = prior.map(
      (m, i) =>
        (parent.sums[i] + model.shrinkage * m) /
        (parent.counts[i] + model.shrinkage),
    );
    const means = coarse.map((m, i) =>
      Math.round(
        (bucket.sums[i] + model.shrinkage * m) /
          (bucket.counts[i] + model.shrinkage),
      ),
    );
    const actions = [recipe.policy, recipe.incumbent].map(
      (p) => design.actions[which(p, flags, means, design.costs)],
    );
    supported.set(flags, {
      minimumObserved: Math.min(...bucket.counts),
      actions,
    });
  }
  const ranges = body.ranges.map((r) => [r.min, r.max]),
    minPerArm = body.minPerArm;
  return {
    seal,
    keys: supported.size,
    score(request) {
      strict(request, ["id", "x"]);
      const id = key(request.id),
        x = request.x;
      check(
        Array.isArray(x) && x.length === ranges.length,
        "Cantidad incorrecta de variables",
      );
      let inRange = true;
      for (let i = 0; i < x.length; i++) {
        num(x[i], -1e7, 1e7);
        if (x[i] < ranges[i][0] || x[i] > ranges[i][1]) inRange = false;
      }
      if (!inRange)
        return {
          id,
          status: "OUTSIDE_TRAINING_RANGE",
          proposed: null,
          incumbent: null,
        };
      const flags = flagsFor(x, predicates),
        c = supported.get(flags);
      const group = share ? groups.get(flags & mask) : null,
        cellMinimum = c?.minimumObserved ?? 0;
      const minimumObserved = share
        ? group
          ? Math.min(...group)
          : 0
        : cellMinimum;
      const evidenceScope = share ? "DECISION_INPUTS" : "EXACT_CELL";
      if (minimumObserved < minPerArm)
        return {
          id,
          status: "INSUFFICIENT_LOCAL_SUPPORT",
          proposed: null,
          incumbent: null,
          minimumObserved,
          cellMinimum,
          evidenceScope,
        };
      const actions =
        c?.actions ?? policies.map((p) => design.actions[act(p.rule, flags)]);
      return {
        id,
        status: "PROPOSED_FOR_PILOT",
        proposed: actions[0],
        incumbent: actions[1],
        minimumObserved,
        cellMinimum,
        evidenceScope,
      };
    },
  };
}
async function waitForOutput(output) {
  const closed = new AbortController();
  const stop = () => closed.abort();
  output.once("close", stop);
  try {
    if (output.destroyed) stop();
    await once(output, "drain", { signal: closed.signal });
  } finally {
    output.off("close", stop);
  }
}

export async function serveLines(engine, input, output, maxBytes = 65536) {
  num(maxBytes, 32, 1e6);
  let pieces = [],
    length = 0,
    overflow = false,
    seq = 0,
    outgoing = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function flush() {
    if (!outgoing) return true;
    const writable = output.write(outgoing);
    outgoing = "";
    return writable;
  }
  function finish() {
    seq++;
    let json;
    try {
      check(!overflow, "La solicitud supera el tamaño admitido");
      const line =
        pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, length);
      const request = JSON.parse(decoder.decode(line));
      json = { seq, seal: engine.seal, ...engine.score(request) };
    } catch (e) {
      json = {
        seq,
        seal: engine.seal,
        status: "INVALID_REQUEST",
        error: e.message,
      };
    }
    outgoing += JSON.stringify(json) + "\n";
    pieces = [];
    length = 0;
    overflow = false;
  }
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let pos = 0;
    while (pos < bytes.length) {
      const newline = bytes.indexOf(10, pos),
        end = newline === -1 ? bytes.length : newline,
        part = bytes.subarray(pos, end);
      if (!overflow) {
        if (length + part.length > maxBytes) {
          pieces = [];
          length = 0;
          overflow = true;
        } else {
          pieces.push(part);
          length += part.length;
        }
      }
      if (newline === -1) break;
      finish();
      if (outgoing.length >= 16384 && !flush()) await waitForOutput(output);
      pos = end + 1;
    }
    // Flush even a single complete request at the end of the ready input chunk.
    if (!flush()) await waitForOutput(output);
  }
  if (length || overflow) {
    finish();
    if (!flush()) await waitForOutput(output);
  }
}
