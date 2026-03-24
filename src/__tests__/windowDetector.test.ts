import { describe, it, expect } from "vitest";
import {
  parseWindowsOutput,
  parseLinuxGeometry,
} from "../windowDetector";

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
