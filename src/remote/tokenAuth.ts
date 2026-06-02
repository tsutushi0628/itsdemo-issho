import crypto from "crypto";

export function validatePassword(provided: string, expected: string): boolean {
  // 入力長で早期 return すると long-password で UTF-8 バイト長と JS 文字長が食い違い
  // timingSafeEqual がバッファ長不一致で throw する（未認証DoS）。両者を固定長ハッシュ化して
  // 必ず同じ長さのバッファ同士を比較することで throw を防ぎつつタイミング差も消す。
  // 空の expected（パスワード未設定）は常に拒否する。
  if (!expected) {
    return false;
  }
  const providedHash = crypto.createHash("sha256").update(Buffer.from(provided, "utf8")).digest();
  const expectedHash = crypto.createHash("sha256").update(Buffer.from(expected, "utf8")).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// 起動時に生成する高エントロピーのワンタイム接続パスワード（出荷時固定値を廃止する）。
// 紛らわしい文字を避けた英数字で、スマホで打ちやすい長さにする。
export function generateRemotePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
