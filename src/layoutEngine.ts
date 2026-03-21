import * as vscode from "vscode";

export interface LayoutConfig {
  totalColumns: number;
  activeColumns: number;
  activeRatio: number;
  inactiveRatio: number;
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
  const { totalColumns, activeColumns, activeRatio, inactiveRatio } = config;

  if (activeRatio <= 0) {
    throw new Error(`activeRatio は正の数である必要があります: ${activeRatio}`);
  }
  if (inactiveRatio <= 0) {
    throw new Error(`inactiveRatio は正の数である必要があります: ${inactiveRatio}`);
  }

  if (activeColumns >= totalColumns) {
    const equalSize = 1 / totalColumns;
    const groups: EditorLayoutLeaf[] = [];
    for (let i = 0; i < totalColumns; i++) {
      groups.push({ groups: [{}], size: equalSize });
    }
    return { orientation: 0, groups };
  }

  const activeIndices = resolveActiveIndices(
    focusedGroupIndex,
    activeColumns,
    totalColumns
  );

  let activeCount = 0;
  let inactiveCount = 0;
  for (let i = 0; i < totalColumns; i++) {
    if (activeIndices.has(i)) {
      activeCount++;
    } else {
      inactiveCount++;
    }
  }

  const rawTotal =
    activeCount * activeRatio + inactiveCount * inactiveRatio;

  const groups: EditorLayoutLeaf[] = [];
  for (let i = 0; i < totalColumns; i++) {
    if (activeIndices.has(i)) {
      groups.push({ groups: [{}], size: activeRatio / rawTotal });
    } else {
      groups.push({ groups: [{}], size: inactiveRatio / rawTotal });
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
