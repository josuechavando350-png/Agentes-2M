import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { availableParallelism } from "node:os";
import { executable } from "./native.mjs";
import {
  accountVector,
  allocate,
  improves,
  signals,
} from "./account-market.mjs";
import { digest, integer, strict, LEADERS, SECTORS } from "./policy.mjs";
import { token } from "./dossiers.mjs";
import { ABSOLUTE } from "./missions.mjs";

const RULES = 100;
const schema = "SEMAR-ANALOG-1";
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function preparePopulation(packet) {
  strict(packet, ["niche", "historical", "outcomes", "queries"]);
  token(packet.niche);
  for (const group of [packet.historical, packet.queries]) {
    if (!Array.isArray(group) || !group.length || group.length > 4096)
      throw Error("Número de expedientes inválido");
  }
  if (packet.historical.length * packet.queries.length > 100000)
    throw Error("Se excedió el cupo de diez millones por sector");
  const history = packet.historical.toSorted(byId),
    queries = packet.queries.toSorted(byId);
  if (
    new Set([...history, ...queries].map((r) => r.id)).size !==
    history.length + queries.length
  )
    throw Error("Cuenta duplicada o ya vista");
  if (
    !packet.outcomes ||
    Array.isArray(packet.outcomes) ||
    Object.keys(packet.outcomes).length !== history.length
  )
    throw Error("Cobertura de desenlaces históricos inválida");
  const train = history.map(accountVector),
    cases = queries.map(accountVector);
  const first = Math.min(...queries.map((r) => Date.parse(r.cutoff)));
  if (history.some((r) => Date.parse(r.cutoff) + 30 * 86400000 > first))
    throw Error("La ventana histórica seguía abierta al pronosticar");
  const labels = history.map((r) =>
    integer(packet.outcomes[r.id], 0, 1, "desenlace histórico"),
  );
  const scale = signals.map((_, i) => Math.max(1, ...train.map((x) => x[i])));
  const normalize = (x) =>
    x.map((v, i) => Math.min(10000, Math.round((v / scale[i]) * 10000)));
  return {
    niche: packet.niche,
    source: digest({ schema, niche: packet.niche, history, queries, labels }),
    history: train.map(normalize),
    queries: cases.map(normalize),
    historyIds: history.map((r) => r.id),
    queryIds: queries.map((r) => r.id),
    labels,
  };
}
function founderRanges(layout, perSector) {
  const sectors = SECTORS.map(() => ({ count: 0, ranges: [] }));
  let previous = 0;
  for (const run of layout.runs) {
    const p = layout.profiles[run.index],
      sector = sectors[p.sector - 1];
    const count = Math.min(perSector - sector.count, run.last - previous);
    if (run.founder && count > 0) {
      if (p.status !== "LIVE" || p.balance < 1)
        throw Error(
          "Fundador retirado en el rango solicitado: " + (previous + 1),
        );
      const last = previous + count;
      const range = sector.ranges.at(-1);
      if (range && range[1] === previous) range[1] = last;
      else sector.ranges.push([previous + 1, last]);
      sector.count += count;
    }
    previous = run.last;
  }
  if (sectors.some((s) => s.count !== perSector))
    throw Error("Padrón de fundadores insuficiente");
  return sectors.map((s) => s.ranges);
}
function idAt(ranges, ordinal) {
  let rest = ordinal;
  for (const [first, last] of ranges) {
    if (rest <= last - first) return first + rest;
    rest -= last - first + 1;
  }
  throw Error("Ordinal sectorial inválido");
}
function ordinalOf(ranges, id) {
  let offset = 0;
  for (const [first, last] of ranges) {
    if (first <= id && id <= last) return offset + id - first;
    offset += last - first + 1;
  }
  return -1;
}
function forecast(p, sectors) {
  const predictions = { ten: [], hundred: [], thousand: [] };
  for (const [q, id] of p.queryIds.entries()) {
    const totals = { ten: 0, hundred: 0, thousand: 0 };
    for (const s of sectors) {
      const c = s.cells[q];
      for (const k of Object.keys(totals)) totals[k] += c[k];
    }
    for (const [k, n] of [
      ["ten", 10],
      ["hundred", 100],
      ["thousand", 1000],
    ]) {
      predictions[k].push({ id, probability: totals[k] / n });
    }
  }
  return Object.fromEntries(
    Object.entries(predictions).map(([k, v]) => [k, allocate(v)]),
  );
}
export function populationResearch(
  layout,
  packet,
  threads = Math.min(4, availableParallelism()),
  rules = RULES,
) {
  integer(threads, 1, 10, "hilos");
  if (![1, 10, RULES].includes(rules)) throw Error("Escala desconocida");
  const start = performance.now();
  const p = preparePopulation(packet),
    perSector = p.queries.length * p.history.length * rules;
  const ranges = founderRanges(layout, perSector);
  const input = [
    [threads, p.history.length, p.queries.length].join(" "),
    ...ranges.map((rs) => [rs.length, ...rs.flat()].join(" ")),
    ...p.history.map((x, i) => [p.labels[i], ...x].join(" ")),
    ...p.queries.map((x) => x.join(" ")),
  ].join("\n");
  const t = performance.now();
  const command =
    rules === RULES ? ["population"] : ["population-scale", String(rules)];
  const job = spawnSync(executable, command, {
    input,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180000,
  });
  if (job.error || job.status !== 0)
    throw job.error ?? Error(job.stderr || "Falló el cálculo de población");
  const nativeMs = performance.now() - t;
  const lines = job.stdout.trim().split("\n");
  assert.equal(lines.length, 10 * p.queries.length);
  const sectors = ranges.map((rs, i) => {
    const cells = lines
      .slice(i * p.queries.length, (i + 1) * p.queries.length)
      .map((line) => {
        const fields = line.split(" ");
        if (fields.length !== 4 || !/^[0-9a-f]{64}$/.test(fields[0]))
          throw Error("Respuesta nativa inválida");
        const [ten, hundred, thousand] = fields.slice(1).map(Number);
        integer(ten, 0, 1, "votos");
        integer(hundred, ten, 10, "votos");
        integer(thousand, hundred, 100, "votos");
        return { hash: fields[0], ten, hundred, thousand };
      });
    return {
      leader: LEADERS[i],
      sector: SECTORS[i],
      signal: signals[i],
      participants: perSector,
      ranges: rs,
      cells,
    };
  });
  const result = {
    schema,
    niche: p.niche,
    checkpoint: layout.checkpoint,
    source: p.source,
    scope: "positive-net-invoicing-next-30-days",
    historical: p.history.length,
    queries: p.queries.length,
    participants: 10 * perSector,
    absolute: ABSOLUTE,
    sectors,
    decisions: forecast(p, sectors),
  };
  if (rules < RULES) {
    result.schema = schema + "-SCALE-" + rules;
    delete result.decisions.thousand;
    if (rules === 1) delete result.decisions.hundred;
  }
  return {
    result,
    commitment: digest(result),
    measurement: { threads, nativeMs, elapsedMs: performance.now() - start },
    accounting: {
      mode: "READ_ONLY_CHECKPOINT",
      ledgerCreditsDebited: 0,
      verifiedPayments: null,
    },
  };
}

