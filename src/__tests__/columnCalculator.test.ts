import { describe, it, expect } from "vitest";
import { computeActiveColumns } from "../columnCalculator";

describe("computeActiveColumns", () => {
  it("ウィンドウ幅1600px / 最小幅400px → 4カラム", () => {
    const result = computeActiveColumns(1600, 400, 6);
    expect(result).toBe(4);
  });

  it("ウィンドウ幅1200px / 最小幅400px → 3カラム", () => {
    const result = computeActiveColumns(1200, 400, 6);
    expect(result).toBe(3);
  });

  it("ウィンドウ幅800px / 最小幅400px → 2カラム", () => {
    const result = computeActiveColumns(800, 400, 4);
    expect(result).toBe(2);
  });

  it("計算結果がtotalColumnsを超える場合はtotalColumnsを返す", () => {
    const result = computeActiveColumns(3840, 400, 4);
    expect(result).toBe(4);
  });

  it("計算結果がちょうどtotalColumnsと同じ場合はtotalColumnsを返す", () => {
    const result = computeActiveColumns(1600, 400, 4);
    expect(result).toBe(4);
  });

  it("ウィンドウ幅が最小幅未満の場合は1を返す（クランプ）", () => {
    const result = computeActiveColumns(300, 400, 4);
    expect(result).toBe(1);
  });

  it("ウィンドウ幅0の場合は1を返す（クランプ）", () => {
    const result = computeActiveColumns(0, 400, 4);
    expect(result).toBe(1);
  });

  it("端数は切り捨てられる（1599px / 400px → 3）", () => {
    const result = computeActiveColumns(1599, 400, 6);
    expect(result).toBe(3);
  });

  it("最小幅を大きく設定するとカラム数が減る", () => {
    const result = computeActiveColumns(1920, 800, 4);
    expect(result).toBe(2);
  });

  it("最小幅を小さく設定するとカラム数が増える", () => {
    const result = computeActiveColumns(1920, 200, 12);
    expect(result).toBe(9);
  });
});
