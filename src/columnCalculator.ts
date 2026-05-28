/**
 * エディタ領域幅・最小許容幅・非アクティブ固定幅から活性カラム数を計算する。
 *
 * fullWidthThreshold以上の幅ではtotalColumnsをそのまま返す（全カラム等間隔表示）。
 * それ以外: N=totalColumns から1まで減らして
 *   (editorWidth - (totalColumns - N) * inactiveFixedWidth) / N >= minColumnWidth
 * を満たす最大のNを返す。1個も満たさない場合は1にクランプ。
 */
export function computeActiveColumns(
  editorWidth: number,
  minColumnWidth: number,
  totalColumns: number,
  fullWidthThreshold: number,
  inactiveFixedWidth: number = 220
): number {
  if (editorWidth >= fullWidthThreshold) {
    return totalColumns;
  }

  for (let n = totalColumns; n >= 1; n--) {
    const inactiveCount = totalColumns - n;
    const activeWidth = (editorWidth - inactiveCount * inactiveFixedWidth) / n;
    if (activeWidth >= minColumnWidth) {
      return n;
    }
  }

  return 1;
}
