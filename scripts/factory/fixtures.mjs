import { randomBytes, createHash } from "node:crypto";
import { hash } from "../../src/factory/reader.mjs";
const sectors = ["construccion", "logistica", "servicios"];
const vocabulary = {
  compras: [
    ["cuenta", "folio", "clase", "centavos", "moneda"],
    ["compra", "abono", "ajuste"],
  ],
  construccion: [
    ["contrato", "partida", "concepto", "importe", "divisa"],
    ["estimacion", "bonificado", "retencion"],
  ],
  logistica: [
    ["ruta", "movimiento", "operacion", "monto", "unidad"],
    ["flete", "pagado", "correccion"],
  ],
  servicios: [
    ["proyecto", "registro", "categoria", "cantidad", "codigo"],
    ["honorarios", "liquidacion", "descuento"],
  ],
};
const kinds = ["base", "pagado", "ajuste"],
  roles = ["account", "entry", "kind", "amount", "unit"];
const guide = (sector) => ({
  headers: vocabulary[sector][0].map((text, i) => ({ text, label: roles[i] })),
  movements: vocabulary[sector][1].map((text, i) => ({
    text,
    label: kinds[i],
  })),
});
const n = (seed, k) =>
  createHash("sha256")
    .update(seed + "/" + k)
    .digest()
    .readUInt32LE(0);
function workCase(sector, id, period, vectors, mode, variant = 0) {
  const [columns, forms] = vocabulary[sector],
    accounts = vectors.map((_, i) => id + "-cuenta-" + i);
  const registers = kinds.map((kind, j) => {
    const order = variant % 2 ? [2, 4, 0, 3, 1] : [0, 1, 2, 3, 4],
      pick = (a) => order.map((i) => a[i]).join(",");
    const head = pick(columns),
      data = vectors.map((g, i) =>
        pick([
          accounts[i],
          id + "-" + i + "-" + j,
          forms[j],
          g[j],
          mode === 4 && i === 0 && j === 0 ? "usd" : "mxn",
        ]),
      );
    // One delivery may be repeated by another source file; an equal movement has one identity.
    const files = [{ id: "d-" + j, csv: [head, ...data].join("\n") }];
    if (variant % 3 === 0)
      files.push({ id: "copia-" + j, csv: [head, data[0]].join("\n") });
    const open = mode === 2 && j === 2;
    return {
      id: "registro-" + kind,
      kind,
      closed: !open,
      ...(open ? { account: accounts[0], limit: 1000000 } : {}),
      files,
    };
  });
  return {
    id,
    sector,
    period,
    flags: { firmado: mode !== 5, conciliado: true },
    registers,
  };
}
const expected = (gs) =>
  gs.reduce(
    (n, [base, paid, credit]) =>
      n + Math.max(0, Math.floor(base / 20) - paid - credit),
    0,
  );
