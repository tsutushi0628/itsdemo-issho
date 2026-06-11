import { describe, it, expect } from "vitest";
import { decideRemoteAccessDisplay, buildQrUrl, QR_KEY_FRAGMENT_PREFIX } from "../remote/qrPolicy";

describe("decideRemoteAccessDisplay", () => {
  const base = { port: 19280, lanIp: "192.168.1.10" };

  it("① tunnelDomain 設定済みなら tunnel を返す（bind 不問）", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "127.0.0.1",
      tunnelDomain: "myhost.example.com",
    });
    expect(result).toEqual({
      kind: "tunnel",
      url: "https://myhost.example.com/",
    });
  });

  it("② bind が 127.0.0.1 × tunnel 未設定 → localOnly（QRなし）", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "127.0.0.1",
      tunnelDomain: "",
    });
    expect(result.kind).toBe("localOnly");
  });

  it("② bind が localhost × tunnel 未設定 → localOnly", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "localhost",
      tunnelDomain: "",
    });
    expect(result.kind).toBe("localOnly");
  });

  it("② bind が ::1 × tunnel 未設定 → localOnly", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "::1",
      tunnelDomain: "",
    });
    expect(result.kind).toBe("localOnly");
  });

  it("③ bind が 0.0.0.0 × tunnel 未設定 → LAN URL", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "0.0.0.0",
      tunnelDomain: "",
    });
    expect(result).toEqual({
      kind: "lan",
      url: `http://192.168.1.10:19280/`,
    });
  });

  it("④ bind に具体 IP を明示 → その IP を URL に使う（B-4: VPN/複数NIC で listen していない IP を出さない）", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "192.168.1.5",
      tunnelDomain: "",
    });
    // bindAddress が具体IPなら lanIp ではなく bindAddress を URL に使う
    expect(result).toEqual({
      kind: "lan",
      url: `http://192.168.1.5:19280/`,
    });
  });

  it("④-a bind が 0.0.0.0 → lanIp を URL に使う（全インターフェース待ち受けは LAN IP で到達可能）", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "0.0.0.0",
      tunnelDomain: "",
    });
    expect(result).toEqual({
      kind: "lan",
      url: `http://192.168.1.10:19280/`,
    });
  });

  it("localOnly の url は 127.0.0.1 の URL を含む（案内文用）", () => {
    const result = decideRemoteAccessDisplay({
      ...base,
      bindAddress: "127.0.0.1",
      tunnelDomain: "",
    });
    expect(result.url).toContain("127.0.0.1");
  });
});

describe("buildQrUrl", () => {
  it("パスワードを QR_KEY_FRAGMENT_PREFIX でエンコードして付加する", () => {
    const url = "https://example.com/";
    const password = "testPass123";
    const result = buildQrUrl(url, password);
    expect(result).toBe(`${url}${QR_KEY_FRAGMENT_PREFIX}${encodeURIComponent(password)}`);
  });

  it("記号入りパスワードのラウンドトリップ（encode→decode で元に戻る）", () => {
    const url = "http://192.168.1.10:19280/";
    const password = "p@ss!w0rd#2024/special=chars&more";
    const result = buildQrUrl(url, password);
    const fragmentIndex = result.indexOf(QR_KEY_FRAGMENT_PREFIX);
    const encoded = result.slice(fragmentIndex + QR_KEY_FRAGMENT_PREFIX.length);
    expect(decodeURIComponent(encoded)).toBe(password);
  });

  it("QR URL のフラグメント前のベース URL は元の url と一致する", () => {
    const url = "https://my-tunnel.example.com/";
    const result = buildQrUrl(url, "secret");
    const fragmentIndex = result.indexOf(QR_KEY_FRAGMENT_PREFIX);
    expect(result.slice(0, fragmentIndex)).toBe(url);
  });
});
