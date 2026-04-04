import * as vscode from "vscode";

export interface LayoutConfig {
  totalColumns: number;
  activeColumns: number;
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
  focusedGroupIndex: number
): EditorLayout {
  const { totalColumns, activeColumns, windowWidth, minColumnWidth } = config;

  if (activeColumns >= totalColumns) {
    const equalSize = 1 / totalColumns;
    const groups: EditorLayoutLeaf[] = [];
    for (let i = 0; i < totalColumns; i++) {
      groups.push({ groups: [{}], size: equalSize });
    }
    return { orientation: 0, groups };
  }

  // アクティブカラム1つの比率 = minColumnWidth / windowWidth
  // ただしactiveColumns * activeSize > 1 の場合はactiveSize = 1/totalColumnsにフォールバック
  const activeSize = Math.min(minColumnWidth / windowWidth, 1 / totalColumns);

  // 残りを非アクティブで均等割り
  const inactiveCount = totalColumns - activeColumns;
  const remaining = 1 - activeColumns * activeSize;
  const inactiveSize = inactiveCount > 0 ? remaining / inactiveCount : 0;

  const activeIndices = resolveActiveIndices(
    focusedGroupIndex,
    activeColumns,
    totalColumns
  );

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

function resolveActiveIndices(
  focusedIndex: number,
  activeColumns: number,
  totalColumns: number
): Set<number> {
  const indices = new Set<number>();
  indices.add(focusedIndex);

  let remaining = activeColumns - 1;
  let offset = 1;

  while (remaining > 0) {
    const rightIndex = focusedIndex + offset;
    if (rightIndex < totalColumns && remaining > 0) {
      indices.add(rightIndex);
      remaining--;
    }

    const leftIndex = focusedIndex - offset;
    if (leftIndex >= 0 && remaining > 0) {
      indices.add(leftIndex);
      remaining--;
    }

    offset++;

    if (offset > totalColumns) {
      break;
    }
  }

  return indices;
}

export async function applyLayout(layout: EditorLayout): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.setEditorLayout",
    layout
  );
}
