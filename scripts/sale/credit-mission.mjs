import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleBook } from "../global/demo.mjs";
import { party } from "./pilot.mjs";
import { projectCreditFile } from "../../src/sale/credits.mjs";
import { hash } from "../../src/factory/reader.mjs";
const [path] = process.argv.slice(2);
const packet = JSON.parse(readFileSync(path, "utf8")),
  dir = mkdtempSync(join(tmpdir(), "semar-credito-"));
let e;
try {
  e = await exampleBook(join(dir, "state.sqlite"));
  const { command, desk } = e;
  command("open", "abrir", { ...e.grant, currency: packet.currency });
  command("sale-account", "cuenta", {
    id: "cuenta",
    publicKey: party().publicKey,
    mode: "DEMONSTRATION",
    currency: packet.currency,
    from: Date.now() - 60000,
    balanceCents: 10000,
  });
  command("sale-client", "comercio", {
    id: "comercio",
    group: "comercio",
    account: "cuenta",
    publicKey: party().publicKey,
    mode: "DEMONSTRATION",
  });
  command("credit-reserve", "auditar", {
    scope: "notas-credito",
    buyer: "comercio",
    ...projectCreditFile(packet),
    cap: 4,
  });
  const result = await desk.work("auditar"),
    report = result.credit.report;
  command("settle", "liquidar", {
    job: "auditar",
    cents: 1,
    reference: "ejemplo-sin-gasto-real",
  });
  assert.equal((await desk.replay("auditar")).verified, true);
  const ceiling = Math.min(report.unmatchedValueCents, 100000);
  const quote = command("sale-offer", "ofertar", {
    id: "piloto-credito",
    job: "auditar",
    buyer: "comercio",
    account: "cuenta",
    input: { certificate: hash(result.credit.certificate) },
    terms: {
      floorCents: 0,
      ceilingCents: ceiling,
      buyerFeeLimitCents: Math.floor(ceiling / 5),
      buyerKeepsBps: 8000,
      options: [
        {
          id: "contingente",
          shareBps: 2000,
          capCents: Math.max(1, Math.floor(ceiling / 5)),
          fixedCostCents: 0,
          variableCostBps: 0,
        },
      ],
    },
    basis: hash(["demostracion", packet.source]),
    expires: e.grant.until,
    service: "Revisión documental de notas de crédito",
    pilot: null,
  });
  assert.equal(quote.data.kind, "CREDIT_AUDIT");
  assert.equal(desk.sales().bankCollectedCents, 0);
  const submitted = desk.read().jobs.get("auditar").snapshot.creditProjection;
  const audit = await desk.audit();
  assert.equal(audit.status, "VERIFIED");
  console.log(
    JSON.stringify(
      process.argv[3] === "summary"
        ? {
            mode: "HISTORICAL_SIGNED_BOOK_TEST",
            submitted,
            creditNotes: report.credits,
            unmatchedCents: report.unmatchedValueCents,
            currency: report.currency,
            roles: result.nexus.roles,
            bookStatus: audit.status,
            reproduced: audit.reproduced,
            quoted: quote.data.kind,
            ownRevenue: null,
          }
        : {
            mode: "DEMONSTRATION_WITH_HISTORICAL_DATA",
            report,
            submitted,
            nexus: result.nexus.roles,
            preview: desk.quote("piloto-credito"),
            book: audit,
            liveCashCents: desk.sales().bankCollectedCents,
          },
      null,
      2,
    ),
  );
} finally {
  e?.close();
  rmSync(dir, { recursive: true, force: true });
}
