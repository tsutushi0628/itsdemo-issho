import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
  },
}));

import { calculateLayout } from "../layoutEngine";
import type { LayoutConfig } from "../layoutEngine";
import { computeActiveColumns } from "../columnCalculator";

const VSCODE_MIN = 230;

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

  it("activeIndices.size < totalColumns のときアクティブカラムが残り幅を取る", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 4000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([1, 2]));

    expect(result.groups).toHaveLength(4);

    // inactiveSize = 230/4000 = 0.0575
    // activeSize = (1 - 2*0.055) / 2 = 0.445
    const inactiveSize = VSCODE_MIN / 4000;
    const activeSize = (1 - 2 * inactiveSize) / 2;

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
    const inactiveSize = VSCODE_MIN / 4000;
    const activeSize = (1 - 2 * inactiveSize) / 2;
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
    const inactiveSize = VSCODE_MIN / 4000;
    const activeSize = (1 - 2 * inactiveSize) / 2;
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

  it("非アクティブカラムが常に230pxになる", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 1414,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0]));

    expect(result.groups).toHaveLength(4);
    const inactiveSize = VSCODE_MIN / 1414;
    const activeSize = (1 - 3 * inactiveSize) / 1;

    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(inactiveSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);

    // 非アクティブカラムが230pxであることを確認
    expect(result.groups[1].size * 1414).toBeCloseTo(VSCODE_MIN);
  });

  it("MBA 14インチ(1414px)で4カラム1アクティブの場合のsize検証", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 1414,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0]));

    expect(result.groups).toHaveLength(4);

    // inactiveSize = 230/1414 ≈ 0.1556
    // activeSize = (1 - 3*0.1556) / 1 ≈ 0.5333
    const inactiveSize = VSCODE_MIN / 1414;
    const activeSize = (1 - 3 * inactiveSize) / 1;

    expect(result.groups[0].size).toBeCloseTo(activeSize);
    expect(result.groups[1].size).toBeCloseTo(inactiveSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);

    // アクティブカラムのピクセル幅 ≈ 754px
    expect(activeSize * 1414).toBeCloseTo(1414 - 3 * VSCODE_MIN);
    // 非アクティブカラムのピクセル幅 = 230px
    expect(inactiveSize * 1414).toBeCloseTo(VSCODE_MIN);
    // activeSize > inactiveSize
    expect(activeSize).toBeGreaterThan(inactiveSize);
  });

  it("ウルトラワイドでアクティブカラムが残り全幅を確保する", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 4000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([1]));

    // inactiveSize = 230/4000 = 0.0575
    // activeSize = (1 - 3*0.0575) / 1 = 0.8275
    const inactiveSize = VSCODE_MIN / 4000;
    const activeSize = (1 - 3 * inactiveSize) / 1;

    expect(result.groups[0].size).toBeCloseTo(inactiveSize);
    expect(result.groups[1].size).toBeCloseTo(activeSize);
    expect(result.groups[2].size).toBeCloseTo(inactiveSize);
    expect(result.groups[3].size).toBeCloseTo(inactiveSize);

    // 非アクティブカラムのピクセル幅が230pxになることを確認
    expect(inactiveSize * 4000).toBeCloseTo(VSCODE_MIN);
  });

  it("複数アクティブでsize合計が1になる", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      windowWidth: 1000,
      minColumnWidth: 850,
    };

    const result = calculateLayout(config, new Set([0, 1]));

    // inactiveSize = 230/1000 = 0.23
    // activeSize = (1 - 2*0.23) / 2 = 0.27
    const inactiveSize = VSCODE_MIN / 1000;
    const activeSize = (1 - 2 * inactiveSize) / 2;

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

describe("27インチ運用 業務意図シナリオ", () => {
  const MIN_ACTIVE_WIDTH = 600;
  const TOTAL_COLUMNS = 5;
  const FULL_WIDTH_THRESHOLD = 3000;

  it("シナリオA: 27インチ・サイドバー開（editorWidth=2260）で活性幅600px以上を維持", () => {
    const editorWidth = 2260;
    const n = computeActiveColumns(editorWidth, MIN_ACTIVE_WIDTH, TOTAL_COLUMNS, FULL_WIDTH_THRESHOLD);
    const activeIndices = new Set(Array.from({ length: n }, (_, i) => i));
    const config: LayoutConfig = { totalColumns: TOTAL_COLUMNS, windowWidth: editorWidth, minColumnWidth: MIN_ACTIVE_WIDTH };
    const layout = calculateLayout(config, activeIndices);
    const activeGroupSize = layout.groups[0].size;
    const activeWidthPx = activeGroupSize * editorWidth;
    expect(activeWidthPx).toBeGreaterThanOrEqual(MIN_ACTIVE_WIDTH);
    // 活性数Nも確認（1以上・totalColumns以下）
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(TOTAL_COLUMNS);
  });

  it("シナリオB: 27インチ・サイドバー閉（editorWidth=2560）で活性幅600px以上を維持", () => {
    const editorWidth = 2560;
    const n = computeActiveColumns(editorWidth, MIN_ACTIVE_WIDTH, TOTAL_COLUMNS, FULL_WIDTH_THRESHOLD);
    const activeIndices = new Set(Array.from({ length: n }, (_, i) => i));
    const config: LayoutConfig = { totalColumns: TOTAL_COLUMNS, windowWidth: editorWidth, minColumnWidth: MIN_ACTIVE_WIDTH };
    const layout = calculateLayout(config, activeIndices);
    const activeGroupSize = layout.groups[0].size;
    const activeWidthPx = activeGroupSize * editorWidth;
    expect(activeWidthPx).toBeGreaterThanOrEqual(MIN_ACTIVE_WIDTH);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(TOTAL_COLUMNS);
  });

  it("シナリオC: ウルトラワイド（editorWidth=3140）で等間隔モードになり各幅600px以上", () => {
    const editorWidth = 3140;
    const n = computeActiveColumns(editorWidth, MIN_ACTIVE_WIDTH, TOTAL_COLUMNS, FULL_WIDTH_THRESHOLD);
    // fullWidthThreshold=3000以上なので等間隔（N=totalColumns）
    expect(n).toBe(TOTAL_COLUMNS);
    const activeIndices = new Set(Array.from({ length: n }, (_, i) => i));
    const config: LayoutConfig = { totalColumns: TOTAL_COLUMNS, windowWidth: editorWidth, minColumnWidth: MIN_ACTIVE_WIDTH };
    const layout = calculateLayout(config, activeIndices);
    // 等間隔モード: 各カラム ≈ editorWidth/totalColumns
    const expectedSize = 1 / TOTAL_COLUMNS;
    for (const group of layout.groups) {
      expect(group.size).toBeCloseTo(expectedSize);
      expect(group.size * editorWidth).toBeGreaterThanOrEqual(MIN_ACTIVE_WIDTH);
    }
  });
});
