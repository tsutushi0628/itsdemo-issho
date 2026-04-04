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
- **ws** (^8.20.0) - WebSocketサーバー（リモートビュー）
- **qrcode** (^1.5.4) - QRコード生成（リモートビュー接続URL）
- **sharp** (^0.34.5) - 画像処理（カラム境界検出・クロップ・リサイズ）
- **VSCode TreeView API** - タブサイドバーパネル（TreeDataProvider, onDidChangeTreeData）
- **VSCode Editor Title Actions API** - レイアウト整形ボタン（menus.editor/title）

## Architecture

モジュラー設計。各モジュールは単一責任:

- **extension.ts** - エントリポイント。activate/deactivate、コマンド登録（toggle, setColumns, resetLayout, applyRecommendedSettings, alignLayout, startRemoteView, stopRemoteView等）、設定変更監視、デバウンス付きフォーカス変更ハンドラ
- **layoutEngine.ts** - レイアウト計算（calculateLayout）とVSCode APIへの適用（applyLayout）。フォーカスカラムを中心にactiveIndicesを決定し、ratio比で幅を配分
- **columnCalculator.ts** - ウィンドウ幅→activeColumns数の計算（computeActiveColumns）。minColumnWidthとfullWidthThresholdに基づく判定
- **windowDetector.ts** - macOSウィンドウ境界検出。Swift経由でCGWindowListCopyWindowInfoを呼び出し、VSCodeウィンドウの位置・サイズを取得
- **tabTreeProvider.ts** - タブ一覧TreeViewプロバイダー。カラムごとにグループ化したタブ一覧をサイドバーに表示
- **remoteWebviewProvider.ts** - リモートビューのWebViewプロバイダー。QRコード表示・接続状態管理
- **remote/remoteViewServer.ts** - HTTP/WebSocketサーバー。screencaptureでVSCodeウィンドウをキャプチャし、sharpでサーバー側クロップ・リサイズ後にbase64でスマホへ配信。イベント駆動でキャプチャ実行。パスワード+Cookie認証
- **remote/mobileHtml.ts** - スマホ向けHTML生成（リモートビュー画面・ログインページ）。画面表示・カラム選択バー・テキスト入力・×ボタン（切断）を提供
- **remote/protocol.ts** - WebSocketメッセージ型定義（ServerMessage, ClientMessage, TabInfo）
- **remote/panelDetector.ts** - スクリーンキャプチャ画像からカラム境界・エディタ下端を検出。sharpで画像解析し、輝度差ベースでセパレータラインを特定
- **remote/tokenAuth.ts** - パスワード認証（timingSafeEqual）・セッショントークン生成

## Data Storage

VSCode settings.json（ユーザー設定の永続化）。`editorSpotlighter.*` namespace配下で管理。

## Build

esbuild でバンドル → `dist/extension.js`（esbuild.config.mjs で設定）

## Deployment

VSCode Marketplace (.vsixパッケージ)。`vsce package` でパッケージング。

## Platform

macOS（初期）- Swift CGWindowListCopyWindowInfo に依存。`process.platform !== "darwin"` で明示的にガード。

## Known Limitations

- **macOS only** - windowDetectorがSwift CGWindowListCopyWindowInfoに依存
- **TreeViewの自動更新** - onDidChangeTreeDataイベントが必要。タブの開閉をリアルタイム反映するにはonDidChangeTabGroupsを監視する必要がある

## Decision Log

| 決定 | 理由 |
|------|------|
| esbuild | webpack比で高速、VSCode拡張のバンドルに十分な機能 |
| Swift CGWindowListCopyWindowInfo | VSCode APIにウィンドウサイズ取得がないため、macOSネイティブAPIで実際のウィンドウ境界を取得 |
| vitest | Jest比で高速、ESM対応、設定がシンプル |
| デバウンス200ms | フォーカス変更の高頻度発火を抑制、レイアウト適用のちらつき防止 |
| screencapture + sharp | VSCodeウィンドウのキャプチャ→サーバー側でsharpによるカラム境界検出・クロップ・リサイズでスマホに最適化配信 |
| イベント駆動キャプチャ | 定期キャプチャを廃止し、フォーカス変更・タブ切替等のイベント発生時のみキャプチャ実行 |
