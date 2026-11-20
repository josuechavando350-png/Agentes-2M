import { createPublicKey, verify } from "node:crypto";
import { canonical, strict } from "../policy.mjs";
import { check, num, key, hash, list, unique } from "../factory/reader.mjs";
import { prepare, result } from "../factory/product.mjs";
import { chooseOffer, fee } from "./pricing.mjs";

const maxCash = 1e11;
const money = (n) => num(n, 0, maxCash);
const ref = (s) => {
  check(
    typeof s === "string" && s.trim().length > 0 && s.length <= 160,
    "Referencia ausente",
  );
  return s;
};
const fingerprint = (s) => {
  check(
    typeof s === "string" && /^[0-9a-f]{64}$/.test(s),
    "Se requiere la huella SHA-256 del comprobante",
  );
  return s;
};
function publicKey(pem) {
  check(
    typeof pem === "string" && pem.length < 1024 && !pem.includes("PRIVATE"),
    "Se requiere clave pública Ed25519",
  );
  const k = createPublicKey(pem);
  check(k.asymmetricKeyType === "ed25519", "Clave ajena al protocolo");
  return k.export({ type: "spki", format: "pem" }).toString();
}
function signed(proof, signer, book, purpose) {
  strict(proof, ["record", "signature"]);
  const r = proof.record;
  check(
    r.protocol === "SEMAR-SALE-1" &&
      r.purpose === purpose &&
      r.book === book &&
      typeof proof.signature === "string" &&
      verify(
        null,
        Buffer.from(canonical(r)),
        signer,
        Buffer.from(proof.signature, "base64"),
      ),
    "La firma independiente no corresponde al documento",
  );
  return r;
}
export function validateCommercialAuthority(key, treasury) {
  const authority = publicKey(key);
  check(
    authority !== publicKey(treasury),
    "El verificador de titulares debe ser distinto de la tesorería",
  );
  return authority;
}
function enrollment(s, d, role, at, signer) {
  if (d.mode !== "LIVE") return {};
  check(
    s.open.commercialAuthority,
    "El mandato real requiere un verificador de titulares previamente designado",
  );
  const authority = publicKey(s.open.commercialAuthority);
  check(signer !== authority, "Una entidad no puede certificarse a sí misma");
  const p = signed(d.enrollment ?? {}, authority, s.open.book, "enrollment");
  strict(p, [
    "protocol",
    "book",
    "purpose",
    "role",
    "id",
    "group",
    "publicKey",
    "source",
    "from",
    "until",
  ]);
  check(
    p.id === d.id &&
      p.role === role &&
      p.group === (d.group ?? d.id) &&
      publicKey(p.publicKey) === signer,
    "Identidad externa distinta de la solicitada",
  );
  fingerprint(p.source);
  num(p.from, 0, at);
  num(p.until, s.open.until, Number.MAX_SAFE_INTEGER);
  return { enrollment: hash(p), identitySource: p.source };
}
function lookup(map, id) {
  key(id);
  const v = map.get(id);
  check(v, "Entidad comercial desconocida");
  return v;
}
function live(s, at) {
  check(
    s.open && s.spent < s.open.budgetCents && at < s.open.until,
    "Tesorería cerrada o presupuesto cero",
  );
}
function currency(s, c) {
  check(c === s.open.currency, "Moneda distinta de la tesorería");
}
function mode(m) {
  check(["DEMONSTRATION", "LIVE"].includes(m), "Modo de operación requerido");
}
export const salesState = () => ({
  clients: new Map(),
  accounts: new Map(),
  offers: new Map(),
  references: new Set(),
  ledger: new Map(),
  activities: new Map(),
});
const kinds = [
  "sale-client",
  "sale-account",
  "sale-offer",
  "sale-order",
  "sale-delivery",
  "sale-bank",
  "sale-close",
  "sale-decline",
  "sale-assign",
  "sale-activity",
];
export const saleEvent = (kind) => kinds.includes(kind);
function sameKey(s, signer) {
  return [...s.sales.accounts.values(), ...s.sales.clients.values()].some(
    (x) => x.key === signer,
  );
}
function bankKey(account, id) {
  return JSON.stringify([account, id]);
}
function cashAvailable(s, account) {
  let held = 0;
  for (const o of s.sales.offers.values())
    if (o.account === account.id && o.order && !o.close) {
      const incurred = [...s.sales.ledger.values()]
        .filter((t) => t.sale === o.id && t.kind === "cost")
        .reduce((sum, t) => sum + t.cents, 0);
      held += Math.max(0, o.order.maxCost - incurred);
    }
  return Math.max(
    0,
    Math.min(s.open.budgetCents - s.spent - s.held, account.balance - held),
  );
}
export const commercialScope = (j) =>
  j.snapshot.creditScope ?? j.snapshot.factory?.id;
