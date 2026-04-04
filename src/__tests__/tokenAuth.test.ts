import { describe, it, expect } from "vitest";
import { generateSessionToken, validatePassword } from "../remote/tokenAuth";

describe("tokenAuth", () => {
  describe("generateSessionToken", () => {
    it("should return a 64-character hex string", () => {
      const token = generateSessionToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should return different tokens on each call", () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("validatePassword", () => {
    it("should return true for matching tokens", () => {
      const token = generateSessionToken();
      expect(validatePassword(token, token)).toBe(true);
    });

    it("should return false for different tokens", () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(validatePassword(token1, token2)).toBe(false);
    });

    it("should return false for different length strings", () => {
      const token = generateSessionToken();
      expect(validatePassword("short", token)).toBe(false);
    });

    it("should return false for empty string against valid token", () => {
      const token = generateSessionToken();
      expect(validatePassword("", token)).toBe(false);
    });
  });
});
