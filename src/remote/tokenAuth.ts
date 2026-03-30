import crypto from "crypto";

export function validatePassword(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
