import { readFileSync, writeFileSync } from "node:fs";
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
  } else if (action === "register") {
    const { rows, ...summary } = creditRegister(packet);
    writeFileSync(arg, registerCsv({ ...summary, rows }), {
      flag: "wx",
      mode: 0o600,
    });
    result = { ...summary, destination: arg };
  } else if (action === "audit") {
    const solved = traceCredits(packet);
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
      "Usa import CSV CONFIG EXPEDIENTE, audit EXPEDIENTE [CERTIFICADO], check EXPEDIENTE CERTIFICADO, register EXPEDIENTE CSV o explain EXPEDIENTE ID",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
