import { commercialScope } from "./book.mjs";
import { checkOriginals } from "./originals.mjs";
import { existsSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { hash, check, list, unique } from "../factory/reader.mjs";
import { Semar } from "../semar.mjs";
import { GlobalDesk } from "../global-desk.mjs";

const identity = (pem) =>
  hash(
    createPublicKey(pem)
      .export({ format: "der", type: "spki" })
      .toString("hex"),
  );
export async function verifiedWeek(path, mode, originals) {
  check(existsSync(path), "Libro local inexistente");
  const store = new Semar(path),
    desk = new GlobalDesk(path, store);
  try {
    const governance = store.audit();
    const audit = await desk.audit(),
      s = desk.read(),
      report = desk.readiness(mode);
    check(
      s.open && s.tip === audit.tip && desk.read().tip === audit.tip,
      "El libro cambió durante la verificación o carece de mandato",
    );
    const accounts = [...s.sales.accounts.values()].filter(
      (a) => a.mode === mode,
    );
    const buyers = [...s.sales.clients.values()].filter((c) => c.mode === mode);
    const source = new Map(accounts.map((a) => [a.id, identity(a.key)]));
    const receipts = [...s.sales.ledger.values()]
      .filter((l) => source.has(l.account))
      .map((l) => hash([source.get(l.account), l.id]));
    const documentation = originals
      ? await checkOriginals(desk, mode, originals)
      : null;
    check(
      store.audit().tip === governance.tip &&
        (!documentation ||
          (documentation.tip === audit.tip &&
            documentation.governanceTip === governance.tip)),
      "Los originales o las asignaciones corresponden a otra revisión",
    );
    return {
      documentation,
      governanceTip: governance.tip,
      book: s.open.book,
      tip: audit.tip,
      authority: identity(store.settlementAuthority()),
      mode,
      currency: s.open.currency,
      buyers: Object.fromEntries(
        buyers.map((b) => [b.id, { group: b.group, signer: identity(b.key) }]),
      ),
      windows: accounts.map((a) => ({
        source: source.get(a.id),
        from: a.from,
        until: a.until,
      })),
      receipts,
      programs: Object.fromEntries(
        report.deals.map((d) => [d.job, commercialScope(s.jobs.get(d.job))]),
      ),
      report,
    };
  } finally {
    desk.close();
    store.close();
  }
}
export function combineWeeks(weeks) {
  list(weeks, 1, 104);
  unique(weeks.map((w) => w.tip));
  unique(weeks.map((w) => w.book));
  const first = weeks[0],
    paid = [],
    trials = [],
    windows = new Map();
  const allReceipts = new Set();
  let net = 0,
    complete = true,
    collected = 0;
  for (const w of weeks) {
    check(
      w.authority === first.authority &&
        w.mode === first.mode &&
        w.currency === first.currency,
      "Los mandatos no pertenecen al mismo titular, modo y moneda",
    );
    for (const h of w.receipts) {
      check(!allReceipts.has(h), "Comprobante bancario repetido entre semanas");
      allReceipts.add(h);
    }
    for (const x of w.windows) {
      const spans = windows.get(x.source) ?? [];
      check(
        spans.every((v) => x.until <= v.from || v.until <= x.from),
        "Ventanas bancarias superpuestas",
      );
      spans.push(x);
      windows.set(x.source, spans);
    }
    if (w.report.campaignNetCents === null) complete = false;
    else net += w.report.campaignNetCents;
    collected += w.report.bankCollectedCents;
    for (const d of w.report.deals)
      if (
        d.state === "POSITIVE_DIRECT_MARGIN" &&
        w.report.scopes.some(
          (s) => s.scope === w.programs[d.job] && s.netLowerCents > 0,
        )
      ) {
        paid.push({
          book: w.book,
          group: w.buyers[d.buyer].group,
          signer: w.buyers[d.buyer].signer,
          when: d.quotedAt,
          scope: w.programs[d.job],
          program: d.program,
          pilot: d.pilot,
        });
      }
    for (const t of w.report.randomizedTrials)
      if (t.status === "BANK_MATCHED_INCREMENTAL_MARGIN")
        trials.push({ ...t, book: w.book });
  }
  const repeated = paid.some((x, i) =>
    paid
      .slice(i + 1)
      .some(
        (y) =>
          x.book !== y.book &&
          x.scope === y.scope &&
          x.group !== y.group &&
          x.signer !== y.signer &&
          Math.abs(x.when - y.when) >= 7 * 86400000,
      ),
  );
  const repeatedEffect = paid.some((x, i) =>
    paid.slice(i + 1).some((y) => {
      if (
        x.book === y.book ||
        x.scope !== y.scope ||
        x.group === y.group ||
        x.signer === y.signer ||
        Math.abs(x.when - y.when) < 7 * 86400000
      )
        return false;
      const a = trials.find(
          (t) => t.book === x.book && t.scope === x.scope && t.id === x.pilot,
        ),
        b = trials.find(
          (t) => t.book === y.book && t.scope === y.scope && t.id === y.pilot,
        );
      return (
        a &&
        b &&
        a.candidate === b.candidate &&
        a.control === b.control &&
        (a.until <= b.from || b.until <= a.from)
      );
    }),
  );
  return {
    mode: first.mode,
    books: weeks.map((w) => ({
      book: w.book,
      tip: w.tip,
      commercialStatus: w.report.commercialStatus,
      documentation: w.documentation?.status ?? "SOURCE_FILES_PENDING",
    })),
    currency: first.currency,
    bankCollectedCents: collected,
    portfolioNetCents: complete ? net : null,
    distinctBankEntries: allReceipts.size,
    repeated,
    repeatedEffect,
    status:
      first.mode !== "LIVE"
        ? "DEMONSTRATION"
        : complete &&
            net > 0 &&
            weeks.some((w) => w.documentation?.status !== "ORIGINALS_MATCHED")
          ? "SOURCE_VERIFICATION_REQUIRED"
          : complete && net > 0 && repeatedEffect
            ? "REPLICATED_INCREMENTAL_MARGIN_IN_SCOPE"
            : complete && net > 0
              ? "POSITIVE_MARGIN_AWAIT_REPLICATION"
              : "AWAIT_COMPLETE_POSITIVE_MARGIN",
  };
}
export async function portfolio(paths, mode = "LIVE", originals = {}) {
  unique(list(paths, 1, 104));
  const weeks = [];
  for (const path of paths)
    weeks.push(await verifiedWeek(path, mode, originals[path]));
  return combineWeeks(weeks);
}
