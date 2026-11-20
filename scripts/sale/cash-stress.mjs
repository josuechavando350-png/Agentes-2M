import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { Semar } from "../../src/semar.mjs";
import { GlobalDesk } from "../../src/global-desk.mjs";
import { pilotBook } from "./pilot.mjs";
import { hash } from "../../src/factory/reader.mjs";

const [mode, path, argument] = process.argv.slice(2),
  self = fileURLToPath(import.meta.url);
if (mode === "writer") {
  const { at, message } = JSON.parse(readFileSync(argument));
  const store = new Semar(path, { clock: () => at }),
    desk = new GlobalDesk(path, store, { clock: () => at });
  try {
    const result = desk.command(message);
    console.log(JSON.stringify({ key: result.key, sequence: result.seq }));
  } catch (error) {
    console.log(JSON.stringify({ error: error.message }));
  } finally {
    desk.close();
    store.close();
  }
} else if (mode === "interrupt") {
  // Exercise recovery from a process killed after BEGIN and a tentative insert, before COMMIT.
  const db = new DatabaseSync(path);
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO global_events VALUES(?,?,?,?)").run(
    99999999,
    "interrumpido",
    "{}",
    "x",
  );
  process.stdout.write("READY\n");
  setInterval(() => {}, 1000);
} else if (mode === "run") {
  const seconds = Number(argument ?? 10);
  assert.ok(seconds >= 1 && seconds <= 14400);
  const begin = performance.now(),
    stats = {
      started: new Date().toISOString(),
      seconds,
      books: 0,
      competingWriters: 0,
      identicalRetries: 0,
      interruptedWrites: 0,
      wrongReturnsRejected: 0,
      verifiedCloses: 0,
      transfers: 0,
      mode: "DEMONSTRATION",
      ownRevenue: null,
    };
  const publish = (status, extra = {}) => {
    writeFileSync(
      path + ".tmp",
      JSON.stringify(
        {
          ...stats,
          status,
          elapsedSeconds: (performance.now() - begin) / 1000,
          updated: new Date().toISOString(),
          ...extra,
        },
        null,
        2,
      ) + "\n",
    );
    renameSync(path + ".tmp", path);
  };
  let random = 0x1a9f3223;
  function draw(n) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random % n;
  }
  async function write(path, file) {
    const p = spawn(process.execPath, [self, "writer", path, file], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    const [code] = await once(p, "exit");
    assert.equal(code, 0, err);
    return JSON.parse(out);
  }
  try {
    do {
      const dir = mkdtempSync(join(tmpdir(), "semar-concurrente-")),
        p = join(dir, "prueba.sqlite");
      let e;
      try {
        e = await pilotBook(p);
        e.client("prueba");
        const o = e.offer("oferta", "prueba");
        const alternatives = ["a", "b"].map((id) =>
          e.message("sale-order", "orden-" + id, {
            sale: o.id,
            proof: e.buyers.get(o.buyer).proof("order", {
              sale: o.id,
              offer: o.digest,
              reference: "pedido-" + id,
              at: e.now(),
            }),
          }),
        );
        const files = alternatives.map((message, i) => {
          const f = join(dir, "orden-" + i + ".json");
          writeFileSync(f, JSON.stringify({ at: e.now(), message }));
          return f;
        });
        const replies = await Promise.all(
          [...files, ...files].map((f) => write(p, f)),
        );
        const accepted = replies.filter((r) => !r.error);
        assert.equal(accepted.length, 2);
        assert.equal(accepted[0].sequence, accepted[1].sequence);
        assert.ok(
          replies
            .filter((r) => r.error)
            .every((r) => /duplicada/.test(r.error)),
        );
        stats.competingWriters += 4;
        stats.identicalRetries++;
        const killed = spawn(process.execPath, [self, "interrupt", p], {
          stdio: ["ignore", "pipe", "inherit"],
        });
        try {
          const ack = await Promise.race([
            once(killed.stdout, "data"),
            once(killed, "exit").then(() => {
              throw Error("Escritor terminó antes de la transacción");
            }),
          ]);
          assert.equal(ack[0].toString(), "READY\n");
        } finally {
          const exit = once(killed, "exit");
          killed.kill("SIGKILL");
          await exit;
        }
        assert.equal(
          e.desk.db
            .prepare(
              "SELECT count(*) n FROM global_events WHERE id='interrumpido'",
            )
            .get().n,
          0,
        );
        stats.interruptedWrites++;
        const order = e.desk.read().sales.offers.get(o.id).order;
        e.advance();
        const recovery = 40 + draw(161),
          d = e.deliver(o, order, recovery),
          fee = Math.floor(recovery / 5);
        assert.equal(d.fee, fee);
        const paid = 1 + draw(fee),
          labor = draw(9),
          cost = 1 + draw(6),
          common = 1 + draw(4);
        let balance = 90 + paid - cost - common - 2;
        e.statement(
          [
            e.line("recibo", "fee", paid, o.id),
            e.line("gasto", "cost", cost, o.id),
            e.line("comun", "overhead", common),
            e.line("gasto-fabrica", "research", 2, null, "producto"),
          ],
          balance,
        );
        stats.transfers += 4;
        e.closeSale(o, labor);
        assert.equal(
          e.desk.sales("DEMONSTRATION").campaignNetCents,
          paid - cost - common - 2 - labor,
        );
        stats.verifiedCloses++;
        e.advance();
        assert.throws(
          () =>
            e.statement(
              [e.line("exceso", "refund", paid + 1, o.id, "recibo")],
              balance - paid - 1,
            ),
          /superior/,
        );
        stats.wrongReturnsRejected++;
        const refund = 1 + draw(paid);
        balance -= refund;
        e.statement(
          [e.line("devolucion", "refund", refund, o.id, "recibo")],
          balance,
        );
        stats.transfers++;
        assert.equal(e.desk.sales("DEMONSTRATION").campaignNetCents, null);
        e.closeSale(o, labor);
        assert.equal(
          e.desk.sales("DEMONSTRATION").campaignNetCents,
          paid - refund - cost - common - 2 - labor,
        );
        assert.equal(e.desk.sales().bankCollectedCents, 0);
        stats.verifiedCloses++;
        assert.equal((await e.desk.audit()).status, "VERIFIED");
        const again = new GlobalDesk(p, e.store);
        try {
          assert.equal(
            again.sales("DEMONSTRATION").campaignNetCents,
            paid - refund - cost - common - 2 - labor,
          );
          assert.equal((await again.audit()).tip, (await e.desk.audit()).tip);
        } finally {
          again.close();
        }
        stats.books++;
        stats.lastExample = hash([
          recovery,
          fee,
          paid,
          refund,
          cost,
          common,
          labor,
        ]);
        publish("RUNNING");
      } finally {
        e?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    } while ((performance.now() - begin) / 1000 < seconds);
    publish("PASSED");
  } catch (error) {
    publish("FAILED", { error: error.message });
    throw error;
  }
} else throw Error("Usa run ARCHIVO SEGUNDOS");
