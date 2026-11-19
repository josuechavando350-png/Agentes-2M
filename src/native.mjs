import { availableParallelism } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { token } from "./dossiers.mjs";
import { OPS } from "./policy.mjs";
export const executable = fileURLToPath(
  new URL("../.cache/semar-native", import.meta.url),
);

// The ledger serializes commands. Keep one bounded IPC request in flight per
// worker and tear it down on failure so its next reply cannot serve another ID.
export class NativeWorker {
  #child = null;
  #request = null;
  constructor(host = "local") {
    if (
      typeof host !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(host)
    )
      throw Error("Alias de trabajador inválido");
    this.host = host;
  }
  #start() {
    const remote = this.host !== "local";
    const child = spawn(
      remote ? "ssh" : executable,
      remote
        ? [
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=5",
            "--",
            this.host,
            "semar-native serve",
          ]
        : ["serve"],
      {
        stdio: ["pipe", "pipe", "inherit"],
      },
    );
    this.#child = child;
    const fail = (error) => {
      if (this.#child !== child) return;
      this.#child = null;
      const request = this.#request;
      this.#request = null;
      request?.reject(error);
      child.kill();
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("close", () => fail(Error("El proceso C++ terminó")));
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (this.#child !== child) return;
      const request = this.#request;
      if (!request) {
        fail(Error("Respuesta nativa sin solicitud"));
        return;
      }
      this.#request = null;
      if (line.startsWith("ERR ")) request.reject(Error(line.slice(4)));
      else request.resolve(line);
    });
    return child;
  }
  #send(fields) {
    if (this.#request) throw Error("Solicitud nativa pendiente");
    const child = this.#child ?? this.#start();
    return new Promise((resolve, reject) => {
      this.#request = { resolve, reject };
      child.stdin.write(fields.join(" ") + "\n");
    });
  }
  async team(docs, query, members, rows) {
    const lanes = Math.min(4, availableParallelism(), members);
    const fields = [
      "TEAM",
      members,
      lanes,
      rows,
      query.fields.length,
      query.subject,
      ...query.fields,
    ];
    for (const doc of docs)
      for (const r of doc.rows) fields.push(r.subject, r.field);
    return JSON.parse(await this.#send(fields));
  }
  async scan(packet) {
    if (
      !Array.isArray(packet.keys) ||
      packet.keys.length < 1 ||
      packet.keys.length > 256 ||
      !Array.isArray(packet.fields) ||
      ![1, 2].includes(packet.fields.length)
    )
      throw Error("Expediente repartido inválido");
    const fields = [
      "TEAM",
      1,
      1,
      packet.keys.length,
      packet.fields.length,
      token(packet.subject),
      ...packet.fields.map(token),
    ];
    for (const [subject, field] of packet.keys)
      fields.push(token(subject), token(field));
    const timer = setTimeout(() => this.close(), 15000);
    try {
      return JSON.parse(await this.#send(fields));
    } finally {
      clearTimeout(timer);
    }
  }
  async run(op, data) {
    const index = OPS.indexOf(op);
    let fields;
    if (op === "inference") {
      fields = [
        index,
        data.query,
        data.facts.length,
        ...data.facts.map((f) => f.literal),
        data.rules.length,
      ];
      for (const r of data.rules) fields.push(r.then, r.if.length, ...r.if);
    } else fields = [index, data.length, ...data];
    const line = await this.#send(fields);
    if (op === "inference") {
      if (!["UNKNOWN", "SUPPORTED", "REFUTED", "CONFLICTED"].includes(line))
        throw Error("Veredicto nativo inválido");
      return line;
    }
    if (!/^-?\d+$/.test(line)) throw Error("Respuesta numérica inválida");
    return Number(line) / 2;
  }
  close() {
    const pending = this.#request;
    this.#request = null;
    const child = this.#child;
    this.#child = null;
    child?.kill();
    pending?.reject(Error("Motor cerrado"));
  }
}
