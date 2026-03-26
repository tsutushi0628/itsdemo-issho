# inv-20260326: Editor Spotlighter リモートビュー開発経緯

## 結論
VSCodeのClaude Codeパネルをスマホから閲覧・操作する「リモートビュー」機能を開発中。画面キャプチャ+WebSocket配信方式で、アクティブカラムだけをCSSクロップしてスマホに表示する設計に収束。

## 開発経緯

### 試行錯誤した方式

| 方式 | 結果 | 棄却理由 |
|------|------|----------|
| CLI --resume でセッション再開 | 42MBセッションで6分遅延 | 実用に耐えない |
| CLI --print でメッセージ送受信 | 動作するが別プロセス | PCのVSCode拡張と分離される |
| VS Code Tunnel + vscode.dev | Claude Code拡張が動かない | Web環境にNode.jsなし |
| ウィンドウ全体リサイズ | PCの作業が妨害される | ユーザーのレイアウトを壊す |
| sipsでサーバー側クロップ | サイドバー幅の計算が困難 | CSS方式に移行 |

### 採用方式
- screencaptureでVSCodeウィンドウ全体をキャプチャ
- WebSocketでBase64 JPEG配信（500ms間隔）
- スマホ側のCSS（width/margin-left）でアクティブカラムだけを表示
- PCのレイアウトは一切変更しない

### インフラ
- Cloudflare Tunnel + st-labo.app ドメインで固定URL
- `https://itsudemo-issho.st-labo.app/?token=xxx`
- トークン認証 + Cloudflareヘッダーチェック

### 未解決課題
1. viewportのCSS方式が正しく動作してるか要テスト
2. テキスト入力のアクセシビリティ権限問題
3. ×ボタン押下時のサイドバー復帰
4. cloudflaredの自動起動（現在は手動）

## アコーディオン改善

### 変更点
- fullWidthThreshold（3000px）追加：ウルトラワイドでは全等間隔
- minColumnWidth（850px）：ウルトラワイド→3active、27インチ→2active、MBA→1active
- トリガー簡素化：フォーカス移動と整形ボタンのみ（onDidChangeWindowState削除）

## 次のアクション
- スマホでのテストとUX改善
- テキスト入力の動作確認（アクセシビリティ権限）
- cloudflaredをlaunchdで自動起動
- docs/findings記録（本ファイル）
