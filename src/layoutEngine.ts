import * as vscode from "vscode";

export interface LayoutConfig {
  totalColumns: number;
  windowWidth: number;
  minColumnWidth: number;
}

export interface EditorLayoutLeaf {
  groups: [Record<string, never>];
  size: number;
}

export interface EditorLayout {
  orientation: number;
  groups: EditorLayoutLeaf[];
}

function equalLayout(totalColumns: number): EditorLayout {
  const equalSize = 1 / totalColumns;
  const groups: EditorLayoutLeaf[] = [];
  for (let i = 0; i < totalColumns; i++) {
    groups.push({ groups: [{}], size: equalSize });
  }
  return { orientation: 0, groups };
}

export function calculateLayout(
  config: LayoutConfig,
  activeIndices: Set<number>
): EditorLayout {
  const { totalColumns, windowWidth } = config;
  const activeColumns = activeIndices.size;

  if (activeColumns >= totalColumns) {
    return equalLayout(totalColumns);
  }

  const VSCODE_MIN_GROUP_WIDTH = 230;
  const activeCount = activeIndices.size;
  const inactiveCount = totalColumns - activeCount;

  // 非アクティブを230px固定、残りをアクティブで均等割り
  const inactiveSize = VSCODE_MIN_GROUP_WIDTH / windowWidth;
  const activeSize = inactiveCount > 0
    ? (1 - inactiveCount * inactiveSize) / activeCount
    : 1 / totalColumns;

  // 窓が狭く非アクティブ固定幅だけで全幅を食い尽くす（アクティブが非アクティブ以下に
  // 潰れる）場合、アコーディオンは成立しない。負値・極小比率を VS Code に渡すと
  // クランプで崩れるため、等間隔へフォールバックする。
  if (activeSize <= inactiveSize) {
    return equalLayout(totalColumns);
  }

  const groups: EditorLayoutLeaf[] = [];
  for (let i = 0; i < totalColumns; i++) {
    if (activeIndices.has(i)) {
      groups.push({ groups: [{}], size: activeSize });
    } else {
      groups.push({ groups: [{}], size: inactiveSize });
    }
  }

  return { orientation: 0, groups };
}

export async function applyLayout(layout: EditorLayout): Promise<void> {
  const fs = require("fs");
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const ts = now.toISOString().replace('T', ' ').replace('Z', ' JST');
  try { fs.appendFileSync("/tmp/editor-spotlighter-debug.log", `${ts} [vscode-layout] ${JSON.stringify(layout)}\n`); } catch {}
  await vscode.commands.executeCommand(
    "vscode.setEditorLayout",
    layout
  );
}

export async function readBackLayout(): Promise<EditorLayout | undefined> {
  try {
    return (await vscode.commands.executeCommand(
      "vscode.getEditorLayout"
    )) as EditorLayout;
  } catch {
    return undefined;
  }
}

// 適用要求と読み戻し結果の比率一致を判定する。
// setEditorLayout は相対比率、getEditorLayout は実ピクセルを返すため、
// 双方を合計1に正規化してから比較する（ディスプレイ切替直後に VS Code 側
// グリッドが旧幅のまま適用を反映しない実害があり、その検出に使う）。
export function layoutMatches(
  requested: EditorLayout,
  actual: EditorLayout | undefined,
  tolerance: number
): boolean {
  if (!actual || !Array.isArray(actual.groups)) {
    return false;
  }
  if (actual.groups.length !== requested.groups.length) {
    return false;
  }
  const normalize = (groups: { size?: number }[]): number[] | undefined => {
    const sizes = groups.map(g => g.size ?? 0);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (!(total > 0)) {
      return undefined;
    }
    return sizes.map(s => s / total);
  };
  const req = normalize(requested.groups);
  const act = normalize(actual.groups);
  if (!req || !act) {
    return false;
  }
  return req.every((r, i) => Math.abs(r - act[i]) <= tolerance);
}
