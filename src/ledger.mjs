import { DatabaseSync } from "node:sqlite";
import {
  BATCH,
  CAP,
  INITIAL,
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
  constructor(path) {
    this.#db = new DatabaseSync(path);
    this.#db
      .exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON journal BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  }
  close() {
    this.#db.close();
  }
  read() {
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
      const e = JSON.parse(row.body);
      if (
        row.seq !== state.events.length + 1 ||
        e.seq !== row.seq ||
        e.key !== row.key ||
        e.prev !== state.tip ||
        digest(e) !== row.hash ||
        e.route?.supreme !== "L1" ||
        e.route?.readers?.join() !== LEADERS.join()
      )
        throw Error("Bitácora alterada");
      state.tip = row.hash;
      state.keys.set(row.key, e);
      state.events.push(e);
      for (const step of e.steps) applyStep(state, step, e);
    }
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
        if (old && old.input === fingerprint) {
          this.#db.exec("COMMIT");
          return old.result;
        }
        let action;
        try {
          if (old) throw Error("Clave repetida para otra solicitud");
          action = await build(state);
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
            at: Date.now(),
            prev: state.tip,
            route: { origin: "L" + sector, supreme: "L1", readers: LEADERS },
            steps,
            result,
          };
          this.#db
            .prepare("INSERT INTO journal VALUES(?,?,?,?)")
            .run(entry.seq, entryKey, JSON.stringify(entry), digest(entry));
          verifyAudit();
        }
        this.#db.exec("COMMIT");
        output = result;
      } catch (error) {
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
function applyStep(state, step, e) {
  switch (step.kind) {
    case "genesis":
      if (state.population !== 0 || step.size !== INITIAL)
        throw Error("Génesis inválida");
      state.population = step.size;
      state.treasury = step.reserve;
      break;
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
export function getAgent(state, id) {
  integer(id, 1, state.population, "identidad");
  const current = state.agents.get(id);
  if (current) return structuredClone(current);
  if (id <= INITIAL) {
    const sector = sectorOf(id);
    return {
      id,
      sector,
      generation: 1,
      version: 1,
      skills: initialSkills(sector),
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
    live: state.population - state.dead,
    dead: state.dead,
    treasury: state.treasury,
    spent: state.spent,
    unit: "créditos simulados",
    cap: CAP,
    events: state.events.length,
    tip: state.tip,
    leaders: LEADERS.map((id, i) => ({
      id,
      sector: SECTORS[i],
      supreme: i === 0,
    })),
  };
}
