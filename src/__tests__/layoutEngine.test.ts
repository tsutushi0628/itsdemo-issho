import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
  },
}));

import { calculateLayout } from "../layoutEngine";
import type { LayoutConfig } from "../layoutEngine";

describe("calculateLayout", () => {
  it("activeIndices.size >= totalColumns のとき等間隔になる", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 3400,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0, 1, 2, 3]));

    expect(result.groups).toHaveLength(4);
    const expectedSize = 1 / 4;
    for (const group of result.groups) {
      expect(group.size).toBeCloseTo(expectedSize);
    }
  });

  it("activeIndices.size < totalColumns のときアクティブカラムが指定幅になる", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 4000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([1, 2]));

    expect(result.groups).toHaveLength(4);

    // activeSize = 850/4000 = 0.2125
    // inactiveSize = (1 - 2*0.2125) / 2 = 0.2875
    const activeSize = 850 / 4000;
    const inactiveSize = (1 - 2 * activeSize) / 2;

    expect(result.groups[0].size).toBeCloseTo(inactiveSize); // inactive
    expect(result.groups[1].size).toBeCloseTo(activeSize);   // active
    expect(result.groups[2].size).toBeCloseTo(activeSize);   // active
    expect(result.groups[3].size).toBeCloseTo(inactiveSize); // inactive
  });

  it("先頭2つがアクティブのとき正しく動作する", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 4000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0, 1]));

    expect(result.groups).toHaveLength(4);
    const activeSize = 850 / 4000;
    const inactiveSize = (1 - 2 * activeSize) / 2;
    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(activeSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);
  });

  it("末尾2つがアクティブのとき正しく動作する", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 4000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([2, 3]));

    expect(result.groups).toHaveLength(4);
    const activeSize = 850 / 4000;
    const inactiveSize = (1 - 2 * activeSize) / 2;
    expect(result.groups[0].size).toBeCloseTo(inactiveSize);
    expect(result.groups[1].size).toBeCloseTo(inactiveSize);
    expect(result.groups[2].size).toBeCloseTo(activeSize);
    expect(result.groups[3].size).toBeCloseTo(activeSize);
  });

  it("全グループのsize合計が1になる", () => {
    const config: LayoutConfig = {
      totalColumns: 5,
      windowWidth: 5000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([1, 2, 3]));

    let total = 0;
    for (const group of result.groups) {
      total += group.size;
    }
    expect(total).toBeCloseTo(1.0);
  });

  it("minColumnWidthがwindowWidthより大きい場合、95%クランプが適用される", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 500,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0]));

    // 850/500 = 1.7, 1 * 1.7 > 0.95 → activeSize = 0.95/1 = 0.95
    expect(result.groups).toHaveLength(4);
    const activeSize = 0.95;
    const inactiveSize = (1 - activeSize) / 3;
    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(inactiveSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);
  });

  it("narrowウィンドウではアクティブとインアクティブに差がつく（95%クランプ）", () => {
    // 旧ロジックでは等間隔にフォールバックしていたが、新ロジックでは差がつく
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 1440,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0]));

    expect(result.groups).toHaveLength(4);
    // 850/1440 ≈ 0.5903, 1 * 0.5903 < 0.95 → クランプ不要、activeSize = 0.5903
    const activeSize = 850 / 1440;
    const inactiveSize = (1 - activeSize) / 3;

    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(inactiveSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);
    // アクティブとインアクティブに差がある
    expect(activeSize).toBeGreaterThan(inactiveSize);
  });

  it("MBA 14インチで4カラム1アクティブの場合のsize検証", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 1440,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0]));

    expect(result.groups).toHaveLength(4);

    // 850/1440 ≈ 0.5903, クランプ不要
    const activeSize = 850 / 1440;
    const inactiveSize = (1 - activeSize) / 3;

    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(inactiveSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);
    // 新ロジック: activeSize > inactiveSize（等間隔にはならない）
    expect(activeSize).toBeGreaterThan(inactiveSize);
  });

  it("ウルトラワイドでアクティブカラムが固定幅を確保する", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 4000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([1]));

    // activeSize = 850/4000 = 0.2125
    const activeSize = 850 / 4000;
    const inactiveSize = (1 - activeSize) / 3;

    expect(result.groups[0].size).toBeCloseTo(inactiveSize);
    expect(result.groups[1].size).toBeCloseTo(activeSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);

    // アクティブカラムのピクセル幅が850pxになることを確認
    expect(activeSize * 4000).toBeCloseTo(850);
  });

  it("複数アクティブで95%クランプが適用される場合", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 1000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0, 1]));

    // 850/1000 = 0.85, 2 * 0.85 = 1.7 > 0.95 → activeSize = 0.95/2 = 0.475
    const activeSize = 0.95 / 2;
    const inactiveSize = (1 - 2 * activeSize) / 2;

    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(activeSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);

    // 合計が1になることを確認
    let total = 0;
    for (const group of result.groups) {
      total += group.size;
    }
    expect(total).toBeCloseTo(1.0);
  });
});
