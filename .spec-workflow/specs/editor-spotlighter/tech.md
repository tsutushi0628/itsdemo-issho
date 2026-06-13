# Tech: Editor Spotlighter

## Project Type

VSCode Extension

## Primary Language

TypeScript（strict・target ES2020・module ES2020）

## Runtime

Node.js (VSCode Electron)。activationEvents は `onStartupFinished`（起動完了時にアクティベート）。

## Key Dependencies

### ランタイム同梱（バンドルに含む）

- **vscode** (^1.85.0) - Extension API（`external` 指定でバンドル除外）
- **ws** (^8.20.0) - WebSocketサーバー（リモートビューの `/ws` パス）
- **qrcode** (^1.5.4) - QRコード生成（リモートビュー接続用）
- **sharp** (^0.34.5) - 画像処理（カラム境界検出・クロップ・リサイズ・JPEGエンコード）

### 開発ツール

- **esbuild** (^0.19.0) - 単一ファイルバンドラ
- **vitest** (^4.1.0) - テストランナー（vscode-test/mocha不使用）
- **typescript** (^5.3.0) - 型チェック・declaration生成（実ビルドはesbuildが担う）
- **@types/node / @types/vscode / @types/ws / @types/qrcode / @types/sharp** - 型定義

### 利用するVSCode API

- **TreeView API** - タブ一覧サイドバー（TreeDataProvider, onDidChangeTreeData）
- **WebviewView API** - リモートビューのサイドバーパネル
- **setEditorLayout / getEditorLayout** - エディタグリッドの比率レイアウト適用と読み戻し
- **Editor Title / View Title Actions** - レイアウト整形ボタン（menus）

注: `@types/sharp`(^0.31.1) と本体 `sharp`(^0.34.5) のメジャー乖離があり、型定義が実APIと不整合になり得る（`skipLibCheck:true` で型エラーは抑止）。`vsce`（package script が使用）は依存に未記載でグローバル/npx前提。

## Architecture

モジュラー設計。各モジュールは単一責任。

### src 直下

- **extension.ts** - エントリポイント。出力チャンネル・デバッグログ初期化、設定読込、デバウンス（100ms）付きフォーカス変更ハンドラ、フォーカス履歴（直近の列を先頭に保持し上限超過で最古を退避）によるアクティブカラム管理、適用後の読み戻し検証と段階的自己回復、サイドバー連動、全コマンド登録（toggle / setColumns / resetLayout / applyRecommendedSettings / alignLayout / spContinue / focusTab / closeTab / startRemoteView / stopRemoteView）、リモートビューサーバの配線（パスワード決定・bindAddress取得・依存注入・QR表示・列状態更新）
- **layoutEngine.ts** - レイアウト計算（calculateLayout）と VSCode API への適用（applyLayout）。非アクティブ列を230px固定幅に縮め残り幅をアクティブ列で均等配分。狭窓では等間隔へフォールバック。読み戻し（readBackLayout）と比率正規化による一致判定（layoutMatches・許容5%）
- **columnCalculator.ts** - ウィンドウ幅→エディタ実領域幅の保守的推定（deriveEditorWidth）と、minColumnWidth底支え・maxActiveColumns上限・fullWidthThreshold超で全列等間隔の3条件によるアクティブ列数決定（computeActiveColumns）の純関数群
- **sidebarPolicy.ts** - アクティブ列数→プライマリサイドバー開閉の目標状態を決める純関数（1以下でclose・2以上でopen）
- **windowDetector.ts** - OS別ウィンドウ幅検出（detectWindowWidth）と、macOS専用のウィンドウID/境界取得・サイドバー境界スクリーンショット検出（getVSCodeWindowId / getWindowBounds / detectEditorWidth）
- **tabTreeProvider.ts** - タブ一覧TreeViewプロバイダー。タブグループ（列）ごとにグループ化したタブ一覧をサイドバーに表示、タブクリックでフォーカス
- **remoteWebviewProvider.ts** - リモートビューのWebViewプロバイダー。停止/稼働/ローカルのみの状態に応じたQR・URL・パスワード・操作ボタンをCSP付きで描画

### src/remote 配下

