import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Semar } from "../../src/semar.mjs";
import { canonical } from "../../src/policy.mjs";
import { GlobalDesk } from "../../src/global-desk.mjs";

export function envelope(key, kind, id, data, book = "ejemplo") {
  const record = { protocol: "SEMAR-GLOBAL-1", book, id, kind, data };
  return {
    record,
    signature: sign(null, Buffer.from(canonical(record)), key).toString(
      "base64",
    ),
  };
}
export function exampleGoal() {
  return {
    scope: "demostracion",
    objective: "Determinar si el margen documentado alcanza el mínimo",
    subject: "cliente",
    op: "difference",
    operands: ["ingreso", "costo"].map((field) => ({
      field,
      unit: "centavos",
      stage: "conciliado",
    })),
    threshold: 40,
    minFamilies: 2,
    probes: [
      {
        id: "contraste",
        field: "costo",
        question: "¿Una fuente independiente confirma el costo?",
        positiveBps: 5000,
        positiveNetCents: 100,
        negativeNetCents: -100,
        costCents: 1,
        minutes: 5,
      },
    ],
  };
}
export function exampleSource(id, root, at, cost = 55) {
  return {
    scope: "demostracion",
    document: {
      id,
      source: "documento/" + id,
      rows: [
        { subject: "cliente", field: "ingreso", value: 100 },
        { subject: "cliente", field: "costo", value: cost },
      ],
    },
    roots: [root],
    method: root,
    assumptions: [],
    schema: {
      ingreso: { unit: "centavos", stage: "conciliado" },
      costo: { unit: "centavos", stage: "conciliado" },
    },
    from: at - 1000,
    until: at + 86400000,
    previous: null,
  };
}
export async function exampleBook(path, clock = Date.now) {
  const store = new Semar(path, { clock }),
    desk = new GlobalDesk(path, store, { clock });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await store.command("inicio", { type: "init", reserve: 5000 });
  await store.command("tesoreria", {
    type: "settlement_key",
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  });
  const message = (kind, id, data) => envelope(privateKey, kind, id, data);
  const actors = [
    {
      id: 1,
      generation: 1,
      limit: 100,
      ops: ["difference", "lookup", "product"],
      policy: "first",
    },
    {
      id: 1000001,
      generation: 1,
      limit: 100,
      ops: ["difference", "lookup", "product"],
      policy: "indexed",
    },
  ];
  const grant = {
    budgetCents: 100,
    currency: "MXN",
    until: clock() + 167 * 3600000,
    maxJobCents: 100,
    permissions: ["read", "calculate"],
    actors,
  };
  return {
    store,
    desk,
    message,
    grant,
    command: (kind, id, data) => desk.command(message(kind, id, data)),
    close() {
      desk.close();
      store.close();
    },
  };
}
export async function globalDemo() {
  const dir = mkdtempSync(join(tmpdir(), "semar-global-"));
  let env;
  try {
    env = await exampleBook(join(dir, "demo.sqlite"));
    const { command, desk, grant } = env;
    const at = Date.now(),
      goal = exampleGoal();
    command("open", "abrir", grant);
    command("source", "primera", exampleSource("libro", "origen-a", at));
    command("source", "copia", exampleSource("espejo", "origen-a", at));
    command("reserve", "primero", { goal, cap: 10 });
    const first = await desk.work("primero");
    command("settle", "liquidar-primero", {
      job: "primero",
      cents: 2,
      reference: "ejemplo-gasto-1",
    });
    command(
      "source",
      "independiente",
      exampleSource("contraparte", "origen-b", at),
    );
    command("refresh", "segundo", { job: "primero", cap: 10 });
    const second = await desk.work("segundo");
    command("settle", "liquidar-segundo", {
      job: "segundo",
      cents: 3,
      reference: "ejemplo-gasto-2",
    });
    return {
      mode: "DEMONSTRATION",
      first: first.decision.action,
      second: second.decision.action,
      decision: second.decision,
      replay: await desk.replay("segundo"),
      book: desk.view(),
    };
  } finally {
    env?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
