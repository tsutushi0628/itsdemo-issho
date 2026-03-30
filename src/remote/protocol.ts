// PC -> スマホ
export type ServerMessage =
  | { type: "frame"; data: string }
  | { type: "tabs"; data: TabInfo[] }
  | { type: "viewport"; x: number; y: number; width: number; height: number }
  | { type: "columns"; count: number; active: number };

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
