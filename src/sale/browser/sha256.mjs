// Incremental SHA-256 for the browser worker. Matches Node's UTF-8 and byte-array inputs.
const constants = Uint32Array.of(
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
);
const rotate = (x, n) => (x >>> n) | (x << (32 - n));
const encoder = new TextEncoder();
export function createHash(name) {
  if (name !== "sha256") throw Error("Se requiere SHA-256");
  const state = Uint32Array.of(
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  );
  const buffer = new Uint8Array(64),
    words = new Uint32Array(64);
  let size = 0,
    used = 0,
    done = false;
  function compress(bytes, offset) {
    for (let i = 0; i < 16; i++) {
      const j = offset + 4 * i;
      words[i] =
        (bytes[j] << 24) |
        (bytes[j + 1] << 16) |
        (bytes[j + 2] << 8) |
        bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15],
        b = words[i - 2];
      words[i] =
        words[i - 16] +
        (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
        words[i - 7] +
        (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          constants[i] +
          words[i]) |
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) |
        0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => (state[i] += v));
  }
  return {
    update(value) {
      if (done) throw Error("La huella ya se cerró");
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      if (!(bytes instanceof Uint8Array))
        throw Error("Se requieren bytes UTF-8");
      size += bytes.length;
      let pos = 0;
      if (used) {
        const n = Math.min(64 - used, bytes.length);
        buffer.set(bytes.subarray(0, n), used);
        pos += n;
        used += n;
        if (used === 64) {
          compress(buffer, 0);
          used = 0;
        }
      }
      for (; pos + 64 <= bytes.length; pos += 64) compress(bytes, pos);
      if (pos < bytes.length) {
        buffer.set(bytes.subarray(pos), 0);
        used = bytes.length - pos;
      }
      return this;
    },
    digest(format) {
      if (format !== "hex" || done)
        throw Error("Formato o estado de huella inválido");
      done = true;
      buffer[used++] = 0x80;
      if (used > 56) {
        buffer.fill(0, used);
        compress(buffer, 0);
        used = 0;
      }
      buffer.fill(0, used, 56);
      const view = new DataView(buffer.buffer);
      view.setBigUint64(56, BigInt(size) * 8n);
      compress(buffer, 0);
      return Array.from(state, (v) => v.toString(16).padStart(8, "0")).join("");
    },
  };
}
