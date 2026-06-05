/**
 * OSウィンドウ全幅から、VS Code が実際にエディタ格子へ割り当てる領域幅を推定する。
 *
 * ウィンドウ全幅にはプライマリサイドバー・アクティビティバー・群間の仕切りが含まれる。
 * これらを差し引かずに比率を作ると、VS Code がその比率を実エディタ領域へ適用した際に
 * 非アクティブ列が 220px（VS Code がハードコードする群の最小幅）を割り、VS Code 側が
 * クランプしてレイアウトが崩れる（選択した列しか表示されない症状）。
 *
 * 推定は実領域を必ず下回るよう保守的に行う（差し引きすぎ＝列は計算値より広く描画され安全、
 * 差し引き不足＝列が最小幅を割って崩れる）。1px 未満にはクランプする。
 */
export function deriveEditorWidth(
  windowWidth: number,
  sidebarWidth: number,
  chromeMargin: number
): number {
  return Math.max(1, windowWidth - sidebarWidth - chromeMargin);
}

/**
 * エディタ領域幅・最小許容幅・非アクティブ固定幅から活性カラム数を計算する。
 *
 * fullWidthThreshold以上の幅ではtotalColumnsをそのまま返す（全カラム等間隔表示）。
 * それ以外: N=totalColumns から1まで減らして
 *   (editorWidth - (totalColumns - N) * inactiveFixedWidth) / N >= minColumnWidth
 * を満たす最大のNを返す。1個も満たさない場合は1にクランプ。
 *
 * maxActiveColumns（>0のとき）はアクティブ本数の上限。最小許容幅だけでは
 * 「狭い画面で2本・広い画面でも2本」を両立できない（広いほど本数が増える式のため）。
 * 上限で頭を抑え、最小許容幅で底を支える二本立てにする。等間隔モード
 * （fullWidthThreshold以上）には上限を適用しない（広い画面では全列を見せる意図）。
 */
export function computeActiveColumns(
  editorWidth: number,
  minColumnWidth: number,
  totalColumns: number,
  fullWidthThreshold: number,
  maxActiveColumns: number = 0,
  inactiveFixedWidth: number = 230
): number {
  if (editorWidth >= fullWidthThreshold) {
    return totalColumns;
  }

  const cap = maxActiveColumns > 0 ? maxActiveColumns : totalColumns;
  for (let n = totalColumns; n >= 1; n--) {
    const inactiveCount = totalColumns - n;
    const activeWidth = (editorWidth - inactiveCount * inactiveFixedWidth) / n;
    if (activeWidth >= minColumnWidth) {
      return Math.min(n, cap);
    }
  }

  return 1;
}