// Independent Oracle. Processes one query/sector at a time; reproduces the
// ID-distance byte stream and nearest labelled neighbour of each fixed metric.
function inspectCell(p, ranges, s, q, requested = -1) {
  const bytes = Buffer.allocUnsafe(p.history.length * RULES * 12);
  const best = new Array(RULES).fill(Infinity),
    neighbours = new Array(RULES);
  const offset = q * p.history.length * RULES;
  let range = 0,
    id = idAt(ranges, offset),
    pos = 0,
    receipt;
  while (id > ranges[range][1]) range++;
  for (const [h, reference] of p.history.entries()) {
    const dif = reference.map((v, i) => Math.abs(v - p.queries[q][i]));
    for (let m = 0; m < RULES; m++) {
      // Compute weighted L1 directly, independently of the native reduction.
      const weights = weightTable[s][m];
      let distance = 0;
      for (let j = 0; j < 10; j++) distance += weights[j] * dif[j];
      bytes.writeUInt32LE(id >>> 0, pos);
      bytes.writeUInt32LE(Math.floor(id / 4294967296), pos + 4);
      bytes.writeUInt32LE(distance, pos + 8);
      pos += 12;
      if (id === requested)
        receipt = {
          id,
          leader: LEADERS[s],
          query: p.queryIds[q],
          reference: p.historyIds[h],
          referenceOutcome: p.labels[h],
          rule: m,
          weights,
          distance,
        };
      if (distance < best[m]) {
        best[m] = distance;
        neighbours[m] = h;
      }
      if (id === ranges[range][1]) {
        range++;
        id = ranges[range]?.[0];
      } else id++;
    }
  }
  const votes = neighbours.map((h) => p.labels[h]);
  if (receipt)
    receipt.nearestForThisRule = p.historyIds[neighbours[receipt.rule]];
  return {
    cell: {
      hash: createHash("sha256").update(bytes).digest("hex"),
      ten: votes[0],
      hundred: votes.reduce((n, v, i) => n + (i % 11 === 0 ? v : 0), 0),
      thousand: votes.reduce((a, b) => a + b, 0),
    },
    receipt,
  };
}
const weightTable = signals.map((_, s) =>
  Array.from({ length: RULES }, (_, m) =>
    signals.map(
      (_, j) =>
        1 +
        (j === s ? 16 : 0) +
        (j === (s + 1) % 10 ? Math.floor(m / 10) : 0) +
        (j === (s + 3) % 10 ? m % 10 : 0),
    ),
  ),
);
export function verifyPopulation(layout, packet, report, agent) {
  const start = performance.now(),
    p = preparePopulation(packet),
    r = report.result;
  assert.equal(report.commitment, digest(r));
  assert.equal(r.schema, schema);
  assert.equal(r.source, p.source);
  assert.equal(r.checkpoint, layout.checkpoint);
  const n = p.history.length * p.queries.length * RULES,
    ranges = founderRanges(layout, n);
  assert.equal(r.participants, n * 10);
  assert.equal(r.niche, p.niche);
  assert.equal(r.historical, p.history.length);
  assert.equal(r.queries, p.queries.length);
  assert.equal(r.scope, "positive-net-invoicing-next-30-days");
  assert.equal(r.absolute, ABSOLUTE);
  assert.equal(r.sectors.length, 10);
  if (agent !== undefined) integer(agent, 1, layout.population, "agente");
  for (const [s, rs] of ranges.entries()) {
    const sector = r.sectors[s];
    assert.deepEqual(sector.ranges, rs);
    assert.equal(sector.participants, n);
    assert.equal(sector.leader, LEADERS[s]);
    assert.equal(sector.signal, signals[s]);
    assert.equal(sector.sector, SECTORS[s]);
    assert.equal(sector.cells.length, p.queries.length);
    const ordinal = agent === undefined ? -1 : ordinalOf(rs, agent);
    if (agent !== undefined && ordinal === -1) continue;
    const first =
      ordinal === -1 ? 0 : Math.floor(ordinal / (p.history.length * RULES));
    const end = ordinal === -1 ? p.queries.length : first + 1;
    for (let q = first; q < end; q++) {
      const { cell, receipt } = inspectCell(p, rs, s, q, agent);
      assert.deepEqual(
        cell,
        sector.cells[q],
        "Resultado divergente en L" + (s + 1) + "/" + p.queryIds[q],
      );
      if (receipt)
        return {
          ...receipt,
          checkpoint: r.checkpoint,
          source: p.source,
          cell: cell.hash,
          commitment: report.commitment,
        };
    }
  }
  if (agent !== undefined) throw Error("Identidad sin asignación en este lote");
  assert.deepEqual(r.decisions, forecast(p, r.sectors));
  return {
    status: "VERIFIED",
    participants: r.participants,
    cells: p.queries.length * 10,
    controlTeam: ranges.map((rs, s) => ({
      id: rs[0][0],
      leader: LEADERS[s],
      comparisons: n,
    })),
    commitment: report.commitment,
    elapsedMs: performance.now() - start,
  };
}

