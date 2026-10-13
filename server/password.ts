import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
export const passwordOptions = {
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 192 * 1024 * 1024,
};
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, passwordOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password) > 1024)
    throw new Error("Password must contain 12–1024 bytes.");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function checkPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!parts || Buffer.byteLength(password) > 1024) return false;
  const key = await derive(password, Buffer.from(parts[1], "hex"));
  return timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}
export const credentialVersion = (encoded: string) =>
  createHash("sha256").update(encoded).digest("hex");
