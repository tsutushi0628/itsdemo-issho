import { describe, it, expect } from "vitest";
import {
  parseMacOSBounds,
  parseWindowsOutput,
  parseLinuxGeometry,
} from "../windowDetector";

describe("parseMacOSBounds", () => {
  it("正常なAppleScript出力からウィンドウ幅を計算する", () => {
    const result = parseMacOSBounds("0, 25, 1920, 1080\n");
    expect(result).toBe(1920);
  });

  it("ウルトラワイドモニターの座標を正しくパースする", () => {
    const result = parseMacOSBounds("100, 0, 3940, 1080\n");
    expect(result).toBe(3840);
  });

  it("オフセットのある座標でも正しく幅を計算する", () => {
    const result = parseMacOSBounds("500, 100, 2060, 1180\n");
    expect(result).toBe(1560);
  });

  it("空白が多い出力でも正しくパースする", () => {
    const result = parseMacOSBounds("  0 ,  25 ,  2560 ,  1440 \n");
    expect(result).toBe(2560);
  });

  it("要素が4つ未満のときエラーをthrowする", () => {
    expect(() => parseMacOSBounds("0, 25")).toThrow("パースできませんでした");
  });

  it("数値でない要素があるときエラーをthrowする", () => {
    expect(() => parseMacOSBounds("abc, 25, def, 1080")).toThrow(
      "座標を取得できませんでした"
    );
  });

  it("空文字列でエラーをthrowする", () => {
    expect(() => parseMacOSBounds("")).toThrow("パースできませんでした");
  });
});

describe("parseWindowsOutput", () => {
  it("正常な数値出力からウィンドウ幅を取得する", () => {
    const result = parseWindowsOutput("1920\n");
    expect(result).toBe(1920);
  });

  it("前後の空白を含む出力を正しくパースする", () => {
    const result = parseWindowsOutput("  2560  \r\n");
    expect(result).toBe(2560);
  });

  it("数値でない出力のときエラーをthrowする", () => {
    expect(() => parseWindowsOutput("error output")).toThrow(
      "ウィンドウ幅を取得できませんでした"
    );
  });
});

describe("parseLinuxGeometry", () => {
  it("正常なxdotool出力からウィンドウ幅を取得する", () => {
    const output = `Window 12345678
  Position: 100,200 (screen: 0)
  Geometry: 1920x1080`;
    const result = parseLinuxGeometry(output);
    expect(result).toBe(1920);
  });

  it("大きなウィンドウサイズを正しくパースする", () => {
    const output = `Window 99999999
  Position: 0,0 (screen: 0)
  Geometry: 3840x2160`;
    const result = parseLinuxGeometry(output);
    expect(result).toBe(3840);
  });

  it("Geometry行がない出力のときエラーをthrowする", () => {
    expect(() => parseLinuxGeometry("Window 12345678\n  Position: 0,0")).toThrow(
      "ウィンドウサイズを取得できませんでした"
    );
  });
});
