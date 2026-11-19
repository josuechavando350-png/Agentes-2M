import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";

const s = new Semar(":memory:"),
  school = new Semar(":memory:");
const read = (name) =>
  readFileSync(new URL("../evidence/" + name, import.meta.url));
try {
  await s.command("genesis", { type: "init", reserve: 66600 });
  assert.deepEqual(s.census(), JSON.parse(read("censo-inicial.json")));
  const recorded = JSON.parse(read("escuela-inicial.json"));
  assert.deepEqual(
    school.restore(
      JSON.parse(gunzipSync(read("escuela-inicial.json.gz"))),
      recorded.audit.tip,
    ),
    recorded.audit,
  );
  assert.deepEqual(school.status(), recorded.status);
  console.log(
    "Censo de 10 millones y escuela restaurada con 6,660 certificados.",
  );
} finally {
  s.close();
  school.close();
}
