# Editor Spotlighter

フォーカスしたエディタカラムが自動で広がり、他が縮む。画面サイズに応じてアクティブカラム数も自動調整する VS Code 拡張。スマホからのリモート閲覧・操作にも対応する。

---

## 主な機能

- **レイアウト整形**: エディタグリッドのカラム幅を比率で算出し、`setEditorLayout` で適用する。適用後は実際のレイアウトを読み戻して照合し、ずれていたら段階的に自己回復する（適用成功と反映成功を区別し、反映されるまで再適用する閉ループ設計）。
- **アコーディオン**: 直近にフォーカスしたカラムが広がり、他のカラムは固定幅まで縮む（直近にフォーカスしたカラムを保持し、上限を超えると最も古いものから押し出す）。同時に広げる本数は上限設定で頭を抑え、各カラムの最小許容幅で底を支える。画面が広く全カラムをアクティブにできる場合は等間隔で整形する（幅崩れも自己回復対象）。
- **タブサイドバー**: アクティビティバーに専用ビューを追加し、カラム（タブグループ）ごとのタブ一覧をツリー表示する。タブをタップするとそのファイルへフォーカスし、インラインの閉じるボタンでタブを閉じられる。
- **ウィンドウ幅検知**: VS Code 拡張APIにウィンドウ幅取得が無いため、OSネイティブAPIで実ウィンドウ幅を実測する（macOSはSwiftの CGWindowList、Windowsは PowerShell、Linuxは xdotool）。幅実測はキャッシュし、ホットパスから外して裏で定期更新する。
- **リモートビュー**: スマホのブラウザからVS Codeの画面を閲覧し、カラムを選んでClaude Codeセッションへテキスト入力・操作ができる（macOS専用）。画面はキャプチャした選択カラムだけを切り出してスマホ幅にリサイズ配信し、PCのレイアウトは一切変更しない。

---

## インストール

このプロジェクトは VS Code Marketplace には公開していない。ローカルでビルドして拡張フォルダへ配置する個人運用を前提とする。

```bash
npm install
npm run build
```

`npm run build` は esbuild で単一ファイルにバンドルし、ビルド成功時にローカルVS Codeの拡張フォルダ（`~/.vscode/extensions/tsukamoto.editor-spotlighter-0.0.1/`）へ `dist/extension.js`・`dist/extension.js.map`・`package.json` を自動コピーする。配置後はVS Codeのウィンドウをリロード（`Developer: Reload Window`）すると有効になる。

拡張開発として動かす場合は、`.vscode/launch.json` の `Run Extension` 構成（ビルドを前段タスクに実行）でデバッグ起動できる。

---

## 使い方

- **整形ボタン**: エディタタイトルバー右上、およびサイドバーの「Tabs」ビュータイトルに整形アイコンが出る。押すと全カラムを整形し直す（手動の主操作）。
- **コマンド**: コマンドパレットから各コマンドを実行できる（下表参照）。`Toggle` で自動アコーディオンの有効/無効を切り替え、`Set Column Count` で総カラム数を変更、`Reset Layout` で等間隔へ戻す。
- **推奨設定の一括適用**: `Apply Recommended Settings` で、新タブをアクティブタブの右隣に開く・プレビューモードを無効化する設定をまとめて適用する（VS Code本体の `workbench.editor.openPositioning` / `enablePreview` を連動制御する）。
- **サイドバー**: アクティビティバーの Editor Spotlighter アイコンから、カラムごとのタブ一覧（Tabs）とリモートビュー（Remote）を開ける。

---

## 設定一覧

すべて `editorSpotlighter.*` 名前空間。

