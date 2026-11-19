import { assess, checkQuery, ref, referee, token } from "./dossiers.mjs";
import { founderId, getAgent } from "./ledger.mjs";
import { digest, INITIAL, integer, LEADERS, strict } from "./policy.mjs";

export const MAX_TEAM_ROWS = 8192;
const denied = (status) => ({ result: { status }, actors: [] });

function selectCrew(state, chief, size, seed) {
  const leader = getAgent(state, chief.id);
  const perSector =
    (state.expansion ? INITIAL : state.genesisSize) / LEADERS.length;
  const selected = new Set([leader.id]),
    members = [leader];
  // A cyclic permutation per sector lets every founder be selected. Its stride
  // is coprime with both supported founder counts per sector (1M and 10M).
  const cursors = LEADERS.map(
    (_, i) => Number.parseInt(digest([seed, i]).slice(0, 10), 16) % perSector,
  );
  for (let seat = 1; seat < size; seat++) {
    const sector = ((leader.sector - 1 + seat) % LEADERS.length) + 1;
    let agent;
    const idx = sector - 1;
    const bands = state.bands.filter((b) => b.sector === sector);
    if (bands.length && seat < 10) {
      const band = bands[cursors[idx] % bands.length];
      const candidate = getAgent(
        state,
        band.lo + (cursors[idx] % (band.hi - band.lo + 1)),
      );
      if (
        !selected.has(candidate.id) &&
        candidate.status === "LIVE" &&
        candidate.balance > 1
      )
        agent = candidate;
    }
    for (
      let tries = 0;
      !agent && tries < Math.min(perSector, state.agents.size + size + 1);
      tries++
    ) {
      const id = founderId(state, sector, cursors[idx] + 1);
      cursors[idx] = (cursors[idx] + 104729) % perSector;
      if (selected.has(id)) continue;
      const candidate = getAgent(state, id);
      if (candidate.status === "LIVE" && candidate.balance > 1)
        agent = candidate;
    }
    if (!agent) return null;
    selected.add(agent.id);
    members.push(agent);
  }
  return members;
}

export function planTeam(state, m, chief, c, available) {
  strict(c, [
    "type",
    "mission",
    "documents",
    "query",
    "size",
    "rowBudget",
    "creditBudget",
  ]);
  token(c.mission);
  if (c.mission !== m.id) throw Error("Misión distinta");
  checkQuery(c.query);
  if (![1, 10, 100].includes(c.size)) throw Error("Tamaño de equipo inválido");
  integer(c.rowBudget, 1, MAX_TEAM_ROWS, "presupuesto de filas");
  integer(c.creditBudget, 1, 100, "presupuesto de créditos");
  if (
    !Array.isArray(c.documents) ||
    !c.documents.length ||
    c.documents.length > 256 ||
    new Set(c.documents).size !== c.documents.length
  )
    throw Error("Selección de expedientes inválida");
  const docs = c.documents.map((id) => {
    token(id);
    const d = m.docs.find((x) => x.id === id);
    if (!d) throw Error("Fuente sin autorización");
    return d;
  });
  const rows = docs.reduce((n, d) => n + d.rows.length, 0);
  if (rows > c.rowBudget || c.size > c.creditBudget || c.size > available)
    return denied("BUDGET_LIMIT");
  if (rows < c.size) return denied("TOO_FEW_ROWS");
  if (getAgent(state, chief.id).balance === 1)
    return {
      result: { status: "DEAD_ZERO", id: chief.id },
      actors: [chief.id],
    };
  const revision = digest(docs.map((d) => [d.id, d.sha256, d.revision]));
  const members = selectCrew(
    state,
    chief,
    c.size,
    digest([m.id, c.query, revision]),
  );
  if (!members) return denied("STAFF_LIMIT");
  return { docs, rows, revision, members };
}

// Rebuild the answer from the offsets submitted by the physical workers. Re-read
// sources independently to check completeness and the attribution of each slice.
export function finishTeam(m, c, plan, seal) {
  if (!plan.members) {
    if (seal) throw Error("Acta de trabajo sin autorización");
    m.spent += plan.actors.length;
    return plan;
  }
  strict(seal, ["lanes", "scanNs", "hits"]);
  integer(seal.lanes, 1, Math.min(4, c.size), "hilos");
  integer(seal.scanNs, 0, Number.MAX_SAFE_INTEGER, "tiempo nativo");
  if (!Array.isArray(seal.hits) || seal.hits.length !== c.size)
    throw Error("Faltan partes del expediente");
  const columns = c.query.fields.map(() => []);
  const { docs, rows, members, revision } = plan;
  let docIndex = 0,
    rowIndex = 0,
    offset = 0;
  const assignments = members.map((member, i) => {
    const first = offset,
      end = Math.floor((rows * (i + 1)) / c.size),
      reported = seal.hits[i];
    if (!Array.isArray(reported)) throw Error("Parte inválida");
    let n = 0;
    while (offset < end) {
      const doc = docs[docIndex],
        r = doc.rows[rowIndex],
        field = c.query.fields.indexOf(r.field);
      if (r.subject === c.query.subject && field !== -1) {
        if (reported[n++] !== offset)
          throw Error("Evidencia omitida o mal atribuida");
        columns[field].push({ value: r.value, ref: ref(doc, rowIndex) });
      }
      offset++;
      rowIndex++;
      if (rowIndex === doc.rows.length) {
        docIndex++;
        rowIndex = 0;
      }
    }
    if (n !== reported.length) throw Error("Referencia sobrante");
    return {
      id: member.id,
      generation: member.generation,
      version: member.version,
      sector: member.sector,
      first,
      end,
      matches: n,
    };
  });
  const answer = assess(c.query, columns);
  if (digest(answer) !== digest(referee(docs, c.query)))
    throw Error("El Oráculo rechazó el dictamen del equipo");
  const result = {
    status: "TEAM_ANSWERED",
    mission: m.id,
    query: c.query,
    revision,
    method: "indexed",
    rows,
    credits: c.size,
    lanes: seal.lanes,
    scanNs: seal.scanNs,
    assignments,
    answer,
  };
  m.spent += c.size;
  m.lastTeam = {
    revision,
    query: c.query,
    size: c.size,
    rows,
    credits: c.size,
    lanes: seal.lanes,
    sectors: [...new Set(members.map((a) => a.sector))],
    answer,
  };
  return { result, actors: members.map((a) => a.id) };
}
