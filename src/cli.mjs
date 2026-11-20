import { commercialList } from "./commercial-decision.mjs";
import { DecisionBook } from "./decision-book.mjs";
import {
  populationResearch,
  verifyPopulation,
  submitPopulation,
} from "./population-research.mjs";
import { activeProgram } from "./market-methods.mjs";
import { admittedModel, allocate, accountForecast } from "./account-market.mjs";
import { digest } from "./policy.mjs";
import { join } from "node:path";
import { materialize, openPacked } from "./packed.mjs";
import {
  runBatch,
  packBatch,
  scanShard,
  mergeShards,
} from "./distribution.mjs";
import { serve } from "./serve.mjs";
import { importSources } from "./sources.mjs";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { trainRound } from "./academy.mjs";
import { enrollAndExercise } from "./rollout.mjs";
import {
  integer,
  INITIAL,
  LEGACY_INITIAL,
  STIPEND,
  BATCH,
  SECTORS,
} from "./policy.mjs";
import { Semar } from "./semar.mjs";

const [action = "status", ...args] = process.argv.slice(2);
const store = new Semar(
  ["demo", "global-demo", "packed", "batch-scan"].includes(action)
    ? ":memory:"
    : (process.env.SEMAR_DB ?? "semar.sqlite"),
);
const show = (x) => console.log(JSON.stringify(x, null, 2));
try {
  switch (action) {
    case "global-command":
    case "global-run":
    case "global-audit":
    case "global-work":
    case "global-replay":
    case "global-status":
    case "global-regressions":
    case "global-aware":
    case "global-feed":
    case "global-report": {
      const { GlobalDesk } = await import("./global-desk.mjs");
      const desk = new GlobalDesk(
        process.env.SEMAR_DB ?? "semar.sqlite",
        store,
      );
      try {
        if (action === "global-status") show(desk.view());
        else if (action === "global-audit") show(await desk.audit());
        else if (action === "global-aware") {
          const view = desk.view(),
            actor = store.agent(Number(args[0]));
          const wallet = view.workers?.find(
            (w) => w.id === actor.id && w.generation === actor.generation,
          );
          show({
            id: actor.id,
            generation: actor.generation,
            alive: actor.status === "LIVE",
            authorized:
              !!wallet && view.status === "ACTIVE" && wallet.status === "LIVE",
            remainingMs: Math.max(0, (view.until ?? 0) - Date.now()),
            currency: view.currency ?? null,
            globalFreeCents: view.freeCents ?? 0,
            actorFreeCents: wallet
              ? wallet.limit - wallet.spent - wallet.held
              : 0,
            operations: wallet?.ops ?? [],
            zero: "DEAD_ZERO",
          });
        } else if (action === "global-feed") {
          if (
            ![
              "diablo-666",
              ...Array.from({ length: 10 }, (_, i) => "L" + (i + 1)),
            ].includes(args[0])
          )
            throw Error("Líder desconocido");
          const state = desk.read();
          show(
            [...state.jobs.values()].map((j) => ({
              job: j.id,
              scope: j.snapshot.goal.scope,
              status: j.status,
              sectors: j.snapshot.team.map((a) => "L" + a.sector),
              decision: j.output?.decision.action ?? null,
              tasks: j.output?.decision.plan ?? [],
              next: j.output?.decision.next ?? null,
            })),
          );
        } else if (action === "global-regressions") {
          const report = await desk.regressions();
          show(report);
          if (report.failures) process.exitCode = 1;
        } else if (action === "global-work") show(await desk.delivery(args[0]));
        else if (action === "global-replay") show(await desk.replay(args[0]));
        else if (action === "global-report") {
          const state = desk.read(),
            j = state.jobs.get(state.aliases.get(args[0]) ?? args[0]);
          if (!j) throw Error("Trabajo desconocido");
          show({
            ...j,
            runtime: j.runtime,
            live: desk.view().jobs.find((v) => v.id === j.id),
          });
        } else {
          const envelope = JSON.parse(readFileSync(args[0] ?? 0, "utf8"));
          if (
            action === "global-run" &&
            !["reserve", "reserve-brief", "reserve-method", "refresh"].includes(
              envelope.record?.kind,
            )
          )
            throw Error("Se requiere una reserva firmada");
          const event = desk.command(envelope);
          if (action === "global-run") {
            if (event.kind === "clarify") show(event.data);
            else show(await desk.delivery(event.key));
          } else
            show({
              id: event.key,
              kind: event.kind,
              hash: digest(event),
              data: event.data,
            });
        }
      } finally {
        desk.close();
      }
      break;
    }
    case "global-rank": {
      const { routedRank } = await import("./global-scale.mjs");
      const report = JSON.parse(
        readFileSync(new URL("../evidence/global-scale.json", import.meta.url)),
      );
      show(
        routedRank(
          store.layout(),
          JSON.parse(readFileSync(args[0], "utf8")),
          report,
          Number(args[1] ?? 100000000),
        ),
      );
      break;
    }
    case "global-scale": {
      const { scaleExam } = await import("./global-scale.mjs");
      const read = (p) => JSON.parse(readFileSync(p, "utf8"));
      show(
        scaleExam(
          store.layout(),
          read(args[0]),
          read(args[1]),
          args[2] ? Number(args[2]) : undefined,
          args[3] ? Number(args[3]) : null,
        ),
      );
      break;
    }
    case "global-demo": {
      const { globalDemo } = await import("../scripts/global/demo.mjs");
      show(await globalDemo());
      break;
    }
    case "restore-state": {
      if (!args[0])
        throw Error("Indica el directorio escuela de la rama estado-semar");
      const meta = JSON.parse(
        readFileSync(join(args[0], "avance.json"), "utf8"),
      );
      const journal = gunzipSync(
        readFileSync(join(args[0], "bitacora.json.gz")),
        { maxOutputLength: 64_000_000 },
      );
      show(store.restore(JSON.parse(journal), meta.audit.tip));
      break;
    }
    case "resume": {
      const evidence = new URL("../evidence/", import.meta.url);
      const { audit } = JSON.parse(
        readFileSync(new URL("escuela-inicial.json", evidence), "utf8"),
      );
      const log = gunzipSync(
        readFileSync(new URL("escuela-inicial.json.gz", evidence)),
        { maxOutputLength: 8_000_000 },
      );
      const staging = new Semar(":memory:");
      try {
        staging.restore(JSON.parse(log), audit.tip);
        await staging.command("dotacion-unica-de-incubacion", {
          type: "reserve_births",
        });
        await staging.command("mando-diablo-666", {
          type: "install_government",
        });
        await enrollAndExercise(staging);
        const checkpoint = staging.checkpoint();
        show(store.restore(checkpoint.events, checkpoint.tip));
      } finally {
        staging.close();
      }
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
    case "upgrade": {
      const state = store.status();
      if (!state.population) throw Error("Inicializa o restaura un padrón");
      if (
        state.treasury <
        ((state.founders ? 0 : INITIAL - LEGACY_INITIAL) +
          SECTORS.length * BATCH) *
          STIPEND
      ) {
        await store.command("dotacion-unica-de-incubacion", {
          type: "reserve_births",
        });
      }
      await store.command("mando-diablo-666", { type: "install_government" });
      show(await enrollAndExercise(store));
      break;
    }
    case "academy": {
      const founders = store.status().founders ?? 10_000_000;
      const first = integer(Number(args[0] ?? 1), 1, founders, "inicio");
      const rounds = integer(
        Number(args[1] ?? 1),
        1,
        founders + 1 - first,
        "rondas",
      );
      for (let i = first; i < first + rounds; i++) {
        const round = await trainRound(store, i);
        show(round);
        if (round.status !== "COMPLETED") break;
      }
      break;
    }
    case "census": {
      const examine = args.at(-1) === "--examine";
      const range = examine ? args.slice(0, -1) : args;
      if (range.length > 2)
        throw Error("Usa census [primer-ID] [último-ID] [--examine]");
      show(
        store.census(
          range[0] === undefined ? undefined : Number(range[0]),
          range[1] === undefined ? undefined : Number(range[1]),
          { examine },
        ),
      );
      break;
    }
    case "mission":
      show(store.mission());
      break;
    case "aware":
      show(store.awareness(Number(args[0])));
      break;
    case "decision-run":
    case "decision-register":
    case "decision-plan":
    case "decision-answer":
    case "decision-seal":
    case "decision-close":
    case "decision-list":
    case "decision-verdict": {
      const book = new DecisionBook(process.env.SEMAR_DB ?? "semar.sqlite", {
        authority: store.settlementAuthority(),
      });
      const file = (p) => JSON.parse(readFileSync(p, "utf8"));
      try {
        if (action === "decision-run") {
          const input = file(args[0]),
            b = input.brief,
            series = "serie-" + digest(b.id).slice(0, 40);
          book.register({
            id: series,
            mode: b.mode,
            selection:
              "Todas las cuentas distintas entregadas en el expediente",
            cohorts: [
              {
                id: b.id,
                cutoff: b.cutoff,
                accounts: input.packet.queries.length,
                briefHash: digest(b),
              },
            ],
          });
          book.start(store.layout(), series, input);
          const current = book.latest(b.id);
          const plan = current.data.plan ?? book.sealed(b.id).plan;
          show({
            stage: current.kind,
            revision: current.hash,
            ...commercialList(plan),
            ...(current.kind === "GRADED"
              ? { evaluation: current.data.result }
              : {}),
          });
        } else if (action === "decision-register")
          show(book.register(file(args[0])));
        else if (action === "decision-plan") {
          const e = book.start(
            store.layout(),
            args[0],
            file(args[1]),
            args[2] ?? null,
          );
          show({ revision: e.hash, ...commercialList(e.data.plan) });
        } else if (action === "decision-answer") {
          const { answer, signature } = file(args[1]);
          const e = book.answer(store.layout(), args[0], answer, signature);
          show({ revision: e.hash, ...commercialList(e.data.plan) });
        } else if (action === "decision-seal")
          show(book.seal(args[0], args[1]));
        else if (action === "decision-close") {
          const { actual, signature } = file(args[2]);
          show(
            book.grade(args[0], args[1], actual, store.fieldTrials(), signature)
              .data.result,
          );
        } else if (action === "decision-verdict") show(book.verdict(args[0]));
        else {
          const e = book.latest(args[0]);
          const plan = e.data.plan ?? book.sealed(args[0]).plan;
          show({
            stage: e.kind,
            revision: e.hash,
            ...commercialList(plan),
            ...(e.kind === "GRADED" ? { evaluation: e.data.result } : {}),
          });
        }
      } finally {
        book.close();
      }
      break;
    }
    case "population-submit": {
      const [mission, input, result] = args;
      show(
        await submitPopulation(
          store,
          mission,
          JSON.parse(readFileSync(input, "utf8")),
          JSON.parse(readFileSync(result, "utf8")),
        ),
      );
      break;
    }
    case "population-rank":
    case "population-audit":
    case "population-receipt": {
      const packet = JSON.parse(readFileSync(args[0], "utf8")),
        layout = store.layout();
      if (action === "population-rank")
        show(
          populationResearch(
            layout,
            packet,
            args[1] === undefined ? undefined : Number(args[1]),
          ),
        );
      else {
        const report = JSON.parse(readFileSync(args[1], "utf8"));
        show(
          verifyPopulation(
            layout,
            packet,
            report,
            action === "population-receipt" ? Number(args[2]) : undefined,
          ),
        );
      }
      break;
    }
    case "method-rank":
    case "account-rank": {
      const [report, policy, rows] = args
        .slice(0, 3)
        .map((p) => JSON.parse(readFileSync(p, "utf8")));
      const model = admittedModel(policy, report),
        size = Number(args[3] ?? 1);
      const method =
        action === "method-rank"
          ? activeProgram(
              JSON.parse(readFileSync(args[4], "utf8")),
              model,
              report.scope,
            )
          : null;
      const mission = store.mission()?.mission;
      if (!mission || mission.phase === "CLOSED" || ![1, 10].includes(size))
        throw Error("Se requiere una misión abierta y equipo de 1 o 10");
      if (
        !Array.isArray(rows) ||
        !rows.length ||
        rows.length > 8192 ||
        new Set(rows.map((r) => r.id)).size !== rows.length
      )
        throw Error("Cuentas incompletas o duplicadas");
      const forecasts = [];
      for (const row of rows) accountForecast(row, model, [1]);
      for (const row of rows) {
        const c = {
          type:
            action === "method-rank"
              ? "method_prediction"
              : "account_prediction",
          ...(action === "method-rank" ? { program: method } : {}),
          mission: mission.id,
          size,
          row,
          model,
        };
        const base = "cuenta-" + digest(c).slice(0, 40);
        let key = base,
          retry = 0;
        while (
          ["STAFF_LIMIT", "BUDGET_LIMIT"].includes(store.receipt(key)?.status)
        )
          key = base + "-" + ++retry;
        const r = await store.command(key, c);
        if (!["METHOD_FORECAST", "ACCOUNT_FORECAST"].includes(r.status))
          throw Error(
            r.status + " tras " + forecasts.length + " cuentas confirmadas",
          );
        forecasts.push(r.detail);
      }
      show(allocate(forecasts));
      break;
    }
    case "field-trials":
      show(store.fieldTrials());
      break;
    case "field-method":
      show(store.fieldLesson(args[0]));
      break;
    case "field-hypotheses":
      show(store.fieldHypotheses(args[0]));
      break;
    case "pilot-product":
      show(store.pilotProduct(args[0], args[1]));
      break;
    case "business-queue":
      show(store.businessQueue());
      break;
    case "business-history":
      show(store.businessHistory());
      break;
    case "mission-sources":
      show(store.missionSources());
      break;
    case "sources":
      show(await importSources(store, args[0]));
      break;
    case "packed": {
      const pack = openPacked(args[0]);
      try {
        show({
          checkpoint: pack.checkpoint,
          agent: pack.agent(Number(args[1])),
        });
      } finally {
        pack.close();
      }
      break;
    }
    case "materialize":
      if (!args[0]) throw Error("Indica el archivo de salida .gz");
      show(
        await materialize(
          store.layout(),
          args[0],
          args[1] === undefined ? undefined : Number(args[1]),
        ),
      );
      break;
    case "distribute": {
      const jobs = JSON.parse(readFileSync(args[0], "utf8"));
      const result = await runBatch(
        store,
        jobs,
        args.length > 1 ? args.slice(1) : ["local"],
      );
      show(result);
      if (result.results.some((r) => r.error)) process.exitCode = 1;
      break;
    }
    case "batch-pack":
      show(packBatch(store, JSON.parse(readFileSync(args[0], "utf8"))));
      break;
    case "batch-scan":
      show(
        await scanShard(
          JSON.parse(readFileSync(args[0], "utf8")),
          Number(args[1]),
          Number(args[2]),
        ),
      );
      break;
    case "batch-merge": {
      const [jobs, batch, ...parts] = args.map((p) =>
        JSON.parse(readFileSync(p, "utf8")),
      );
      show(await mergeShards(store, jobs, batch, parts));
      break;
    }
    case "serve":
      await serve(store);
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
        "Usa init, resume, upgrade, status, academy, census, agent, request, feed, audit, mission, mission-sources, aware, sources, restore-state, materialize, packed, serve, distribute, batch-pack, batch-scan, batch-merge o demo",
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.close();
}
