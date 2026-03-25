// PC -> スマホ
export type ServerMessage =
  | { type: "frame"; data: string }
  | { type: "tabs"; data: TabInfo[] };

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
  | { type: "switchTab"; groupIndex: number; tabIndex: number };
