import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Semar } from "../../src/semar.mjs";
import { GlobalDesk } from "../../src/global-desk.mjs";
import { canonical } from "../../src/policy.mjs";
import { hash } from "../../src/factory/reader.mjs";
import { importCreditCsv } from "../../src/sale/credit-csv.mjs";
import { portfolio } from "../../src/sale/portfolio.mjs";

const day = 86400000,
  root = mkdtempSync(join(tmpdir(), "semar-aceptacion-sin-dinero-"));
const key = () => {
  const k = generateKeyPairSync("ed25519");
  return {
    publicKey: k.publicKey.export({ type: "spki", format: "pem" }).toString(),
    sign: (record) => ({
      record,
      signature: sign(
        null,
        Buffer.from(canonical(record)),
        k.privateKey,
      ).toString("base64"),
    }),
  };
};
const treasury = key(),
  registry = key(),
  bank = key();
const bankProfile = {
  delimiter: ",",
  amountFormat: "minor",
  columns: {
    reference: "folio",
    at: "fecha",
    amount: "importe",
    currency: "moneda",
    account: "cuenta",
  },
};
const creditFields = {
  id: "id",
  party: "parte",
  sku: "producto",
  price: "precio",
  qty: "cantidad",
  time: "fecha",
  invoice: "factura",
  currency: "moneda",
};
const facts = {
  buyer: "Empresa del examen",
  prior_spend_mxn_cents: 8000,
  authority: "Compras",
  access: "yes",
  alternative: "Manual",
  scope: "Conciliar",
  price_mxn_cents: 2000,
  cost_mxn_cents: 1000,
  delivery_days: 2,
  acceptance: "Firma de recepción",
};
const arm = (method, action) => ({
  method,
  field: "access",
  supported: action,
  missing: "HOLD",
  probe: "Verificar acceso escrito",
  minutes: 6,
  outlayCents: 25,
  expectedPaidBps: 2000,
  expectedNetCents: 15,
});
async function week(number) {
  const book = "aceptacion-" + number,
    start = 1800000000000 + number * day * 8,
    path = join(root, book + ".sqlite"),
    directory = join(root, book);
  const end = start + day,
    limit = start + 7 * day;
  let now = start,
    seq = 0;
  mkdirSync(directory);
  const store = new Semar(path, { clock: () => now }),
    desk = new GlobalDesk(path, store, { clock: () => now });
  const save = (bytes) => {
    const h = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(directory, h), bytes);
    return h;
  };
  const attested = (signer, purpose, d) =>
    signer.sign({ protocol: "SEMAR-SALE-1", book, purpose, ...d });
  const run = (c) => store.command("base-" + ++seq, c);
  const governance = (type, record) => run({ type, ...treasury.sign(record) });
  const command = (kind, data, id = "paso-" + ++seq) =>
    desk.command(
      treasury.sign({ protocol: "SEMAR-GLOBAL-1", book, id, kind, data }),
    ).data;
  const enroll = (role, id, group, entity) =>
    attested(registry, "enrollment", {
      role,
      id,
      group,
      publicKey: entity.publicKey,
      from: start - 1000,
      until: limit,
      source: save(
        "Identidad ficticia para pruebas: " + book + "/" + role + "/" + id,
      ),
    });
  try {
    await run({ type: "init", reserve: 5000 });
    await run({ type: "open_mission", mission: "ensayo", budget: 1000 });
    await run({ type: "settlement_key", publicKey: treasury.publicKey });
    command("open", {
      budgetCents: 200,
      currency: "MXN",
      commercialAuthority: registry.publicKey,
      commercialBudget: "bank-outlays-v1",
      until: limit,
      maxJobCents: 100,
      permissions: ["read", "calculate"],
      actors: [
        {
          id: 1,
          generation: 1,
          limit: 100,
          ops: ["difference", "lookup", "product"],
          policy: "first",
        },
      ],
    });
    command("sale-account", {
      id: "cuenta",
      publicKey: bank.publicKey,
      mode: "LIVE",
      currency: "MXN",
      from: start - 1,
      balanceCents: 500,
      enrollment: enroll("bank", "cuenta", "cuenta", bank),
    });
    const pairs = Array.from({ length: 6 }, (_, i) => [
        "ua" + number + "-" + i,
        "ub" + number + "-" + i,
      ]),
      buyers = new Map();
    for (const subject of pairs.flat()) {
      const who = key();
      buyers.set(subject, who);
      command("sale-client", {
        id: subject,
        group: subject,
        account: "cuenta",
        mode: "LIVE",
        publicKey: who.publicKey,
        enrollment: enroll("buyer", subject, subject, who),
      });
      await run({
        type: "admit_source",
        document: {
          id: "d-" + subject,
          source: "expediente/" + subject,
          rows: Object.entries(facts).map(([field, value]) => ({
            subject,
            field,
            value,
          })),
        },
      });
      await run({
        type: "business_review",
        mission: "ensayo",
        size: 1,
        subject,
      });
    }
    const trial = await governance("trial_open", {
      mission: "ensayo",
      id: "piloto",
      scope: "conciliacion",
      pairs,
      control: arm("referencia", "ASK"),
      candidate: arm("oferta", "OFFER"),
      consent: "consentimiento ficticio para pruebas",
      days: 1,
      hourlyCents: 60,
      availableCashCents: 1000,
      availableMinutes: 72,
      minLiftCents: 10,
    });
    const units = trial.pairs.flat(),
      sales = new Map(),
      bankLines = [],
      fieldLines = new Map(units.map((u) => [u.subject, []]));
    let expectedNet = 0;
    const iso = (t) => new Date(t).toISOString();
    now += 2000;
    const line = (subject, id, kind, cents, sale = null, original = null) => ({
      id: subject + "-" + id,
      at: now,
      kind,
      cents,
      sale,
      original,
    });
    for (const u of units) {
      const id = u.subject,
        who = buyers.get(id);
      if (u.arm !== "candidate") {
        bankLines.push(line(id, "actividad", "field-cost", 1, null, "h-" + id));
        continue;
      }
      assert.equal(u[u.arm].action, "OFFER");
      const job = "j-" + id,
        offer = "p-" + id;
      const csv =
        "id,parte,producto,precio,cantidad,fecha,factura,moneda\n" +
        "v," +
        id +
        ",s,2.00,1," +
        iso(start - 3 * day) +
        ",V,MXN\n" +
        "c," +
        id +
        ",s,2.00,-4," +
        iso(start - day) +
        ",C,MXN\n";
      const packet = importCreditCsv(Buffer.from(csv), {
        fields: creditFields,
        delimiter: ",",
        decimal: ".",
        currency: "MXN",
        from: iso(start - 20 * day),
        until: iso(start),
        maxAgeDays: 5,
      });
      assert.equal(save(csv), packet.source);
      command(
        "credit-reserve",
        { scope: "conciliacion", buyer: id, packet, cap: 2 },
        job,
      );
      const product = await desk.work(job),
        costRef = id + "-investigacion";
      command("settle", { job, cents: 1, reference: costRef });
      bankLines.push(line(id, "investigacion", "research", 1, null, job));
      const input = { certificate: hash(product.credit.certificate) },
        terms = {
          floorCents: 0,
          ceilingCents: 400,
          buyerFeeLimitCents: 80,
          buyerKeepsBps: 8000,
          options: [
            {
              id: "contingente",
              shareBps: 2000,
              capCents: 80,
              fixedCostCents: 0,
              variableCostBps: 0,
            },
          ],
        };
      const basis = save("Condiciones del expediente ficticio " + id),
        mandate = attested(who, "brief", {
          buyer: id,
          job,
          input: hash(input),
          terms: hash(terms),
          source: basis,
          at: now,
          until: end,
        });
      const o = command("sale-offer", {
        id: offer,
        job,
        buyer: id,
        account: "cuenta",
        input,
        terms,
        expires: end,
        service: "Revisión documental de prueba",
        basis,
        pilot: "piloto",
        mandate,
      });
      const order = command("sale-order", {
        sale: offer,
        proof: attested(who, "order", {
          sale: offer,
          offer: o.digest,
          reference: "orden-" + id,
          at: now,
        }),
      });
      const delivered = command("sale-delivery", {
        sale: offer,
        proof: attested(who, "delivery", {
          sale: offer,
          offer: o.digest,
          order: order.document,
          recoveryCents: 300,
          reference: "entrega-" + id,
          source: save("Recuperación ficticia " + id),
          at: now,
        }),
      });
      assert.equal(delivered.fee, 60);
      bankLines.push(
        line(id, "abono", "fee", 60, offer),
        line(id, "costo", "cost", 3, offer),
      );
      sales.set(id, o);
    }
    const occurred = now;
    now = end;
    for (const u of units) {
      const id = u.subject,
        who = buyers.get(id);
      if (u.arm === "control")
        command("sale-activity", {
          id: "h-" + id,
          buyer: id,
          pilot: "piloto",
          proof: attested(who, "activity", {
            buyer: id,
            pilot: "piloto",
            from: start,
            until: end,
            minutes: 6,
            source: save("Parte del grupo de referencia " + id),
          }),
        });
      const fiscal =
        u.arm === "candidate"
          ? [
              ["paid", "payment", 60, id + "-abono"],
              ["expense", "cost", 3, id + "-costo"],
            ]
          : [["expense", "cost", 1, id + "-actividad"]];
      for (const [stage, category, cents, reference] of fiscal) {
        await governance("business_settlement", {
          mission: "ensayo",
          subject: id,
          sale: id,
          stage,
          cents,
          reference,
          currency: "MXN",
          contributors: [1],
        });
        fieldLines
          .get(id)
          .push({ stage, category, reference, occurredAt: occurred });
      }
      expectedNet += u.arm === "candidate" ? 60 - 3 - 6 - 1 : -1 - 6;
    }
    const amount = (l) => (l.kind === "fee" ? 1 : -1) * l.cents;
    const bankCsv =
      "folio,fecha,importe,moneda,cuenta\n" +
      bankLines
        .map((l) => [l.id, iso(l.at), amount(l), "MXN", "cuenta"].join(","))
        .join("\n") +
      "\n";
    command("sale-bank", {
      account: "cuenta",
      proof: attested(bank, "statement", {
        account: "cuenta",
        previous: null,
        currency: "MXN",
        from: start - 1,
        until: end,
        opening: 500,
        closing: 500 + bankLines.reduce((n, l) => n + amount(l), 0),
        lines: bankLines,
        source: save(bankCsv),
      }),
    });
    for (const u of units) {
      const id = u.subject;
      if (sales.has(id))
        command("sale-close", {
          sale: sales.get(id).id,
          through: end,
          minutes: 6,
          hourlyCents: 60,
          evidence: save("Horas de ejecución " + id),
          previous: null,
        });
      await governance("trial_observed", {
        trial: "piloto",
        subject: id,
        previous: null,
        settlements: fieldLines.get(id),
        humanMinutes: 6,
        applied: true,
        delivered: true,
        evidence: "cierre-" + id,
      });
    }
    const acquired = desk.readiness("LIVE");
    assert.equal(acquired.campaignNetCents, expectedNet);
    const trialReport = acquired.randomizedTrials[0];
    assert.equal(
      trialReport.status,
      "BANK_MATCHED_INCREMENTAL_MARGIN",
      JSON.stringify(trialReport),
    );
    assert.equal(trialReport.marginTest.upperP, 1 / 64);
    assert.equal((await desk.audit()).status, "VERIFIED");
    return {
      path,
      originals: { directory, bank: { cuenta: bankProfile } },
      units: units.length,
      verified: trialReport.matched,
      pairs: trialReport.marginTest.pairs,
      expectedNet,
    };
  } finally {
    desk.close();
    store.close();
  }
}
try {
  const a = await week(1),
    b = await week(2),
    paths = [a.path, b.path],
    originals = { [a.path]: a.originals, [b.path]: b.originals };
  assert.equal(
    (await portfolio(paths, "LIVE")).status,
    "SOURCE_VERIFICATION_REQUIRED",
  );
  const combined = await portfolio(paths, "LIVE", originals);
  assert.equal(
    combined.status,
    "REPLICATED_INCREMENTAL_MARGIN_IN_SCOPE",
    JSON.stringify(combined),
  );
  assert.equal(combined.portfolioNetCents, a.expectedNet + b.expectedNet);
  console.log(
    JSON.stringify(
      {
        mode: "SYNTHETIC_ACCEPTANCE_TEST",
        status: "PASSED",
        testBooks: 2,
        randomizedPairs: a.pairs + b.pairs,
        verifiedUnits: a.verified + b.verified,
        realOwnReceipts: null,
        scope:
          "Datos y firmantes creados para verificar los caminos de producción; las bases temporales se eliminan al terminar.",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
