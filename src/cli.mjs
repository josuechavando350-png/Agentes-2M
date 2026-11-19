import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { trainRound } from "./academy.mjs";
import { integer } from "./policy.mjs";
import { Semar } from "./semar.mjs";

const [action = "status", ...args] = process.argv.slice(2);
const store = new Semar(
  action === "demo" ? ":memory:" : (process.env.SEMAR_DB ?? "semar.sqlite"),
);
const show = (x) => console.log(JSON.stringify(x, null, 2));
try {
  switch (action) {
    case "resume": {
      const evidence = new URL("../evidence/", import.meta.url);
      const { audit } = JSON.parse(
        readFileSync(new URL("escuela-inicial.json", evidence), "utf8"),
      );
      const log = gunzipSync(
        readFileSync(new URL("escuela-inicial.json.gz", evidence)),
        { maxOutputLength: 8_000_000 },
      );
      show(store.restore(JSON.parse(log), audit.tip));
      break;
    }
    case "init":
      show(
        await store.command("genesis", {
          type: "init",
          reserve: Number(args[0] ?? 66600),
        }),
      );
      break;
    case "academy": {
      const first = integer(Number(args[0] ?? 1), 1, 10_000_000, "inicio");
      const rounds = integer(
        Number(args[1] ?? 1),
        1,
        10_000_001 - first,
        "rondas",
      );
      for (let i = first; i < first + rounds; i++) {
        const round = await trainRound(store, i);
        show(round);
        if (round.status !== "COMPLETED") break;
      }
      break;
    }
    case "census":
      show(store.census(...args.map(Number)));
      break;
    case "status":
      show(store.status());
      break;
    case "agent":
      show(store.agent(Number(args[0])));
      break;
    case "feed":
      show(store.feed(args[0], Number(args[1] ?? 0), Number(args[2] ?? 100)));
      break;
    case "audit":
      show(store.audit(args[0]));
      break;
    case "request":
      show(await store.command(args[0], JSON.parse(readFileSync(0, "utf8"))));
      break;
    case "demo": {
      await store.command("genesis", { type: "init", reserve: 66600 });
      const work = (id, op, data) => ({
        type: "work",
        id,
        generation: 1,
        version: 1,
        op,
        data,
      });
      const teacher = await store.command(
        "ensena",
        work(5_000_001, "nonAdjacent", [8, 1, 9, 2, 8]),
      );
      const student = await store.command(
        "aprender",
        work(1_000_001, "nonAdjacent", [3, 8, 1, 9]),
      );
      const child = await store.command("replica", {
        ...work(student.first, "nonAdjacent", [7, 1, 8]),
        version: 2,
      });
      const council = await store.command("consejo", {
        type: "council",
        sector: 2,
        op: "nonAdjacent",
      });
      show({
        teacher,
        student,
        child,
        council,
        registry: store.status(),
        audit: store.audit(),
      });
      break;
    }
    default:
      throw Error(
        "Usa init, resume, status, academy, census, agent, request, feed, audit o demo",
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.close();
}
