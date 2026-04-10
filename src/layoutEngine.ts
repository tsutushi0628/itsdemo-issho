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

export function calculateLayout(
  config: LayoutConfig,
  activeIndices: Set<number>
): EditorLayout {
  const { totalColumns, windowWidth, minColumnWidth } = config;
  const activeColumns = activeIndices.size;

  if (activeColumns >= totalColumns) {
    const equalSize = 1 / totalColumns;
    const groups: EditorLayoutLeaf[] = [];
    for (let i = 0; i < totalColumns; i++) {
      groups.push({ groups: [{}], size: equalSize });
    }
    return { orientation: 0, groups };
  }

  let activeSize = minColumnWidth / windowWidth;
  const activeCount = activeIndices.size;
  if (activeCount * activeSize > 0.95) {
    activeSize = 0.95 / activeCount;
  }

  // 残りを非アクティブで均等割り
  const inactiveCount = totalColumns - activeColumns;
  const remaining = 1 - activeColumns * activeSize;
  const inactiveSize = inactiveCount > 0 ? remaining / inactiveCount : 0;

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
