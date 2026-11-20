import { readFileSync, writeFileSync } from "node:fs";
import { extendCreditHistory, verifyCreditHistory } from "./credit-history.mjs";
import { reviewQueue, verifyQueue } from "./review-queue.mjs";
import { importCreditCsv, registerCsv } from "./credit-csv.mjs";
import {
  traceCredits,
  verifyCredits,
  creditRange,
  creditRegister,
} from "./credits.mjs";
const [action, file, arg, destination] = process.argv.slice(2);
try {
  const packet =
    action === "import"
      ? importCreditCsv(
          readFileSync(file),
          JSON.parse(readFileSync(arg, "utf8")),
        )
      : JSON.parse(readFileSync(file, "utf8"));
  let result;
  if (action === "import") {
    writeFileSync(destination, JSON.stringify(packet) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    result = { source: packet.source, rows: packet.lines.length, destination };
  } else if (action === "extend" || action === "extend-check") {
    const earlier = JSON.parse(readFileSync(arg, "utf8"));
    if (action === "extend-check")
      result = verifyCreditHistory(
        packet,
        earlier,
        JSON.parse(readFileSync(destination, "utf8")),
      );
    else {
      const receipt = extendCreditHistory(packet, earlier);
      result = verifyCreditHistory(packet, earlier, receipt);
      writeFileSync(destination, JSON.stringify(receipt) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    }
  } else if (action === "queue" || action === "queue-check") {
    const spec = JSON.parse(readFileSync(arg, "utf8"));
    if (action === "queue-check")
      result = verifyQueue(
        packet,
        spec,
        JSON.parse(readFileSync(destination, "utf8")),
      );
    else {
      const queue = reviewQueue(packet, spec);
      result = verifyQueue(packet, spec, queue);
      writeFileSync(destination, JSON.stringify(queue, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    }
  } else if (action === "register") {
    const { rows, ...summary } = creditRegister(packet);
    writeFileSync(arg, registerCsv({ ...summary, rows }), {
      flag: "wx",
      mode: 0o600,
    });
    result = { ...summary, destination: arg };
  } else if (action === "audit" || action === "audit-compact") {
    const solved = traceCredits(packet, {
      compact: action === "audit-compact",
    });
    result = solved.report;
    if (arg)
      writeFileSync(arg, JSON.stringify(solved.certificate) + "\n", {
        flag: "wx",
      });
  } else if (action === "check")
    result = verifyCredits(packet, JSON.parse(readFileSync(arg, "utf8")));
  else if (action === "explain") result = creditRange(packet, arg);
  else
    throw Error(
      "Usa import CSV CONFIG EXPEDIENTE, audit o audit-compact EXPEDIENTE [CERTIFICADO], check EXPEDIENTE CERTIFICADO, register EXPEDIENTE CSV, queue EXPEDIENTE TURNO PLAN, queue-check EXPEDIENTE TURNO PLAN, extend ACTUAL ANTERIOR PRUEBA, extend-check ACTUAL ANTERIOR PRUEBA o explain EXPEDIENTE ID",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
