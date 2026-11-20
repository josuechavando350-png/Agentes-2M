import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import {
  creditRegister,
  creditRange,
  traceCredits,
} from "../../src/sale/credits.mjs";
import { hash } from "../../src/factory/reader.mjs";
const packet = JSON.parse(readFileSync(process.argv[2])),
  start = performance.now(),
  register = creditRegister(packet),
  ms = performance.now() - start;
const total = traceCredits(packet).report,
  groups = new Map();
const key = (r) => JSON.stringify([r.party, r.sku, r.price]);
for (const r of packet.lines) {
  const k = key(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
let checked = 0,
  censored = 0,
  documentableCents = 0,
  censoredCents = 0,
  withIndividualShortfall = 0;
for (const c of register.rows) {
  const rank = creditRange({ ...packet, lines: groups.get(key(c)) }, c.id);
  assert.deepEqual(
    [rank.minBacked, rank.maxBacked],
    [c.minBacked, c.maxBacked],
  );
  checked++;
  censored += Number(c.leftCensored);
  withIndividualShortfall += Number(c.unavoidableUnmatched > 0);
  if (c.leftCensored) censoredCents += c.unavoidableCents;
  else documentableCents += c.unavoidableCents;
}
assert.equal(register.unavoidableCents, censoredCents + documentableCents);
assert.ok(total.unmatchedValueCents >= register.unavoidableCents);
console.log(
  JSON.stringify(
    {
      mode: "HISTORICAL_DOCUMENTARY",
      currency: register.currency,
      source: register.source,
      input: register.inputHash,
      windowDays: packet.maxAgeDays,
      registered: register.notes,
      checkedWithThreeIndependentRanks: checked,
      ambiguousNotes: register.ambiguousNotes,
      withIndividualShortfall,
      leftCensoredNotes: censored,
      aggregateUnmatchedCents: total.unmatchedValueCents,
      individualUnavoidableCents: register.unavoidableCents,
      atBeginningOfFileCents: censoredCents,
      individualWithCompleteLookbackCents: documentableCents,
      sharedShortfallCents:
        total.unmatchedValueCents - register.unavoidableCents,
      registerHash: hash(register),
      milliseconds: ms,
      ownRecoveryCents: null,
    },
    null,
    2,
  ),
);
