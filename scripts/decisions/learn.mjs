import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Semar } from "../../src/semar.mjs";
import { populationResearch } from "../../src/population-research.mjs";
import { admittedModel } from "../../src/account-market.mjs";
import { activeProgram } from "../../src/market-methods.mjs";
import { learn } from "../../src/decision-model.mjs";
import method from "../../evidence/metodos-negocio.json" with { type: "json" };
import full from "../../evidence/participacion-100m.json" with { type: "json" };
import { digest } from "../../src/policy.mjs";
const [dir, prior, base, state, out] = process.argv.slice(2),
  read = (d, n) => JSON.parse(readFileSync(join(d, n + ".json")));
const packet = read(dir, "packet"),
  old = read(prior, "participacion");
assert.equal(digest(old.result), full.commitment);
const previous = read(base, "negocios"),
  model = admittedModel(read(base, "account-policy"), previous),
  program = activeProgram(method, model, previous.scope);
const s = new Semar(":memory:");
try {
  s.restore(
    JSON.parse(gunzipSync(readFileSync(join(state, "bitacora.json.gz")))),
    read(state, "avance").audit.tip,
  );
  const rows = read(dir, "reserve-cases").slice(0, 200),
    all = read(dir, "reserve-outcomes"),
    votes = populationResearch(s.layout(), { ...packet, queries: rows }).result
      .decisions.thousand;
  const p = learn(
    {
      rows: packet.queries,
      votes: old.result.decisions.thousand,
      labels: read(dir, "population-outcomes"),
      seats: 40,
    },
    {
      rows,
      votes,
      labels: Object.fromEntries(rows.map((r) => [r.id, all[r.id]])),
      seats: 40,
    },
    model,
    program,
  );
  assert.equal(p.studied, 139);
  assert.equal(p.omittedBuyers, 43);
  writeFileSync(out, JSON.stringify(p, null, 2) + "\n");
} finally {
  s.close();
}