- **remoteViewServer.ts** - HTTP/WebSocket一体サーバー。認証・セッション・IPロックアウト・接続中のみの定期キャプチャ・二段ハッシュ変化検知・列状態broadcast・失効接続への配信ガード。screencaptureでVSCodeウィンドウをキャプチャし、sharpで選択列をクロップ・スマホ幅リサイズしてbase64配信
- **focusRouter.ts** - 指定列へのフォーカス移動＋確定検証＋Claude Codeタブ活性化（fail-closed）。Claude Codeタブ判定（viewType完全包含）。フォーカスコマンドは8列分
- **injectionPipeline.ts** - リモート入力の注入パイプライン。多重抑止・列検証・フォーカス確定・直前再検証・クリップボード退避/復元・前面アプリのbundle identifier完全一致検査・単一osascript貼付＋Enter
- **qrPolicy.ts** - リモートアクセス表示種別の判定（decideRemoteAccessDisplay・tunnel/lan/localOnly）、QR URL組立（buildQrUrl）、bind既定値の単一真実源（DEFAULT_BIND_ADDRESS="127.0.0.1"）
- **mobileHtml.ts** - スマホ向けHTML生成（リモートビュー画面・ログインページ）。画面表示・列選択バー（textContent生成でXSS防止）・テキスト入力・切断ボタン・QRフラグメント自動ログイン
- **panelDetector.ts** - キャプチャ画像から列境界・エディタ下端を検出（detectPanelBoundaries）。sharpの生バッファで輝度差ベースのセパレータライン特定、画像幅比0.2未満の先頭セパレータはサイドバー右端として除外
- **tokenAuth.ts** - パスワード検証（sha256ダイジェスト化＋timingSafeEqual）・セッショントークン生成（generateSessionToken）・起動時ワンタイム高エントロピーパスワード生成（generateRemotePassword）
- **protocol.ts** - WebSocketメッセージ型定義（ServerMessage, ClientMessage, TabInfo, InjectAbortReason）

## Data Storage

- **VSCode settings.json** - ユーザー設定の永続化。`editorSpotlighter.*` namespace 配下。明示設定の有無は `config.inspect` の global/workspace/workspaceFolder 値で判定（`config.get` は既定値で常に非undefinedのため）
- **context.globalState** - 一度きりの案内表示済みフラグ（待ち受けアドレス移行の初回通知）
- **workbench.editor.* 連動** - VSCode本体設定の薄いラッパー。`openTabBesideActive` → `workbench.editor.openPositioning`、`disablePreviewMode` → `workbench.editor.enablePreview` を連動書き換え（二重管理の回避）

## Build

esbuild で単一ファイルバンドル → `dist/extension.js`（`esbuild.config.mjs`）。

- entryPoints: `src/extension.ts`、bundle: true、platform: node、format: cjs、sourcemap: true
- external: `vscode` のみ（qrcode/sharp/ws はバンドルに含める）
- `--watch` 指定で watch ビルド
- テスト: `vitest run`（探索範囲 `src/__tests__/**/*.test.ts`）
- `lint`・専用 `tsc` の script は存在しない（型チェックはエディタ/tsconfig依存）

## Deployment

現状はローカル個人運用。esbuild プラグインがビルド成功時に `dist/extension.js`・`dist/extension.js.map`・`package.json` をユーザーの VSCode 拡張フォルダ（`~/.vscode/extensions/tsukamoto.editor-spotlighter-<version>/`）へ自動コピーし、ウィンドウリロードで有効化（失敗時はログのみ）。`vsce package` script は存在するが Marketplace 公開はしていない（Future Vision として区別）。

## Platform

- **detectWindowWidth** - 3プラットフォーム分岐。macOS: Swift CGWindowList（アクセシビリティ権限不要）、Windows: PowerShell Win32 API（GetForegroundWindow + GetWindowRect）、Linux: xdotool。その他はreject
- **getVSCodeWindowId / getWindowBounds / detectEditorWidth** - macOS専用（Swift CGWindowList・screencapture前提）
- **リモートビュー機能全体** - キャプチャ（screencapture）・クリック注入（CGEvent）・貼付（osascript）はすべてmacOS固定。デバッグログ等の `/tmp` パスもUnix前提

## Known Limitations

