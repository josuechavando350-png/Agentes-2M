import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  traceCredits,
  creditRange,
  verifyCredits,
} from "../../src/sale/credits.mjs";
import { hash } from "../../src/factory/reader.mjs";
const dir = process.argv[2],
  read = (name) => JSON.parse(readFileSync(join(dir, name + ".json")));
const packet = read("packet"),
  runs = [];
for (const days of [30, 90, 365]) {
  const scoped = { ...packet, maxAgeDays: days },
    start = performance.now(),
    result = traceCredits(scoped);
  if (days === 90)
    writeFileSync(
      join(dir, "certificate.json"),
      JSON.stringify(result.certificate) + "\n",
    );
  const verification = verifyCredits(scoped, result.certificate);
  runs.push({
    ...verification,
    certificateHash: hash(result.certificate),
    elapsedMs: performance.now() - start,
  });
}
const sample = packet.lines
  .filter((l) => l.qty < 0)
  .sort((a, b) => {
    const x = hash(a.id),
      y = hash(b.id);
    return x < y ? -1 : x > y ? 1 : 0;
  })
  .slice(0, 6)
  .map((c) => creditRange(packet, c.id));
console.log(
  JSON.stringify(
    {
      source: "Daqing Chen, Online Retail, UCI, DOI 10.24432/C5BW33, CC BY 4.0",
      mode: "historical ledger reconciliation",
      intake: read("intake"),
      runs,
      sample,
      ownRecoveryCents: null,
      ownRevenueCents: null,
    },
    null,
    2,
  ),
);
