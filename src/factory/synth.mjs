import { hash, check, num, key, list, unique } from "./reader.mjs";
const ops = ["add", "sub", "mul", "min", "max"];
function dim(d) {
  check(
    d &&
      typeof d === "object" &&
      !Array.isArray(d) &&
      Object.keys(d).length <= 6,
    "Dimensión inválida",
  );
  return Object.fromEntries(
    Object.entries(d)
      .filter(([k, e]) => {
        key(k);
        num(e, -8, 8);
        return e !== 0;
      })
      .sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}
function dims(op, a, b) {
  if (op !== "mul") return JSON.stringify(a) === JSON.stringify(b) ? a : null;
  const v = { ...a };
  for (const [k, e] of Object.entries(b)) v[k] = (v[k] ?? 0) + e;
  if (Object.values(v).some((e) => Math.abs(e) > 8)) return null;
  return dim(v);
}
function bounded(v) {
  return v === null || v > 9007199254740991n || v < -9007199254740991n
    ? null
    : Number(v);
}
function binary(op, x, y) {
  if (x === null || y === null) return null;
  if (op === "max") return Math.max(x, y);
  if (op === "min") return Math.min(x, y);
  const a = BigInt(x),
    b = BigInt(y);
  return bounded(op === "add" ? a + b : op === "sub" ? a - b : a * b);
}
export function applyFormula(ast, record) {
  if (ast.field !== undefined) return num(record[ast.field], -1e6, 1e6);
  if (ast.op === "positive") {
    const v = applyFormula(ast.a, record);
    return v === null ? null : Math.max(0, v);
  }
  check(ops.includes(ast.op), "Operación no disponible");
  return binary(
    ast.op,
    applyFormula(ast.a, record),
    applyFormula(ast.b, record),
  );
}
export function fitFormula(s, options = {}) {
  const allowedErrors = num(options.maxTrainingErrors ?? 0, 0, 8);
  key(s.id);
  check(
    typeof s.purpose === "string" &&
      s.purpose.trim().length &&
      s.purpose.length <= 300,
    "Propósito ausente",
  );
  const cols = list(s.columns, 1, 5),
    fields = unique(cols.map((c) => key(c.id))),
    target = dim(s.resultUnit);
  num(s.maxNodes, 1, 7);
  num(s.limit, 10, 50000);
  const demos = list(s.examples, 2, 48);
  unique(demos.map((x) => hash(x.record)));
  const inspect = (r) => {
    check(Object.keys(r).length === fields.length, "Demostración incompleta");
    for (const f of fields) num(r[f], -1e6, 1e6);
  };
  demos.forEach((e) => {
    inspect(e.record);
    num(e.out, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  });
  const probes = Array.from({ length: 24 }, (_, i) =>
    Object.fromEntries(
      fields.map((f, j) => [
        f,
        (parseInt(hash([f, i, j]).slice(0, 6), 16) % 61) - 20,
      ]),
    ),
  );
  const records = [...demos.map((e) => e.record), ...probes],
    levels = [[]],
    seen = new Set(),
    log = [];
  let count = 0;
  for (let size = 1; size <= s.maxNodes; size++) {
    const level = [],
      fits = [];
    const keep = (ast, unit, values) => {
      if (++count > s.limit) return false;
      const sig = hash([unit, values]),
        status = seen.has(sig)
          ? "same-observations"
          : JSON.stringify(unit) === JSON.stringify(target) &&
              demos.reduce(
                (miss, e, i) => miss + Number(e.out !== values[i]),
                0,
              ) <= allowedErrors
            ? "fit"
            : "reject";
      log.push([hash(ast).slice(0, 24), status]);
      if (!seen.has(sig)) {
        const node = { ast, unit, values };
        seen.add(sig);
        level.push(node);
        if (status === "fit") fits.push(node);
      }
      return true;
    };
    if (size === 1)
      for (const c of cols)
        keep(
          { field: c.id },
          dim(c.dimension),
          records.map((r) => r[c.id]),
        );
    else {
      for (const n of levels[size - 1])
        if (
          !keep(
            { op: "positive", a: n.ast },
            n.unit,
            n.values.map((v) => (v === null ? null : Math.max(0, v))),
          )
        )
          break;
      outer: for (let l = 1; l < size - 1; l++)
        for (const a of levels[l])
          for (const b of levels[size - 1 - l])
            for (const op of ops) {
              if (
                op !== "sub" &&
                (l > size - 1 - l ||
                  (l === size - 1 - l &&
                    JSON.stringify(a.ast) > JSON.stringify(b.ast)))
              )
                continue;
              const unit = dims(op, a.unit, b.unit);
              if (!unit) continue;
              if (
                !keep(
                  { op, a: a.ast, b: b.ast },
                  unit,
                  a.values.map((v, i) => binary(op, v, b.values[i])),
                )
              )
                break outer;
            }
    }
    if (count > s.limit)
      return {
        id: s.id,
        status: "SEARCH_BUDGET_EXHAUSTED",
        tried: log.length,
        attempts: log,
      };
    if (fits.length) {
      const pub = {
        id: s.id,
        columns: cols,
        purpose: s.purpose,
        resultUnit: target,
        complexity: size,
        tried: count,
        attempts: log,
      };
      const errors = (n) =>
        demos.reduce((miss, e, i) => miss + Number(e.out !== n.values[i]), 0);
      const best = Math.min(...fits.map(errors)),
        finalists = fits.filter((n) => errors(n) === best);
      if (finalists.length > 1) {
        const j = records.findIndex((r, i) =>
          finalists.some((x) => x.values[i] !== finalists[0].values[i]),
        );
        return {
          ...pub,
          status: "ASK_EXPERT",
          question: {
            record: records[j],
            alternatives: [...new Set(finalists.map((x) => x.values[j]))],
          },
        };
      }
      return {
        ...pub,
        status: best ? "EXPLORATORY" : "CANDIDATE",
        trainingErrors: best,
        ast: finalists[0].ast,
      };
    }
    levels.push(level);
  }
  return { id: s.id, status: "OUTSIDE_LANGUAGE", tried: count, attempts: log };
}
// Emit only operator templates and bounded integer field reads. No user text becomes executable syntax.
export function generateTools(formulas) {
  const expression = (a, fields) => {
    if (a.field !== undefined) {
      const i = fields.indexOf(a.field);
      check(i >= 0, "Campo inválido");
      return "v[" + i + "]";
    }
    const x = expression(a.a, fields);
    if (a.op === "positive") return "pos(" + x + ")";
    check(ops.includes(a.op), "Operación desconocida");
    return a.op + "(" + x + "," + expression(a.b, fields) + ")";
  };
  const data = formulas.map((f) => {
    const keys = f.columns.map((c) => c.id);
    return [key(f.id), keys, expression(f.ast, keys)];
  });
  return `// Local generated integer tools. Values outside the exact range require evidence.
const bound=v=>v===null||v>9007199254740991n||v< -9007199254740991n?null:v;
const add=(a,b)=>a===null||b===null?null:bound(a+b), sub=(a,b)=>a===null||b===null?null:bound(a-b), mul=(a,b)=>a===null||b===null?null:bound(a*b);
const max=(a,b)=>a===null||b===null?null:a>b?a:b, min=(a,b)=>a===null||b===null?null:a<b?a:b, pos=a=>a===null?null:a<0n?0n:a;
const tools=new Map([${data.map(([id, keys, expr]) => "[" + JSON.stringify(id) + ",{keys:" + JSON.stringify(keys) + ",run:v=>" + expr + "}]").join(",")}]);
export function apply(id,record){const t=tools.get(id);if(!t)throw Error("Herramienta desconocida");const v=t.keys.map(k=>{const n=record[k];if(!Number.isSafeInteger(n)||Math.abs(n)>1e6)throw Error("Entrada fuera del dominio");return BigInt(n);});const out=t.run(v);return out===null?null:Number(out);}
`;
}