| 設定キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `editorSpotlighter.enabled` | boolean | `true` | アコーディオン自動整形の有効/無効 |
| `editorSpotlighter.totalColumns` | number | `5` | 総カラム数 |
| `editorSpotlighter.minColumnWidth` | number | `460` | アクティブ枠の最小許容幅(px)。エディタ領域幅とこの値からアクティブカラム数を自動決定（最小100） |
| `editorSpotlighter.maxActiveColumns` | number | `2` | 同時アクティブ列数の上限。0で上限なし。`fullWidthThreshold` 以上の等間隔表示には不適用 |
| `editorSpotlighter.fullWidthThreshold` | number | `3000` | この幅(px)以上のウィンドウでは全カラム等間隔表示 |
| `editorSpotlighter.sidebarWidthWhenOpen` | number | `230` | プライマリサイドバー開時に編集領域から差し引く幅(px)。実機サイドバー幅に合わせ調整（最小0） |
| `editorSpotlighter.openTabBesideActive` | boolean | `true` | 新タブをアクティブタブ右隣に開く（`workbench.editor.openPositioning` を制御） |
| `editorSpotlighter.disablePreviewMode` | boolean | `false` | プレビューモード無効化で常に新タブで開く（`workbench.editor.enablePreview` を制御） |
| `editorSpotlighter.remoteView.enabled` | boolean | `false` | モバイルリモートビューを有効にする |
| `editorSpotlighter.remoteView.port` | number | `19280` | リモートビューのポート番号 |
| `editorSpotlighter.remoteView.password` | string | `""` | リモートビュー接続パスワード。空なら起動ごとに高エントロピーのワンタイムパスワードを自動生成しQRに埋め込み（推奨・起動ごと失効）。固定値はQRに長期有効な秘密として埋め込まれるため撮影・画面共有に注意 |
| `editorSpotlighter.remoteView.allowRemoteInput` | boolean | `true` | リモート（スマホ）からのキーボード入力・クリック・タブ切替を許可。閲覧専用にしたい場合はオフ |
| `editorSpotlighter.remoteView.bindAddress` | string | `"127.0.0.1"` | リモートビューサーバの待受アドレス。既定はローカルのみ（トンネル経由向け）。同一LAN直結は `0.0.0.0`。ただしLAN直結は平文HTTP（TLS未対応）で盗聴され得るためトンネル(HTTPS)推奨 |
| `editorSpotlighter.remoteView.tunnelDomain` | string | `""` | Cloudflare Tunnel のドメイン。設定するとQRコードがこのドメインのURLで生成される |

---

## コマンド一覧

| コマンドID | タイトル |
|---|---|
| `editorSpotlighter.toggle` | Editor Spotlighter: Toggle |
| `editorSpotlighter.setColumns` | Editor Spotlighter: Set Column Count |
| `editorSpotlighter.resetLayout` | Editor Spotlighter: Reset Layout |
| `editorSpotlighter.applyRecommendedSettings` | Editor Spotlighter: Apply Recommended Settings |
| `editorSpotlighter.alignLayout` | Align Layout |
| `editorSpotlighter.closeTab` | Editor Spotlighter: Close Tab |
| `editorSpotlighter.focusTab` | Editor Spotlighter: Focus Tab |
| `editorSpotlighter.spContinue` | Editor Spotlighter: Continue Session from Mobile |
| `editorSpotlighter.startRemoteView` | Editor Spotlighter: Start Remote View |
| `editorSpotlighter.stopRemoteView` | Editor Spotlighter: Stop Remote View |

補足: `editorSpotlighter.spContinue` は Claude Code 拡張のコマンド（`claude-vscode.editor.openLast`）を呼んで直近のセッションを開くもの（失敗時は手動起動を案内）。`closeTab` / `focusTab` はサイドバーのタブ一覧から内部的に呼ばれる。

---

## リモートビュー

スマホのブラウザからVS Code（Claude Code）の画面を閲覧・操作する機能。macOS専用（画面キャプチャ・入力注入・貼り付けがmacOSのAPIに依存するため）。

### 起動手順

1. `editorSpotlighter.remoteView.enabled` を `true` にする。
2. コマンド `Start Remote View`（または Remote サイドバーの Start ボタン）でサーバを起動する。
3. Remote サイドバーにQRコード・接続URL・パスワードが表示される。スマホのカメラでQRを読み取る。
4. 起動中はステータスバー右側に `$(remote) Remote: {ポート番号}` が表示され、クリックで停止できる。
5. 終了するときは `Stop Remote View`（または Stop ボタン・ステータスバー項目）。

### QR / パスワード / 自動ログイン

- パスワードは、未設定または旧固定値のとき起動ごとにワンタイムで自動生成される（起動ごとに失効）。このパスワードが接続認証とQR鍵を兼ねる。
- QRには認証鍵がURLのフラグメント（`#k=`）として埋め込まれる。フラグメントはHTTPリクエストに載らないため、サーバやトンネルのログに鍵が残らない。スマホ側ではログイン後すぐにアドレスバー・履歴から鍵を消す。
- QRをスキャンするとパスワード入力なしで自動ログインする。手動で開いた場合は表示されたパスワードを入力する。

### スマホからの閲覧と操作

- カラムを選ぶと、そのカラムの画面だけが切り出されて表示される。
- 操作を許可している場合（`allowRemoteInput`）、選んだカラムのClaude Codeセッションへテキスト入力・タップ・タブ切替ができる。入力はOS全体に作用するため、誤爆を防ぐfail-closed設計（対象カラムへフォーカスが移ったことを検証 → 前面アプリがVS Code系であることを bundle id 完全一致で確認 → クリップボードを退避して貼り付け＋Enter → 退避内容へ復元）になっている。前面アプリがVS Code系でない・フォーカス確定できない等の場合は注入を中止する。
- `allowRemoteInput` をオフにすると閲覧専用になる。

