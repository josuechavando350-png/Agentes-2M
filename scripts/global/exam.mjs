import { randomBytes, createHash } from "node:crypto";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus, availableParallelism } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Semar } from "../../src/semar.mjs";
import { GlobalDesk, engine } from "../../src/global-desk.mjs";
import { digest } from "../../src/policy.mjs";
import { exampleBook, exampleGoal, exampleSource } from "./demo.mjs";

async function runWorker({ path, jobs }) {
  const s = new Semar(path),
    book = new GlobalDesk(path, s);
  try {
    const results = [];
    for (const envelope of jobs) {
      const at = performance.now();
      const { key: id } = book.command(envelope);
      const out = await book.work(id);
      results.push({
        id,
        elapsedMs: performance.now() - at,
        decision: out.decision,
      });
    }
    return results;
  } finally {
    book.close();
    s.close();
  }
}
function chunk(path, jobs) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { path, jobs },
    });
    w.once("message", resolve);
    w.once("error", reject);
    w.once("exit", (code) => {
      if (code) reject(Error("Examinador interrumpido " + code));
    });
  });
}
async function exam() {
  const seed = process.argv[2] ?? randomBytes(32).toString("hex");
  const dir = mkdtempSync(join(tmpdir(), "semar-examen-")),
    path = join(dir, "examen.sqlite");
  let env;
  try {
    env = await exampleBook(path);
    const { command, grant } = env;
    const total = 108,
      now = Date.now(),
      workers = Math.min(4, availableParallelism());
    grant.budgetCents = total * 2;
    grant.actors.forEach((w) => {
      w.limit = total * 2;
    });
    command("open", "examen", grant);
    const ids = [],
      expected = new Map();
    for (let i = 0; i < total; i++) {
      const h = createHash("sha256")
        .update(seed + "/" + i)
        .digest();
      const goal = exampleGoal(),
        id = "j-" + i;
      goal.scope = "s-" + i;
      goal.op = ["lookup", "difference", "product"][Math.floor(i / 9) % 3];
      if (goal.op === "lookup") {
        goal.operands = goal.operands.slice(0, 1);
        goal.probes = [];
      }
      const a = 50 + h[0],
        b = 1 + h[1],
        value =
          goal.op === "lookup" ? a : goal.op === "difference" ? a - b : a * b;
      goal.threshold = value + (h[2] % 2 ? -1 : 1);
      const mode = i % 9;
      const refs = [];
      for (let k = 0; k < 2; k++) {
        if (mode === 3 && k === 1) continue;
        const name = "d-" + i + "-" + k;
        const src = exampleSource(
          name,
          "r-" + i + "-" + (mode === 2 ? 0 : k),
          now,
        );
        src.scope = goal.scope;
        src.document.rows[0].value = a;
        src.document.rows[1].value = b;
        if (mode === 4 && k === 1) src.document.rows[0].value++;
        if (mode === 5 && k === 1) src.schema.ingreso.unit = "otra-moneda";
        if (mode === 6 && k === 1) src.schema.ingreso.stage = "cotizado";
        if (mode === 7) src.assumptions = ["mismo-supuesto"];
        if (mode === 8 && k === 1)
          src.document.rows.push({ ...src.document.rows[0] });
        refs.push(
          ...src.document.rows.map((r, n) => ({
            id: name,
            row: n + 1,
            value: r.value,
            field: r.field,
          })),
        );
        command("source", name, src);
      }
      const request = env.message("reserve", id, { goal, cap: 2 });
      expected.set(id, {
        action:
          mode < 2
            ? value >= goal.threshold
              ? "ADVANCE"
              : "STOP"
            : "NEED_EVIDENCE",
        value: mode < 2 ? value : null,
        refs,
        fields: goal.operands.map((o) => o.field),
      });
      ids.push(request);
    }
    const rows = (
      await Promise.all(
        Array.from({ length: workers }, (_, k) =>
          chunk(
            path,
            ids.filter((_, i) => i % workers === k),
          ),
        ),
      )
    ).flat();
    let correct = 0,
      severe = 0,
      answered = 0,
      possible = 0,
      missingCorrect = 0,
      badCites = 0,
      rowsRead = 0;
    for (const r of rows) {
      const o = r.decision,
        e = expected.get(r.id);
      const ok = o.action === e.action && o.value === e.value;
      correct += Number(ok);
      severe += Number(!ok && o.action !== "NEED_EVIDENCE");
      answered += Number(o.action !== "NEED_EVIDENCE");
      possible += Number(e.action !== "NEED_EVIDENCE");
      missingCorrect += Number(ok && e.action === "NEED_EVIDENCE");
      rowsRead += o.reviews.reduce((n, x) => n + x.cost, 0);
      // Check both invented and missing references against the case generator.
      const actual = o.oracle.refs.map((v) => [v.document, v.row]).sort();
      const original = e.refs
        .filter((v) => e.fields.includes(v.field))
        .map((v) => [v.id, v.row])
        .sort();
      badCites += Number(digest(actual) !== digest(original));
    }
    const ms = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
    const q = (p) => ms[Math.ceil(p * ms.length) - 1];
    const passed =
      correct === total &&
      badCites === 0 &&
      severe === 0 &&
      answered === possible;
    console.log(
      JSON.stringify(
        {
          scope: "generated documentary decisions",
          seed,
          engine: digest(engine),
          cases: total,
          answerable: possible,
          answered,
          correct,
          severe,
          missingCorrect,
          invalidCitationSets: badCites,
          coverage: answered / total,
          answerableCoverage: (correct - missingCorrect) / possible,
          rowsRead,
          observedCashCost: null,
          hardware: {
            cpu: cpus()[0]?.model,
            available: availableParallelism(),
            workers,
          },
          latencyMs: {
            p50: q(0.5),
            p95: q(0.95),
            p99: q(0.99),
            boundary:
              "signed request through reservation, execution and durable decision commit under concurrent load",
          },
          passed,
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    env?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
if (isMainThread) await exam();
else parentPort.postMessage(await runWorker(workerData));
