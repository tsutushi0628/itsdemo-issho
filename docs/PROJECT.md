---
schema_version: 1
verified_at: 2026-09-16T12:59:36Z
verified_head: 52866f4
source_worklog: handoff-20260611-steering-readme-refresh.md
---
# Editor Spotlighter

## 1. 目的と利用者
フォーカスしたエディタカラムが自動で広がり他が縮むVS Code拡張。画面サイズに応じてアクティブカラム数も自動調整する。スマホからのリモート閲覧・操作にも対応する。
利用者: オーナー本人の個人運用（マーケットプレイス非公開）。

## 2. 稼働状態とURL
試作／個人運用。VS Code Marketplace非公開、ローカルビルドを拡張フォルダへ自動配置して使う。
本番URLなし（VS Code拡張のためWeb URLを持たない）。
リモートビューはローカル待受（既定127.0.0.1:19280、Cloudflare Tunnel経由でQR接続、LAN直結はopt-in）。

## 3. 構成マップ
- src/: 拡張本体（layoutEngine・extension.ts・windowDetector等）
- src/remote/: リモートビュー機能（WebSocket配信・認証・QR発行）
- resources/: 拡張アイコン
- dist/: ビルド成果物（esbuildバンドル、拡張フォルダへ自動配置）
- .spec-workflow/specs/: spec管理下の仕様（column-remote-control等）
- docs/findings/: 調査・引継記録

## 4. 現在地
- 焦点: 直近コミットは列×段グリッドの定型レイアウト機能追加。README/Steeringへの反映は未実施。
- 次の一手: QR自動ログイン＋画面自動更新のスマホ実機end-to-end目視（前回引継書の最優先項目、未着手）。
- 残作業: カラム単位リモート操作のタスク20-21（実機回帰・3列以上の実機E2E）が未実施。
- オーナー未回答: なし

## 5. 制約と注意事項
- リモートビューはmacOS専用（画面幅実測にCGWindowList等のOS別ネイティブAPI依存、Windows/LinuxはPowerShell/xdotool）。
- リモートサーバの待受既定は127.0.0.1。LAN直結（`0.0.0.0`）はopt-inで平文HTTP・盗聴されうるためトンネル（Cloudflare Tunnel）推奨。
- remoteViewServer.tsの認証・セッション失効・ロックアウトに自動テストがなく、純関数テストのみ。
- VS Code Marketplace非公開。`npm run package`のvsceはグローバル/npx前提で依存関係に未掲載。

## 6. 根拠となる最近の記録
- [handoff-20260611-steering-readme-refresh](findings/handoff-20260611-steering-readme-refresh.md)
- [handoff-20260611-qr-autologin-and-screen-refresh](findings/handoff-20260611-qr-autologin-and-screen-refresh.md)
