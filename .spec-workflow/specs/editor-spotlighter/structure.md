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
│   ├── columnCalculator.ts             # ウィンドウ幅→activeColumns計算（computeActiveColumns）
│   ├── windowDetector.ts               # macOSウィンドウ境界検出（Swift CGWindowListCopyWindowInfo）
│   ├── tabTreeProvider.ts              # タブ一覧TreeViewプロバイダー（カラムごとにグループ化）
│   ├── remoteWebviewProvider.ts        # リモートビューWebViewプロバイダー（QRコード・接続状態表示）
│   ├── remote/
│   │   ├── remoteViewServer.ts         # HTTP/WebSocketサーバー（スクリーンキャプチャ配信・入力転送）
│   │   ├── mobileHtml.ts              # スマホ向けHTML生成（リモートビュー画面・ログインページ）
│   │   ├── protocol.ts                # WebSocketメッセージ型定義（ServerMessage, ClientMessage, TabInfo）
│   │   ├── panelDetector.ts           # スクリーンキャプチャ画像からカラム境界・エディタ下端を検出（sharp）
│   │   └── tokenAuth.ts              # パスワード認証・セッショントークン生成
│   └── __tests__/
│       ├── layoutEngine.test.ts
│       ├── columnCalculator.test.ts
│       ├── windowDetector.test.ts
│       └── tokenAuth.test.ts
├── resources/
│   └── icon.svg                        # アクティビティバーアイコン
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

- **ファイル名**: camelCase（`layoutEngine.ts`, `windowDetector.ts`）
- **変数・関数**: camelCase（`calculateLayout`, `focusedGroupIndex`）
- **型・インターフェース**: PascalCase（`LayoutConfig`, `EditorLayout`, `TabInfo`）

### Import Order

1. `vscode`（VSCode Extension API）
2. 内部モジュール（`./windowDetector`, `./columnCalculator`, `./layoutEngine`）

### Test

- 配置: `src/__tests__/` ディレクトリ
- 命名: `*.test.ts`（`layoutEngine.test.ts`, `columnCalculator.test.ts`, `windowDetector.test.ts`, `tokenAuth.test.ts`）
- フレームワーク: vitest
- 対象: 純粋関数（layoutEngine, columnCalculator, windowDetector, tokenAuth）。VSCode API依存のextension.tsは対象外

### Configuration Namespace

`editorSpotlighter.*` で統一。VSCode本体設定（`workbench.editor.*`）はタブ設定連動時のみ書き換え。

### package.json contributes

- `viewsContainers.activitybar` - ESアイコン（アクティビティバー）
- `views` - タブ一覧TreeView（サイドバーパネル）、リモートビューWebView
- `menus.editor/title` - レイアウト整形ボタン（エディタ右上）

### Commands

| Command ID | 機能 |
|---|---|
| `editorSpotlighter.toggle` | 有効/無効切替 |
| `editorSpotlighter.setColumns` | カラム数変更（InputBox） |
| `editorSpotlighter.resetLayout` | レイアウトを等幅にリセット |
| `editorSpotlighter.applyRecommendedSettings` | 推奨設定の一括適用 |
| `editorSpotlighter.alignLayout` | レイアウト整形（エディタ右上ボタン） |
| `editorSpotlighter.closeTab` | タブを閉じる |
| `editorSpotlighter.focusTab` | タブにフォーカス |
| `editorSpotlighter.spContinue` | モバイルからセッション継続 |
| `editorSpotlighter.startRemoteView` | リモートビュー開始 |
| `editorSpotlighter.stopRemoteView` | リモートビュー停止 |
