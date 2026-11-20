import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reviewQueue, verifyQueue } from "../src/sale/review-queue.mjs";
const sha = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
test("El plan de documentos iguala la enumeración exhaustiva con gastos compartidos por comprador", () => {
  let random = 1735;
  const draw = (n) =>
    (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) % n;
  for (let i = 0; i < 100; i++) {
    const packet = {
        source: sha(i),
        currency: "MXN",
        from: 0,
        until: 40 * 86400000,
        maxAgeDays: 3,
        lines: [],
      },
      docs = [];
    for (let d = 0; d < 9; d++) {
      const party = "p-" + draw(3),
        invoice = "i-" + d,
        face = 1 + draw(300),
        lines = 1 + draw(3);
      for (let k = 0; k < lines; k++)
        packet.lines.push({
          id: d + "-" + k,
          party,
          sku: "s",
          price: face,
          qty: -1,
          time: 20 * 86400000,
          invoice,
          row: d * 5 + k + 2,
        });
      docs.push({ party, lines, face: face * lines });
    }
    const spec = {
      minutes: draw(40),
      startBuyerMinutes: draw(5),
      openInvoiceMinutes: 1 + draw(4),
      perLineMinutes: draw(4),
      windowsDays: [2, 3],
      completeLookback: true,
    };
    let best = 0,
      time = 0;
    for (let mask = 1; mask < 512; mask++) {
      const selected = docs.filter((d, i) => (mask >> i) & 1),
        buyers = new Set(selected.map((d) => d.party));
      const spent =
          buyers.size * spec.startBuyerMinutes +
          selected.reduce(
            (s, d) =>
              s + spec.openInvoiceMinutes + d.lines * spec.perLineMinutes,
            0,
          ),
        value = selected.reduce((s, d) => s + d.face, 0);
      if (
        spent <= spec.minutes &&
        (value > best || (value === best && spent < time))
      ) {
        best = value;
        time = spent;
      }
    }
    const q = reviewQueue(packet, spec),
      v = verifyQueue(packet, spec, q);
    assert.deepEqual([q.reviewCents, q.minutes], [best, time]);
    assert.equal(v.upperCents, best);
    assert.ok(q.reviewCents >= q.faceValueBaseline.cents);
    if (q.selected.length) {
      const tampered = structuredClone(q);
      tampered.selected[0].sourceRows = [];
      const { certificate, ...data } = tampered;
      tampered.certificate = sha(data);
      assert.throws(() => verifyQueue(packet, spec, tampered), /alterado/);
    }
  }
});
