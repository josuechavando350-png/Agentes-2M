import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  openSync,
  closeSync,
  readSync,
  fstatSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { availableParallelism } from "node:os";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { getAgent } from "./ledger.mjs";
import { executable } from "./native.mjs";
import { canonical, integer, OPS, SECTORS } from "./policy.mjs";
import { qualificationAnswers } from "./qualification.mjs";

const WIDTH = 8;
export function rosterLayout(state) {
  const population = state.population;
  if (!population) throw Error("Inicializa el padrón");
  const cuts = new Set([1, population + 1]);
  function founders(start, end) {
    for (let i = start; i <= end; i += 1_000_000) cuts.add(i);
    cuts.add(end + 1);
  }
  founders(1, state.genesisSize);
  if (state.expansion) founders(state.expansion.lo, state.expansion.hi);
  for (const b of state.bands) {
    cuts.add(b.lo);
    cuts.add(b.hi + 1);
  }
  for (const id of state.agents.keys()) {
    cuts.add(id);
    cuts.add(id + 1);
  }
  const edges = [...cuts].sort((a, b) => a - b),
    profiles = [],
    lookup = new Map(),
    runs = [];
  for (let i = 1; i < edges.length; i++) {
    const id = edges[i - 1],
      last = edges[i] - 1;
    const agent = getAgent(state, id);
    delete agent.id;
    const fingerprint = canonical(agent);
    let index = lookup.get(fingerprint);
    if (index === undefined) {
      index = profiles.length;
      lookup.set(fingerprint, index);
      profiles.push(agent);
    }
    const founder =
      id <= state.genesisSize ||
      Boolean(
        state.expansion && id >= state.expansion.lo && id <= state.expansion.hi,
      );
    const previous = runs.at(-1);
    if (previous?.index === index && previous.founder === founder)
      previous.last = last;
    else runs.push({ last, index, founder });
  }
  return {
    schema: "SEMAR-ROWS-1",
    rowBytes: WIDTH,
    population,
    checkpoint: state.tip,
    profiles,
    runs,
  };
}
function pattern(p, index) {
  const skills = p.skills.reduce((m, op) => {
    const n = OPS.indexOf(op);
    if (n < 0) throw Error("Habilidad desconocida");
    return m | (1 << n);
  }, 0);
  const row = Buffer.alloc(WIDTH);
  row.writeUInt8(p.sector);
  row.writeUInt8(p.balance, 1);
  row.writeUInt16LE(skills, 2);
  row.writeUInt32LE(index, 4);
  if (
    !["LIVE", "DEAD"].includes(p.status) ||
    (p.status === "DEAD") !== (p.balance === 0)
  )
    throw Error("Estado incompleto");
  return row;
}
export async function materialize(
  layout,
  target,
  threads = Math.min(4, availableParallelism()),
) {
  integer(threads, 1, 64, "hilos");
  target = resolve(target);
  const { runs, ...header } = layout;
  const rows = header.profiles.map(pattern);
  const json = Buffer.from(JSON.stringify(header) + "\n");
  const input =
    [
      json.toString().trimEnd(),
      [header.population, rows.length, runs.length].join(" "),
      ...rows.map((r) => [r[0], r[1], r.readUInt16LE(2)].join(" ")),
      ...runs.map((r) => [r.last, r.index, Number(r.founder)].join(" ")),
      ...qualificationAnswers().map((a) => a.join(" ")),
    ].join("\n") + "\n";
  mkdirSync(dirname(target), { recursive: true });
  const tmp = mkdtempSync(join(dirname(target), ".padron-")),
    out = join(tmp, "padron.gz");
  try {
    let start = performance.now();
    const job = spawnSync(executable, ["snapshot", out, String(threads)], {
      input,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (job.error || job.status !== 0)
      throw job.error ?? Error(job.stderr || "Error en el recorrido nativo");
    const nativeMs = performance.now() - start;
    const [balance, ...sectors] = job.stdout.trim().split("\n");
    const totals = SECTORS.map(() => ({
      identities: 0,
      founders: 0,
      tested: 0,
    }));
    let last = 0,
      credits = 0;
    for (const r of runs) {
      const p = header.profiles[r.index],
        n = r.last - last,
        counts = totals[p.sector - 1];
      counts.identities += n;
      counts.founders += r.founder ? n : 0;
      counts.tested += p.status === "LIVE" ? n : 0;
      credits += n * p.balance;
      last = r.last;
    }
    if (
      last !== header.population ||
      credits !== Number(balance) ||
      sectors.length !== 10 ||
      totals.some(
        (x, i) => sectors[i] !== [x.identities, x.founders, x.tested].join(" "),
      )
    )
      throw Error("Totales nativos inconsistentes");
    start = performance.now();
    // Independent check of every expanded byte against the ledger's expected runs.
    const sha = createHash("sha256");
    let headerAt = 0,
      bodyAt = 0,
      run = 0;
    const buffer = Buffer.alloc(1024 * 1024 + WIDTH);
    let filled = -1;
    await pipeline(
      createReadStream(out),
      createGunzip({ chunkSize: 1024 * 1024 }),
      async (stream) => {
        for await (const chunk of stream) {
          sha.update(chunk);
          let pos = 0;
          if (headerAt < json.length) {
            const n = Math.min(chunk.length, json.length - headerAt);
            if (
              !json
                .subarray(headerAt, headerAt + n)
                .equals(chunk.subarray(0, n))
            )
              throw Error("Cabecera divergente");
            headerAt += n;
            pos = n;
          }
          while (pos < chunk.length) {
            if (run >= runs.length) throw Error("Filas sobrantes");
            const { last, index } = runs[run],
              end = last * WIDTH,
              offset = bodyAt % WIDTH;
            if (filled !== index) {
              buffer.fill(rows[index]);
              filled = index;
            }
            const n = Math.min(end - bodyAt, chunk.length - pos);
            if (
              !buffer
                .subarray(offset, offset + n)
                .equals(chunk.subarray(pos, pos + n))
            )
              throw Error(
                "Fila divergente en " + (Math.floor(bodyAt / WIDTH) + 1),
              );
            bodyAt += n;
            pos += n;
            if (bodyAt === end) run++;
          }
        }
      },
    );
    if (
      headerAt !== json.length ||
      bodyAt !== WIDTH * header.population ||
      run !== runs.length
    )
      throw Error("Archivo incompleto");
    const report = {
      schema: header.schema,
      file: basename(target),
      checkpoint: header.checkpoint,
      population: header.population,
      founders: totals.reduce((a, s) => a + s.founders, 0),
      tested: totals.reduce((a, s) => a + s.tested, 0),
      bytesPerRow: WIDTH,
      bodyBytes: bodyAt,
      headerBytes: json.length,
      compressedBytes: statSync(out).size,
      sha256Uncompressed: sha.digest("hex"),
      threads,
      nativeExamAndGzipMs: nativeMs,
      independentVerificationMs: performance.now() - start,
      sectors: totals,
    };
    renameSync(out, target);
    return report;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// The distributable is gzip-compressed. Open the expanded file once to seek
// individual identities in constant time, independent of population size.
export function openPacked(path) {
  const fd = openSync(path, "r");
  try {
    let pos = 0;
    const sections = [];
    const buf = Buffer.alloc(8192);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (!n || pos > 32 * 1024 * 1024)
        throw Error("Cabecera del padrón incompleta");
      const end = buf.subarray(0, n).indexOf(10);
      const count = end < 0 ? n : end;
      sections.push(Buffer.from(buf.subarray(0, count)));
      pos += count;
      if (end >= 0) {
        pos++;
        break;
      }
    }
    const header = JSON.parse(Buffer.concat(sections).toString());
    integer(header.population, 1, 1_000_000_000_000, "población");
    if (
      header.schema !== "SEMAR-ROWS-1" ||
      header.rowBytes !== WIDTH ||
      !Array.isArray(header.profiles) ||
      fstatSync(fd).size !== pos + header.population * WIDTH
    )
      throw Error("Tamaño o formato de padrón inválido");
    const patterns = header.profiles.map(pattern),
      row = Buffer.alloc(WIDTH);
    return {
      checkpoint: header.checkpoint,
      population: header.population,
      agent(id) {
        integer(id, 1, header.population, "identidad");
        if (readSync(fd, row, 0, WIDTH, pos + (id - 1) * WIDTH) !== WIDTH)
          throw Error("Fila incompleta");
        const i = row.readUInt32LE(4);
        if (!patterns[i]?.equals(row))
          throw Error("Fila sin perfil compatible");
        return { id, ...structuredClone(header.profiles[i]) };
      },
      close() {
        closeSync(fd);
      },
    };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}
