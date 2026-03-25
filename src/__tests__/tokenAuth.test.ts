import { describe, it, expect } from "vitest";
import { generateToken, validateToken } from "../remote/tokenAuth";

describe("tokenAuth", () => {
  describe("generateToken", () => {
    it("should return a 64-character hex string", () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should return different tokens on each call", () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("validateToken", () => {
    it("should return true for matching tokens", () => {
      const token = generateToken();
      expect(validateToken(token, token)).toBe(true);
    });

    it("should return false for different tokens", () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(validateToken(token1, token2)).toBe(false);
    });

    it("should return false for different length strings", () => {
      const token = generateToken();
      expect(validateToken("short", token)).toBe(false);
    });

    it("should return false for empty string against valid token", () => {
      const token = generateToken();
      expect(validateToken("", token)).toBe(false);
    });
  });
});
