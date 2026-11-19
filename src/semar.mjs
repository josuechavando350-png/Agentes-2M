import { createPublicKey, verify } from "node:crypto";
import {
  canonical,
  digest,
  integer,
  strict,
  validateTask,
  initialSkills,
  OPS,
  oracle,
  compute,
  healthExam,
  CAP,
  INITIAL,
  STIPEND,
  BATCH,
  LEADERS,
  SECTORS,
} from "./policy.mjs";
import { getAgent, statusOf, Ledger } from "./ledger.mjs";
import { infer, verifyDerivation, examCase } from "./inference.mjs";
import { experiment, runTree, scenario, policyManifest } from "./induction.mjs";
import { census } from "./census.mjs";
import { deliberate } from "./nexus.mjs";

function pack(sector, steps, result) {
  return { sector, steps, result };
}
const notice = (reason) => ({ kind: "notice", reason });
function live(state, id, generation, version) {
  const a = getAgent(state, id);
  if (
    a.status !== "LIVE" ||
    a.generation !== generation ||
    a.version !== version
  )
    throw Error("Identidad muerta o versión caducada");
  return a;
}
function peerLesson(state, op, a) {
  return [...(state.lessons.get(op)?.values() ?? [])]
    .reverse()
    .find((x) => x.agentId !== a.id);
}
function fitnessCertificate(seed, skills, index) {
  const raw = Buffer.from(digest({ seed, index }), "hex");
  const sample = Array.from(
    raw.subarray(0, 1 + (raw[31] % 12)),
    (x) => x - 128,
  );
  for (const op of skills) {
    const input = op === "inference" ? examCase(sample) : sample;
    if (compute(op, input) !== oracle(op, input))
      throw Error("Salud rechazó réplica " + index);
  }
  return digest({ index, skills, sample });
}
export function birthCounts(population) {
  integer(population, INITIAL, CAP, "población");
  const count = Math.min(BATCH, CAP - population);
  return { count, standby: BATCH - count };
}
function cohortProposal(state, a, op, peer, key) {
  if (!peer || peer.op !== op || peer.agentId === a.id)
    throw Error("Falta lección externa auditada");
  if (a.skills.includes(op)) throw Error("La capacidad ya está presente");
  const { count, standby } = birthCounts(state.population);
  if (count === 0) return { blocked: "CAP_REACHED" };
  if (state.treasury < count * STIPEND) return { blocked: "RESERVE_TOO_LOW" };
  const skills = [...a.skills, op].sort(),
    version = a.version + 1;
  const seed = digest({
    key,
    member: a.id,
    generation: a.generation,
    version,
    peer: peer.hash,
    tip: state.tip,
  });
  const exam = healthExam(a.skills, skills, seed);
  const certificates = Array.from({ length: BATCH }, (_, i) =>
    fitnessCertificate(seed, skills, i),
  );
  const band = {
    kind: "cohort",
    sector: a.sector,
    lo: state.population + 1,
    hi: state.population + count,
    standby,
    skills,
    version,
    seed,
    certificates: digest(certificates),
    exam,
    source: peer.key,
    parent: a.id,
    ...(a.programs ? { programs: a.programs } : {}),
    gates: ["SALUD:aptitud", "SEMAR:infantería-integridad", "SEMAR:oráculo"],
  };
  return { band };
}
function member(a, spent = 0, other = {}) {
  return { kind: "agent", agent: a, spent, ...other };
}
function debit(a, steps) {
  a.balance--;
  if (a.balance === 0) {
    a.status = "DEAD";
    a.publicKey = null;
    steps.push(member({ ...a }, 1, { deadDelta: 1 }));
    return {
      status: "DEAD_ZERO",
      id: a.id,
      generation: a.generation,
      balance: 0,
    };
  }
  steps.push(member({ ...a }, 1));
  return null;
}
function signed(body, sig, key) {
  if (!key || typeof sig !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(sig))
    return false;
  try {
    return verify(
      null,
      Buffer.from(canonical(body)),
      key,
      Buffer.from(sig, "base64"),
    );
  } catch {
    return false;
  }
}