export function corpus(seed = randomBytes(16).toString("hex"), perSector = 12) {
  const demos = [];
  const values = [
    [
      [10000, 100, 40],
      [6000, 20, 500],
    ],
    [[1000, 0, 0]],
    [[2000, 65, 28]],
    [
      [1105, 0, 0],
      [1901, 0, 0],
    ],
    [
      [10000, 900, 2],
      [30000, 700, 200],
    ],
    [
      [999, 4, 10],
      [1, 0, 0],
    ],
    [
      [3007, 0, 120],
      [12000, 400, 0],
    ],
  ];
  for (const [i, g] of values.entries())
    demos.push({
      dossier: workCase("compras", "entrenar-" + i, "desarrollo", g, 0, i),
      value: expected(g),
    });
  const expert = {
    signals: ["firmado", "conciliado"],
    sessions: [0, 1, 2, 3].map((mask) => ({
      id: "sesion-" + mask,
      events: [
        { inspect: "firmado", value: !!(mask & 1) },
        { inspect: "conciliado", value: !!(mask & 2) },
        { decision: mask === 3 ? "ALLOW" : "REVIEW" },
      ],
    })),
  };
  const formulaData = (i, scope) => {
    const v = (tag) => n(seed, scope + "/" + i + "/" + tag);
    const bucket = ["formacion", ...sectors].indexOf(scope),
      demanda = 1 + i * 32 + bucket * 8 + (v("d") % 8),
      dias = 2 + (v("t") % 13);
    const stock =
      i % 2
        ? demanda * dias + 1 + (v("s") % 60)
        : 1 + (v("s") % Math.max(1, demanda * dias - 1));
    return { demanda, dias, stock };
  };
  const quantity = (x) => Math.max(0, x.demanda * x.dias - x.stock);
  const tools = [
    {
      id: "reposicion",
      purpose: "Unidades por reponer a partir de consumo, plazo y existencias",
      columns: [
        { id: "demanda", dimension: { piezas: 1, dias: -1 } },
        { id: "dias", dimension: { dias: 1 } },
        { id: "stock", dimension: { piezas: 1 } },
      ],
      resultUnit: { piezas: 1 },
      examples: Array.from({ length: 14 }, (_, i) => {
        const record = formulaData(i, "formacion");
        return { record, out: quantity(record) };
      }),
      maxNodes: 6,
      limit: 40000,
    },
  ];
  const batches = [],
    answers = [],
    exams = [];
  for (const [s, sector] of sectors.entries()) {
    const period = "periodo-" + (s + 1),
      cases = [],
      outcomes = {};
    for (let i = 0; i < perSector; i++) {
      const id = sector + "-" + i,
        mode = i % 6,
        b = 4000 + (n(seed, id) % 60000),
        g = [
          [b, 1 + (n(seed, id + "p") % 30), 1 + (n(seed, id + "a") % 32)],
          [
            8000 + (i * sectors.length + s) * 64 + (n(seed, id + "b") % 64),
            2000,
            5,
          ],
        ];
      if (mode === 1) g[0][2] = Math.ceil(b / 20);
      cases.push(workCase(sector, id, period, g, mode, i));
      outcomes[id] = [2, 4, 5].includes(mode) ? null : expected(g);
    }
    const records = Array.from({ length: 8 }, (_, i) => formulaData(i, sector));
    const group = {
        sector,
        period,
        guide: guide(sector),
        cases,
        tools: { reposicion: records },
      },
      a = {
        sector,
        period,
        tools: { reposicion: records.map(quantity) },
        salt: hash([seed, sector, "sal"]),
        values: outcomes,
      };
    batches.push(group);
    answers.push(a);
    exams.push({
      sector,
      period,
      count: cases.length,
      inputHash: hash(group),
      answersHash: hash(a),
    });
  }
  const workflow = {
    budget: 6,
    stages: [
      { id: "captura", cost: 3 },
      { id: "conciliar", cost: 5 },
      { id: "revision", cost: 3 },
    ],
    traces: [1, 2, 3, 4].map((i) => ({
      id: "flujo-" + i,
      tasks: [
        {
          id: "inicio",
          stage: "captura",
          minutes: 15 + i,
          improved: 4,
          after: [],
        },
        {
          id: "comparar",
          stage: "conciliar",
          minutes: 90 + i * 8,
          improved: 15,
          after: ["inicio"],
        },
        {
          id: "aprobacion",
          stage: "revision",
          minutes: 30 + i,
          improved: 5,
          after: ["inicio"],
        },
        {
          id: "entrega",
          stage: "captura",
          minutes: 5,
          improved: 2,
          after: ["comparar", "aprobacion"],
        },
      ],
    })),
  };
  const project = {
    id: "bonificaciones",
    trainingSector: "compras",
    unit: "mxn",
    kinds,
    rates: [100, 200, 500, 1000],
    maxEvaluations: 40000,
    guide: guide("compras"),
    expert,
    demos,
    exams,
    tools,
    precedents: [],
    workflow,
    provenance: [
      "Ejercicios generados por SEMAR. Importes, organizaciones, tiempos y demostraciones de experto son de prueba.",
    ],
  };
  return { seed, project, batches, answers };
}
