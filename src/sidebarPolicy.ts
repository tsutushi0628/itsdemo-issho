/**
 * アクティブカラム数からプライマリサイドバーの目標表示状態を決定する純粋関数。
 *
 * 境界: アクティブカラム1以下で非表示、2以上で表示。
 * アクティブが1本まで縮むほど狭いウィンドウではサイドバーを畳んでエディタ領域を最大化し、
 * 2本以上のアクティブを並べられる広さではサイドバーを開いたまま運用する。
 * 27インチ（実測1920px）でアクティブ2本＋サイドバー開を両立させるための境界。
 */
export type SidebarTargetState = "open" | "close";

export function decideSidebarTargetState(activeColumns: number): SidebarTargetState {
  if (activeColumns <= 1) {
    return "close";
  }
  return "open";
}