function ordered(s, r) {
  const o = lookup(s.sales.offers, r.sale);
  check(
    o.order && o.digest === r.offer,
    "Pedido comercial inexistente o cambiado",
  );
  return o;
}
export function planSale(s, r, at, treasury, trials = []) {
  const d = r.data,
    b = s.sales,
    book = s.open.book;
  if (
    ["sale-client", "sale-account", "sale-offer", "sale-order"].includes(r.kind)
  )
    live(s, at);
  if (r.kind === "sale-client") {
    strict(d, [
      "id",
      "group",
      "account",
      "publicKey",
      "mode",
      ...(d.mode === "LIVE" ? ["enrollment"] : []),
    ]);
    const account = lookup(b.accounts, d.account);
    check(
      account.mode === d.mode,
      "El cliente requiere una cuenta del mismo modo",
    );
    key(d.id);
    key(d.group);
    mode(d.mode);
    const signer = publicKey(d.publicKey);
    check(
      !b.clients.has(d.id) &&
        !sameKey(s, signer) &&
        signer !== publicKey(treasury),
      "Comprador o firmante ya registrado",
    );
    return {
      id: d.id,
      group: d.group,
      account: d.account,
      key: signer,
      mode: d.mode,
      ...enrollment(s, d, "buyer", at, signer),
    };
  }
  if (r.kind === "sale-account") {
    strict(d, [
      "id",
      "publicKey",
      "mode",
      "currency",
      "from",
      "balanceCents",
      ...(d.mode === "LIVE" ? ["enrollment"] : []),
    ]);
    key(d.id);
    mode(d.mode);
    currency(s, d.currency);
    const signer = publicKey(d.publicKey);
    check(
      !b.accounts.has(d.id) &&
        !sameKey(s, signer) &&
        signer !== publicKey(treasury),
      "Cuenta o firmante ya registrado",
    );
    num(d.from, 0, at);
    money(d.balanceCents);
    return {
      id: d.id,
      key: signer,
      mode: d.mode,
      currency: d.currency,
      from: d.from,
      balance: d.balanceCents,
      until: d.from,
      tip: null,
      ...enrollment(s, d, "bank", at, signer),
    };
  }
  if (r.kind === "sale-offer") {
    const keys = [
      "id",
      "job",
      "buyer",
      "account",
      "input",
      "terms",
      "expires",
      "service",
      "basis",
      "pilot",
    ];
    strict(d, Object.hasOwn(d, "mandate") ? [...keys, "mandate"] : keys);
    key(d.id);
    ref(d.service);
    fingerprint(d.basis);
    check(!b.offers.has(d.id), "Oferta duplicada");
    const client = lookup(b.clients, d.buyer),
      account = lookup(b.accounts, d.account);
    check(
      client.mode === account.mode && client.account === account.id,
      "Mezcla de demostración y operación",
    );
    const job = lookup(s.jobs, d.job),
      f = job.output?.factory;
    check(
      job.status === "SETTLED",
      "Requiere una entrega auditada y costo liquidado",
    );
    num(d.expires, at + 1, s.open.until);
    if (d.pilot !== null) key(d.pilot);
    let run, program, kind;
    if (job.snapshot.credit) {
      strict(d.input, ["certificate"]);
      const c = job.output.credit;
      check(
        job.snapshot.creditBuyer === client.id &&
          d.input.certificate === hash(c.certificate) &&
          c.report.mathematicalGapUnits === 0,
        "Certificado o titular del archivo distintos",
      );
      currency(s, c.report.currency);
      kind = "CREDIT_AUDIT";
      program = job.runtime.files["src/sale/credits.mjs"];
      run = {
        status: "REVIEW_VOLUME",
        value: c.report.unmatchedValueCents,
        case: job.id,
        source: c.report.source,
        certificate: d.input.certificate,
      };
    } else {
      check(
        job.grade?.status === "QUALIFIED_IN_SCOPE" &&
          f &&
          job.grade.programHash === f.programHash,
        "Requiere una fábrica calificada",
      );
      currency(s, f.program.unit.toUpperCase());
      kind = "LEARNED_TOOL";
      program = f.programHash;
      const release = {
          program: f.program,
          adapters: job.adapters,
          trainingSector: f.scope,
        },
        parsed = prepare(release, d.input);
      run = result(release, parsed);
      check(
        run.status === "FOUND" && run.transfer === "MEASURED_SECTOR",
        "Falta oportunidad respaldada en el alcance examinado",
      );
      if (client.mode === "LIVE") {
        const id = parsed.parsed.id,
          pattern = parsed.parsed.pattern;
        check(
          !f.training.some((t) => t.id === id || t.pattern === pattern) &&
            !job.predictions.batches.some((g) =>
              g.predictions.some((p) => p.id === id || p.pattern === pattern),
            ),
          "Una venta real requiere un expediente nuevo del comprador",
        );
      }
    }
    check(
      run.value > 0,
      "El expediente no tiene partidas pendientes de conciliación",
    );
    if (client.mode === "LIVE" || d.mandate) {
      const mandate = signed(d.mandate ?? {}, client.key, book, "brief");
      strict(mandate, [
        "protocol",
        "book",
        "purpose",
        "buyer",
        "job",
        "input",
        "terms",
        "source",
        "at",
        "until",
      ]);
      check(
        mandate.buyer === client.id &&
          mandate.job === job.id &&
          mandate.input === hash(d.input) &&
          mandate.terms === hash(d.terms) &&
          mandate.source === d.basis,
        "Alcance o condiciones distintos del expediente del cliente",
      );
      num(mandate.at, 0, at);
      num(mandate.until, d.expires, Number.MAX_SAFE_INTEGER);
    }
    const choice = chooseOffer(d.terms, run.value, cashAvailable(s, account));
    check(choice.selected, "Ninguna oferta respeta precio, costo y capacidad");
    const proposal = {
      id: d.id,
      job: d.job,
      buyer: d.buyer,
      group: client.group,
      account: d.account,
      mode: client.mode,
      pilot: d.pilot,
      currency: account.currency,
      service: d.service,
      opportunityCents: run.value,
      case: run.case,
      program,
      kind,
      inputHash: hash(d.input),
      evidence: hash(run),
      termsBasis: d.basis,
      terms: d.terms,
      choice,
      expires: d.expires,
      quotedAt: at,
    };
    return { ...proposal, digest: hash(proposal) };
  }
  if (r.kind === "sale-order" || r.kind === "sale-decline") {
    strict(d, ["sale", "proof"]);
    const o = lookup(b.offers, d.sale),
      buyer = lookup(b.clients, o.buyer),
      isOrder = r.kind === "sale-order";
    const p = signed(d.proof, buyer.key, book, isOrder ? "order" : "decline");
    strict(p, [
      "protocol",
      "book",
      "purpose",
      "sale",
      "offer",
      "reference",
      "at",
    ]);
    check(
      p.sale === o.id && p.offer === o.digest && !o.order && !o.decline,
      "Respuesta ajena o duplicada",
    );
    num(p.at, o.quotedAt, at);
    if (isOrder) check(at < o.expires && p.at < o.expires, "Oferta vencida");
    ref(p.reference);
    const reference = bankKey(o.buyer, p.reference);
    check(!b.references.has(reference), "Referencia comercial reutilizada");
    const maxCost = o.choice.candidates.find(
      (c) => c.id === o.choice.selected.id,
    ).maxCost;
    if (isOrder)
      check(
        ![...b.offers.values()].some(
          (other) =>
            other.order &&
            other.buyer === o.buyer &&
            other.inputHash === o.inputHash,
        ),
        "El comprador ya aceptó este expediente",
      );
    if (isOrder)
      check(
        maxCost <= cashAvailable(s, lookup(b.accounts, o.account)),
        "Caja comprometida en otros pedidos",
      );
    return {
      sale: o.id,
      reference,
      at: p.at,
      document: hash(p),
      ...(isOrder ? { maxCost } : {}),
    };
  }
  if (r.kind === "sale-delivery") {
    strict(d, ["sale", "proof"]);
    const initial = lookup(b.offers, d.sale),
      buyer = lookup(b.clients, initial.buyer),
      p = signed(d.proof, buyer.key, book, "delivery");
    strict(p, [
      "protocol",
      "book",
      "purpose",
      "sale",
      "offer",
      "order",
      "recoveryCents",
      "reference",
      "source",
      "at",
    ]);
    const o = ordered(s, p);
    check(
      initial.id === o.id && !o.delivery && p.order === o.order.document,
      "Entrega ajena al pedido",
    );
    num(p.at, o.order.at, at);
    money(p.recoveryCents);
    ref(p.reference);
    fingerprint(p.source);
    const reference = bankKey(o.buyer, p.reference);
    check(
      !b.references.has(reference) && !b.references.has("recovery/" + p.source),
      "Recuperación contabilizada dos veces",
    );
    const amount = fee(
      Math.min(p.recoveryCents, o.terms.ceilingCents),
      o.choice.selected,
    );
    return {
      sale: o.id,
      at: p.at,
      recovery: p.recoveryCents,
      fee: amount,
      source: p.source,
      reference,
      document: hash(p),
    };
  }
  if (r.kind === "sale-activity") {
    strict(d, ["id", "buyer", "pilot", "proof"]);
    key(d.id);
    key(d.pilot);
    const buyer = lookup(b.clients, d.buyer),
      p = signed(d.proof, buyer.key, book, "activity");
    strict(p, [
      "protocol",
      "book",
      "purpose",
      "buyer",
      "pilot",
      "from",
      "until",
      "minutes",
      "source",
    ]);
    const t = trials.find((t) => t.trial === d.pilot),
      u = t?.pairs.flat().find((u) => u.subject === buyer.id);
    check(
      u &&
        u[u.arm].action !== "OFFER" &&
        p.buyer === buyer.id &&
        p.pilot === t.trial &&
        p.from === t.from &&
        p.until === t.until &&
        t.until <= at,
      "Trabajo fuera de la asignación o ventana firmada",
    );
    check(
      !b.activities.has(d.id) &&
        ![...b.activities.values()].some(
          (a) => a.buyer === buyer.id && a.pilot === d.pilot,
        ),
      "Parte de actividad duplicado",
    );
    fingerprint(p.source);
    check(
      !b.references.has("timesheet/" + p.source),
      "Parte de horas reutilizado",
    );
    num(p.minutes, 0, 1e7);
    const labor = Math.ceil((t.hourlyCents * p.minutes) / 60);
    money(labor);
    return {
      id: d.id,
      buyer: buyer.id,
      pilot: t.trial,
      scope: t.scope,
      from: t.from,
      until: t.until,
      labor,
      minutes: p.minutes,
      source: p.source,
      account: buyer.account,
      mode: buyer.mode,
    };
  }
  if (r.kind === "sale-bank") {
    strict(d, ["account", "proof"]);
    const account = lookup(b.accounts, d.account),
      p = signed(d.proof, account.key, book, "statement");
    strict(p, [
      "protocol",
      "book",
      "purpose",
      "account",
      "previous",
      "currency",
      "from",
      "until",
      "opening",
      "closing",
      "lines",
      "source",
    ]);
    check(
      p.account === account.id &&
        p.currency === account.currency &&
        p.previous === account.tip &&
        p.opening === account.balance &&
        p.from === account.until,
      "Extracto con huecos o revisión caducada",
    );
    num(p.until, p.from + 1, at + 1);
    money(p.closing);
    fingerprint(p.source);
    check(!b.references.has("bank/" + p.source), "Extracto reutilizado");
    unique(list(p.lines, 0, 10000).map((l) => ref(l.id)));
    let balance = p.opening;
    const pending = new Map(),
      refunded = new Map(account.refunded ?? []);
    for (const l of p.lines) {
      strict(l, ["id", "at", "kind", "cents", "sale", "original"]);
      num(l.at, p.from, p.until - 1);
      num(l.cents, 1, maxCash);
      const tx = bankKey(account.id, l.id);
      check(!b.ledger.has(tx), "Movimiento bancario duplicado");
      check(
        [
          "fee",
          "refund",
          "cost",
          "research",
          "overhead",
          "funding",
          "unapplied",
          "field-cost",
        ].includes(l.kind),
        "Categoría bancaria desconocida",
      );
      if (["fee", "refund", "cost"].includes(l.kind)) {
        const o = lookup(b.offers, l.sale);
        check(
          o.account === account.id && l.at >= o.quotedAt,
          "Movimiento de otra venta",
        );
        if (l.kind === "fee" || l.kind === "refund")
          check(
            o.delivery && l.at >= o.delivery.at,
            "Cobro sin entrega aceptada",
          );
      } else check(l.sale === null, "Movimiento común asignado a una venta");
      if (l.kind === "refund") {
        const k = bankKey(account.id, ref(l.original)),
          old = pending.get(k) ?? b.ledger.get(k);
        check(
          old?.kind === "fee" && old.sale === l.sale && l.at >= old.at,
          "Reembolso sin cobro original",
        );
        const total = (refunded.get(k) ?? 0) + l.cents;
        check(total <= old.cents, "Reembolso superior al cobro");
        refunded.set(k, total);
      } else if (l.kind === "field-cost") {
        const a = lookup(b.activities, l.original);
        check(
          a.account === account.id && a.from <= l.at && l.at < a.until,
          "Gasto ajeno al ensayo o la cuenta",
        );
      } else if (l.kind === "research") {
        const job = lookup(s.jobs, l.original);
        check(
          job.settlement?.reference === l.id &&
            job.settlement.cents === l.cents &&
            [...b.offers.values()].some(
              (o) => o.job === job.id && o.account === account.id,
            ),
          "Gasto de investigación sin comprobante conciliado",
        );
        check(
          !b.references.has("research/" + job.id),
          "Gasto de investigación duplicado",
        );
      } else check(l.original === null, "Referencia de devolución inesperada");
      pending.set(tx, l);
      balance +=
        (["funding", "fee", "unapplied"].includes(l.kind) ? 1 : -1) * l.cents;
      num(balance, -1e14, 1e14);
    }
    check(balance === p.closing, "El extracto no concilia con los saldos");
    return {
      account: account.id,
      until: p.until,
      balance,
      source: p.source,
      tip: hash(p),
      lines: p.lines,
      refunded: [...refunded],
    };
  }
  if (r.kind === "sale-assign") {
    strict(d, ["account", "proof"]);
    const account = lookup(b.accounts, d.account),
      p = signed(d.proof, account.key, book, "allocation");
    strict(p, [
      "protocol",
      "book",
      "purpose",
      "account",
      "original",
      "parts",
      "source",
      "at",
    ]);
    const original = b.ledger.get(bankKey(account.id, ref(p.original)));
    check(
      p.account === account.id && original?.kind === "unapplied",
      "El movimiento ya está asignado o pertenece a otra cuenta",
    );
    num(p.at, original.at, at);
    fingerprint(p.source);
    check(
      !b.references.has("allocation/" + p.source),
      "Comprobante de distribución repetido",
    );
    unique(list(p.parts, 1, 64).map((part) => ref(part.id)));
    let total = 0;
    const lines = p.parts.map((part) => {
      strict(part, ["id", "kind", "sale", "cents"]);
      num(part.cents, 1, maxCash);
      total += part.cents;
      check(
        !b.ledger.has(bankKey(account.id, part.id)),
        "Identificador de partida ya registrado",
      );
      if (part.kind === "fee") {
        const o = lookup(b.offers, part.sale);
        check(
          o.account === account.id &&
            o.delivery &&
            original.at >= o.delivery.at,
          "El cobro debe corresponder a una entrega aceptada",
        );
      } else
        check(
          part.kind === "funding" && part.sale === null,
          "Clasificación de ingreso inválida",
        );
      return {
        ...part,
        at: original.at,
        original: null,
        bankOrigin: p.original,
        account: account.id,
      };
    });
    check(
      total === original.cents,
      "Las partidas deben conservar el total del movimiento bancario",
    );
    return {
      account: account.id,
      original: p.original,
      source: p.source,
      lines,
    };
  }
  if (r.kind === "sale-close") {
    strict(d, [
      "sale",
      "through",
      "minutes",
      "hourlyCents",
      "evidence",
      "previous",
    ]);
    const o = lookup(b.offers, d.sale),
      a = lookup(b.accounts, o.account);
    const completed =
      o.delivery?.at ??
      o.decline?.at ??
      (!o.order && at >= o.expires ? o.expires : null);
    check(
      completed !== null && d.previous === (o.close?.digest ?? null),
      "Cierre sin desenlace o revisión vencida",
    );
    num(
      d.through,
      Math.max(completed + 1, o.close?.through ?? 0),
      Math.min(at + 1, a.until),
    );
    num(d.minutes, 0, 1e7);
    money(d.hourlyCents);
    fingerprint(d.evidence);
    const labor = Math.ceil((d.minutes * d.hourlyCents) / 60);
    num(labor, 0, maxCash);
    check(
      !b.references.has("timesheet/" + d.evidence),
      "Parte de horas reutilizado",
    );
    return { ...d, labor, digest: hash(d) };
  }
  throw Error("Orden de venta desconocida");
}
export function applySale(s, kind, d) {
  const b = s.sales;
  if (kind === "sale-client") b.clients.set(d.id, d);
  else if (kind === "sale-account")
    b.accounts.set(d.id, { ...d, refunded: [] });
  else if (kind === "sale-offer")
    b.offers.set(d.id, {
      ...d,
      order: null,
      decline: null,
      delivery: null,
      close: null,
      closes: [],
    });
  else if (kind === "sale-activity") {
    b.activities.set(d.id, d);
    b.references.add("timesheet/" + d.source);
  } else if (kind === "sale-assign") {
    const original = b.ledger.get(bankKey(d.account, d.original));
    original.kind = "allocated";
    b.references.add("allocation/" + d.source);
    for (const l of d.lines) b.ledger.set(bankKey(d.account, l.id), l);
  } else if (kind === "sale-bank") {
    const a = b.accounts.get(d.account);
    Object.assign(a, {
      until: d.until,
      tip: d.tip,
      balance: d.balance,
      refunded: d.refunded,
    });
    b.references.add("bank/" + d.source);
    for (const l of d.lines) {
      b.ledger.set(bankKey(d.account, l.id), { ...l, account: d.account });
      if (l.kind === "research") b.references.add("research/" + l.original);
    }
  } else {
    const o = b.offers.get(d.sale);
    if (kind === "sale-close") {
      o.close = d;
      o.closes = [
        ...(o.closes ?? []).filter((x) => x.through !== d.through),
        d,
      ];
      b.references.add("timesheet/" + d.evidence);
    } else if (kind === "sale-delivery") {
      o.delivery = d;
      b.references.add(d.reference);
      b.references.add("recovery/" + d.source);
    } else {
      o[kind === "sale-order" ? "order" : "decline"] = d;
      b.references.add(d.reference);
    }
  }
}
export function salesReport(s, modeValue = "LIVE") {
  mode(modeValue);
  const b = s.sales,
    offers = [...b.offers.values()].filter((o) => o.mode === modeValue);
  const eligibleAccounts = [...b.accounts.values()].filter(
    (a) => a.mode === modeValue,
  );
  const raw = [...b.ledger.values()].filter(
    (t) => b.accounts.get(t.account).mode === modeValue,
  );
  const total = (rows, kind) =>
    rows.filter((t) => t.kind === kind).reduce((sum, t) => sum + t.cents, 0);
  const deals = offers.map((o) => {
    const rows = raw.filter((t) => t.sale === o.id),
      account = b.accounts.get(o.account);
    const gross = total(rows, "fee"),
      refund = total(rows, "refund"),
      expense = total(rows, "cost"),
      cash = gross - refund;
    const earned = o.delivery?.fee ?? 0,
      recognized = Math.min(cash, earned),
      excess = cash - recognized;
    const fresh = o.close !== null && o.close.through === account.until;
    const net = fresh ? recognized - expense - o.close.labor : null;
    const state = !o.order
      ? o.decline
        ? "DECLINED"
        : o.close
          ? "EXPIRED"
          : "QUOTED"
      : !o.delivery
        ? "ORDERED"
        : !fresh
          ? "AWAIT_RECONCILIATION"
          : recognized < earned
            ? "UNPAID_OR_REFUNDED"
            : net > 0
              ? "POSITIVE_DIRECT_MARGIN"
              : "NO_POSITIVE_MARGIN";
    return {
      id: o.id,
      job: o.job,
      buyer: o.buyer,
      group: o.group,
      mode: o.mode,
      program: o.program,
      pilot: o.pilot,
      state,
      quotedAt: o.quotedAt,
      through: account.until,
      recoveryConfirmedCents: o.delivery?.recovery ?? null,
      earnedCents: earned,
      bankPaidCents: gross,
      refundCents: refund,
      unappliedCents: excess,
      collectedCents: recognized,
      costCents: expense,
      laborCents: fresh ? o.close.labor : null,
      directNetCents: net,
      invoice: o.delivery?.document ?? null,
    };
  });
  const complete =
    deals.length > 0 && deals.every((d) => d.directNetCents !== null);
  const activities = [...b.activities.values()].filter(
    (a) => a.mode === modeValue,
  );
  const activityLabor = activities.reduce((v, a) => v + a.labor, 0),
    activityCosts = total(raw, "field-cost");
  const overhead = total(raw, "overhead") + activityLabor + activityCosts;
  const positive = deals.filter((d) => d.state === "POSITIVE_DIRECT_MARGIN"),
    groups = new Set(positive.map((d) => d.group));
  const distinctJobs = [...new Set(deals.map((d) => d.job))],
    research = distinctJobs.reduce(
      (v, id) => v + (s.jobs.get(id)?.settlement?.cents ?? 0),
      0,
    );
  const bankResearch = total(raw, "research"),
    unmatchedResearch = distinctJobs.filter(
      (id) =>
        s.jobs.get(id)?.settlement?.cents > 0 &&
        !raw.some((l) => l.kind === "research" && l.original === id),
    );
  const unassigned =
    total(raw, "unapplied") + deals.reduce((v, d) => v + d.unappliedCents, 0);
  const campaign =
    complete && !unmatchedResearch.length && unassigned === 0
      ? deals.reduce((v, d) => v + d.directNetCents, 0) -
        overhead -
        bankResearch
      : null;
  const scopes = [
    ...new Set(deals.map((d) => commercialScope(s.jobs.get(d.job)))),
  ].map((scope) => {
    const scoped = deals.filter(
      (d) => commercialScope(s.jobs.get(d.job)) === scope,
    );
    const jobs = new Set(scoped.map((d) => d.job));
    const ready =
      unassigned === 0 &&
      scoped.every((d) => d.directNetCents !== null) &&
      !unmatchedResearch.some((id) => jobs.has(id));
    const direct = scoped.reduce((n, d) => n + (d.directNetCents ?? 0), 0);
    const research = total(
      raw.filter((l) => jobs.has(l.original)),
      "research",
    );
    return {
      scope,
      deals: scoped.length,
      netLowerCents: ready ? direct - research - overhead : null,
      overheadAssumption:
        "todo el gasto común se asigna a este alcance para obtener su cota inferior",
    };
  });
  return {
    mode: modeValue,
    scopes,
    currency: s.open?.currency ?? null,
    accounts: eligibleAccounts.length,
    deals,
    quoted: offers.length,
    bankCollectedCents: deals.reduce((n, d) => n + d.collectedCents, 0),
    overheadCents: overhead,
    activityLaborCents: activityLabor,
    activityCostCents: activityCosts,
    researchCents: research,
    bankResearchCents: bankResearch,
    unassignedCents: unassigned,
    unmatchedResearch,
    campaignNetCents: campaign,
    independentPayingGroups: groups.size,
    repeatability:
      groups.size >= 2 && campaign > 0
        ? "POSITIVE_ACROSS_BUYER_GROUPS"
        : "AWAIT_INDEPENDENT_PROFITABLE_SALES",
    measurement:
      "Resultados del libro y de las cuentas declaradas hasta su último corte bancario y de horas",
  };
}
