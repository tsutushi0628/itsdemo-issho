import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
  },
}));

import {
  buildRowsPerColumn,
  totalGroupCount,
  groupIndexToColumn,
  wrapColumnsIntoGrid,
  calculateGridLayout,
  calculateLayout,
  layoutMatches,
  layoutSignature,
} from "../layoutEngine";
import type { LayoutConfig, EditorLayout } from "../layoutEngine";

describe("buildRowsPerColumn（列ごとの段数）", () => {
  it("既定の4列2段・左1列フルは [1,2,2,2]（左端だけ1段＝編集用に縦フル）", () => {
    expect(buildRowsPerColumn(4, 2, 1)).toEqual([1, 2, 2, 2]);
  });

  it("左フル0なら全列が段数どおりに割れる", () => {
    expect(buildRowsPerColumn(4, 2, 0)).toEqual([2, 2, 2, 2]);
    expect(buildRowsPerColumn(3, 3, 0)).toEqual([3, 3, 3]);
  });

  it("左フルが列数を超えても列数までにクランプする（全列フル）", () => {
    expect(buildRowsPerColumn(3, 2, 9)).toEqual([1, 1, 1]);
  });

  it("段数1なら左フル指定に関わらず全列が1段（従来の横1列モード）", () => {
    expect(buildRowsPerColumn(5, 1, 0)).toEqual([1, 1, 1, 1, 1]);
  });

  it("列数・段数の下限は1にクランプし、不正値で空配列や0段を作らない", () => {
    expect(buildRowsPerColumn(0, 0, 0)).toEqual([1]);
    expect(buildRowsPerColumn(2, 0, 0)).toEqual([1, 1]);
  });
});

describe("totalGroupCount / groupIndexToColumn（実グループ←→列の写像）", () => {
  it("4列2段・左1列フルのセル総数は7", () => {
    expect(totalGroupCount(buildRowsPerColumn(4, 2, 1))).toBe(7);
  });

  it("フォーカスされた実グループindexが正しい列に写像される（[1,2,2,2]→[0,1,1,2,2,3,3]）", () => {
    expect(groupIndexToColumn([1, 2, 2, 2])).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it("段違いの2セルでも同じ列に写像される（同じ列を広げる根拠）", () => {
    const map = groupIndexToColumn(buildRowsPerColumn(4, 2, 1));
    // 列1（左フルの右隣）の上段=index1・下段=index2 はどちらも列1
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(1);
    // 列3（右端）の上段=index5・下段=index6 はどちらも列3
    expect(map[5]).toBe(3);
    expect(map[6]).toBe(3);
  });
});

describe("wrapColumnsIntoGrid（列幅を据え置き段で縦分割）", () => {
  it("左フル列は1段・残りは段数どおりに inner を持ち、列の横幅比率は据え置く", () => {
    const columnLayout: EditorLayout = {
      orientation: 0,
      groups: [
        { groups: [{}], size: 0.4 },
        { groups: [{}], size: 0.2 },
        { groups: [{}], size: 0.2 },
        { groups: [{}], size: 0.2 },
      ],
    };
    const grid = wrapColumnsIntoGrid(columnLayout, [1, 2, 2, 2]);

    expect(grid.orientation).toBe(0);
    expect(grid.groups).toHaveLength(4);
    // 左端は1段（縦フル）
    expect(grid.groups[0].groups).toHaveLength(1);
    // 残り3列は2段
    expect(grid.groups[1].groups).toHaveLength(2);
    expect(grid.groups[2].groups).toHaveLength(2);
    expect(grid.groups[3].groups).toHaveLength(2);
    // 横幅比率は据え置き
    expect(grid.groups[0].size).toBeCloseTo(0.4);
    expect(grid.groups[1].size).toBeCloseTo(0.2);
  });
});

describe("calculateGridLayout（行列プリセットの一括生成・業務シナリオ）", () => {
  it("4列2段・左1列フル・等間隔: 列幅合計が1、左端だけ1段で残りが2段になる", () => {
    const config: LayoutConfig = { totalColumns: 4, windowWidth: 3000, minColumnWidth: 600 };
    const rowsPerColumn = buildRowsPerColumn(4, 2, 1);
    const grid = calculateGridLayout(config, new Set([0, 1, 2, 3]), rowsPerColumn);

    expect(grid.groups).toHaveLength(4);
    const total = grid.groups.reduce((s, g) => s + g.size, 0);
    expect(total).toBeCloseTo(1.0);
    expect(grid.groups[0].groups).toHaveLength(1); // 左フル
    expect(grid.groups.slice(1).every(g => g.groups.length === 2)).toBe(true);
  });

  it("フォーカス列だけ広げてもグリッド構造（段数）は保たれ、列幅は据え置きアコーディオンと一致する", () => {
    const config: LayoutConfig = { totalColumns: 4, windowWidth: 4000, minColumnWidth: 850 };
    const rowsPerColumn = buildRowsPerColumn(4, 2, 1);
    const active = new Set([0]); // 左の編集列を広げる
    const grid = calculateGridLayout(config, active, rowsPerColumn);
    const columnOnly = calculateLayout(config, active);

    // 列幅はアコーディオン（単段）と完全一致
    grid.groups.forEach((g, i) => expect(g.size).toBeCloseTo(columnOnly.groups[i].size));
    // 段構成は維持
    expect(grid.groups[0].groups).toHaveLength(1);
    expect(grid.groups[1].groups).toHaveLength(2);
  });

  it("署名は段構成も含むので、列幅が同じでも段数が変われば別署名になり再適用される", () => {
    const config: LayoutConfig = { totalColumns: 4, windowWidth: 3000, minColumnWidth: 600 };
    const active = new Set([0, 1, 2, 3]); // 等間隔（列幅は同一）
    const sigLeftFull = layoutSignature(calculateGridLayout(config, active, buildRowsPerColumn(4, 2, 1)));
    const sigAllSplit = layoutSignature(calculateGridLayout(config, active, buildRowsPerColumn(4, 2, 0)));
    // 列幅は同じだが段構成（左端1段 vs 2段）が違う → 署名が異なる＝「変化なしスキップ」に吸われない
    expect(sigLeftFull).not.toBe(sigAllSplit);
  });

  it("読み戻し検証（layoutMatches）はグリッドでも上位の列幅で一致判定できる", () => {
    const config: LayoutConfig = { totalColumns: 4, windowWidth: 3000, minColumnWidth: 600 };
    const rowsPerColumn = buildRowsPerColumn(4, 2, 1);
    const requested = calculateGridLayout(config, new Set([0, 1, 2, 3]), rowsPerColumn);
    // VS Code は読み戻しで実ピクセルを返す。列幅を等倍したものは一致と判定されるべき。
    const actualPx: EditorLayout = {
      orientation: 0,
      groups: requested.groups.map(g => ({ groups: g.groups, size: g.size * 1530 })),
    };
    expect(layoutMatches(requested, actualPx, 0.05)).toBe(true);
  });
});
