import { ABSOLUTE, charter, decide, incumbent } from "./missions.mjs";
import { DatabaseSync } from "node:sqlite";
import {
  BATCH,
  CAP,
  INITIAL,
  LEGACY_INITIAL,
  STIPEND,
  LEADERS,
  SECTORS,
  integer,
  initialSkills,
  sectorOf,
  digest,
} from "./policy.mjs";

// Node's sqlite driver is synchronous. Serialize async writers before acquiring a SQL lock;
// BEGIN IMMEDIATE also excludes writers in other processes. No external calls inside the lock.
let pending = Promise.resolve();
const ZERO = "0".repeat(64);
export class Ledger {
  #db;
  #cache;
  #dataVersion;
  #readVersion;
  constructor(path, clock = Date.now) {
    this.clock = clock;
    this.#db = new DatabaseSync(path);
    this.#readVersion = this.#db.prepare("PRAGMA data_version");
    this.#db
      .exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON journal BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  }
  close() {
    this.#db.close();
  }
  read(force = false) {
    const version = this.#readVersion.get().data_version;
    if (!force && this.#cache && version === this.#dataVersion)
      return this.#cache;
    this.#cache = undefined;
    const state = {
      population: 0,
      treasury: 0,
      spent: 0,
      dead: 0,
      agents: new Map(),
      bands: [],
      lessons: new Map(),
      bandits: new Map(),
      events: [],
      keys: new Map(),
      tip: ZERO,
    };
    for (const row of this.#db
      .prepare("SELECT * FROM journal ORDER BY seq")
      .iterate()) {
      appendRow(state, row);
    }
    this.#cache = state;
    this.#dataVersion = version;
    return state;
  }
  restore(events, tip, verifyAudit) {
    if (!Array.isArray(events) || !events.length || !/^[0-9a-f]{64}$/.test(tip))
      throw Error("Checkpoint inválido");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.#db.prepare("SELECT count(*) n FROM journal").get().n)
        throw Error("Se requiere una base vacía");
      const insert = this.#db.prepare("INSERT INTO journal VALUES(?,?,?,?)");
      for (const e of events)
        insert.run(e.seq, e.key, JSON.stringify(e), digest(e));
      const audit = verifyAudit(tip);
      this.#db.exec("COMMIT");
      return audit;
    } catch (error) {
      this.#cache = undefined;
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  dispatch(key, command, build, verifyAudit) {
    if (typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key))
      throw Error("Clave inválida");
    const fingerprint = digest(command);
    const task = async () => {
      this.#db.exec("BEGIN IMMEDIATE");
      let failure, output;
      try {
        const state = this.read(),
          old = state.keys.get(key);
        verifyAudit(state);
        if (old && old.input === fingerprint) {
          this.#db.exec("COMMIT");
          return structuredClone(old.result);
        }
        const now = Math.max(this.clock(), state.events.at(-1)?.at ?? 0);
        let action;
        try {
          if (old) throw Error("Clave repetida para otra solicitud");
          action = await build(state, now);
        } catch (error) {
          failure = error;
          const reason = String(error.message).slice(0, 360);
          let sector = 1;
          if (
            Number.isSafeInteger(command?.id) &&
            command.id >= 1 &&
            command.id <= state.population
          )
            sector = getAgent(state, command.id).sector;
          action = {
            sector,
            steps: [{ kind: "notice", reason }],
            result: { status: "DENIED", reason, request: key },
          };
        }
        const { steps, result, sector } = action;
        // An unsigned packet must not reserve the legitimate author's idempotency key.
        const rejected = failure || result.status === "INVALID_SIGNATURE";
        const entryKey = rejected
          ? "~" + digest({ key, fingerprint, status: result.status })
          : key;
        if (!state.keys.has(entryKey)) {
          const entry = {
            seq: state.events.length + 1,
            key: entryKey,
            input: fingerprint,
            at: now,
            prev: state.tip,
            route: {
              origin: "L" + sector,
              supreme: state.gov ? ABSOLUTE : "L1",
              readers: state.gov ? [...LEADERS, ABSOLUTE] : LEADERS,
            },
            steps,
            result,
          };
          const row = {
            seq: entry.seq,
            key: entryKey,
            body: JSON.stringify(entry),
            hash: digest(entry),
          };
          this.#db
            .prepare("INSERT INTO journal VALUES(?,?,?,?)")
            .run(row.seq, row.key, row.body, row.hash);
          appendRow(state, row);
          verifyAudit(state);
          this.#cache = state;
        }
        this.#db.exec("COMMIT");
        output = result;
      } catch (error) {
        this.#cache = undefined;
        this.#db.exec("ROLLBACK");
        throw error;
      }
      if (failure) throw failure;
      return output;
    };
    const job = pending.then(task);
    pending = job.catch(() => {});
    return job;
  }
}
function appendRow(state, row) {
  const e = JSON.parse(row.body);
  if (
    row.seq !== state.events.length + 1 ||
    e.seq !== row.seq ||
    e.key !== row.key ||
    e.prev !== state.tip ||
    digest(e) !== row.hash ||
    e.route?.supreme !== (state.gov ? ABSOLUTE : "L1") ||
    e.route?.readers?.join() !==
      (state.gov ? [...LEADERS, ABSOLUTE] : LEADERS).join() ||
    (state.gov && e.at < (state.events.at(-1)?.at ?? 0))
  )
    throw Error("Bitácora alterada");
  state.tip = row.hash;
  state.keys.set(row.key, e);
  state.events.push(e);
  for (const step of e.steps) applyStep(state, step, e);
}
function applyStep(state, step, e) {
  switch (step.kind) {
    case "genesis":
      if (
        state.population !== 0 ||
        ![LEGACY_INITIAL, INITIAL].includes(step.size)
      )
        throw Error("Génesis inválida");
      state.genesisSize = step.size;
      state.population = step.size;
      state.treasury = step.reserve;
      break;
    case "charter":
      if (!state.population || state.gov)
        throw Error("Carta de gobierno inválida");
      state.gov = charter();
      break;
    case "government": {
      if (!state.gov || e.steps[0] !== step || digest(step.command) !== e.input)
        throw Error("Acta sin mandato");
      const projected = decide(
        state,
        step.command,
        e.at,
        step.seal,
        step.protocol,
      );
      const charges = governmentDebits(
        state,
        projected.actors,
        projected.transfer,
      );
      if (
        digest(projected.result) !== digest(e.result) ||
        digest(charges) !== digest(e.steps.slice(1))
      )
        throw Error("Mandato o cargo alterado");
      break;
    }
    case "founder_expansion": {
      applyExpansion(state, step);
      state.treasury -= (step.hi - step.lo + 1) * STIPEND;
      break;
    }
    case "birth_endowment": {
      const needed = Math.max(
        0,
        (CAP - state.population) * STIPEND - state.treasury,
      );
      if (!state.population || state.hasEndowment || step.amount !== needed)
        throw Error("Dotación de nacimientos inválida");
      state.hasEndowment = true;
      state.treasury += step.amount;
      break;
    }
    case "agent":
      state.agents.set(step.agent.id, step.agent);
      state.spent += step.spent || 0;
      state.treasury += step.reserveDelta || 0;
      state.dead += step.deadDelta || 0;
      break;
    case "lesson": {
      const known = state.lessons.get(step.op) ?? new Map();
      known.set(step.teacher, {
        ...step,
        key: e.key,
        hash: digest(step),
        at: e.at,
      });
      state.lessons.set(step.op, known);
      state.bandits.set(step.sector, step.states);
      break;
    }
    case "cohort":
      if (
        step.lo !== state.population + 1 ||
        step.hi > CAP ||
        step.hi < step.lo ||
        step.hi - step.lo + 1 + step.standby !== BATCH
      )
        throw Error("Padrón inconsistente");
      state.bands.push(step);
      state.population = step.hi;
      state.treasury -= (step.hi - step.lo + 1) * STIPEND;
      break;
    case "notice":
      break;
    default:
      throw Error("Evento desconocido");
  }
  if (state.treasury < 0 || state.dead < 0)
    throw Error("Saldo contable imposible");
}
export function governmentDebits(state, ids, transfer) {
  if (transfer) {
    const from = getAgent(state, transfer.from),
      to = getAgent(state, transfer.to);
    if (
      ids.length ||
      from.id === to.id ||
      from.balance <= 1 ||
      to.status !== "LIVE" ||
      to.balance >= STIPEND
    )
      throw Error("Transferencia de créditos inválida");
    from.balance--;
    to.balance++;
    return [from, to].map((agent) => ({ kind: "agent", agent, spent: 0 }));
  }
  if (new Set(ids).size !== ids.length)
    throw Error("Una identidad no puede ocupar dos puestos del equipo");
  return ids.map((id) => {
    const agent = getAgent(state, id);
    if (agent.status !== "LIVE") throw Error("Identidad retirada");
    agent.balance--;
    if (agent.balance === 0) {
      agent.status = "DEAD";
      agent.publicKey = null;
    }
    return {
      kind: "agent",
      agent,
      spent: 1,
      ...(agent.balance === 0 ? { deadDelta: 1 } : {}),
    };
  });
}
export function applyExpansion(state, step) {
  if (
    state.genesisSize !== LEGACY_INITIAL ||
    state.expansion ||
    step.lo !== state.population + 1 ||
    step.hi !== state.population + (INITIAL - LEGACY_INITIAL) ||
    step.hi > CAP
  )
    throw Error("Expansión de fundadores inválida");
  state.expansion = { lo: step.lo, hi: step.hi };
  state.population = step.hi;
}
export function founderId(state, sector, ordinal) {
  if (!state.genesisSize) throw Error("Padrón sin inicializar");
  integer(sector, 1, SECTORS.length, "sector");
  const founders = state.expansion ? INITIAL : state.genesisSize;
  integer(ordinal, 1, founders / SECTORS.length, "ordinal de fundador");
  const stripe = LEGACY_INITIAL / SECTORS.length;
  const logical =
    Math.floor((ordinal - 1) / stripe) * LEGACY_INITIAL +
    (sector - 1) * stripe +
    ((ordinal - 1) % stripe) +
    1;
  return logical > state.genesisSize && state.expansion
    ? state.expansion.lo + logical - state.genesisSize - 1
    : logical;
}
const skillsBySector = SECTORS.map((_, i) =>
  Object.freeze(initialSkills(i + 1)),
);
export function getAgent(state, id) {
  integer(id, 1, state.population, "identidad");
  const current = state.agents.get(id);
  if (current) return structuredClone(current);
  const logical =
    id <= state.genesisSize
      ? id
      : state.expansion && id >= state.expansion.lo && id <= state.expansion.hi
        ? id - state.expansion.lo + 1
        : 0;
  if (logical) {
    const sector = sectorOf(logical);
    return {
      id,
      sector,
      generation: 1,
      version: 1,
      skills: [...skillsBySector[sector - 1]],
      balance: STIPEND,
      status: "LIVE",
      publicKey: null,
    };
  }
  const band = state.bands.find((b) => id >= b.lo && id <= b.hi);
  if (!band) throw Error("Identidad sin cohorte");
  return {
    id,
    sector: band.sector,
    generation: 1,
    version: band.version,
    skills: [...band.skills],
    ...(band.programs ? { programs: structuredClone(band.programs) } : {}),
    balance: STIPEND,
    status: "LIVE",
    publicKey: null,
  };
}
export function statusOf(state) {
  return {
    population: state.population,
    ...(state.expansion || state.genesisSize === INITIAL
      ? { founders: INITIAL, foundersPerSector: INITIAL / SECTORS.length }
      : {}),
    live: state.population - state.dead,
    dead: state.dead,
    treasury: state.treasury,
    spent: state.spent,
    unit: "créditos simulados",
    cap: CAP,
    events: state.events.length,
    tip: state.tip,
    ...(state.gov
      ? { absolute: { name: ABSOLUTE, holder: incumbent(state) } }
      : {}),
    leaders: LEADERS.map((id, i) => ({
      id,
      sector: SECTORS[i],
      supreme: state.gov ? true : i === 0,
    })),
  };
}
