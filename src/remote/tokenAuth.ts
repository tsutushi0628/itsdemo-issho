import crypto from "crypto";

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function validateToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
