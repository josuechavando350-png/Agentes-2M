import { DatabaseSync } from "node:sqlite";
import { token, label } from "./dossiers.mjs";
import { digest, integer, strict } from "./policy.mjs";
import { signedRecord } from "./field-lab.mjs";
import { utc } from "./decision-model.mjs";
import {
  buildDecision,
  gradePlan,
  verdict,
  policyId,
} from "./commercial-decision.mjs";
const contract = (b, n) => [
  b.niche,
  b.mode,
  b.currency,
  b.seats,
  n,
  b.minutes,
  b.minutesPerAccount,
  b.researchCents,
];
export class DecisionBook {
  constructor(path, { clock = Date.now, authority = null } = {}) {
    this.clock = clock;
    this.authority = authority;
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA busy_timeout=10000;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS decision_log(id TEXT NOT NULL,rev INTEGER NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL,parent TEXT NOT NULL,data TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,PRIMARY KEY(id,rev));
   CREATE TRIGGER IF NOT EXISTS decision_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT,'immutable'); END;
   CREATE TRIGGER IF NOT EXISTS decision_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  }
  close() {
    this.db.close();
  }
  history(id) {
    token(id);
    let parent = "";
    return this.db
      .prepare("SELECT * FROM decision_log WHERE id=? ORDER BY rev")
      .all(id)
      .map((r, i) => {
        const data = JSON.parse(r.data),
          hash = digest([id, i, r.kind, r.at, parent, data]);
        if (r.rev !== i || r.parent !== parent || hash !== r.hash)
          throw Error("Bitácora alterada");
        parent = hash;
        return { kind: r.kind, rev: i, at: r.at, hash, data };
      });
  }
  latest(id) {
    const e = this.history(id).at(-1);
    if (!e) throw Error("Registro desconocido");
    return e;
  }
  append(id, rev, parent, kind, data, deadline = Infinity) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.history(id),
        old = rows[rev];
      if (
        old &&
        old.kind === kind &&
        old.hash === digest([id, rev, kind, old.at, parent, data])
      ) {
        this.db.exec("COMMIT");
        return old;
      }
      const at = Math.max(this.clock(), rows.at(-1)?.at ?? 0);
      if (
        at > deadline ||
        rows.length !== rev ||
        (rows.at(-1)?.hash ?? "") !== parent
      )
        throw Error("Corte vencido o revisión caducada");
      const hash = digest([id, rev, kind, at, parent, data]);
      this.db
        .prepare("INSERT INTO decision_log VALUES(?,?,?,?,?,?,?)")
        .run(id, rev, kind, at, parent, JSON.stringify(data), hash);
      this.db.exec("COMMIT");
      return { kind, rev, at, hash, data };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  register(reg) {
    strict(reg, ["id", "mode", "selection", "cohorts"]);
    token(reg.id);
    label(reg.selection, 250);
    if (
      !["HISTORICAL", "PROSPECTIVE"].includes(reg.mode) ||
      !Array.isArray(reg.cohorts) ||
      !reg.cohorts.length ||
      new Set(reg.cohorts.map((c) => c.id)).size !== reg.cohorts.length
    )
      throw Error("Serie inválida");
    for (const c of reg.cohorts) {
      strict(c, ["id", "briefHash", "accounts", "cutoff"]);
      token(c.id);
      utc(c.cutoff);
      integer(c.accounts, 2, 4096, "cuentas");
      if (!/^[0-9a-f]{64}$/.test(c.briefHash) || c.id === reg.id)
        throw Error("Contrato inválido");
    }
    const old = this.history(reg.id)[0];
    if (old && old.kind === "REGISTERED" && digest(old.data) === digest(reg))
      return old;
    if (reg.cohorts.some((c) => this.history(c.id).length))
      throw Error("Cohorte ya iniciada");
    return this.append(
      reg.id,
      0,
      "",
      "REGISTERED",
      reg,
      reg.mode === "PROSPECTIVE"
        ? Math.min(...reg.cohorts.map((c) => utc(c.cutoff)))
        : Infinity,
    );
  }
  expiry(b) {
    return b.mode === "PROSPECTIVE" ? utc(b.cutoff) : Infinity;
  }
  internalCalibration(b, m) {
    const ids = this.db
        .prepare("SELECT DISTINCT id FROM decision_log WHERE kind='GRADED'")
        .all(),
      previous = ids
        .map((x) => this.latest(x.id).data.result)
        .filter(
          (r) =>
            r.policy === policyId &&
            r.brief.merchant === b.merchant &&
            r.brief.niche === b.niche &&
            r.brief.mode === b.mode &&
            utc(r.asOf) <= utc(b.cutoff),
        );
    if (!previous.length) return null;
    const bins = previous[0].scores[m].bins.map((x, i) => ({
      ...x,
      cases: previous.reduce((n, r) => n + r.scores[m].bins[i].cases, 0),
      bought: previous.reduce((n, r) => n + r.scores[m].bins[i].bought, 0),
    }));
    return { bins, seals: previous.map((r) => r.seal).sort() };
  }
  start(layout, series, input, release = null) {
    const b = input.brief,
      reg = this.latest(series);
    if (
      reg.kind !== "REGISTERED" ||
      !reg.data.cohorts.some(
        (c) =>
          c.id === b.id &&
          c.cutoff === b.cutoff &&
          c.briefHash === digest(b) &&
          c.accounts === input.packet.queries.length,
      ) ||
      reg.data.mode !== b.mode
    )
      throw Error("Mandato distinto al prerregistro");
    const old = this.history(b.id)[0];
    if (old) {
      if (
        old.data.plan.source !== digest(input) ||
        old.data.series !== series ||
        old.data.release !== release
      )
        throw Error("Campaña ya iniciada");
      return old;
    }
    if (b.mode === "PROSPECTIVE" && !this.authority)
      throw Error("Registra la clave de tesorería");
    let method = "incumbent";
    if (release) {
      const approved = this.verdict(release),
        reports = approved.cohorts.map((x) => this.latest(x.id).data.result);
      const ids = new Set(input.packet.queries.map((r) => r.id));
      if (
        approved.status !== "QUALIFIED_IN_SCOPE" ||
        approved.niche !== b.niche ||
        reports.some(
          (r) =>
            utc(r.asOf) > utc(b.cutoff) ||
            r.accounts.some((id) => ids.has(id)) ||
            digest(contract(r.brief, r.accounts.length)) !==
              digest(contract(b, ids.size)),
        )
      )
        throw Error("Promoción fuera de alcance");
      method = "challenger";
    }
    const local = this.internalCalibration(b, method),
      plan = buildDecision(layout, input, method, [], local);
    return this.append(
      b.id,
      0,
      "",
      "PLAN",
      {
        input,
        plan,
        series,
        release,
        layout,
        local,
        authority: b.mode === "PROSPECTIVE" ? this.authority : null,
      },
      this.expiry(b),
    );
  }
  authenticate(first, kind, id, anchor, data, signature) {
    if (first.data.authority)
      signedRecord(
        { key: first.data.authority },
        { type: kind, record: { kind, id, anchor, data }, signature },
      );
  }
  answer(layout, id, a, signature = null) {
    strict(a, [
      "previous",
      "probe",
      "branch",
      "observedAt",
      "source",
      "reference",
    ]);
    label(a.reference, 250);
    label(a.source, 250);
    const events = this.history(id),
      old = events.at(-1);
    if (!old) throw Error("Campaña desconocida");
    this.authenticate(events[0], "answer", id, a.previous, a, signature);
    const replay = events.find(
      (e) => e.kind === "ANSWER" && digest(e.data.answer) === digest(a),
    );
    if (replay) return replay;
    if (!["PLAN", "ANSWER"].includes(old.kind) || old.hash !== a.previous)
      throw Error("Revisión caducada o lista sellada");
    const plan = old.data.plan,
      b = plan.brief,
      q = plan.queue.find((v) => v.id === a.probe && v.status === "VERIFY");
    if (
      !q ||
      q.source !== a.source ||
      !["ORIGINAL", "ALTERNATIVE", "UNRESOLVED"].includes(a.branch) ||
      utc(a.observedAt) > Math.min(utc(b.cutoff), this.clock()) ||
      plan.answers.some((x) => x.reference === a.reference) ||
      (events[0].data.layout ?? layout).checkpoint !== plan.checkpoint
    )
      throw Error("Aclaración inválida");
    const next = buildDecision(
      events[0].data.layout ?? layout,
      events[0].data.input,
      plan.method,
      [...plan.answers, a],
      events[0].data.local,
      plan,
    );
    return this.append(
      id,
      old.rev + 1,
      old.hash,
      "ANSWER",
      { answer: a, signature, plan: next },
      this.expiry(b),
    );
  }
  seal(id, previous) {
    const events = this.history(id),
      sealed = events.find((e) => e.kind === "SEALED");
    if (sealed) {
      if (sealed.data.previous !== previous)
        throw Error("Otra lista ya sellada");
      return sealed;
    }
    const old = events.at(-1);
    if (!old || old.hash !== previous || !["PLAN", "ANSWER"].includes(old.kind))
      throw Error("Revisión caducada");
    return this.append(
      id,
      old.rev + 1,
      old.hash,
      "SEALED",
      { previous, planHash: digest(old.data.plan) },
      this.expiry(old.data.plan.brief),
    );
  }
  sealed(id) {
    const e = this.history(id),
      s = e.find((x) => x.kind === "SEALED");
    if (!s) throw Error("Lista sin sellar");
    const plan = e[s.rev - 1].data.plan;
    if (digest(plan) !== s.data.planHash) throw Error("Lista alterada");
    return { seal: s.hash, plan };
  }
  grade(id, hash, actual, trials = [], signature = null) {
    const { seal, plan } = this.sealed(id);
    if (seal !== hash || utc(actual.asOf) > this.clock())
      throw Error("Sello o fecha inválidos");
    this.authenticate(
      this.history(id)[0],
      "outcomes",
      id,
      seal,
      actual,
      signature,
    );
    const spec = plan.brief.trial,
      t = spec
        ? trials.find((t) => t.trial === spec.id && t.mission === spec.mission)
        : null,
      result = gradePlan(plan, actual, t);
    const old = this.latest(id);
    if (old.kind === "GRADED") {
      const r = old.data.result;
      if (
        r.outcomesHash !== result.outcomesHash ||
        r.source !== result.source ||
        r.asOf !== result.asOf
      )
        throw Error("Resultados distintos para una reserva abierta");
      if (digest(r.margin) === digest(result.margin)) return old;
    }
    return this.append(id, old.rev + 1, old.hash, "GRADED", {
      result,
      actual,
      signature,
    });
  }
  verdict(series) {
    const reg = this.latest(series);
    if (reg.kind !== "REGISTERED") throw Error("Serie inexistente");
    return verdict(
      reg.data.cohorts.map((c) => {
        const e = this.latest(c.id);
        if (e.kind !== "GRADED" || this.history(c.id)[0].data.series !== series)
          throw Error("Examen incompleto");
        return e.data.result;
      }),
    );
  }
}
