import sharp from "sharp";

export interface PanelBoundaries {
  /** 各パネルの左端x座標（ピクセル）の配列。サイドバーは除外済み。エディタカラムのみ */
  columns: { left: number; width: number }[];
  /** 画像全体の幅 */
  imageWidth: number;
  /** 画像全体の高さ */
  imageHeight: number;
  /** エディタ領域の下端y座標（ピクセル）。ターミナルパネルとの境界 */
  editorBottom: number;
}

/**
 * ピクセルの輝度を計算する (ITU-R BT.709)
 */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * スクリーンキャプチャ画像からVSCodeのパネル境界を検出する。
 *
 * アルゴリズム:
 * 1. 画像の上15%〜下15%を除外した中央70%のストリップを使用
 * 2. 各x座標の列について、縦方向に10px間隔でサンプリング
 * 3. そのピクセルの輝度が左右2px隣より10以上異なる場合「セパレータ候補」
 * 4. サンプルの70%以上が候補なら「セパレータライン」と判定
 * 5. 近接（5px以内）のセパレータはグルーピング
 * 6. 最初のセパレータ＝サイドバー右端。それ以降がカラム境界
 * 7. サイドバー以降のセパレータでカラムを区切り、columnsを生成
 * 8. 垂直方向: 画像下半分で水平セパレータを検出し、エディタ下端を特定
 *
 * @param imagePath キャプチャ画像のパス
 * @returns パネル境界情報
 */
export async function detectPanelBoundaries(
  imagePath: string
): Promise<PanelBoundaries> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const imageWidth = metadata.width!;
  const imageHeight = metadata.height!;

  const rawBuffer = await image
    .raw()
    .toBuffer();

  const channels = 3;

  // 中央70%のストリップ（上15%〜下15%を除外）
  const stripTop = Math.floor(imageHeight * 0.15);
  const stripBottom = Math.floor(imageHeight * 0.85);

  // 10px間隔でサンプリングするy座標のリスト
  const sampleYs: number[] = [];
  for (let y = stripTop; y < stripBottom; y += 10) {
    sampleYs.push(y);
  }
  const totalSamples = sampleYs.length;

  // 各x座標についてセパレータ候補かどうかを判定
  const separatorLines: number[] = [];

  for (let x = 2; x < imageWidth - 2; x++) {
    let candidateCount = 0;

    for (const y of sampleYs) {
      const idx = (y * imageWidth + x) * channels;
      const r = rawBuffer[idx];
      const g = rawBuffer[idx + 1];
      const b = rawBuffer[idx + 2];
      const lum = luminance(r, g, b);

      // 左2pxの輝度
      const leftIdx = (y * imageWidth + (x - 2)) * channels;
      const leftLum = luminance(
        rawBuffer[leftIdx],
        rawBuffer[leftIdx + 1],
        rawBuffer[leftIdx + 2]
      );

      // 右2pxの輝度
      const rightIdx = (y * imageWidth + (x + 2)) * channels;
      const rightLum = luminance(
        rawBuffer[rightIdx],
        rawBuffer[rightIdx + 1],
        rawBuffer[rightIdx + 2]
      );

      // |左右との輝度差| > 10 で判定（ダーク/ライト両対応）
      const diffLeft = Math.abs(lum - leftLum);
      const diffRight = Math.abs(lum - rightLum);

      if (diffLeft > 10 && diffRight > 10) {
        candidateCount++;
      }
    }

    // サンプルの70%以上が候補ならセパレータライン
    if (candidateCount / totalSamples >= 0.7) {
      separatorLines.push(x);
    }
  }

  // セパレータが見つからない場合は画像全体を1カラムとして返す
  if (separatorLines.length === 0) {
    return {
      columns: [{ left: 0, width: imageWidth }],
      imageWidth,
      imageHeight,
      editorBottom: imageHeight,
    };
  }

  // 近接（5px以内）のセパレータをグルーピング
  const groups: number[][] = [];
  let currentGroup: number[] = [separatorLines[0]];

  for (let i = 1; i < separatorLines.length; i++) {
    if (separatorLines[i] - separatorLines[i - 1] <= 5) {
      currentGroup.push(separatorLines[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [separatorLines[i]];
    }
  }
  groups.push(currentGroup);

  // 各グループの中央値をセパレータ位置とする
  const separatorPositions = groups.map((group) => {
    const mid = Math.floor(group.length / 2);
    return group[mid];
  });

  // 最初のセパレータ＝サイドバー右端。それ以降がカラム境界
  if (separatorPositions.length < 1) {
    return {
      columns: [{ left: 0, width: imageWidth }],
      imageWidth,
      imageHeight,
      editorBottom: imageHeight,
    };
  }

  const sidebarEnd = separatorPositions[0];
  const columnBoundaries = separatorPositions.slice(1);

  // カラムを生成
  const columns: { left: number; width: number }[] = [];
  let currentLeft = sidebarEnd + 1;

  for (const boundary of columnBoundaries) {
    columns.push({
      left: currentLeft,
      width: boundary - currentLeft,
    });
    currentLeft = boundary + 1;
  }

  // 最後のカラム（最後のセパレータから画像右端まで）
  columns.push({
    left: currentLeft,
    width: imageWidth - currentLeft,
  });

  // --- 垂直方向: 水平セパレータ検出（エディタ下端の特定） ---
  // 画像の中央30%〜70%のx範囲で10px間隔にサンプリング
  const hSampleXStart = Math.floor(imageWidth * 0.3);
  const hSampleXEnd = Math.floor(imageWidth * 0.7);
  const hSampleXs: number[] = [];
  for (let x = hSampleXStart; x < hSampleXEnd; x += 10) {
    hSampleXs.push(x);
  }
  const hTotalSamples = hSampleXs.length;

  // 画像の下半分（50%以降）のみスキャン
  const scanYStart = Math.floor(imageHeight * 0.5);
  let editorBottom = imageHeight;

  for (let y = scanYStart + 2; y < imageHeight - 2; y++) {
    let hCandidateCount = 0;

    for (const x of hSampleXs) {
      const idx = (y * imageWidth + x) * channels;
      const r = rawBuffer[idx];
      const g = rawBuffer[idx + 1];
      const b = rawBuffer[idx + 2];
      const lum = luminance(r, g, b);

      // 上2pxの輝度
      const topIdx = ((y - 2) * imageWidth + x) * channels;
      const topLum = luminance(
        rawBuffer[topIdx],
        rawBuffer[topIdx + 1],
        rawBuffer[topIdx + 2]
      );

      // 下2pxの輝度
      const bottomIdx = ((y + 2) * imageWidth + x) * channels;
      const bottomLum = luminance(
        rawBuffer[bottomIdx],
        rawBuffer[bottomIdx + 1],
        rawBuffer[bottomIdx + 2]
      );

      const diffTop = Math.abs(lum - topLum);
      const diffBottom = Math.abs(lum - bottomLum);

      if (diffTop > 10 && diffBottom > 10) {
        hCandidateCount++;
      }
    }

    // サンプルの50%以上が候補なら水平セパレータ
    if (hCandidateCount / hTotalSamples >= 0.5) {
      editorBottom = y;
      break;
    }
  }

  return {
    columns,
    imageWidth,
    imageHeight,
    editorBottom,
  };
}