export class Semar {
  #journal;
  constructor(path) {
    this.#journal = new Ledger(path);
  }
  close() {
    this.#journal.close();
  }
  checkpoint() {
    const state = this.#journal.read();
    this.audit(state.tip);
    return { events: state.events, tip: state.tip };
  }
  restore(events, tip) {
    return this.#journal.restore(events, tip, (anchor) => this.audit(anchor));
  }
  receipt(key) {
    return this.#journal.read().keys.get(key)?.result ?? null;
  }
  status() {
    return statusOf(this.#journal.read());
  }
  census(first, last) {
    return census(this.#journal.read(), first, last);
  }
  agent(id) {
    return getAgent(this.#journal.read(), id);
  }
  feed(leader, after = 0, limit = 100) {
    if (!LEADERS.includes(leader)) throw Error("Líder desconocido");
    integer(after, 0, Number.MAX_SAFE_INTEGER, "cursor");
    integer(limit, 1, 1000, "límite");
    return this.#journal
      .read()
      .events.filter((e) => e.seq > after && e.route.readers.includes(leader))
      .slice(0, limit)
      .map((e) => ({
        seq: e.seq,
        key: e.key,
        at: e.at,
        route: e.route,
        result: e.result,
      }));
  }
  async command(key, input) {
    const c = structuredClone(input);
    return this.#journal.dispatch(
      key,
      c,
      async (state) => {
        if (c.type === "init") {
          strict(c, ["type", "reserve"]);
          integer(c.reserve, 0, CAP * STIPEND, "reserva");
          if (state.population) throw Error("El padrón ya existe");
          return pack(
            1,
            [{ kind: "genesis", size: INITIAL, reserve: c.reserve }],
            { status: "INITIALIZED", population: INITIAL, reserve: c.reserve },
          );
        }
        if (!state.population) throw Error("Inicializa el padrón");
        if (c.type === "reserve_births") {
          strict(c, ["type"]);
          if (state.hasEndowment)
            throw Error("Dotación de incubación ya constituida");
          const amount = Math.max(
            0,
            (CAP - state.population) * STIPEND - state.treasury,
          );
          return pack(1, [{ kind: "birth_endowment", amount }], {
            status: "RESERVED",
            amount,
            unit: "créditos de simulación para nuevas identidades",
          });
        }
        if (c.type === "council") {
          strict(c, ["type", "sector", "op"]);
          integer(c.sector, 1, 10, "sector");
          if (!OPS.includes(c.op)) throw Error("Método desconocido");
          const replies = LEADERS.map((leader, i) => ({
            leader,
            sector: SECTORS[i],
            base: initialSkills(i + 1).includes(c.op),
            teacher:
              [...(state.lessons.get(c.op)?.values() ?? [])]
                .reverse()
                .find((v) => v.sector === i + 1)?.key ?? null,
          }));
          return pack(c.sector, [notice("consulta de capacidades")], {
            status: "COUNCIL",
            from: "L" + c.sector,
            to: "L1",
            op: c.op,
            replies,
          });
        }
        let priorCase;
        if (c.type === "recall") {
          strict(c, ["type", "id", "generation", "version", "from", "query"]);
          const lesson = state.keys
            .get(c.from)
            ?.steps.find((s) => s.kind === "lesson" && s.op === "inference");
          if (!lesson) throw Error("Expediente previo sin dictamen");
          priorCase = c.from;
          c.type = "work";
          c.op = "inference";
          c.data = { ...lesson.data, query: c.query };
          delete c.from;
          delete c.query;
        }
        const a = live(state, c.id, c.generation, c.version);
        if (c.type === "synthesize") {
          strict(c, [
            "type",
            "id",
            "generation",
            "version",
            "from",
            "features",
          ]);
          const sample = state.keys
            .get(c.from)
            ?.steps.find((s) => s.kind === "lesson" && s.op === "inference");
          if (
            !sample ||
            sample.agentId === a.id ||
            !a.skills.includes("inference")
          )
            throw Error(
              "Se requiere inferencia y evidencia auditada de otro agente",
            );
          const steps = [],
            death = debit(a, steps);
          if (death) return pack(a.sector, steps, death);
          const trial = experiment(sample.data, c.features);
          if (!trial.accepted)
            return pack(a.sector, steps, {
              status: "REJECTED_HYPOTHESIS",
              id: a.id,
              exam: trial.exam,
            });
          if (a.programs?.some((p) => p.id === trial.policy.id))
            return pack(a.sector, steps, { status: "KNOWN", id: a.id });
          const { count, standby } = birthCounts(state.population);
          if (!count || state.treasury < count * STIPEND)
            return pack(a.sector, steps, {
              status: count ? "RESERVE_TOO_LOW" : "CAP_REACHED",
              id: a.id,
            });
          const program = { ...trial.policy, source: c.from };
          a.programs = [...(a.programs ?? []), program];
          a.version++;
          const seed = digest({
            key,
            tip: state.tip,
            program: program.id,
            version: a.version,
          });
          const band = {
            kind: "cohort",
            sector: a.sector,
            parent: a.id,
            skills: a.skills,
            version: a.version,
            lo: state.population + 1,
            hi: state.population + count,
            standby,
            seed,
            program,
            programs: a.programs,
            source: c.from,
            exam: trial.exam,
            certificates: policyManifest(program, seed),
          };
          steps.push(member({ ...a }), band);
          return pack(a.sector, steps, {
            status: "EVOLVED",
            id: a.id,
            version: a.version,
            program: program.id,
            exam: trial.exam,
            replicas: BATCH,
            first: band.lo,
            last: band.hi,
          });
        }
        let predictor, mask;
        if (c.type === "predict") {
          strict(c, ["type", "id", "generation", "version", "program", "mask"]);
          predictor = a.programs?.find((p) => p.id === c.program);
          if (!predictor)
            throw Error("Programa no acreditado para esta identidad");
          const sample = state.keys
            .get(predictor.source)
            .steps.find((s) => s.kind === "lesson" && s.op === "inference");
          mask = c.mask;
          priorCase = predictor.source;
          c.type = "work";
          c.op = "inference";
          c.data = scenario(sample.data, predictor.vars, mask);
          delete c.program;
          delete c.mask;
        }
        if (c.type === "register") {
          strict(c, ["type", "id", "generation", "version", "publicKey"]);
          const keyObj = createPublicKey(c.publicKey);
          if (keyObj.asymmetricKeyType !== "ed25519" || a.publicKey)
            throw Error("Clave inválida o ya asignada");
          a.publicKey = keyObj
            .export({ format: "pem", type: "spki" })
            .toString();
          return pack(a.sector, [member(a)], {
            status: "REGISTERED",
            id: a.id,
          });
        }
        const base = ["type", "id", "generation", "version", "op"];
        if (c.type === "learn") strict(c, base);
        else if (c.type === "work") strict(c, [...base, "data"]);
        else if (c.type === "submit")
          strict(c, [...base, "data", "value", "signature"]);
        else throw Error("Comando desconocido");
        if (!OPS.includes(c.op)) throw Error("Método desconocido");
        if (c.type !== "learn") validateTask(c.op, c.data);
        if (c.type === "submit") {
          const { signature, ...packet } = c;
          if (!signed({ key, packet }, signature, a.publicKey)) {
            return pack(a.sector, [notice("firma no válida")], {
              status: "INVALID_SIGNATURE",
              id: a.id,
            });
          }
        }
        const steps = [],
          death = debit(a, steps);
        if (death) return pack(a.sector, steps, death);
        const peer = peerLesson(state, c.op, a);
        let mutation;
        if (!a.skills.includes(c.op)) {
          if (!peer || c.type === "submit")
            return pack(a.sector, steps, {
              status: "NEEDS_TRAINING",
              id: a.id,
              op: c.op,
            });
          const proposed = cohortProposal(state, a, c.op, peer, key);
          if (proposed.blocked)
            return pack(a.sector, steps, {
              status: proposed.blocked,
              id: a.id,
            });
          mutation = proposed.band;
          a.skills = mutation.skills;
          a.version = mutation.version;
          steps.push(member({ ...a }), mutation);
        }
        if (c.type === "learn")
          return pack(a.sector, steps, {
            status: mutation ? "EVOLVED" : "KNOWN",
            id: a.id,
            version: a.version,
            ...(mutation
              ? {
                  replicas: BATCH,
                  first: mutation.lo,
                  last: mutation.hi,
                  standby: mutation.standby,
                  exam: mutation.exam,
                }
              : {}),
          });
        let submission;
        if (c.type === "submit") {
          const { signature, ...packet } = c;
          submission = { key, packet, signature, publicKey: a.publicKey };
          steps.push({ kind: "notice", submission });
        }
        const expected = oracle(c.op, c.data);
        const value = predictor
          ? runTree(predictor.tree, mask)
          : c.type === "submit"
            ? c.value
            : compute(c.op, c.data);
        if (value !== expected) {
          const old = a.generation;
          const replacement = { ...a, generation: old + 1, publicKey: null };
          steps.push(
            member(replacement),
            notice("infantería revocó la generación " + old),
          );
          return pack(a.sector, steps, {
            status: "REPLACED",
            id: a.id,
            revokedGeneration: old,
            generation: replacement.generation,
            balance: replacement.balance,
            expected,
            received: value,
            op: c.op,
            data: c.data,
          });
        }
        const derivation = c.op === "inference" ? infer(c.data) : null;
        if (derivation) verifyDerivation(c.data, derivation);
        const proof = await deliberate({
          sector: a.sector,
          key,
          op: c.op,
          data: c.data,
          value,
          peer,
          states: state.bandits.get(a.sector) ?? [],
          now: Date.now(),
        });
        if (
          !proof.verdicts.every((v) => v.verdict === "ACCEPT") ||
          proof.evidenceDigest !== digest({ op: c.op, data: c.data })
        )
          throw Error("SEMAR bloqueó la entrega");
        const { states, ...report } = proof;
        steps.push({
          kind: "lesson",
          teacher: a.id + "@" + a.generation,
          agentId: a.id,
          sector: a.sector,
          op: c.op,
          data: c.data,
          value,
          states,
        });
        return pack(a.sector, steps, {
          status: "APPROVED",
          id: a.id,
          generation: a.generation,
          version: a.version,
          balance: a.balance,
          op: c.op,
          value,
          ...report,
          ...(derivation
            ? { proof: derivation.proof, caseSource: priorCase ?? key }
            : {}),
          ...(predictor ? { program: predictor.id, mask } : {}),
          peer: peer?.key ?? null,
          ...(mutation
            ? { replicas: BATCH, first: mutation.lo, last: mutation.hi }
            : {}),
        });
      },
      () => this.audit(),
    );
  }
  audit(expectedTip) {
    const state = this.#journal.read();
    if (expectedTip !== undefined && state.tip !== expectedTip)
      throw Error("Ancla externa diferente");
    let admitted = 0,
      deliveries = 0,
      issued = 0,
      initialReserve = 0;
    const prior = { population: 0, agents: new Map(), bands: [] };
    for (const e of state.events) {
      const cohort = e.steps.find((s) => s.kind === "cohort");
      const author = e.steps.find((s) => s.submission)?.submission;
      if (e.steps.filter((s) => s.kind === "agent" && s.spent).length > 1)
        throw Error("Cargo duplicado");
      for (const s of e.steps) {
        if (s.kind === "birth_endowment") initialReserve += s.amount;
        if (s.kind === "genesis") {
          initialReserve = s.reserve;
          prior.population = s.size;
        }
        if (s.kind === "agent") {
          const next = s.agent,
            previous = getAgent(prior, next.id),
            expected = { ...previous };
          if (
            previous.status !== "LIVE" ||
            next.sector !== previous.sector ||
            e.route.origin !== "L" + next.sector
          )
            throw Error("Transición de identidad inválida");
          if (s.spent === 1) {
            expected.balance--;
            if (expected.balance === 0) {
              expected.status = "DEAD";
              expected.publicKey = null;
            }
            if ((s.deadDelta ?? 0) !== Number(expected.balance === 0))
              throw Error("Baja inconsistente");
          } else if (e.result.status === "REGISTERED" && !previous.publicKey) {
            if (createPublicKey(next.publicKey).asymmetricKeyType !== "ed25519")
              throw Error("Clave de agente inválida");
            expected.publicKey = next.publicKey;
          } else if (e.result.status === "REPLACED") {
            validateTask(e.result.op, e.result.data);
            if (
              oracle(e.result.op, e.result.data) !== e.result.expected ||
              e.result.expected === e.result.received ||
              (author && previous.publicKey !== author.publicKey)
            )
              throw Error("Baja sin causa comprobada");
            expected.generation++;
            expected.publicKey = null;
          } else if (cohort?.parent === next.id) {
            if (cohort.program) {
              if (
                previous.programs?.some((p) => p.id === cohort.program.id) ||
                !previous.skills.includes("inference")
              )
                throw Error("Programa duplicado o sin base");
              expected.programs = [
                ...(previous.programs ?? []),
                cohort.program,
              ];
            } else {
              const skill = state.keys.get(cohort.source)?.result.op;
              if (!skill || previous.skills.includes(skill))
                throw Error("Mejora sin novedad");
              expected.skills = [...previous.skills, skill].sort();
            }
            expected.version++;
          } else throw Error("Transición sin autoridad");
          if (digest(expected) !== digest(next) || s.reserveDelta)
            throw Error("Cambio de agente fuera de política");
          prior.agents.set(next.id, next);
        }
        if (s.submission) {
          const { key, packet, signature, publicKey } = s.submission;
          if (key !== e.key || !signed({ key, packet }, signature, publicKey))
            throw Error("Firma inválida en auditoría");
        }
        if (s.kind === "lesson") {
          validateTask(s.op, s.data);
          if (
            oracle(s.op, s.data) !== s.value ||
            e.result.value !== s.value ||
            e.result.status !== "APPROVED" ||
            e.result.evidenceDigest !== digest({ op: s.op, data: s.data }) ||
            !e.result.verdicts.every((v) => v.verdict === "ACCEPT")
          )
            throw Error("Entrega inconsistente");
          if (s.op === "inference")
            verifyDerivation(s.data, { value: s.value, proof: e.result.proof });
          const teacher = getAgent(prior, s.agentId);
          if (
            teacher.status !== "LIVE" ||
            !teacher.skills.includes(s.op) ||
            teacher.version !== e.result.version ||
            teacher.sector !== s.sector ||
            teacher.generation !== e.result.generation ||
            e.result.verdicts.map((v) => v.role).join() !==
              "PLANNER,CRITIC,VERIFIER"
          )
            throw Error("Entrega de origen inválido");
          if (e.result.program) {
            const p = teacher.programs?.find((r) => r.id === e.result.program);
            const origin = state.keys
              .get(p?.source)
              ?.steps.find((x) => x.kind === "lesson" && x.op === "inference");
            if (
              !p ||
              !origin ||
              runTree(p.tree, e.result.mask) !== s.value ||
              digest(scenario(origin.data, p.vars, e.result.mask)) !==
                digest(s.data)
            )
              throw Error("Inferencia sin programa certificado");
          }
          deliveries++;
        }
        if (s.kind === "cohort") {
          const source = state.keys.get(s.source);
          if (
            !source ||
            source.seq >= e.seq ||
            source.result.status !== "APPROVED" ||
            source.result.id === s.parent ||
            !s.skills.includes(source.result.op)
          )
            throw Error("Linaje inválido");
          if (s.program) {
            const lesson = source.steps.find(
              (x) => x.kind === "lesson" && x.op === "inference",
            );
            if (!lesson || s.program.source !== s.source)
              throw Error("Fuente de síntesis inválida");
            const trial = experiment(lesson.data, s.program.vars);
            if (
              !trial.accepted ||
              digest({ ...trial.policy, source: s.source }) !==
                digest(s.program) ||
              digest(trial.exam) !== digest(s.exam) ||
              policyManifest(s.program, s.seed) !== s.certificates
            )
              throw Error("Programa rechazado en auditoría");
          } else {
            const before = s.skills.filter((x) => x !== source.result.op);
            if (digest(healthExam(before, s.skills, s.seed)) !== digest(s.exam))
              throw Error("Examen alterado");
            const manifest = Array.from({ length: BATCH }, (_, i) =>
              fitnessCertificate(s.seed, s.skills, i),
            );
            if (digest(manifest) !== s.certificates)
              throw Error("Certificación de cohorte inválida");
          }
          const parent = getAgent(prior, s.parent);
          if (
            parent.sector !== s.sector ||
            parent.version !== s.version ||
            digest(parent.programs ?? []) !== digest(s.programs ?? []) ||
            digest(parent.skills) !== digest(s.skills)
          )
            throw Error("Cohorte sin progenitor aprobado");
          prior.population = s.hi;
          prior.bands.push(s);
          admitted += s.hi - s.lo + 1;
          issued += BATCH;
        }
      }
    }
    const balances =
      (state.population - state.agents.size) * STIPEND +
      [...state.agents.values()].reduce((n, a) => n + a.balance, 0);
    if (
      state.population &&
      (INITIAL + admitted !== state.population ||
        balances + state.spent + state.treasury !==
          INITIAL * STIPEND + initialReserve)
    )
      throw Error("Conservación fallida");
    return {
      status: "VERIFIED",
      deliveries,
      replicaCertificates: issued,
      registeredReplicas: admitted,
      events: state.events.length,
      tip: state.tip,
    };
  }
}
