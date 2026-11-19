import { digest } from "../src/policy.mjs";

// Ground truth is constructed from the planted entries before the workers see the files.
// Competing arms receive identical files, including all irrelevant rows.
export function sealedDossier(seed, index, n, prefix = "d") {
  const hash = digest([seed, index]),
    subject = "caso-" + hash.slice(0, 16);
  const variant = index % 6;
  const op =
    variant === 4 || variant === 5
      ? "product"
      : ["lookup", "difference", "product"][Math.floor(index / 6) % 3];
  const fields = op === "lookup" ? ["buyer"] : ["price", "cost"];
  const values =
    op === "lookup"
      ? ["empresa-" + hash.slice(16, 24)]
      : variant === 4
        ? [999999999, 999999998]
        : variant === 5
          ? ["pendiente", 125]
          : [
              1000 + parseInt(hash.slice(0, 4), 16),
              1 + (parseInt(hash.slice(4, 8), 16) % 1000),
            ];
  const entries = Array.from({ length: n }, (_, i) => ({
    subject: i % 2 ? "otro" : subject,
    field: i % 2 ? fields[0] : "adjunto",
    value: i,
  }));
  const evidence = fields.map(() => []);
  const positions = new Set();
  function plant(field, value, domain) {
    const offset = parseInt(digest([hash, domain]).slice(0, 8), 16);
    let row =
      domain === "conflicto"
        ? n - 1 - (offset % Math.max(1, Math.floor(n / 10)))
        : offset % Math.max(1, Math.floor(n / 2));
    while (positions.has(row)) row = (row + 1) % n;
    positions.add(row);
    entries[row] = { subject, field: fields[field], value };
    evidence[field].push(row);
  }
  fields.forEach((_, i) => {
    if (variant !== 1 || i !== fields.length - 1)
      plant(i, values[i], "campo-" + i);
  });
  if (variant === 2)
    plant(
      0,
      typeof values[0] === "string" ? "otro-comprador" : values[0] + 1,
      "conflicto",
    );
  if (variant === 3) plant(0, values[0], "copia");
  const query = { subject, fields, op };
  let status = "SUPPORTED",
    value = null;
  if (variant === 2) status = "CONFLICTED";
  else if (variant === 1 || variant >= 4) status = "UNKNOWN";
  else
    value =
      op === "lookup"
        ? values[0]
        : op === "difference"
          ? values[0] - values[1]
          : values[0] * values[1];
  const docs = [];
  for (let start = 0; start < n; start += 128) {
    const id = prefix + (docs.length + 1);
    docs.push({
      id,
      source: "escuela/" + hash + "/" + id,
      rows: entries.slice(start, start + 128),
    });
  }
  const refs = evidence.flatMap((group) =>
    group
      .sort((a, b) => a - b)
      .map((row) => {
        const doc = docs[Math.floor(row / 128)];
        return {
          document: doc.id,
          source: doc.source,
          sha256: digest(doc),
          row: 1 + (row % 128),
        };
      }),
  );
  return {
    docs,
    query,
    n,
    expected: { status, value, refs },
    inputDigest: digest({ docs, query }),
  };
}
