import { importSources, discoverTenders } from "./sources.mjs";
import { HOUR } from "./missions.mjs";

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
  return { feed, latest: receipt.status, command: s.mission() };
}
