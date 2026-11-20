import { DatabaseSync } from "node:sqlite";
import { engine, saveRuntime, archivedExecution } from "./global-archive.mjs";
export { engine };
import { digest, integer, strict, BATCH } from "./policy.mjs";
import { token, label, investigate, referee, POLICIES } from "./dossiers.mjs";
import { compileBrief } from "./global-planner.mjs";
import { candidate, examine } from "./global-method.mjs";
import { signedRecord } from "./field-lab.mjs";
import {
  relevant,
  sourceVersion,
  validateGoal,
  stamp,
  executeMission,
  assessMission,
} from "./global-analysis.mjs";

const WEEK = 168 * 3600000;
const maxMoney = 1e10;
const ops = ["lookup", "difference", "product"];
const hash = digest(engine);
const unknown = (x, m) => {
  if (!x) throw Error(m);
  return x;
};
const byKey = (s, id) =>
  unknown(s.jobs.get(s.aliases.get(id) ?? id), "Trabajo desconocido");
const actorKey = (w) => w.id + "/" + w.generation;
const expires = (s, now) => now >= s.open.until;
const empty = () => ({
  open: null,
  actors: new Map(),
  docs: new Map(),
  jobs: new Map(),
  clarifications: new Map(),
  aliases: new Map(),
  methods: new Map(),
  receipts: new Set(),
  feedback: new Map(),
  spent: 0,
  held: 0,
  tip: "",
  seq: 0,
  at: 0,
});
function apply(s, e) {
  const { kind, data: d } = e;
  if (kind === "open") {
    s.open = d;
    for (const w of d.actors)
      s.actors.set(actorKey(w), { ...w, spent: 0, held: 0 });
  } else if (kind === "clarify") s.clarifications.set(e.key, d);
  else if (kind === "shared") s.aliases.set(e.key, d.job);
  else if (kind === "propose")
    s.methods.set(e.key, { candidate: d, exam: null });
  else if (kind === "deploy") {
    s.actors.get(d.sponsorKey).limit -= d.members.length * d.perAgentCents;
    for (const w of d.members)
      s.actors.set(actorKey(w), {
        ...w,
        limit: d.perAgentCents,
        spent: 0,
        held: 0,
        ops: [d.op],
        policy: "indexed",
        requires: d.proposal,
        certificates: { [d.op]: d.certificate },
      });
    s.methods.get(d.proposal).deployment = {
      first: d.members[0].id,
      last: d.members.at(-1).id,
      receipt: d.birth,
      certificate: d.certificate,
    };
  } else if (kind === "examine") s.methods.get(d.proposal).exam = d;
  else if (kind === "source" || kind === "withdraw")
    s.docs.set(d.document.id, d);
  else if (kind === "reserve") {
    s.jobs.set(e.key, { ...d, id: e.key, status: "RESERVED" });
    s.held += d.cap;
    for (const member of d.snapshot.team)
      s.actors.get(actorKey(member)).held += member.cap;
  } else if (kind === "work") {
    const j = byKey(s, d.job);
    j.status = "WORKED";
    j.output = d.output;
    j.resultHash = d.resultHash;
  } else if (["cancel", "settle"].includes(kind)) {
    const j = byKey(s, d.job);
    s.held -= j.cap;
    let remaining = d.cents ?? 0,
      held = j.cap;
    for (const member of j.snapshot.team) {
      const w = s.actors.get(actorKey(member));
      const charge = Number(
        (BigInt(remaining) * BigInt(member.cap)) / BigInt(held),
      );
      w.held -= member.cap;
      w.spent += charge;
      remaining -= charge;
      held -= member.cap;
    }
    j.status = kind === "cancel" ? "CANCELLED" : "SETTLED";
    if (kind === "settle") {
      s.spent += d.cents;
      s.receipts.add(d.reference);
      j.settlement = d;
    }
  } else if (kind === "feedback") s.feedback.set(d.job, d);
  else throw Error("Evento global desconocido");
  s.tip = digest(e);
  s.seq = e.seq;
  s.at = e.at;
}
function selfTest(w, op) {
  const q = {
    subject: "caso",
    op,
    fields: op === "lookup" ? ["a"] : ["a", "b"],
  };
  const docs = [
    {
      id: "examen",
      source: "examen",
      sha256: "verificado",
      rows: [
        { subject: "caso", field: "a", value: 7 },
        { subject: "caso", field: "b", value: 4 },
      ],
    },
  ];
  const answer = investigate(docs, q, w.policy),
    oracle = referee(docs, q);
  if (answer.status !== oracle.status || answer.value !== oracle.value)
    throw Error("Capacidad sin acreditar");
  return digest([w.policy, q, answer, oracle]);
}
function skillKey(g) {
  return digest([g.scope, g.op, g.minFamilies, g.operands]);
}
function ranking(s, g, at, store, cap, method, replica) {
  const previous = [...s.feedback.values()].map((f) => [byKey(s, f.job), f]);
  return [...s.actors.values()]
    .flatMap((w) => {
      if (
        (w.requires && w.requires !== method) ||
        (replica !== null && w.id !== replica)
      )
        return [];
      const a = store.agent(w.id);
      if (
        a.status !== "LIVE" ||
        a.generation !== w.generation ||
        !w.ops.includes(g.op) ||
        w.spent >= w.limit ||
        w.limit - w.spent - w.held < cap
      )
        return [];
      const past = previous.filter(
        ([j, f]) =>
          j.snapshot.team.some((m) => actorKey(m) === actorKey(w)) &&
          skillKey(j.snapshot.goal) === skillKey(g) &&
          f.until > at,
      );
      const hits = past.filter(([j, f]) => {
        const p = j.output.decision.reviews.find((r) => r.id === w.id);
        const predicted =
          p.status !== "SUPPORTED" || !Number.isSafeInteger(p.value)
            ? "NEED_EVIDENCE"
            : p.value >= j.snapshot.goal.threshold
              ? "ADVANCE"
              : "STOP";
        return predicted === f.action;
      }).length;
      return [
        {
          id: w.id,
          generation: w.generation,
          sector: a.sector,
          policy: w.policy,
          score: (hits + 1) / (past.length + 2),
          examined: past.length,
          certificate: w.certificates[g.op],
          free: w.limit - w.spent - w.held,
        },
      ];
    })
    .sort(
      (a, b) => b.score - a.score || a.examined - b.examined || a.id - b.id,
    );
}
function validateOpen(d, now, store) {
  strict(d, [
    "budgetCents",
    "currency",
    "until",
    "maxJobCents",
    "permissions",
    "actors",
  ]);
  integer(d.budgetCents, 0, maxMoney, "presupuesto");
  integer(d.maxJobCents, 1, maxMoney, "tope por trabajo");
  integer(d.until, now + 1, now + WEEK, "plazo máximo de 168 horas");
  if (
    !/^[A-Z]{3}$/.test(d.currency) ||
    !Array.isArray(d.permissions) ||
    !d.permissions.length ||
    d.permissions.some((x) => !["read", "calculate"].includes(x)) ||
    new Set(d.permissions).size !== d.permissions.length
  )
    throw Error("Permisos o moneda inválidos");
  if (
    !Array.isArray(d.actors) ||
    !d.actors.length ||
    d.actors.length > 256 ||
    new Set(d.actors.map((w) => w.id)).size !== d.actors.length
  )
    throw Error("Identidades inválidas");
  return {
    ...d,
    actors: d.actors.map((w) => {
      strict(w, ["id", "generation", "limit", "ops", "policy"]);
      const a = store.agent(w.id);
      if (
        a.status !== "LIVE" ||
        a.generation !== w.generation ||
        !POLICIES.includes(w.policy) ||
        !Array.isArray(w.ops) ||
        !w.ops.length ||
        w.ops.some((x) => !ops.includes(x)) ||
        new Set(w.ops).size !== w.ops.length
      )
        throw Error("Trabajador sin habilitación");
      integer(w.limit, 0, maxMoney, "saldo del agente");
      return {
        ...w,
        certificates: Object.fromEntries(
          w.ops.map((op) => [op, selfTest(w, op)]),
        ),
      };
    }),
  };
}
function active(s, now) {
  if (!s.open || expires(s, now) || s.spent >= s.open.budgetCents)
    throw Error("Tesorería cerrada o presupuesto cero");
}
function scopeDocs(s, g) {
  return relevant([...s.docs.values()], g);
}
function portfolioSources(s, brief) {
  return [...s.docs.values()]
    .filter((v) => v.scope === brief.scope)
    .sort((a, b) => a.document.id.localeCompare(b.document.id));
}
function methodFailures(s, proposal) {
  const failures = [];
  for (const feedback of s.feedback.values()) {
    const j = byKey(s, feedback.job),
      g = j.snapshot.goal;
    if (
      g.scope !== proposal.scope ||
      g.op !== proposal.candidate.op ||
      digest(g.operands.map((o) => o.field)) !==
        digest(proposal.candidate.fields) ||
      g.operands.some(
        (o) =>
          digest({ unit: o.unit, stage: o.stage }) !==
          digest(proposal.schema[o.field]),
      )
    )
      continue;
    if (assessMission(j.snapshot).action !== feedback.action)
      failures.push(j.id);
  }
  return failures;
}
function methodExam(s, c, d) {
  const score = examine(c, d),
    failures = methodFailures(s, c);
  return {
    ...score,
    admitted: score.admitted && failures.length === 0,
    regressions: failures,
  };
}
function isCurrent(s, j, at, store) {
  const p = j.snapshot.portfolio;
  const method = j.method ? s.methods.get(j.method)?.candidate : null;
  if (
    j.method &&
    (!method ||
      methodFailures(s, method).length > 0 ||
      method.until <= at ||
      method.basis.some(
        ([id, v]) =>
          s.docs.get(id)?.version !== v || s.docs.get(id).until <= at,
      ))
  )
    return false;
  return (
    (!p ||
      stamp(portfolioSources(s, p.brief), at) ===
        stamp(p.sources, j.snapshot.at)) &&
    stamp(scopeDocs(s, j.snapshot.goal), at) ===
      stamp(j.snapshot.sources, j.snapshot.at) &&
    digest(commercialEvidence(store, j.snapshot.goal.scope)) ===
      digest(j.snapshot.field)
  );
}
function commercialEvidence(store, scope) {
  const lesson = store.fieldLesson(scope);
  if (!lesson.active) return null;
  const candidate = lesson.trials.findLast(
    (t) => t.linked && t.status === "QUALIFIED_IN_SCOPE",
  );
  const receipt =
    candidate &&
    store
      .fieldTrials()
      .find((t) => t.trial === candidate.trial && t.scope === scope);
  return {
    method: lesson.active,
    history: lesson.trials,
    qualified: receipt
      ? {
          trial: receipt.trial,
          mission: receipt.mission,
          currency: "MXN",
          perPairCents: receipt.incrementalNetPerPairCents,
          observedPaidCents: receipt.observedPaidCents,
          completed: receipt.completed,
        }
      : null,
  };
}
function context(s, job, at, store) {
  const { goal: g, cap } = job;
  validateGoal(g);
  if (
    !s.open.permissions.includes("read") ||
    (g.op !== "lookup" && !s.open.permissions.includes("calculate"))
  )
    throw Error("Operación sin permiso");
  integer(cap, 1, s.open.maxJobCents, "reserva");
  const free = s.open.budgetCents - s.spent - s.held;
  if (free < cap) throw Error("Presupuesto disponible insuficiente");
  const team = [],
    sectors = new Set();
  for (const member of ranking(
    s,
    g,
    at,
    store,
    1,
    job.method ?? null,
    job.replica ?? null,
  )) {
    if (team.length === cap) break;
    if (!sectors.has(member.sector)) {
      team.push({ ...member, cap: 1 });
      sectors.add(member.sector);
    }
  }
  let remaining = cap - team.length;
  for (const m of team) {
    const extra = Math.min(remaining, m.free - 1);
    m.cap += extra;
    remaining -= extra;
  }
  if (!team.length || remaining)
    throw Error("Ningún equipo vivo con saldo y capacidad suficientes");
  const worker = team[0];
  const prior = [...s.jobs.values()]
    .reverse()
    .find(
      (j) =>
        j.output &&
        j.snapshot.worker.sector === worker.sector &&
        j.snapshot.goal.scope === g.scope &&
        j.snapshot.goal.op === g.op &&
        at - j.snapshot.at < 30 * 86400000 &&
        j.output.decision.sourcesStamp ===
          stamp(scopeDocs(s, j.snapshot.goal), at),
    );
  const lesson = commercialEvidence(store, g.scope);
  return {
    goal: g,
    at,
    worker,
    team,
    sources: scopeDocs(s, g),
    engine: hash,
    budget: Math.min(
      free - cap,
      team.reduce((n, w) => n + w.free - w.cap, 0),
    ),
    minutes: Math.floor((s.open.until - at) / 60000),
    field: lesson,
    peer: prior
      ? { at: prior.snapshot.at, key: prior.id, hash: prior.resultHash }
      : null,
    states: prior?.output.bandit ?? [],
  };
}
export class GlobalDesk {
  #cache = empty();
  constructor(path, store, { clock = Date.now } = {}) {
    this.store = store;
    this.clock = clock;
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA busy_timeout=10000;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS global_runtime(id TEXT PRIMARY KEY,archive BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS global_events(seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS global_immutable BEFORE UPDATE ON global_events BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS global_keep BEFORE DELETE ON global_events BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TABLE IF NOT EXISTS global_retired(actor INTEGER NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(actor,generation));`);
  }
  close() {
    this.db.close();
  }
  read() {
    return structuredClone(this.#state());
  }
  #state() {
    const s = this.#cache;
    for (const row of this.db
      .prepare("SELECT * FROM global_events WHERE seq>? ORDER BY seq")
      .iterate(s.seq)) {
      const e = JSON.parse(row.body);
      if (
        e.seq !== s.seq + 1 ||
        e.prev !== s.tip ||
        e.key !== row.id ||
        e.at < s.at ||
        digest(e) !== row.hash
      )
        throw Error("Bitácora global alterada");
      apply(s, e);
    }
    return s;
  }
  write(key, input, make) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT body,hash FROM global_events WHERE id=?")
        .get(key);
      const s = this.#state();
      let e;
      if (old) {
        e = JSON.parse(old.body);
        if (e.input !== input) throw Error("Identificador reutilizado");
      } else {
        const at = Math.max(s.at, this.clock());
        const event = make(s, at);
        if (event.kind === "reserve") saveRuntime(this.db);
        e = { seq: s.seq + 1, prev: s.tip, key, input, at, ...event };
        this.db
          .prepare("INSERT INTO global_events VALUES(?,?,?,?)")
          .run(e.seq, key, JSON.stringify(e), digest(e));
        apply(s, e);
        if (e.kind === "open" || e.kind === "settle" || e.kind === "deploy") {
          const retire = this.db.prepare(
            "INSERT OR IGNORE INTO global_retired VALUES(?,?)",
          );
          for (const a of s.actors.values())
            if (a.limit === a.spent) retire.run(a.id, a.generation);
          if (s.spent === s.open.budgetCents) retire.run(0, 0);
        }
      }
      this.db.exec("COMMIT");
      return structuredClone(e);
    } catch (err) {
      this.db.exec("ROLLBACK");
      this.#cache = empty();
      throw err;
    }
  }
  command(envelope) {
    envelope = structuredClone(envelope);
    strict(envelope, ["record", "signature"]);
    const r = envelope.record;
    strict(r, ["protocol", "book", "id", "kind", "data"]);
    token(r.book);
    token(r.id);
    if (r.protocol !== "SEMAR-GLOBAL-1") throw Error("Protocolo incorrecto");
    signedRecord(
      { key: this.store.settlementAuthority() },
      { type: r.kind, ...envelope },
    );
    return this.write(r.id, digest(r), (s, at) => {
      const d = r.data;
      const event = (data) => ({ kind: r.kind, data, authorization: envelope });
      if (r.kind === "open") {
        if (s.open) throw Error("Tesorería ya constituida");
        return event({ ...validateOpen(d, at, this.store), book: r.book });
      }
      if (!s.open || s.open.book !== r.book)
        throw Error("Mandato de otro libro");
      if (d.job && s.aliases.has(d.job) && r.kind !== "refresh")
        throw Error("Usa la entrega original: " + s.aliases.get(d.job));
      const reserve = (
        goal,
        cap,
        method = null,
        parent = null,
        replica = null,
        portfolio = null,
      ) => {
        validateGoal(goal);
        integer(cap, 1, s.open.maxJobCents, "reserva");
        const tip = stamp(scopeDocs(s, goal), at),
          field = commercialEvidence(this.store, goal.scope);
        const found = [...s.jobs.values()].find(
          (j) =>
            j.status !== "CANCELLED" &&
            (j.method ?? null) === method &&
            (replica === null || j.snapshot.worker.id === replica) &&
            digest(j.snapshot.portfolio ?? null) === digest(portfolio) &&
            isCurrent(s, j, at, this.store) &&
            j.snapshot.engine === hash &&
            digest(j.snapshot.goal) === digest(goal) &&
            digest(j.snapshot.field) === digest(field) &&
            stamp(j.snapshot.sources, j.snapshot.at) === tip,
        );
        if (found)
          return {
            kind: "shared",
            data: { job: found.id },
            authorization: envelope,
          };
        return {
          kind: "reserve",
          data: {
            cap,
            method,
            parent,
            snapshot: {
              ...context(s, { goal, cap, method, replica }, at, this.store),
              portfolio,
            },
            runtime: engine,
          },
          authorization: envelope,
        };
      };
      if (r.kind === "settle") {
        strict(d, ["job", "cents", "reference"]);
        const j = byKey(s, d.job);
        integer(d.cents, 0, j.cap, "centavos comprobados");
        label(d.reference, 250);
        if (j.status !== "WORKED" || s.receipts.has(d.reference))
          throw Error("Liquidación duplicada o sin entrega");
        return event(d);
      }
      if (r.kind === "cancel") {
        strict(d, ["job"]);
        if (byKey(s, d.job).status !== "RESERVED")
          throw Error("Reserva sin cancelar");
        return event(d);
      }
      if (r.kind === "feedback") {
        strict(d, ["job", "resultHash", "action", "reference", "until"]);
        const j = byKey(s, d.job);
        if (
          !j.output ||
          j.resultHash !== d.resultHash ||
          s.feedback.has(d.job) ||
          !["ADVANCE", "STOP", "NEED_EVIDENCE"].includes(d.action)
        )
          throw Error("Observación sin decisión comprobable");
        label(d.reference, 250);
        integer(d.until, at + 1, at + 365 * 86400000, "vigencia");
        return event(d);
      }
      active(s, at);
      if (r.kind === "withdraw") {
        strict(d, ["document", "previous", "reason"]);
        label(d.reason, 240);
        const old = unknown(s.docs.get(d.document), "Fuente desconocida");
        if (old.version !== d.previous || old.until <= at)
          throw Error("Fuente caducada");
        return event({
          ...old,
          until: at,
          version: digest([d, at]),
          withdrawn: d.reason,
        });
      }
      if (r.kind === "source") {
        const v = sourceVersion(d),
          old = s.docs.get(v.document.id);
        if (
          v.from > at ||
          v.until <= at ||
          v.previous !== (old?.version ?? null)
        )
          throw Error("Versión o fecha de fuente inválida");
        return event(v);
      }
      if (r.kind === "propose" || r.kind === "examine") {
        if (
          !s.open.permissions.includes("calculate") ||
          !s.open.permissions.includes("read")
        )
          throw Error("Método sin permiso");
        if (r.kind === "propose")
          return event(candidate([...s.docs.values()], d, at));
        const m = unknown(s.methods.get(d.proposal), "Propuesta desconocida");
        if (m.exam || m.candidate.until <= at) throw Error("Examen cerrado");
        return event(methodExam(s, m.candidate, d));
      }
      if (r.kind === "deploy") {
        strict(d, [
          "proposal",
          "birth",
          "sponsor",
          "generation",
          "perAgentCents",
        ]);
        const m = unknown(s.methods.get(d.proposal), "Propuesta desconocida"),
          c = m.candidate;
        const sponsorKey = d.sponsor + "/" + d.generation,
          w = unknown(s.actors.get(sponsorKey), "Patrocinador desconocido");
        integer(
          d.perAgentCents,
          1,
          Math.floor(maxMoney / BATCH),
          "asignación por réplica",
        );
        const cost = d.perAgentCents * BATCH,
          birth = this.store.receipt(d.birth);
        const payer = this.store.agent(d.sponsor);
        if (
          !m.exam?.admitted ||
          methodFailures(s, c).length > 0 ||
          m.deployment ||
          payer.generation !== d.generation ||
          payer.status !== "LIVE" ||
          c.until <= at ||
          c.basis.some(
            ([id, v]) =>
              s.docs.get(id)?.version !== v || s.docs.get(id).until <= at,
          ) ||
          s.open.budgetCents - s.spent - s.held < cost ||
          w.limit - w.spent - w.held < cost ||
          birth?.replicas !== BATCH ||
          birth.last - birth.first + 1 !== BATCH
        )
          throw Error("Falta cohorte certificada, mejora vigente o fondos");
        const members = Array.from({ length: BATCH }, (_, i) => {
          const a = this.store.agent(birth.first + i);
          if (a.status !== "LIVE" || s.actors.has(actorKey(a)))
            throw Error("Cohorte ocupada o retirada");
          return { id: a.id, generation: a.generation, sector: a.sector };
        });
        const op = c.candidate.op,
          certificate = digest([
            selfTest({ policy: "indexed" }, op),
            m.exam,
            c.candidate,
            birth.first,
            birth.last,
          ]);
        return event({ ...d, sponsorKey, members, op, certificate });
      }
      if (r.kind === "reserve-method") {
        strict(
          d,
          Object.hasOwn(d, "replica")
            ? ["proposal", "goal", "cap", "replica"]
            : ["proposal", "goal", "cap"],
        );
        if (
          Object.hasOwn(d, "replica") &&
          ![...s.actors.values()].some(
            (w) => w.id === d.replica && w.requires === d.proposal,
          )
        )
          throw Error("Réplica no habilitada");
        const m = unknown(s.methods.get(d.proposal), "Propuesta desconocida"),
          c = m.candidate;
        validateGoal(d.goal);
        if (
          !m.exam?.admitted ||
          methodFailures(s, c).length > 0 ||
          c.scope !== d.goal.scope ||
          at >= c.until ||
          c.testSubjects.includes(d.goal.subject) ||
          c.examples.some((x) => x.subject === d.goal.subject) ||
          c.basis.some(
            ([id, v]) =>
              s.docs.get(id)?.version !== v || s.docs.get(id).until <= at,
          ) ||
          d.goal.op !== c.candidate.op ||
          digest(d.goal.operands.map((o) => o.field)) !==
            digest(c.candidate.fields) ||
          d.goal.operands.some(
            (o) =>
              digest(c.schema[o.field]) !==
              digest({ unit: o.unit, stage: o.stage }),
          )
        )
          throw Error("Versión no admitida en este contexto");
        return reserve(d.goal, d.cap, d.proposal, null, d.replica ?? null);
      }
      const fromBrief = (brief, cap, parent = null) => {
        integer(cap, 1, s.open.maxJobCents, "reserva");
        if (
          !s.open.permissions.includes("read") ||
          s.open.budgetCents - s.spent - s.held < cap
        )
          throw Error("Plan sin permiso o presupuesto");
        const sources = portfolioSources(s, brief),
          plan = compileBrief(
            brief,
            sources,
            at,
            s.open.permissions.includes("calculate"),
          );
        if (plan.status !== "PLANNED")
          return { kind: "clarify", data: plan, authorization: envelope };
        return reserve(plan.goal, cap, null, parent, null, { brief, sources });
      };
      if (r.kind === "refresh") {
        strict(d, ["job", "cap"]);
        const old = byKey(s, d.job);
        if (old.method) throw Error("Revalida la versión con reserve-method");
        if (!old.output || isCurrent(s, old, at, this.store))
          throw Error("Entrega vigente");
        return old.snapshot.portfolio
          ? fromBrief(old.snapshot.portfolio.brief, d.cap, old.id)
          : reserve(old.snapshot.goal, d.cap, null, old.id);
      }
      if (r.kind === "reserve-brief") {
        strict(d, ["brief", "cap"]);
        return fromBrief(d.brief, d.cap);
      }
      if (r.kind === "reserve") {
        strict(d, ["goal", "cap"]);
        return reserve(d.goal, d.cap);
      }
      throw Error("Acción fuera del ejecutor");
    });
  }
  async work(job) {
    const s = this.#state(),
      j = byKey(s, job);
    job = j.id;
    if (j.output) return structuredClone(j.output);
    if (j.status !== "RESERVED") throw Error("Trabajo sin reserva");
    const check = (s, at) => {
      active(s, at);
      const current = byKey(s, job);
      const staffInvalid = j.snapshot.team.some((w) => {
        const a = this.store.agent(w.id);
        return (
          a.generation !== w.generation ||
          a.status !== "LIVE" ||
          s.actors.get(actorKey(w)).spent >= s.actors.get(actorKey(w)).limit
        );
      });
      const m = current.method
        ? s.methods.get(current.method)?.candidate
        : null;
      if (
        current.method &&
        (!m ||
          m.until <= at ||
          m.basis.some(
            ([id, v]) =>
              s.docs.get(id)?.version !== v || s.docs.get(id).until <= at,
          ))
      )
        throw Error("Método vencido");
      if (!isCurrent(s, j, at, this.store))
        throw Error("Alcance o fuente caducados");
      if (
        current.status !== "RESERVED" ||
        staffInvalid ||
        j.snapshot.engine !== hash ||
        stamp(scopeDocs(s, j.snapshot.goal), at) !==
          stamp(j.snapshot.sources, j.snapshot.at)
      )
        throw Error("Reserva, fuente o ejecutor caducado");
    };
    check(s, Math.max(s.at, this.clock()));
    const output = await executeMission(j.snapshot),
      resultHash = digest(output);
    this.write("@work/" + job, digest([job, j.snapshot]), (state, at) => {
      check(state, at);
      return { kind: "work", data: { job, output, resultHash } };
    });
    return output;
  }
  async delivery(id) {
    await this.work(id);
    const s = this.#state(),
      j = byKey(s, id),
      at = Math.max(s.at, this.clock());
    const decision = structuredClone(j.output.decision);
    const funding =
      s.spent === s.open.budgetCents
        ? "DEAD"
        : expires(s, at)
          ? "EXPIRED"
          : "ACTIVE";
    if (!isCurrent(s, j, at, this.store))
      return {
        job: j.id,
        action: "REVIEW_REQUIRED",
        previousAction: decision.action,
        resultHash: j.resultHash,
        funding,
        next: { action: j.method ? "REVALIDATE_METHOD" : "REFRESH", job: j.id },
      };
    return {
      ...decision,
      job: j.id,
      freshness: "CURRENT",
      resultHash: j.resultHash,
      funding,
    };
  }
  async replay(id) {
    const j = byKey(this.#state(), id);
    if (!j.output) throw Error("Se requiere una entrega");
    const output = archivedExecution(this.db, j);
    if (digest(output) !== j.resultHash) throw Error("Reproducción distinta");
    return {
      job: id,
      verified: true,
      hash: j.resultHash,
      engine: j.snapshot.engine,
      originalNode: j.runtime.node,
      replayNode: engine.node,
    };
  }
  view() {
    return structuredClone(this.summary());
  }
  summary() {
    const s = this.#state();
    if (!s.open) return { status: "UNFUNDED" };
    const now = Math.max(s.at, this.clock());
    return {
      book: s.open.book,
      status:
        s.spent === s.open.budgetCents
          ? "DEAD"
          : expires(s, now)
            ? "EXPIRED"
            : "ACTIVE",
      currency: s.open.currency,
      budgetCents: s.open.budgetCents,
      spentCents: s.spent,
      reservedCents: s.held,
      freeCents: s.open.budgetCents - s.spent - s.held,
      until: s.open.until,
      permissions: s.open.permissions,
      workers: [...s.actors.values()].map((w) => ({
        ...w,
        status:
          s.spent === s.open.budgetCents || w.spent === w.limit
            ? "DEAD"
            : "LIVE",
      })),
      clarifications: [...s.clarifications].map(([id, data]) => ({
        id,
        ...data,
      })),
      shared: [...s.aliases].map(([request, job]) => ({ request, job })),
      methods: [...s.methods].map(([id, m]) => ({
        id,
        scope: m.candidate.scope,
        recipe: m.candidate.candidate,
        exam: m.exam,
        deployment: m.deployment ?? null,
      })),
      jobs: [...s.jobs.values()].map((j) => ({
        id: j.id,
        status: j.status,
        actor: j.snapshot.worker.id,
        operation: j.snapshot.goal.op,
        resultHash: j.resultHash ?? null,
        freshness: isCurrent(s, j, now, this.store)
          ? "CURRENT"
          : "REVIEW_REQUIRED",
        decision: j.output?.decision.action ?? null,
        observed: s.feedback.get(j.id)?.action ?? null,
      })),
      tip: s.tip,
    };
  }
  async audit() {
    const s = empty(),
      authority = this.store.settlementAuthority();
    const verified = [];
    for (const row of this.db
      .prepare("SELECT * FROM global_events ORDER BY seq")
      .iterate()) {
      const e = JSON.parse(row.body);
      if (
        e.seq !== s.seq + 1 ||
        e.prev !== s.tip ||
        e.key !== row.id ||
        e.at < s.at ||
        digest(e) !== row.hash
      )
        throw Error("Bitácora global alterada");
      if (e.kind !== "work") {
        const { record: r, signature } = e.authorization;
        signedRecord(
          { key: authority },
          { type: r.kind, record: r, signature },
        );
        if (
          r.protocol !== "SEMAR-GLOBAL-1" ||
          r.id !== e.key ||
          digest(r) !== e.input ||
          (s.open && s.open.book !== r.book)
        )
          throw Error("Autorización incongruente");
        if (e.kind === "open") {
          const { book, actors, ...terms } = e.data;
          const original = actors.map(({ certificates, ...w }) => w);
          if (
            book !== r.book ||
            digest({ ...terms, actors: original }) !== digest(r.data)
          )
            throw Error("Dotación alterada");
        }
        if (e.kind === "examine") {
          const m = unknown(
            s.methods.get(r.data.proposal),
            "Propuesta ausente",
          );
          if (
            digest(
              Object.hasOwn(e.data, "regressions")
                ? methodExam(s, m.candidate, r.data)
                : examine(m.candidate, r.data),
            ) !== digest(e.data)
          )
            throw Error("Examen alterado");
        }
        if (
          e.kind === "propose" &&
          digest(candidate([...s.docs.values()], r.data, e.at)) !==
            digest(e.data)
        )
          throw Error("Síntesis alterada");
        if (
          e.kind === "source" &&
          digest(sourceVersion(r.data)) !== digest(e.data)
        )
          throw Error("Fuente alterada");
        if (
          ["settle", "cancel", "feedback"].includes(e.kind) &&
          digest(r.data) !== digest(e.data)
        )
          throw Error("Comprobante alterado");
        if (
          e.kind === "reserve" &&
          (e.data.cap !== r.data.cap ||
            e.data.snapshot.at !== e.at ||
            digest(e.data.snapshot.sources) !==
              digest(scopeDocs(s, e.data.snapshot.goal)))
        )
          throw Error("Reserva alterada");
      } else {
        const j = byKey(s, e.data.job);
        if (
          j.status !== "RESERVED" ||
          digest(e.data.output) !== e.data.resultHash ||
          digest(archivedExecution(this.db, j)) !== e.data.resultHash
        )
          throw Error("Entrega irreproducible");
        verified.push(e.data.job);
      }
      apply(s, e);
      if (
        s.spent < 0 ||
        s.held < 0 ||
        s.spent + s.held > s.open.budgetCents ||
        [...s.actors.values()].some(
          (w) => w.spent < 0 || w.held < 0 || w.spent + w.held > w.limit,
        )
      )
        throw Error("Conservación presupuestaria fallida");
    }
    const retirees = s.open
      ? [...s.actors.values()].filter((w) => w.spent === w.limit).map(actorKey)
      : [];
    if (s.open && s.spent === s.open.budgetCents) retirees.push("0/0");
    const actual = this.db
      .prepare("SELECT actor,generation FROM global_retired")
      .all()
      .map((r) => r.actor + "/" + r.generation);
    if (digest(actual.sort()) !== digest(retirees.sort()))
      throw Error("Retiros fuera del libro");
    return {
      status: "VERIFIED",
      events: s.seq,
      tip: s.tip,
      reproduced: verified,
      spentCents: s.spent,
      reservedCents: s.held,
    };
  }
  async regressions() {
    const s = this.#state(),
      cases = [];
    for (const f of s.feedback.values()) {
      const j = byKey(s, f.job);
      const out = await executeMission(j.snapshot);
      cases.push({
        job: j.id,
        was: j.output.decision.action,
        expected: f.action,
        now: out.decision.action,
        passed: out.decision.action === f.action,
      });
    }
    return { cases, failures: cases.filter((c) => !c.passed).length };
  }
}
