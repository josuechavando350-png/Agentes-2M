import { createHash } from "node:crypto";
import { integer, SECTORS } from "./policy.mjs";
import { getAgent } from "./ledger.mjs";

import { qualification } from "./qualification.mjs";

export function census(
  state,
  first = 1,
  last = state.population,
  { examine = false } = {},
) {
  const exam = examine ? qualification() : null;
  integer(first, 1, state.population, "primer ID");
  integer(last, first, state.population, "último ID");
  const hash = createHash("sha256"),
    sectors = SECTORS.map((name, i) => ({
      leader: "L" + (i + 1),
      name,
      identities: 0,
      ...(exam ? { founders: 0, replicas: 0, passed: 0 } : {}),
    }));
  let live = 0,
    balance = 0,
    chunk = "";
  for (let id = first; id <= last; id++) {
    const a = getAgent(state, id);
    if (
      a.id !== id ||
      !a.skills.length ||
      (a.balance === 0) !== (a.status === "DEAD")
    )
      throw Error("Identidad incompleta: " + id);
    const group = sectors[a.sector - 1];
    group.identities++;
    let result;
    if (exam) {
      const founder =
        id <= state.genesisSize ||
        (state.expansion &&
          id >= state.expansion.lo &&
          id <= state.expansion.hi);
      group[founder ? "founders" : "replicas"]++;
      if (a.status === "LIVE") {
        result = exam.evaluate(a);
        group.passed++;
      }
    }
    live += Number(a.status === "LIVE");
    balance += a.balance;
    chunk +=
      [
        id,
        a.sector,
        a.generation,
        a.version,
        a.balance,
        a.status,
        a.skills.join(","),
      ].join("|") +
      (exam ? "|" + (result ?? "RETIRED") : "") +
      "\n";
    if (id % 2048 === 0) {
      hash.update(chunk);
      chunk = "";
    }
  }
  hash.update(chunk);
  return {
    first,
    last,
    identities: last - first + 1,
    live,
    simulationCredits: balance,
    sectors,
    sha256: hash.digest("hex"),
    ...(exam ? { tested: live, byMethod: exam.counts } : {}),
  };
}
