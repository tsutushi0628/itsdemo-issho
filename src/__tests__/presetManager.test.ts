import { describe, it, expect } from "vitest";
import { resolveActiveColumns } from "../presetManager";
import type { Preset } from "../presetManager";

describe("resolveActiveColumns", () => {
  it("3840px以上で totalColumns が返る（全カラムアクティブ）", () => {
    const result = resolveActiveColumns(3840, 4);
    expect(result).toBe(4);
  });

  it("4K超の解像度でも totalColumns が返る", () => {
    const result = resolveActiveColumns(5120, 4);
    expect(result).toBe(4);
  });

  it("2560px以上3840px未満で 3 が返る", () => {
    const result = resolveActiveColumns(2560, 4);
    expect(result).toBe(3);
  });

  it("2560px未満で 2 が返る", () => {
    const result = resolveActiveColumns(1920, 4);
    expect(result).toBe(2);
  });

  it("totalColumns が activeColumns より小さい場合は totalColumns が返る", () => {
    // 2560px → activeColumns=3 だが totalColumns=2 なので 2 が返る
    const result = resolveActiveColumns(2560, 2);
    expect(result).toBe(2);
  });

  it("カスタムプリセットが正しく適用される", () => {
    const customPresets: Preset[] = [
      { minWidth: 1920, activeColumns: 4 },
      { minWidth: 1280, activeColumns: 2 },
      { minWidth: 0, activeColumns: 1 },
    ];

    expect(resolveActiveColumns(1920, 5, customPresets)).toBe(4);
    expect(resolveActiveColumns(1280, 5, customPresets)).toBe(2);
    expect(resolveActiveColumns(800, 5, customPresets)).toBe(1);
  });

  it("該当プリセットなしでエラーがthrowされる", () => {
    // 全プリセットのminWidthが現在の幅より大きい場合
    const presets: Preset[] = [
      { minWidth: 3840, activeColumns: 4 },
      { minWidth: 2560, activeColumns: 3 },
    ];

    expect(() => resolveActiveColumns(1920, 4, presets)).toThrow(
      "該当するプリセットが見つかりません"
    );
  });

  it("プリセットがソート順に関係なく正しくマッチする", () => {
    // 逆順で渡しても正しく最大のminWidthからマッチする
    const presets: Preset[] = [
      { minWidth: 0, activeColumns: 1 },
      { minWidth: 3840, activeColumns: 5 },
      { minWidth: 1920, activeColumns: 3 },
    ];

    expect(resolveActiveColumns(3840, 6, presets)).toBe(5);
    expect(resolveActiveColumns(2000, 6, presets)).toBe(3);
    expect(resolveActiveColumns(500, 6, presets)).toBe(1);
  });
});
