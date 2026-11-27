import "server-only";
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt parameters (N=2^14, r=8, p=1) — memory-hard, OWASP-recommended baseline.
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Returns "scrypt$N$r$p$salt$hash" (base64 salt and hash). Plaintext is never stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password.normalize("NFKC"), salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Constant-time verification. Missing or malformed hashes still cost one derivation. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  const valid =
    parts.length === 6 &&
    parts[0] === "scrypt" &&
    [parts[1], parts[2], parts[3]].every((value) => /^\d+$/.test(value));
  const salt = valid ? Buffer.from(parts[4], "base64") : randomBytes(16);
  const expected = valid ? Buffer.from(parts[5], "base64") : randomBytes(SCRYPT.keyLength);
  const options = valid
    ? { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), maxmem: SCRYPT.maxmem }
    : { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem };
  const actual = await deriveKey(password.normalize("NFKC"), salt, expected.length, options);
  return valid && actual.length === expected.length && timingSafeEqual(actual, expected);
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALPHABET = UPPER + LOWER + DIGITS;

/**
 * Generates a random password such as "Hq7m-Rt4k-Wz9p" (~70 bits of entropy with
 * the default 3 groups). Ambiguous characters (0/O, 1/l/I) are excluded.
 */
export function generatePassword(groups = 3, groupSize = 4): string {
  for (;;) {
    const characters = Array.from({ length: groups * groupSize }, () => ALPHABET[randomInt(ALPHABET.length)]);
    const joined = characters.join("");
    if (/[A-Z]/.test(joined) && /[a-z]/.test(joined) && /[2-9]/.test(joined)) {
      const chunks: string[] = [];
      for (let i = 0; i < characters.length; i += groupSize) chunks.push(characters.slice(i, i + groupSize).join(""));
      return chunks.join("-");
    }
  }
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
