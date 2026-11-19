import { createInterface } from "node:readline";
import { once } from "node:events";
// One line is acknowledged only after its ledger transaction has committed.
export async function serve(s, input = process.stdin, output = process.stdout) {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    let key = null,
      answer;
    try {
      if (Buffer.byteLength(line) > 1024 * 1024)
        throw Error("Solicitud demasiado grande");
      const request = JSON.parse(line);
      key = request.key;
      const result = await s.command(key, request.command);
      answer = { key, result };
    } catch (e) {
      answer = { key, error: e.message };
    }
    if (!output.write(JSON.stringify(answer) + "\n"))
      await once(output, "drain");
  }
}
