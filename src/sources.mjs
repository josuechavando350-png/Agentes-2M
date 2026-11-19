import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { freezeDocument, token } from "./dossiers.mjs";
import { digest, strict } from "./policy.mjs";

const limit = 131072;
async function authorizedFile(root, path) {
  const resolved = await realpath(resolve(root, path)),
    rel = relative(root, resolved);
  if (
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    !(await stat(resolved)).isFile() ||
    (await stat(resolved)).size > limit
  )
    throw Error("Archivo fuera del manifiesto o demasiado grande");
  return readFile(resolved, "utf8");
}
async function authorizedURL(source) {
  const url = new URL(source);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("Fuente HTTPS inválida");
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw Error("Fuente no disponible HTTP " + r.status);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of r.body) {
    bytes += chunk.length;
    if (bytes > limit) throw Error("Fuente demasiado grande");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function admit(s, mission, doc) {
  const { sha256 } = freezeDocument(doc),
    old = s.sourceRevision(doc.id);
  if (old?.sha256 === sha256)
    return { status: "ADMITTED", id: doc.id, sha256, revision: old.revision };
  const previous = old?.revision ?? 0;
  const key =
    "fuente-" +
    digest({ mission: mission.id, id: doc.id, sha256, previous }).slice(0, 48);
  return s.command(key, { type: "admit_source", document: doc, previous });
}
// The manifest is trusted operator configuration. Documents cannot nominate further URLs.
export async function importSources(s, manifestPath) {
  const path = await realpath(manifestPath),
    root = dirname(path);
  const list = JSON.parse(await authorizedFile(root, path));
  if (
    !Array.isArray(list) ||
    list.length > 128 ||
    new Set(list.map((x) => x.id)).size !== list.length
  )
    throw Error("Manifiesto inválido");
  const mission = s.mission()?.mission;
  if (!mission || mission.phase === "CLOSED")
    throw Error("Se requiere una misión abierta");
  const receipts = [];
  for (const entry of list) {
    strict(entry, ["id", "format", "source"]);
    token(entry.id);
    if (
      !["text", "rows"].includes(entry.format) ||
      typeof entry.source !== "string"
    )
      throw Error("Formato inválido");
    const raw = entry.source.startsWith("https://")
      ? await authorizedURL(entry.source)
      : await authorizedFile(root, entry.source);
    const doc = {
      id: entry.id,
      source: entry.source,
      ...(entry.format === "text" ? { text: raw } : { rows: JSON.parse(raw) }),
    };
    receipts.push(await admit(s, mission, doc));
  }
  return receipts;
}

export const tendersURL =
  "https://api.postor.com.mx/api/open/v1/licitaciones?limite=5";
export function tenderDocuments(payload, at) {
  if (payload.success !== true || !Array.isArray(payload.data))
    throw Error("Respuesta de Postor inválida");
  return payload.data
    .filter(
      (r) =>
        r.status === "vigente" &&
        Date.parse(r.fecha_apertura) > at &&
        r.uuid_procedimiento &&
        r.dependencia &&
        r.nombre_procedimiento,
    )
    .slice(0, 5)
    .map((r) => {
      const id = "mx-" + digest(r.uuid_procedimiento).slice(0, 20);
      return { id, source: r.postor_url ?? r.fuente, publicRecord: r };
    });
}
export async function discoverTenders(s) {
  const payload = JSON.parse(await authorizedURL(tendersURL));
  const mission = s.mission().mission;
  const results = [];
  for (const doc of tenderDocuments(payload, s.clock())) {
    results.push(await admit(s, mission, doc));
  }
  return results;
}
