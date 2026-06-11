// 注入中止理由（PC→スマホ）。スマホ側で日本語文言にマッピングする
export type InjectAbortReason =
  | "busy"               // 注入処理中の連打
  | "columnOutOfRange"   // 選択列が実グループ数の範囲外
  | "noClaudeTab"        // 対象列に Claude Code セッションが無い/活性化できない
  | "focusUnverified"    // フォーカス確定検証タイムアウト
  | "frontAppNotVSCode"  // 前面アプリが VS Code でない
  | "stateChanged"       // 注入中に選択列/グループ構成が変わった
  | "internalError";     // コマンド実行例外等

// PC -> スマホ
export type ServerMessage =
  | { type: "frame"; data: string; column: number }  // column: クロップ元列番号（B-5）
  | { type: "tabs"; data: TabInfo[] }
  | { type: "viewport"; x: number; y: number; width: number; height: number }
  | { type: "columns"; count: number; active: number; labels: string[]; allowInput: boolean }
  | { type: "injectResult"; ok: boolean; reason?: InjectAbortReason; column: number };

export interface TabInfo {
  groupIndex: number;
  tabIndex: number;
  label: string;
  isActive: boolean;
}

// スマホ -> PC
export type ClientMessage =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "switchTab"; groupIndex: number; tabIndex: number }
  | { type: "selectColumn"; column: number }
  | { type: "disconnect" }
  | { type: "screenInfo"; width: number };
