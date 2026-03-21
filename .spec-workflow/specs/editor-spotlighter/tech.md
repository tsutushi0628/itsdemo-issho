# Tech: Editor Spotlighter

## Project Type

VSCode Extension

## Primary Language

TypeScript

## Runtime

Node.js (VSCode Electron)

## Key Dependencies

- **vscode** (^1.85.0) - Extension API
- **esbuild** (^0.19.0) - バンドル
- **vitest** (^4.1.0) - テスト
- **typescript** (^5.3.0) - 型チェック・コンパイル
- **VSCode TreeView API** - タブサイドバーパネル（TreeDataProvider, onDidChangeTreeData）
- **VSCode Editor Title Actions API** - レイアウト整形ボタン（menus.editor/title）

## Architecture

モジュラー設計。各モジュールは単一責任:

- **extension.ts** - エントリポイント。activate/deactivate、コマンド登録（toggle, setColumns, resetLayout, applyRecommendedSettings）、設定変更監視、デバウンス付きフォーカス変更ハンドラ
- **layoutEngine.ts** - レイアウト計算（calculateLayout）とVSCode APIへの適用（applyLayout）。フォーカスカラムを中心にactiveIndicesを決定し、ratio比で幅を配分
- **monitorDetector.ts** - macOS解像度検知。system_profiler SPDisplaysDataTypeの出力をパースしてメインディスプレイの解像度を返す
- **presetManager.ts** - 解像度→activeColumns数の判定。デフォルトプリセット（3840/2560/0）とユーザー定義プリセットのマージ

## Data Storage

VSCode settings.json（ユーザー設定の永続化）。`editorSpotlighter.*` namespace配下で管理。

## Build

esbuild でバンドル → `dist/extension.js`（esbuild.config.mjs で設定）

## Deployment

VSCode Marketplace (.vsixパッケージ)。`vsce package` でパッケージング。

## Platform

macOS（初期）- system_profiler SPDisplaysDataType に依存。`process.platform !== "darwin"` で明示的にガード。

## Known Limitations

- **macOS only** - monitorDetectorがsystem_profilerに依存
- **ウィンドウサイズ直接取得不可** - VSCode APIにウィンドウサイズ取得がないため、OSコマンド（system_profiler）でディスプレイ解像度を取得するワークアラウンド
- **解像度 = ウィンドウサイズではない** - ディスプレイ解像度で判定するため、ウィンドウが画面の一部だけを占める場合はプリセットが実態と合わない可能性
- **TreeViewの自動更新** - onDidChangeTreeDataイベントが必要。タブの開閉をリアルタイム反映するにはonDidChangeTabGroupsを監視する必要がある

## Decision Log

| 決定 | 理由 |
|------|------|
| esbuild | webpack比で高速、VSCode拡張のバンドルに十分な機能 |
| system_profiler | VSCode APIにウィンドウサイズ取得がないため、macOSネイティブコマンドで代替 |
| vitest | Jest比で高速、ESM対応、設定がシンプル |
| デバウンス200ms | フォーカス変更の高頻度発火を抑制、レイアウト適用のちらつき防止 |
