import { describe, it, expect } from "vitest";
import { decideSidebarTargetState } from "../sidebarPolicy";

describe("decideSidebarTargetState", () => {
  it("アクティブカラム0は非表示", () => {
    expect(decideSidebarTargetState(0)).toBe("close");
  });

  it("アクティブカラム1は非表示", () => {
    expect(decideSidebarTargetState(1)).toBe("close");
  });

  it("アクティブカラム2は非表示（境界・閉じる側）", () => {
    expect(decideSidebarTargetState(2)).toBe("close");
  });

  it("アクティブカラム3は表示（境界・開く側）", () => {
    expect(decideSidebarTargetState(3)).toBe("open");
  });

  it("アクティブカラム4は表示", () => {
    expect(decideSidebarTargetState(4)).toBe("open");
  });

  it("アクティブカラム5は表示", () => {
    expect(decideSidebarTargetState(5)).toBe("open");
  });

  it("アクティブカラム10は表示", () => {
    expect(decideSidebarTargetState(10)).toBe("open");
  });
});
