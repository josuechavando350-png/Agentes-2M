import test from "node:test";
import assert from "node:assert/strict";
import { createHash as native } from "node:crypto";
import { createHash } from "../src/sale/browser/sha256.mjs";
test("La huella del navegador coincide con Node para fronteras de bloque, mezclas UTF-8 y archivos largos", () => {
  for (const size of [
    ...Array.from({ length: 260 }, (_, i) => i),
    65535,
    65536,
    65537,
    1000000,
  ]) {
    const bytes = Uint8Array.from(
      { length: size },
      (_, i) => (i * 31 + size) % 256,
    );
    const expected = native("sha256")
      .update("México🧾")
      .update(bytes)
      .digest("hex");
    for (const width of [17, 64, 129, Math.max(1, size)]) {
      const h = createHash("sha256").update("México🧾");
      for (let i = 0; i < size; i += width)
        h.update(bytes.subarray(i, i + width));
      assert.equal(h.digest("hex"), expected);
    }
  }
});