### 画面自動更新

- スマホが接続している間だけ、約1.5秒間隔で画面をキャプチャする。
- 生フレームと切り出し後フレームの二段でハッシュを取り、変化があったときだけ配信する（静止画面は送らない）。操作の直後は描画反映を待ってから1回キャプチャする。

### セキュリティ注意

- **既定は `127.0.0.1`（ローカルのみ待ち受け）**。外部からアクセスするにはCloudflare Tunnel などのHTTPSトンネル経由が推奨。
- **LAN直結は明示的なopt-in**（`bindAddress` を `0.0.0.0` などに変更）。ただしLAN直結は平文HTTP（TLS未対応）で盗聴され得るため、トンネル経由（HTTPS）を推奨。
- アクセス許可は実際の接続元ソケットIPだけで判定する（偽装可能なHTTPヘッダは信用しない）。許可範囲はループバックとプライベートIP帯（`10.*` / `192.168.*` / `172.16-31.*`）。
- 認証はパスワード＋Cookieセッション（セッション有効期限12時間）。同一IPからのログイン失敗が一定回数に達するとロックアウトする。
- **固定パスワードを設定した場合**、その鍵が長期有効な秘密としてQRに埋め込まれる。QRの撮影・画面共有に注意（推奨は空欄＝起動ごとワンタイム生成）。

---

## ビルドとテスト

| コマンド | 内容 |
|---|---|
| `npm run build` | esbuild で単一ファイルにバンドル（成功時にローカル拡張フォルダへ自動配置） |
| `npm run watch` | watchモードでバンドル |
| `npm test` | vitest でテストを1回実行 |
| `npm run test:watch` | vitest をwatch実行 |
| `npm run package` | `vsce package` で `.vsix` を生成（vsce はグローバル/npx 前提・依存に未掲載） |

テストは vitest を使い、`src/__tests__/` 配下に配置する。レイアウト算出（`columnCalculator` / `layoutEngine`）、サイドバー開閉判定、ウィンドウ幅出力のパース、リモート系の純関数（フォーカスルーティング・注入パイプライン・QR表示判定・認証・フレーム送信判定・モバイルHTML契約）などを検証する。

---

## 対応プラットフォーム

- **ウィンドウ幅検知（レイアウト整形・アコーディオン）**: macOS / Windows / Linux に対応（各OSのネイティブ手段で実ウィンドウ幅を取得）。
- **リモートビュー全般（画面キャプチャ・入力注入・貼り付け・サイドバー境界検出）**: macOS専用。
- ログやキャプチャの一時ファイルは `/tmp` 配下を使う（Unix前提）。

---

## 開発

ソースは `src/` 配下。主なモジュール:

- `extension.ts` — 拡張のエントリーポイント。フォーカス監視・アクティブ列計算・レイアウト適用・読み戻し検証/自己回復・サイドバー連動・全コマンド登録・リモートビュー起動を統括。
- `layoutEngine.ts` — アクティブ集合とエディタ幅から比率レイアウトを算出し、適用・読み戻し・一致判定する。
- `columnCalculator.ts` — ウィンドウ幅からエディタ実領域幅とアクティブ列数を決める純関数群。
- `sidebarPolicy.ts` — アクティブ列数からプライマリサイドバーの開閉目標を決める純関数。
- `windowDetector.ts` — OS別の実ウィンドウ幅取得、サイドバー境界検出（macOS）。
- `tabTreeProvider.ts` — サイドバーのタブ一覧ツリービュー。
- `remoteWebviewProvider.ts` — サイドバー内のリモートビュー状態表示（QR・URL・パスワード・操作ボタン）。
- `remote/` — リモートビューのサーバと部品: `remoteViewServer.ts`（HTTP+WSサーバ・認証・セッション・キャプチャ配信）、`focusRouter.ts`（列フォーカス移動と確定検証）、`injectionPipeline.ts`（テキスト注入パイプライン）、`qrPolicy.ts`（待受アドレス既定値・QR URL組立・表示種別判定）、`mobileHtml.ts`（スマホ側UI）、`panelDetector.ts`（キャプチャ画像の列境界検出）、`tokenAuth.ts`（パスワード検証・トークン生成）、`protocol.ts`（メッセージ型）。

ビルドは esbuild が担い、TypeScript の型チェック/宣言生成は `tsconfig.json`（strict）で行う。
