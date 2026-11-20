import { suggestProfile } from "./profile.mjs";
import { importCreditCsv, registerCsv } from "../credit-csv.mjs";
import { traceCredits, verifyCredits, creditRegister } from "../credits.mjs";
let packet, solved, register;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "inspect") {
      const suggestion = suggestProfile(
        new Uint8Array(data.buffer),
        data.profile,
      );
      self.postMessage({ type: "inspect", ...suggestion });
    } else if (data.type === "audit") {
      packet = solved = register = null;
      const bytes = new Uint8Array(data.buffer),
        next = importCreditCsv(bytes, data.profile);
      const native = await crypto.subtle.digest("SHA-256", bytes);
      const actual = Array.from(new Uint8Array(native), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (actual !== next.source)
        throw Error(
          "El navegador y el importador obtuvieron huellas distintas para el archivo",
        );
      const result = traceCredits(next, { compact: true }),
        notes = creditRegister(next);
      packet = next;
      solved = result;
      register = notes;
      self.postMessage({
        type: "audit",
        summary: result.report,
        individual: notes.unavoidableCents,
      });
    } else if (data.type === "existing") {
      if (!packet)
        throw Error("Carga el CSV asociado antes de comprobar el certificado");
      const report = verifyCredits(packet, JSON.parse(data.json));
      self.postMessage({ type: "existing", lines: report.lines });
    } else if (data.type === "page") {
      if (!register) throw Error("Falta conciliar el archivo");
      const word = String(data.filter).trim().toLocaleLowerCase("es");
      const rows = word
        ? register.rows.filter((r) =>
            [r.invoice, r.party, r.id, r.sku].some((v) =>
              v.toLocaleLowerCase("es").includes(word),
            ),
          )
        : register.rows;
      const page = Math.max(
        0,
        Math.min(Math.floor(data.page), Math.ceil(rows.length / 20) - 1),
      );
      self.postMessage({
        type: "page",
        page,
        total: rows.length,
        rows: rows.slice(page * 20, (page + 1) * 20),
      });
    } else if (data.type === "download") {
      if (!solved) throw Error("Falta conciliar el archivo");
      if (data.kind === "csv")
        self.postMessage({
          type: "download",
          name: "revision.csv",
          mime: "text/csv;charset=utf-8",
          content: registerCsv(register),
        });
      else if (data.kind === "certificate")
        self.postMessage({
          type: "download",
          name: "certificado.json",
          mime: "application/json",
          content: JSON.stringify(solved.certificate),
        });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      operation: data.type,
      error: error.message,
    });
  }
};
