import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { compileServing, openServing, serveLines } from "../src/sale/serve.mjs";
import { fitResponse, constants } from "../src/sale/policy.mjs";
import { hash } from "../src/factory/reader.mjs";

const design = {
  actions: ["espera", "a", "b"],
  fields: [
    { id: "f", cuts: [1, 2] },
    { id: "g", cuts: [1, 2] },
  ],
  costs: [0, 2, 1],
  currency: "MXN",
  response: "valor",
  randomization: "equal-thirds",
};
const rows = Array.from({ length: 72 }, (_, i) => ({
  id: "u-" + i,
  x: [i % 3, Math.floor(i / 3) % 3],
  arm: i % 3,
  y: i * 2,
}));
const packet = { design, fit: rows, search: [], validation: [] };
function build(policy, mode) {
  const recipe = {
      design,
      training: hash([rows, [], []]),
      model: fitResponse(design, rows),
      policy,
      incumbent: { type: "tree", rule: constants[0] },
    },
    recipeHash = hash(recipe);
  const report = { recipe, recipeHash };
  return compileServing(report, packet, recipeHash, 2, mode);
}
test("La inferencia considera solo soportes justificables y se abstiene fuera del dominio", () => {
  const p = { type: "tree", rule: constants[1] },
    coarse = build(p, "policy-inputs"),
    fine = build(p, "observed-cell");
  const a = openServing(coarse, coarse.seal),
    b = openServing(fine, fine.seal),
    q = { id: "nuevo", x: [0, 1] };
  assert.equal(a.score(q).proposed, "a");
  assert.equal(b.score(q).status, "INSUFFICIENT_LOCAL_SUPPORT");
  assert.equal(a.score({ ...q, x: [3, 0] }).status, "OUTSIDE_TRAINING_RANGE");
  assert.throws(() => a.score({ ...q, y: 0 }));
  assert.throws(() =>
    openServing({ ...fine, ranges: [{ min: 0, max: 1 }] }, fine.seal),
  );
  const policy = build({ type: "response" }, "policy-inputs");
  assert.equal(
    openServing(policy, policy.seal).score(q).evidenceScope,
    "EXACT_CELL",
  );
});
test("Un lector que se desconecta durante la contrapresión termina el trabajo", async () => {
  const model = build({ type: "tree", rule: constants[0] }, "policy-inputs");
  const sink = new Writable({
    highWaterMark: 1,
    write() {
      this.destroy();
    },
  });
  const input = Readable.from([
    JSON.stringify({ id: "nuevo", x: [1, 1] }) + "\n",
  ]);
  await assert.rejects(
    serveLines(openServing(model, model.seal), input, sink),
    { name: "AbortError" },
  );
  assert.equal(sink.listenerCount("drain"), 0);
});
test("El flujo local impone límites por línea y continúa con la siguiente petición", async () => {
  const c = build({ type: "tree", rule: constants[1] }, "policy-inputs"),
    e = openServing(c, c.seal),
    q = JSON.stringify({ id: "caso", x: [1, 2] });
  const chunks = [
    q.slice(0, 5),
    q.slice(5) + "\n",
    "t".repeat(90),
    "bad\n",
    "\n",
    q,
  ];
  let out = "";
  const sink = new Writable({
    highWaterMark: 4,
    write(chunk, enc, next) {
      out += chunk.toString();
      setImmediate(next);
    },
  });
  await serveLines(e, Readable.from(chunks), sink, 64);
  const records = out
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    records.map((v) => v.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    records.map((v) => v.status),
    [
      "PROPOSED_FOR_PILOT",
      "INVALID_REQUEST",
      "INVALID_REQUEST",
      "PROPOSED_FOR_PILOT",
    ],
  );
});
