import { availableParallelism } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { OPS } from "./policy.mjs";
export const executable = fileURLToPath(
  new URL("../.cache/semar-native", import.meta.url),
);

// The ledger serializes commands. Keep one bounded IPC request in flight per
// worker and tear it down on failure so its next reply cannot serve another ID.
export class NativeWorker {
  #child = null;
  #request = null;
  #start() {
    const child = spawn(executable, ["serve"], {
      stdio: ["pipe", "pipe", "inherit"],
    });
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
