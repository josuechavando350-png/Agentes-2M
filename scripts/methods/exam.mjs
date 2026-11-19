import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  admittedModel,
  gradeAccounts,
  improves,
} from "../../src/account-market.mjs";
import { inventMethods, rankMethod } from "../../src/market-methods.mjs";
import { digest } from "../../src/policy.mjs";
const [stage, dir, old, archive] = process.argv.slice(2);
const read = (path, name) =>
  JSON.parse(readFileSync(join(path, name + ".json")));
const write = (name, value) =>
  writeFileSync(
    join(dir, name + ".json"),
    JSON.stringify(value, null, 2) + "\n",
  );
const base = admittedModel(read(old, "account-policy"), read(old, "negocios"));
if (stage === "search") {
  const result = inventMethods(
    read(dir, "train-cases"),
    read(dir, "train-outcomes"),
    read(dir, "validation-cases"),
    read(dir, "validation-outcomes"),
    base,
  );
  write("candidate", result);
} else if (stage === "freeze") {
  const c = read(dir, "candidate"),
    rows = read(dir, "reserve-cases");
  const exposed = new Set(
    ["train", "validation", "test"].flatMap((s) =>
      read(dir, s + "-cases").map((r) => r.id),
    ),
  );
  assert.ok(
    rows.length > 0 &&
      rows.every((r) => !exposed.has(r.id) && r.cutoff === "2011-11-09") &&
      new Set(rows.map((r) => r.id)).size === rows.length,
  );
  const control = rankMethod(rows, base, null),
    candidate = rankMethod(rows, base, c.chosen.program);
  write("sealed", {
    reserve: digest(rows),
    method: digest(c.chosen.program),
    control,
    candidate,
  });
} else if (stage === "judge") {
  const c = read(dir, "candidate"),
    seal = read(dir, "sealed"),
    cases = read(dir, "reserve-cases");
  const reserve = digest(cases),
    commitment = digest(seal);
  assert.equal(seal.reserve, reserve);
  assert.equal(seal.method, digest(c.chosen.program));
  assert.deepEqual(seal.control, rankMethod(cases, base, null));
  assert.deepEqual(seal.candidate, rankMethod(cases, base, c.chosen.program));
  const prior = JSON.parse(
    readFileSync(
      archive ??
        new URL("../../evidence/metodos-negocio.json", import.meta.url),
    ),
  );
  if (prior.reserve === reserve && prior.commitment !== commitment)
    throw Error("Reserva ya abierta para otro finalista");
  const labels = read(dir, "reserve-outcomes"),
    a = gradeAccounts(seal.control, labels),
    b = gradeAccounts(seal.candidate, labels);
  const report = {
    schema: 1,
    scope: c.scope,
    source: "UCI Online Retail · Daqing Chen · DOI 10.24432/C5BW33 · CC BY 4.0",
    cutoff: cases[0].cutoff,
    reserve,
    commitment,
    incumbent: digest(base),
    programHash: seal.method,
    candidate: c.chosen.program,
    signals: c.signals,
    tested: c.tested,
    shortlist: c.shortlist,
    developmentMisses: c.developmentMisses,
    validation: { incumbent: c.reference, candidate: c.chosen.validation },
    holdout: { incumbent: a, candidate: b },
    admitted: c.qualified && improves(b, a),
    paidEvidence: null,
  };
  write("metodos", report);
  console.log(JSON.stringify(report));
} else throw Error("Usa search, freeze o judge");
