import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { Semar } from "../src/semar.mjs";
import { trainRound } from "../src/academy.mjs";

const s = new Semar(":memory:");
try {
  await s.command("genesis", { type: "init", reserve: 133200 });
  const rounds = [];
  for (let i = 1; i <= 10; i++) rounds.push(await trainRound(s, i));
  if (rounds.some((r) => r.status !== "COMPLETED" || r.replicas !== 666))
    throw Error("Escuela incompleta");
  const checkpoint = s.checkpoint();
  const file = (name) => new URL("../evidence/" + name, import.meta.url);
  writeFileSync(
    file("escuela-inicial.json.gz"),
    gzipSync(JSON.stringify(checkpoint.events)),
  );
  writeFileSync(
    file("escuela-inicial.json"),
    JSON.stringify({ rounds, status: s.status(), audit: s.audit() }, null, 2) +
      "\n",
  );
  console.log(s.audit());
} finally {
  s.close();
}
