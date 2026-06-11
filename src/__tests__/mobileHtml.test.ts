import { describe, it, expect } from "vitest";
import { getLoginHtml, getMobileHtml } from "../remote/mobileHtml";
import { QR_KEY_FRAGMENT_PREFIX } from "../remote/qrPolicy";

describe("mobileHtml: QR_KEY_FRAGMENT_PREFIX 契約テスト", () => {
  it("ログインHTMLに QR_KEY_FRAGMENT_PREFIX の値が含まれる", () => {
    const html = getLoginHtml(false);
    expect(html).toContain(QR_KEY_FRAGMENT_PREFIX);
  });

  it("本体HTMLに QR_KEY_FRAGMENT_PREFIX の値が含まれる", () => {
    const html = getMobileHtml();
    expect(html).toContain(QR_KEY_FRAGMENT_PREFIX);
  });
});

describe("getLoginHtml: Q-2 ログインスクリプト防御", () => {
  it("フラグメント除去（replaceState）がデコードより先に実行される順序になっている", () => {
    const html = getLoginHtml(false);
    const replaceIndex = html.indexOf("replaceState");
    const decodeIndex = html.indexOf("decodeURIComponent");
    expect(replaceIndex).toBeGreaterThan(-1);
    expect(decodeIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeLessThan(decodeIndex);
  });

  it("URIError を catch して生値フォールバックする try/catch が含まれる", () => {
    const html = getLoginHtml(false);
    expect(html).toContain("try");
    expect(html).toContain("catch");
    expect(html).toContain("URIError");
  });

  it("空文字チェック（if (key)）が含まれる", () => {
    const html = getLoginHtml(false);
    expect(html).toContain("if (key)");
  });
});

describe("getLoginHtml: Q-7 エラー文言", () => {
  it("エラー表示時に最新QR再読み案内が含まれる", () => {
    const html = getLoginHtml(true);
    expect(html).toContain("最新のQRを読み直してください");
  });

  it("エラーなし時には再読み案内が含まれない", () => {
    const html = getLoginHtml(false);
    expect(html).not.toContain("最新のQRを読み直してください");
  });
});

describe("getMobileHtml: Q-1 本体ページのフラグメント除去", () => {
  it("本体HTMLに replaceState によるフラグメント除去スクリプトが含まれる", () => {
    const html = getMobileHtml();
    expect(html).toContain("replaceState");
  });
});
