import { describe, it, expect } from "vitest";
import { computeActiveColumns } from "../columnCalculator";

describe("computeActiveColumns", () => {
  it("ウィンドウ幅1600px / 最小幅400px → 4カラム", () => {
    const result = computeActiveColumns(1600, 400, 6, 3000);
    expect(result).toBe(4);
  });

  it("ウィンドウ幅1200px / 最小幅400px → 3カラム", () => {
    const result = computeActiveColumns(1200, 400, 6, 3000);
    expect(result).toBe(3);
  });

  it("ウィンドウ幅800px / 最小幅400px → 2カラム", () => {
    const result = computeActiveColumns(800, 400, 4, 3000);
    expect(result).toBe(2);
  });

  it("計算結果がtotalColumnsを超える場合はtotalColumnsを返す", () => {
    const result = computeActiveColumns(2900, 400, 4, 3000);
    expect(result).toBe(4);
  });

  it("計算結果がちょうどtotalColumnsと同じ場合はtotalColumnsを返す", () => {
    const result = computeActiveColumns(1600, 400, 4, 3000);
    expect(result).toBe(4);
  });

  it("ウィンドウ幅が最小幅未満の場合は1を返す（クランプ）", () => {
    const result = computeActiveColumns(300, 400, 4, 3000);
    expect(result).toBe(1);
  });

  it("ウィンドウ幅0の場合は1を返す（クランプ）", () => {
    const result = computeActiveColumns(0, 400, 4, 3000);
    expect(result).toBe(1);
  });

  it("端数は切り捨てられる（1599px / 400px → 3）", () => {
    const result = computeActiveColumns(1599, 400, 6, 3000);
    expect(result).toBe(3);
  });

  it("最小幅を大きく設定するとカラム数が減る", () => {
    const result = computeActiveColumns(1920, 800, 4, 3000);
    expect(result).toBe(2);
  });

  it("最小幅を小さく設定するとカラム数が増える", () => {
    const result = computeActiveColumns(1920, 200, 12, 3000);
    expect(result).toBe(9);
  });

  describe("fullWidthThreshold", () => {
    it("3000px以上のウルトラワイドではtotalColumnsを返す", () => {
      const result = computeActiveColumns(3000, 850, 4, 3000);
      expect(result).toBe(4);
    });

    it("3840pxのウルトラワイドではtotalColumnsを返す", () => {
      const result = computeActiveColumns(3840, 850, 4, 3000);
      expect(result).toBe(4);
    });

    it("2718px → 3カラム（2718/850=3.19）", () => {
      const result = computeActiveColumns(2718, 850, 4, 3000);
      expect(result).toBe(3);
    });

    it("1864px → 2カラム（1864/850=2.19）", () => {
      const result = computeActiveColumns(1864, 850, 4, 3000);
      expect(result).toBe(2);
    });

    it("1440px → 1カラム（1440/850=1.69）", () => {
      const result = computeActiveColumns(1440, 850, 4, 3000);
      expect(result).toBe(1);
    });
  });
});
