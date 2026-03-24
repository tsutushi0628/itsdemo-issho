/**
 * ウィンドウ幅と最小カラム幅からアクティブカラム数を計算する。
 *
 * activeColumns = Math.min(Math.floor(windowWidth / minColumnWidth), totalColumns)
 * 結果が1未満の場合は1にクランプする。
 */
export function computeActiveColumns(
  windowWidth: number,
  minColumnWidth: number,
  totalColumns: number
): number {
  const computed = Math.floor(windowWidth / minColumnWidth);

  if (computed < 1) {
    return 1;
  }

  if (computed >= totalColumns) {
    return totalColumns;
  }

  return computed;
}
