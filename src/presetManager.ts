export interface Preset {
  minWidth: number;
  activeColumns: number;
}

const DEFAULT_PRESETS: Preset[] = [
  { minWidth: 3840, activeColumns: Infinity },
  { minWidth: 2560, activeColumns: 3 },
  { minWidth: 0, activeColumns: 2 },
];

export function resolveActiveColumns(
  width: number,
  totalColumns: number,
  presets: Preset[] = DEFAULT_PRESETS
): number {
  const sorted = [...presets].sort((a, b) => b.minWidth - a.minWidth);

  let matched: Preset | undefined;
  for (const preset of sorted) {
    if (width >= preset.minWidth) {
      matched = preset;
      break;
    }
  }

  if (!matched) {
    throw new Error(
      `resolveActiveColumns: 解像度 ${width}px に該当するプリセットが見つかりません`
    );
  }

  if (matched.activeColumns >= totalColumns) {
    return totalColumns;
  }

  return matched.activeColumns;
}

export function buildPresets(
  userPresets: Record<string, number>
): Preset[] {
  const keys = Object.keys(userPresets);
  if (keys.length === 0) {
    return DEFAULT_PRESETS;
  }

  const result: Preset[] = [];
  for (const key of keys) {
    const minWidth = parseInt(key, 10);
    if (isNaN(minWidth)) {
      continue;
    }
    result.push({ minWidth, activeColumns: userPresets[key] });
  }

  if (result.length === 0) {
    return DEFAULT_PRESETS;
  }

  return result;
}
