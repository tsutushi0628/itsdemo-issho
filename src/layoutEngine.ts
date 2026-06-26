import * as vscode from "vscode";

export interface LayoutConfig {
  totalColumns: number;
  windowWidth: number;
  minColumnWidth: number;
}

export interface EditorLayoutLeaf {
  // 1セル=長さ1（縦フル）、N段=長さN（縦にN分割）。VS Code は inner の size 省略時に
  // 段を均等分割する。上位 orientation の直交方向（横並び列なら縦）に割れる。
  groups: Record<string, never>[];
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

// ---- グリッド（行列プリセット）---------------------------------------------
// 設計: 上位 orientation は従来どおり横並び（列）。各列を「段数」で縦分割する。
// 列の横幅は calculateLayout がそのまま決め（アコーディオンも列軸で従来どおり効く）、
// 段は均等。左端 fullHeightColumns 列だけ 1 段（縦フル）にして編集用に確保する。

// 列ごとの段数を返す。左から fullHeightColumns 列は 1 段、残りは rows 段。
// 例: buildRowsPerColumn(4, 2, 1) = [1, 2, 2, 2]（左1列フル＋3列が2段）。
export function buildRowsPerColumn(
  columns: number,
  rows: number,
  fullHeightColumns: number
): number[] {
  const cols = Math.max(1, Math.floor(columns));
  const r = Math.max(1, Math.floor(rows));
  const fh = Math.min(cols, Math.max(0, Math.floor(fullHeightColumns)));
  const result: number[] = [];
  for (let i = 0; i < cols; i++) {
    result.push(i < fh ? 1 : r);
  }
  return result;
}

// グリッド全体のエディタ群（セル）総数。
export function totalGroupCount(rowsPerColumn: number[]): number {
  return rowsPerColumn.reduce((sum, n) => sum + n, 0);
}

// フラットなグループ index（VS Code の tabGroups.all / focusNthEditorGroup の採番）から
// 所属する列 index への写像。VS Code はグリッドのグループを groups 配列の深さ優先順で
// 採番するため、wrapColumnsIntoGrid が並べる順（列0の全段→列1の全段…）と一致する。
// 例: groupIndexToColumn([1,2,2,2]) = [0, 1,1, 2,2, 3,3]。
export function groupIndexToColumn(rowsPerColumn: number[]): number[] {
  const map: number[] = [];
  rowsPerColumn.forEach((rowCount, col) => {
    for (let r = 0; r < rowCount; r++) {
      map.push(col);
    }
  });
  return map;
}

// 単段の列幅レイアウト（calculateLayout の出力）を、列ごとの段数で縦分割した
// グリッドへ包む。各列の横幅比率（size）は据え置き、段は均等分割（inner size 省略）。
export function wrapColumnsIntoGrid(
  columnLayout: EditorLayout,
  rowsPerColumn: number[]
): EditorLayout {
  const groups: EditorLayoutLeaf[] = columnLayout.groups.map((col, i) => {
    const rowCount = Math.max(1, rowsPerColumn[i] ?? 1);
    const inner: Record<string, never>[] = Array.from({ length: rowCount }, () => ({}));
    return { groups: inner, size: col.size };
  });
  return { orientation: columnLayout.orientation, groups };
}

// 列数・段数・左フル列数からグリッドレイアウトを一括生成する。
// activeColumnIndices は「横に広げる列」（アコーディオン）。空集合や全列指定で等間隔。
export function calculateGridLayout(
  config: LayoutConfig,
  activeColumnIndices: Set<number>,
  rowsPerColumn: number[]
): EditorLayout {
  const columnLayout = calculateLayout(config, activeColumnIndices);
  return wrapColumnsIntoGrid(columnLayout, rowsPerColumn);
}

// 「同じレイアウトなら再適用しない」同一性キー。段構成（inner 長）と列幅比率の両方を含める。
// 適用側（onFocusChange）と整形側（resetToEqual）で必ず同じ式を使うため正本をここに置く
// （式が片方だけズレると、整えた直後のフォーカスが誤って『変化なし』スキップに吸われ崩れが固定される）。
export function layoutSignature(layout: EditorLayout): string {
  return layout.groups.map(g => `${g.groups.length}:${g.size.toFixed(4)}`).join('|');
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
