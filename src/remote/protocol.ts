// PC -> スマホ
export type ServerMessage = { type: "frame"; data: string };

// スマホ -> PC
export type ClientMessage =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string };
