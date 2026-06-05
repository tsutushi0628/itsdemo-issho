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

  describe("maxActiveColumns（アクティブ本数の上限）", () => {
    // BenQ GW2790Q（2560×1440・等倍）運用。窓を広げてもアクティブ2本を保つ意図。
    it("上限2: 窓を最大化しても（編集領域2270px）2本に頭打ちする", () => {
      // 上限なしなら (2270-230)/4=510>=460 で4本になるところを2本に抑える
      expect(computeActiveColumns(2270, 460, 5, 3000, 0)).toBe(4);
      expect(computeActiveColumns(2270, 460, 5, 3000, 2)).toBe(2);
    });

    it("上限2: 窓が1920px相当（編集領域1630px）でも2本になる", () => {
      expect(computeActiveColumns(1630, 460, 5, 3000, 2)).toBe(2);
    });

    it("上限2: ノート相当（編集領域1160px）では上限未満の1本のまま", () => {
      // 上限は頭を抑えるだけで、底は最小許容幅で決まる（1本しか入らなければ1本）
      expect(computeActiveColumns(1160, 460, 5, 3000, 2)).toBe(1);
    });

    it("上限2でもfullWidthThreshold以上の等間隔表示には適用されない（全列表示）", () => {
      // ウルトラワイドでは全5列を等間隔で見せる意図を維持
      expect(computeActiveColumns(3206, 460, 5, 3000, 2)).toBe(5);
    });

    it("上限0は上限なし（従来どおり最小許容幅のみで決まる）", () => {
      expect(computeActiveColumns(2270, 460, 5, 3000, 0)).toBe(4);
    });
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
