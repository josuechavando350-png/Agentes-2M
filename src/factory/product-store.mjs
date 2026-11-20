import { DatabaseSync } from "node:sqlite";
import { check, hash, key } from "./reader.mjs";
import { inputCase, runProduct, validateRelease } from "./product.mjs";
// Original input documents remain immutable. Views can be rebuilt with any installed release.
export class ProductStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active(slot INTEGER PRIMARY KEY CHECK(slot=1),version TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facts(seq INTEGER PRIMARY KEY,request TEXT UNIQUE NOT NULL,subject TEXT NOT NULL,previous TEXT,body TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS fact_subject ON facts(subject,seq);
      CREATE TABLE IF NOT EXISTS results(version TEXT,seq INTEGER,body TEXT NOT NULL,PRIMARY KEY(version,seq));
      CREATE TRIGGER IF NOT EXISTS immutable_facts BEFORE UPDATE ON facts BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS keep_facts BEFORE DELETE ON facts BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  }
  close() {
    this.db.close();
  }
  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = work();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  switch(version, release = null) {
    return this.transaction(() => {
      if (release) {
        validateRelease(release);
        check(hash(release) === version, "Versión alterada");
        this.db
          .prepare("INSERT OR IGNORE INTO releases VALUES(?,?)")
          .run(version, JSON.stringify(release));
      }
      const saved = this.db
        .prepare("SELECT body FROM releases WHERE id=?")
        .get(version);
      check(saved, "Versión desconocida");
      const target = JSON.parse(saved.body);
      check(hash(target) === version, "Versión almacenada alterada");
      const pending = this.db
        .prepare(
          "SELECT f.* FROM facts f LEFT JOIN results r ON r.seq=f.seq AND r.version=? WHERE r.seq IS NULL ORDER BY f.seq",
        )
        .all(version);
      for (const f of pending) {
        const input = JSON.parse(f.body);
        check(hash([f.previous, input]) === f.digest, "Original alterado");
        this.db
          .prepare("INSERT INTO results VALUES(?,?,?)")
          .run(version, f.seq, JSON.stringify(runProduct(target, input)));
      }
      this.db
        .prepare(
          "INSERT INTO active VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET version=excluded.version",
        )
        .run(version);
      return {
        version,
        replayed: pending.length,
        records: this.db.prepare("SELECT count(*) n FROM facts").get().n,
      };
    });
  }
  append({ request, previous, input }) {
    key(request);
    return this.transaction(() => {
      const a = this.db
        .prepare("SELECT r.* FROM active a JOIN releases r ON r.id=a.version")
        .get();
      check(a, "Sin producto activo");
      const release = JSON.parse(a.body);
      check(hash(release) === a.id, "Producto activo alterado");
      const id = key(inputCase(input).id),
        digest = hash([previous, input]);
      const old = this.db
        .prepare("SELECT * FROM facts WHERE request=?")
        .get(request);
      if (old) {
        check(old.digest === digest, "Clave de operación reutilizada");
        return {
          seq: old.seq,
          digest,
          version: a.id,
          result: JSON.parse(
            this.db
              .prepare("SELECT body FROM results WHERE version=? AND seq=?")
              .get(a.id, old.seq).body,
          ),
        };
      }
      check(
        (this.db
          .prepare(
            "SELECT digest FROM facts WHERE subject=? ORDER BY seq DESC LIMIT 1",
          )
          .get(id)?.digest ?? null) === previous,
        "Revisión caducada",
      );
      const output = runProduct(release, input);
      const seq = Number(
        this.db
          .prepare(
            "INSERT INTO facts(request,subject,previous,body,digest) VALUES(?,?,?,?,?)",
          )
          .run(request, id, previous, JSON.stringify(input), digest)
          .lastInsertRowid,
      );
      this.db
        .prepare("INSERT INTO results VALUES(?,?,?)")
        .run(a.id, seq, JSON.stringify(output));
      return { seq, digest, version: a.id, result: output };
    });
  }
  history() {
    return this.db
      .prepare(
        "SELECT f.seq,f.request,f.subject,f.digest,r.version,r.body FROM facts f JOIN active a ON a.slot=1 JOIN results r ON r.version=a.version AND r.seq=f.seq ORDER BY f.seq",
      )
      .all()
      .map(({ body, ...x }) => ({ ...x, result: JSON.parse(body) }));
  }
}