- **リモートビューはmacOS専用** - ウィンドウID取得・キャプチャ・入力注入・貼付がmacOS固定。Windows/Linuxではレイアウト機能のウィンドウ幅検知のみ動作
- **フォーカスコマンドは8列まで** - リモート列フォーカスは First..Eighth EditorGroup コマンドに依存し、9列以上の列指定操作は `columnOutOfRange` で fail-closed
- **LAN直結は平文HTTP** - TLS未対応のため盗聴され得る。既定は `127.0.0.1`（ローカルのみ）で、HTTPSのトンネル経由を推奨、LAN直結（`0.0.0.0`）は明示opt-in
- **サーバ系の自動テスト未整備** - extension.ts・remoteWebviewProvider.ts・tabTreeProvider.ts・panelDetector.ts に専用テストファイルがない（純関数とリモート系ヘルパーはカバー済み）
- **固定パス残置** - キャプチャ出力（`/tmp/es-frame.jpg`・`/tmp/es-sidebar-detect.jpg`）とデバッグログ（`/tmp/editor-spotlighter-debug.log`・1MB超で後半512KBへ切詰め）が本番でも固定パスへ常時書き込み
- **配布物の同梱範囲** - `.vscodeignore` は `docs/` を除外対象に列挙していないため、`docs/findings` 等が vsix に同梱され得る。sourcemap も同梱される

## Decision Log

| 決定 | 理由 |
|------|------|
| esbuild | webpack比で高速、VSCode拡張のバンドルに十分な機能。ビルド時に拡張フォルダへ自動配置 |
| Swift CGWindowList | VSCode APIにウィンドウサイズ取得がないため、macOSネイティブAPIで実ウィンドウ境界を取得（アクセシビリティ権限不要） |
| vitest | Jest比で高速、ESM対応、設定がシンプル |
| ピクセルベースの比率計算 | 非アクティブ列を230px固定幅に縮め、残り幅をアクティブ列で均等配分。狭窓で比率が破綻する場合は等間隔へフォールバック |
| 読み戻し検証付き自己回復 | 適用成功≠反映。setEditorLayout後にgetEditorLayoutで読み戻し照合（許容5%）し、不一致なら段階的自己回復（evenEditorWidths→サイドバー2回トグル→幅キャッシュ即時失効と裏再実測）。回復確認できるまで署名を残さず次フォーカスで再適用 |
| 全列アクティブ時も整形適用 | 旧版は等間隔モードで早期returnし幅崩れが放置されていた。広い画面でも等間隔を適用し自己回復する |
| デバウンス100ms＋幅実測のホットパス外し | 旧200msとホットパス内の実測（OSプロセス1-2秒）が反映遅延を生んでいた。キャッシュ即時計算＋裏実測（最短5秒間隔）で応答性を改善 |
| screencapture + sharp（画像配信方式） | 当初のCLI stdin/stdout＋ターミナル方式は --resume の遅延・別プロセス分離・実行環境のNode.js欠如で棄却。最終的にウィンドウキャプチャ→列クロップ・スマホ幅リサイズ配信に収束（PCのレイアウトは変更しない） |
| 接続中のみ定期キャプチャ＋二段ハッシュ変化検知 | 認証済みクライアントが1以上の間だけ約1.5秒間隔（setTimeoutチェーン）でキャプチャ。第1ゲート=生JPEGのsha1、第2ゲート=クロップ後JPEGのsha1で、変化時のみ配信。操作直後は150ms後に即時1回。ウィンドウID失効時は10秒バックオフ |
| bundle identifier 完全一致での注入 | 入力注入はOS全体に効くため fail-closed。列フォーカス確定検証→前面アプリがVSCode系か bundle id 完全一致で確認→クリップボード退避→貼付＋Enter→復元。部分一致誤爆を防ぐ |
| QRフラグメント鍵（#k=） | 認証キーをURLフラグメントにのみ載せHTTPリクエスト・サーバ/トンネルログに残さない。スキャン後はreplaceStateで即除去。表示用URLは素のまま |
| bind既定 127.0.0.1 | 旧既定 0.0.0.0 を安全化。許可判定は実ソケットIPのみ（cf-connecting-ip等の偽装可能ヘッダ非依存）でループバック＋プライベートIP帯に限定。LAN直結は明示opt-in＋初回案内（globalStateで一度きり） |
| パスワード＋Cookieセッション認証 | sha256＋timingSafeEqualで照合、ワンタイム高エントロピーパスワードを起動毎生成。セッションTTL12時間、同一IP5回/5分でロックアウト |
