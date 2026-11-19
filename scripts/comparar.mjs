// Standalone examination. Give participants only cases.json, never the examiner's directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { digest, integer } from "../src/policy.mjs";
import { freshSeed, sealedCases } from "../src/blind.mjs";
import { investigate } from "../src/dossiers.mjs";

const [action, dir, submission] = process.argv.slice(2);
if (!dir)
  throw Error(
    "Usa crear DIRECTORIO_NUEVO o evaluar DIRECTORIO RESPUESTAS.json",
  );
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const save = (n, x) =>
  writeFileSync(join(dir, n), JSON.stringify(x, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
if (action === "crear") {
  mkdirSync(dir, { mode: 0o700 });
  const cases = Array.from({ length: 4 }, () =>
    sealedCases(freshSeed()),
  ).flat();
  const inputs = cases.map(({ docs, q }, i) => ({
    id: i + 1,
    documents: docs,
    query: q,
  }));
  const hash = digest(inputs),
    start = performance.now();
  const answers = inputs.map(({ id, documents, query }) => {
    const { status, value, refs } = investigate(documents, query);
    return {
      id,
      status,
      value,
      refs: refs.map((r) => ({ document: r.document, row: r.row })),
    };
  });
  const elapsedMs = Math.ceil(performance.now() - start);
  save("casos.json", { schema: 1, hash, inputs });
  save("clave-privada.json", {
    hash,
    answers: cases.map(({ expected }, i) => ({
      id: i + 1,
      status: expected.status,
      value: expected.value,
      refs: expected.refs.map((r) => ({ document: r.document, row: r.row })),
    })),
  });
  save("semar.json", {
    participant: "SEMAR/indexed",
    hash,
    elapsedMs,
    externalCostMicrosMXN: 0,
    answers,
  });
  console.log(
    "Comparte únicamente casos.json. El costo externo de SEMAR excluye CPU local.",
  );
} else if (action === "evaluar") {
  const key = read(join(dir, "clave-privada.json")),
    incoming = read(submission);
  if (
    key.hash !== incoming.hash ||
    typeof incoming.participant !== "string" ||
    !Array.isArray(incoming.answers) ||
    incoming.answers.length !== key.answers.length
  )
    throw Error("Entrega incompleta o examen distinto");
  const ids = new Map(incoming.answers.map((a) => [a.id, a]));
  integer(incoming.elapsedMs, 0, Number.MAX_SAFE_INTEGER, "ms reportados");
  integer(
    incoming.externalCostMicrosMXN,
    0,
    Number.MAX_SAFE_INTEGER,
    "costo externo reportado",
  );
  let correct = 0,
    severe = 0;
  for (const item of key.answers) {
    const a = ids.get(item.id);
    if (!a || !Array.isArray(a.refs))
      throw Error("Falta una respuesta o sus referencias");
    const refs = (x) => x.map((r) => r.document + "#" + r.row).sort();
    const ok =
      a.status === item.status &&
      a.value === item.value &&
      digest(refs(a.refs)) === digest(refs(item.refs));
    correct += Number(ok);
    severe += Number(!ok && a.status === "SUPPORTED");
  }
  console.log(
    JSON.stringify({
      participant: incoming.participant,
      total: key.answers.length,
      correct,
      severe,
      reportedElapsedMs: incoming.elapsedMs,
      reportedExternalCostMicrosMXN: incoming.externalCostMicrosMXN,
      exam: key.hash,
    }),
  );
} else throw Error("Operación de comparación inválida");
