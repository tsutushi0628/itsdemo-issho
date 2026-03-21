# Structure: Editor Spotlighter

## Directory Layout

```
editor-spotlighter/
├── .claude -> ../firebase-kit/.claude  # 共有ルール（シンボリックリンク）
├── .spec-workflow/                     # Steering/Specドキュメント
│   └── specs/
│       └── editor-spotlighter/
│           ├── product.md
│           ├── tech.md
│           └── structure.md
├── src/
│   ├── extension.ts                    # エントリポイント（activate/deactivate, コマンド登録, 設定変更監視）
│   ├── layoutEngine.ts                 # レイアウト計算（calculateLayout, applyLayout, resolveActiveIndices）
│   ├── monitorDetector.ts              # macOS解像度検知（system_profiler SPDisplaysDataType）
│   ├── presetManager.ts                # 解像度→activeColumns判定（resolveActiveColumns, buildPresets）
│   ├── tabTreeProvider.ts              # タブ一覧TreeViewプロバイダー（カラムごとにグループ化）
│   └── __tests__/
│       ├── layoutEngine.test.ts
│       └── presetManager.test.ts
├── dist/                               # ビルド出力（.gitignore）
│   └── extension.js
├── package.json                        # 拡張マニフェスト・設定スキーマ・コマンド定義
├── package-lock.json
├── tsconfig.json
├── esbuild.config.mjs                  # esbuildバンドル設定
├── vitest.config.ts                    # vitestテスト設定
├── .gitignore
└── .vscodeignore                       # vsixパッケージ除外設定
```

## Conventions

### Naming

- **ファイル名**: camelCase（`layoutEngine.ts`, `monitorDetector.ts`）
- **変数・関数**: camelCase（`calculateLayout`, `focusedGroupIndex`）
- **型・インターフェース**: PascalCase（`LayoutConfig`, `EditorLayout`, `Preset`）

### Import Order

1. `vscode`（VSCode Extension API）
2. 内部モジュール（`./monitorDetector`, `./presetManager`, `./layoutEngine`）

### Test

- 配置: `src/__tests__/` ディレクトリ
- 命名: `*.test.ts`（`layoutEngine.test.ts`, `presetManager.test.ts`）
- フレームワーク: vitest
- 対象: 純粋関数（layoutEngine, presetManager）。VSCode API依存のextension.tsは対象外

### Configuration Namespace

`editorSpotlighter.*` で統一。VSCode本体設定（`workbench.editor.*`）はタブ設定連動時のみ書き換え。

### package.json contributes（追加予定）

- `viewsContainers.activitybar` - ESアイコン（アクティビティバー）
- `views` - タブ一覧TreeView（サイドバーパネル）
- `menus.editor/title` - レイアウト整形ボタン（エディタ右上）

### Commands

| Command ID | 機能 |
|---|---|
| `editorSpotlighter.toggle` | 有効/無効切替 |
| `editorSpotlighter.setColumns` | カラム数変更（InputBox） |
| `editorSpotlighter.resetLayout` | レイアウトを等幅にリセット |
| `editorSpotlighter.applyRecommendedSettings` | 推奨設定の一括適用 |
