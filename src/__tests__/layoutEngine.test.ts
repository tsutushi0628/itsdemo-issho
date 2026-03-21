import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
  },
}));

import { calculateLayout } from "../layoutEngine";
import type { LayoutConfig } from "../layoutEngine";

describe("calculateLayout", () => {
  it("activeColumns >= totalColumns のとき等間隔になる", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      activeColumns: 4,
      activeRatio: 0.35,
      inactiveRatio: 0.1,
    };

    const result = calculateLayout(config, 0);

    expect(result.groups).toHaveLength(4);
    const expectedSize = 1 / 4;
    for (const group of result.groups) {
      expect(group.size).toBeCloseTo(expectedSize);
    }
  });

  it("activeColumns < totalColumns のときフォーカスカラムが広くなる", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      activeColumns: 2,
      activeRatio: 0.35,
      inactiveRatio: 0.1,
    };

    const result = calculateLayout(config, 1);

    expect(result.groups).toHaveLength(4);

    // フォーカスされたカラム(index=1)はactiveなので大きいはず
    const focusedSize = result.groups[1].size;
    // 非アクティブカラムより大きい
    for (let i = 0; i < result.groups.length; i++) {
      if (i === 1) {
        continue;
      }
      // activeIndicesに含まれないカラムとの比較
      // activeColumns=2, focused=1 → active indices = {1, 2}
      if (i !== 2) {
        expect(focusedSize).toBeGreaterThan(result.groups[i].size);
      }
    }
  });

  it("フォーカスが先頭(index=0)のとき正しく動作する", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      activeColumns: 2,
      activeRatio: 0.35,
      inactiveRatio: 0.1,
    };

    const result = calculateLayout(config, 0);

    expect(result.groups).toHaveLength(4);
    // active indices: {0, 1}
    // index 0, 1 はactiveRatio、index 2, 3 はinactiveRatio
    const rawTotal = 2 * 0.35 + 2 * 0.1;
    expect(result.groups[0].size).toBeCloseTo(0.35 / rawTotal);
    expect(result.groups[1].size).toBeCloseTo(0.35 / rawTotal);
    expect(result.groups[2].size).toBeCloseTo(0.1 / rawTotal);
    expect(result.groups[3].size).toBeCloseTo(0.1 / rawTotal);
  });

  it("フォーカスが末尾(index=totalColumns-1)のとき正しく動作する", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      activeColumns: 2,
      activeRatio: 0.35,
      inactiveRatio: 0.1,
    };

    const result = calculateLayout(config, 3);

    expect(result.groups).toHaveLength(4);
    // active indices: {3, 2} (focused=3, right溢れ→leftに展開)
    const rawTotal = 2 * 0.35 + 2 * 0.1;
    expect(result.groups[0].size).toBeCloseTo(0.1 / rawTotal);
    expect(result.groups[1].size).toBeCloseTo(0.1 / rawTotal);
    expect(result.groups[2].size).toBeCloseTo(0.35 / rawTotal);
    expect(result.groups[3].size).toBeCloseTo(0.35 / rawTotal);
  });

  it("activeRatio が 0 以下のときエラーをthrowする", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      activeColumns: 2,
      activeRatio: 0,
      inactiveRatio: 0.1,
    };

    expect(() => calculateLayout(config, 0)).toThrow("activeRatio");
  });

  it("inactiveRatio が 0 以下のときエラーをthrowする", () => {
    const config: LayoutConfig = {
      totalColumns: 4,
      activeColumns: 2,
      activeRatio: 0.35,
      inactiveRatio: -0.1,
    };

    expect(() => calculateLayout(config, 0)).toThrow("inactiveRatio");
  });

  it("全グループのsize合計が1になる", () => {
    const config: LayoutConfig = {
      totalColumns: 5,
      activeColumns: 3,
      activeRatio: 0.3,
      inactiveRatio: 0.05,
    };

    const result = calculateLayout(config, 2);

    let total = 0;
    for (const group of result.groups) {
      total += group.size;
    }
    expect(total).toBeCloseTo(1.0);
  });
});
