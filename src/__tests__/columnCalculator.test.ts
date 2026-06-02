import { describe, it, expect } from "vitest";
import { computeActiveColumns } from "../columnCalculator";

const INACTIVE_FIXED = 230;

function activeWidth(editorWidth: number, totalColumns: number, n: number): number {
  const inactiveCount = totalColumns - n;
  return (editorWidth - inactiveCount * INACTIVE_FIXED) / n;
}

describe("computeActiveColumns", () => {
  it("活性幅が最小許容幅以上を保てる最大のNを返す（基本）", () => {
    // editorWidth=2260, min=600, total=5
    // N=3: (2260-2×230)/3=600>=600 ✓, N=4: (2260-230)/4=507.5<600 ✗
    const n = computeActiveColumns(2260, 600, 5, 3000);
    expect(n).toBe(3);
    expect(activeWidth(2260, 5, n)).toBeGreaterThanOrEqual(600);
  });

  it("活性幅がちょうど最小許容幅と等しい場合はそのNを採用する", () => {
    // N=4: (1600-0×230)/4=400>=400 ✓（totalColumns=4なので非アクティブ0本）
    const n = computeActiveColumns(1600, 400, 4, 3000);
    expect(n).toBe(4);
    expect(activeWidth(1600, 4, n)).toBeGreaterThanOrEqual(400);
  });

  it("fullWidthThreshold以上のとき全カラムを返す", () => {
    const n = computeActiveColumns(3000, 600, 5, 3000);
    expect(n).toBe(5);
  });

  it("3840pxのウルトラワイドでもfullWidthThresholdを超えれば全カラムを返す", () => {
    const n = computeActiveColumns(3840, 600, 5, 3000);
    expect(n).toBe(5);
  });

  it("fullWidthThreshold未満でも活性幅が確保できるなら多カラムを返す", () => {
    // editorWidth=2900, min=400, total=4
    // N=4: (2900-0×230)/4=725>=400 ✓
    const n = computeActiveColumns(2900, 400, 4, 3000);
    expect(n).toBe(4);
    expect(activeWidth(2900, 4, n)).toBeGreaterThanOrEqual(400);
  });

  it("エディタ幅が最小許容幅より小さくても1を返す（クランプ）", () => {
    const n = computeActiveColumns(300, 400, 4, 3000);
    expect(n).toBe(1);
  });

  it("エディタ幅0でも1を返す（クランプ）", () => {
    const n = computeActiveColumns(0, 400, 4, 3000);
    expect(n).toBe(1);
  });

  it("totalColumns=12でエディタ幅が足りない場合は1にクランプされる", () => {
    // editorWidth=1920, min=200, total=12
    // N=1でも (1920-11×230)/1=-610<200 → 条件を満たすNが存在しないため1にクランプ
    const n = computeActiveColumns(1920, 200, 12, 3000);
    expect(n).toBe(1);
  });

  describe("fullWidthThreshold", () => {
    it("3000px以上のウルトラワイドではtotalColumnsを返す", () => {
      const n = computeActiveColumns(3000, 850, 4, 3000);
      expect(n).toBe(4);
    });

    it("fullWidthThreshold未満では活性幅保証ロジックが働く", () => {
      // editorWidth=2718, min=850, total=4
      // N=4: 2718/4=679.5<850 → N=3: (2718-230)/3=829.3<850 → N=2: (2718-2×230)/2=1129>=850
      const n = computeActiveColumns(2718, 850, 4, 3000);
      expect(n).toBe(2);
      expect(activeWidth(2718, 4, n)).toBeGreaterThanOrEqual(850);
    });

    it("幅が狭い場合は1カラムにクランプされる", () => {
      // editorWidth=1440, min=850, total=4
      // N=1: (1440-3×230)/1=750<850 → クランプ1
      const n = computeActiveColumns(1440, 850, 4, 3000);
      expect(n).toBe(1);
    });
  });
});