// Ten founders each handle an entire sector with a single metric under the
// same information cutoff. This control spends 1/100 of the comparisons.
export function smallTeamResearch(layout, packet) {
  const p = preparePopulation(packet),
    heads = founderRanges(layout, 1),
    started = performance.now();
  const predictions = p.queries.map((query, q) => {
    const nearest = signals.map(() => ({ index: -1, distance: Infinity }));
    for (const [h, reference] of p.history.entries()) {
      const delta = query.map((v, j) => Math.abs(v - reference[j])),
        sum = delta.reduce((a, b) => a + b, 0);
      for (let s = 0; s < 10; s++) {
        const distance = sum + 16 * delta[s];
        if (distance < nearest[s].distance) nearest[s] = { index: h, distance };
      }
    }
    return {
      id: p.queryIds[q],
      probability:
        nearest.reduce((n, v) => n + p.labels[v.index], 0) / nearest.length,
    };
  });
  return {
    actors: heads.map((rs) => rs[0][0]),
    comparisons: 10 * p.queries.length * p.history.length,
    decisions: allocate(predictions),
    elapsedMs: performance.now() - started,
  };
}

// Promotion uses the existing commercial admission criteria. Each more
// expensive family must beat both the incumbent and the best cheaper family.
export function populationVerdict(scores) {
  let selected = "incumbent";
  const comparisons = { ten: 1000000, hundred: 10000000, thousand: 100000000 };
  for (const name of ["ten", "hundred", "thousand"]) {
    if (improves(scores[name], scores[selected])) selected = name;
  }
  return {
    selected,
    comparisonsOfSelectedFamily: comparisons[selected] ?? null,
    status:
      selected === "incumbent"
        ? "KEEP_INCUMBENT"
        : "CANDIDATE_FOR_FRESH_VALIDATION",
  };
}

