/**
 * アクティブカラム数からプライマリサイドバーの目標表示状態を決定する純粋関数。
 *
 * 境界: アクティブカラム2以下で非表示、3以上で表示。
 * 狭いウィンドウでエディタ領域を最大化し、広いウィンドウではサイドバーを復帰させる。
 */
export type SidebarTargetState = "open" | "close";

export function decideSidebarTargetState(activeColumns: number): SidebarTargetState {
  if (activeColumns <= 2) {
    return "close";
  }
  return "open";
}
