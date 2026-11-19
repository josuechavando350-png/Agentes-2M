import { createHash } from "node:crypto";
import { integer, SECTORS } from "./policy.mjs";
import { getAgent } from "./ledger.mjs";

export function census(state, first = 1, last = state.population) {
  integer(first, 1, state.population, "primer ID");
  integer(last, first, state.population, "último ID");
  const hash = createHash("sha256"),
    sectors = SECTORS.map((name, i) => ({
      leader: "L" + (i + 1),
      name,
      identities: 0,
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
    sectors[a.sector - 1].identities++;
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
      ].join("|") + "\n";
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
  };
}
