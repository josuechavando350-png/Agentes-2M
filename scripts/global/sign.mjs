import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { canonical } from "../../src/policy.mjs";
const [keyPath, recordPath] = process.argv.slice(2);
if (!keyPath || !recordPath)
  throw Error("Indica el PEM privado de tesorería y el JSON del mandato");
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const key = createPrivateKey(readFileSync(keyPath));
if (key.asymmetricKeyType !== "ed25519" || record.protocol !== "SEMAR-GLOBAL-1")
  throw Error("Clave o protocolo incorrectos");
const signature = sign(null, Buffer.from(canonical(record)), key).toString(
  "base64",
);
console.log(JSON.stringify({ record, signature }, null, 2));