export async function submitPopulation(store, mission, packet, report) {
  token(mission);
  const r = report.result;
  if (report.commitment !== digest(r)) throw Error("Informe alterado");
  // The immutable source fits in the usual dossier. Its commitment locates
  // every per-account decision and every individual contribution in the report.
  const doc = {
    id: "poblacion-" + report.commitment.slice(0, 38),
    source: "semar:sha256:" + report.commitment,
    rows: [
      { subject: packet.niche, field: "metodo", value: r.schema },
      { subject: packet.niche, field: "expedientes", value: r.queries },
      { subject: packet.niche, field: "antecedentes", value: r.historical },
      { subject: packet.niche, field: "participantes", value: r.participants },
      { subject: packet.niche, field: "ancla", value: r.checkpoint },
      { subject: packet.niche, field: "fuentes", value: r.source },
      ...r.sectors.map((s, i) => ({
        subject: packet.niche,
        field: "lider_" + (i + 1),
        value: s.leader + " / " + s.signal + " / " + s.participants,
      })),
    ],
  };
  const key = "poblacion-" + digest([mission, report.commitment]).slice(0, 48),
    known = store.receipt(key);
  if (known) {
    if (
      known.sha256 !== digest(doc) ||
      preparePopulation(packet).source !== r.source
    )
      throw Error("Recibo de otra investigación");
    return known;
  }
  if (store.mission()?.mission?.id !== mission) throw Error("Misión distinta");
  verifyPopulation(store.layout(), packet, report);
  return store.command(key, {
    type: "admit_source",
    mission,
    previous: 0,
    document: doc,
  });
}
