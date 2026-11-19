import { importSources, discoverTenders } from "./sources.mjs";
import { digest } from "./policy.mjs";
import { MAX_TEAM_ROWS } from "./teams.mjs";
import { HOUR, allowance } from "./missions.mjs";

export async function runMission(s, { publicFeed = false, manifest } = {}) {
  await s.command("mando-diablo-666", { type: "install_government" });
  if (s.mission()?.mission?.sealed)
    return { feed: null, latest: "CLOSED", command: s.mission() };
  const epoch = Math.floor(s.clock() / (168 * HOUR));
  const vacant = !s.status().absolute.holder;
  const key =
    "concurso-diablo-" + epoch + (vacant ? "-sucesion-" + s.status().dead : "");
  if (!s.receipt(key)) {
    const candidates = ["crosscheck", "indexed"]
      .map((policy, i) => {
        const id = s.founderId(
          i + 1,
          5000 + ((epoch + (vacant ? s.status().dead : 0)) % 900000),
        );
        return { id, generation: s.agent(id).generation, policy };
      })
      .filter(
        (c) =>
          s.agent(c.id).status === "LIVE" &&
          c.id !== s.status().absolute.holder?.id,
      );
    if (candidates.length)
      await s.command(key, { type: "contest", candidates });
  }
  if (!s.mission().mission)
    await s.command("semana-inaugural", {
      type: "open_mission",
      mission: "semana-inaugural",
      budget: 168,
    });
  const m = s.mission().mission;
  let feed = null;
  if (m.phase !== "CLOSED") {
    if (publicFeed) {
      try {
        feed = {
          source: "Postor Abierto",
          documents: (await discoverTenders(s)).length,
        };
      } catch (e) {
        feed = {
          source: "Postor Abierto",
          error: String(e.message).slice(0, 200),
        };
      }
    }
    if (manifest) await importSources(s, manifest);
  }
  const hour = Math.floor(s.clock() / HOUR);
  const receipt = await s.command(
    "pulso-" +
      m.id.slice(0, 30) +
      "-" +
      m.start +
      "-" +
      hour +
      (m.phase === "CLOSED" ? "-cierre" : ""),
    { type: "pulse" },
  );
  const current = s.mission().mission;
  const sectorKey =
    "consulta-sectorial-" + digest([current.id, current.start]).slice(0, 24);
  let attempt = 0;
  let prior = s.receipt(sectorKey);
  while (prior && prior.status !== "TEAM_ANSWERED")
    prior = s.receipt(sectorKey + "-" + ++attempt);
  if (
    current.phase !== "CLOSED" &&
    !prior &&
    allowance(current, s.clock()) - current.spent >= 10
  ) {
    const opportunity = current.findings.find(
      (f) => f.facts.buyer?.refs.length,
    );
    const sources = s.missionSources(),
      rows = sources.reduce((n, d) => n + d.rows, 0);
    if (opportunity && rows >= 10 && rows <= MAX_TEAM_ROWS) {
      await s.command(attempt ? sectorKey + "-" + attempt : sectorKey, {
        type: "team_inquiry",
        mission: current.id,
        documents: sources.map((d) => d.id),
        query: {
          subject: opportunity.subject,
          op: "lookup",
          fields: ["buyer"],
        },
        size: 10,
        rowBudget: rows,
        creditBudget: 10,
      });
    }
  }
  return { feed, latest: receipt.status, command: s.mission() };
}
