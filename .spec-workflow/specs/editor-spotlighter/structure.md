# Structure: Editor Spotlighter

## Directory Layout

```
editor-spotlighter/
├── .claude -> ../firebase-kit/.claude  # 共有ルール（シンボリックリンク）
├── .spec-workflow/                     # Steering/Specドキュメント
│   └── specs/
│       ├── editor-spotlighter/         # 本拡張のSteering（product/tech/structure）
│       │   ├── product.md
│       │   ├── tech.md
│       │   └── structure.md
│       └── column-remote-control/      # カラム単位リモート操作の正本（focusRouter/injectionPipelineの成果物）
│           ├── requirements.md
│           ├── design.md
│           ├── tasks.md                # 21タスク
│           └── Implementation Logs/
├── src/
│   ├── extension.ts                    # エントリポイント。フォーカス監視→アクティブ列計算→アコーディオン適用→読み戻し検証/自己回復、サイドバー連動、全コマンド登録、リモートビュー起動の統括
│   ├── layoutEngine.ts                 # レイアウト計算（calculateLayout/applyLayout/readBackLayout/layoutMatches）。setEditorLayout経由で適用・読み戻し・比率一致判定
│   ├── columnCalculator.ts             # ウィンドウ幅→エディタ実領域幅推定とアクティブ列数判定の純関数（deriveEditorWidth/computeActiveColumns）
│   ├── sidebarPolicy.ts                # アクティブ列数→プライマリサイドバー開閉の目標状態を決める純関数（decideSidebarTargetState）
│   ├── windowDetector.ts               # OS別ウィンドウ幅/座標取得＋macOS専用のサイドバー境界検出（Swift CGWindowList / PowerShell / xdotool）
│   ├── tabTreeProvider.ts              # タブ一覧TreeViewプロバイダー（列＝タブグループごとにタブをグループ化表示）
│   ├── remoteWebviewProvider.ts        # リモートビューWebViewプロバイダー（停止/稼働/ローカルのみの状態別にQR・URL・パスワード・操作ボタンをCSP付き描画）
│   ├── remote/
│   │   ├── remoteViewServer.ts         # HTTP/WebSocket一体サーバー。認証・セッション・IPロックアウト・定期キャプチャ・二段ハッシュ変化検知・列状態broadcast・配信ガード
│   │   ├── mobileHtml.ts               # スマホ向けHTML生成（リモートビュー画面・ログインページ・QR自動ログインのinline JS）
│   │   ├── protocol.ts                 # WebSocketメッセージ型定義（ServerMessage / ClientMessage / TabInfo / InjectAbortReason）
│   │   ├── panelDetector.ts            # スクリーンキャプチャ画像から列境界・エディタ下端を検出（sharp・輝度差ベース）
│   │   ├── tokenAuth.ts                # パスワード検証（timingSafeEqual）・セッショントークン生成・起動時ワンタイムパスワード生成
│   │   ├── qrPolicy.ts                 # リモートアクセス表示種別の判定（tunnel/lan/localOnly）・QR URL組立・bind既定値の単一真実源
│   │   ├── focusRouter.ts              # 指定列へのフォーカス移動＋確定検証＋Claude Codeタブ活性化（fail-closed）・Claudeタブ判定
│   │   └── injectionPipeline.ts        # リモート入力の注入パイプライン（多重抑止・列検証・フォーカス確定・クリップボード退避/復元・前面アプリbundle id完全一致検査・貼付＋Enter）
│   └── __tests__/
│       ├── layoutEngine.test.ts        # calculateLayout/layoutMatches（比率計算・狭窓等間隔フォールバック・読み戻し一致）
│       ├── columnCalculator.test.ts    # computeActiveColumns（最小幅底支え・上限・等間隔閾値・クランプ）
│       ├── sidebarPolicy.test.ts       # decideSidebarTargetState（1以下close・2以上open）
│       ├── windowDetector.test.ts      # parseWindowsOutput/parseLinuxGeometry（OS別出力のパース）
│       ├── focusRouter.test.ts         # isClaudeCodeTab/routeFocusToColumn（範囲外・タブ無し・確定失敗・非アクティブ活性化）
│       ├── injectionPipeline.test.ts   # runInjectionPipeline（busy抑止・列範囲外・フォーカス失敗・stateChanged・退避/復元・in-flight解除）
│       ├── mobileHtml.test.ts          # getLoginHtml/getMobileHtml（QRフラグメント・replaceState順序・エラー文言出し分け）
│       ├── qrPolicy.test.ts            # decideRemoteAccessDisplay/buildQrUrl（表示種別判定・QR URLラウンドトリップ）
│       └── remoteViewServerHelpers.test.ts # clampSelectedColumn/deriveColumnLabels/shouldSendFrame/shouldAttemptResolve/columnsペイロード生成
├── resources/
│   └── icon.svg                        # アクティビティバー・整形ボタンのアイコン
├── docs/                               # design HTML・findings・personal（vsix除外設定の対象外）
├── dist/                               # esbuildバンドル出力（.gitignore・vsixには同梱）
│   ├── extension.js
│   └── extension.js.map
├── README.md                           # 利用者/開発者向けドキュメント（機能・インストール・設定・コマンド・リモートビュー）
├── package.json                        # 拡張マニフェスト・設定スキーマ・コマンド/ビュー/メニュー定義
├── package-lock.json
├── tsconfig.json
├── esbuild.config.mjs                  # esbuildバンドル設定（ビルド時に拡張フォルダへ自動配置）
├── vitest.config.ts                    # vitestテスト設定
├── .gitignore
└── .vscodeignore                       # vsixパッケージ除外設定
```

注: 実ビルドはesbuildが単一ファイルへバンドルし（entry: `src/extension.ts`、external: `vscode`）、`dist/extension.js` を出力する。tsconfigは型チェック/IDE/declaration用。`tokenAuth.test.ts` を含むテストは `src/__tests__/` に全10ファイル。

## Conventions

### Naming

- **ファイル名**: camelCase（`layoutEngine.ts`, `windowDetector.ts`, `remoteViewServer.ts`）
- **変数・関数**: camelCase（`calculateLayout`, `computeActiveColumns`, `routeFocusToColumn`）
- **型・インターフェース**: PascalCase（`LayoutConfig`, `EditorLayout`, `TabInfo`, `ServerMessage`, `InjectAbortReason`）
- **モジュール定数**: UPPER_SNAKE_CASE（`DEFAULT_BIND_ADDRESS`, `CAPTURE_INTERVAL_MS`, `SESSION_TTL_MS`, `PASTE_OSASCRIPT`）

### Import Order

1. `vscode`（VSCode Extension API）
2. 外部ランタイム依存（`qrcode`, `ws`, `sharp`, Node標準 `http`/`crypto`/`os`/`fs`）
3. 内部モジュール（`./columnCalculator`, `./layoutEngine`, `./remote/qrPolicy` ほか）

### Test

- 配置: `src/__tests__/` ディレクトリ（vitestの探索範囲は `src/__tests__/**/*.test.ts`）
- 命名: `*.test.ts`
- フレームワーク: vitest（`vitest run` で1回実行、`vitest` でwatch）。vscode-test/mochaは不使用
- 対象: 純関数・リモート系の純関数群が中心（`layoutEngine` / `columnCalculator` / `sidebarPolicy` / `windowDetector`パース / `focusRouter` / `injectionPipeline` / `mobileHtml` / `qrPolicy` / `remoteViewServer`ヘルパー / `tokenAuth`）。VSCode API依存が強い `extension.ts` / `remoteWebviewProvider.ts` / `tabTreeProvider.ts` / `panelDetector.ts` には専用テストなし（沈黙の未カバー範囲）。`layoutEngine.test.ts` は `vi.mock("vscode")` でvscodeモジュールをモックする
- 検証観点: 業務要件・期待される振る舞い（クランプ・上限・フォールバック・fail-closed中止理由・XSSガード・認証照合）を検証する

### Configuration Namespace

`editorSpotlighter.*` で統一。設定キー（全14件）は以下のグループ。

- レイアウト系: `totalColumns` / `minColumnWidth` / `sidebarWidthWhenOpen` / `maxActiveColumns` / `fullWidthThreshold` / `enabled`
- タブ設定連動系: `openTabBesideActive` / `disablePreviewMode`（VSCode本体設定 `workbench.editor.openPositioning` / `workbench.editor.enablePreview` を連動書き換え）
- リモートビュー系: `remoteView.enabled` / `remoteView.port` / `remoteView.password` / `remoteView.bindAddress` / `remoteView.tunnelDomain` / `remoteView.allowRemoteInput`

VSCode本体設定（`workbench.editor.*`）はタブ設定・推奨設定適用時のみ書き換える（二重管理を避ける薄いラッパー方針）。設定の永続化先はユーザー設定（settings.json）に加え、初回案内の表示済みフラグに `context.globalState`（キー `remoteView.bindMigrationNoticeShown`）を使う。

## package.json contributes

- `viewsContainers.activitybar` - id=`editorSpotlighter`、アイコン `resources/icon.svg`
- `views.editorSpotlighter`（2件）:
  - `editorSpotlighter.tabList`（name=`Tabs`）- タブ一覧TreeView（`tabTreeProvider.ts`）
  - `editorSpotlighter.remoteView`（name=`Remote`, type=`webview`）- リモートビューWebView（`remoteWebviewProvider.ts`）
- `menus`（3カテゴリ）:
  - `editor/title` - `alignLayout`（when `editorIsOpen`, group `navigation`、エディタ右上の整形ボタン）
  - `view/title` - `alignLayout`（when `view == editorSpotlighter.tabList`, group `navigation`）
  - `view/item/context` - `closeTab`（when `view == editorSpotlighter.tabList && viewItem == tab`, group `inline`）
- `configuration` - title=`Editor Spotlighter`、上記 Configuration Namespace の全14設定キー
- `activationEvents` - `onStartupFinished`（起動完了時にアクティベート）

## Commands

`contributes.commands` の全コマンド（全10件）。Command ID は package.json と一致。

| Command ID | title | 機能 |
|---|---|---|
| `editorSpotlighter.toggle` | Editor Spotlighter: Toggle | 有効/無効切替（無効化時は等間隔へリセット） |
| `editorSpotlighter.setColumns` | Editor Spotlighter: Set Column Count | カラム数変更（InputBox・1以上の整数のみ受理） |
| `editorSpotlighter.resetLayout` | Editor Spotlighter: Reset Layout | レイアウトを等間隔にリセット（読み戻し検証付き） |
| `editorSpotlighter.applyRecommendedSettings` | Editor Spotlighter: Apply Recommended Settings | 推奨設定の一括適用（タブ配置・プレビュー無効化など） |
| `editorSpotlighter.alignLayout` | Align Layout | レイアウト整形＋履歴リセット（エディタ右上ボタン・アイコン `resources/icon.svg`） |
| `editorSpotlighter.closeTab` | Editor Spotlighter: Close Tab | タブを閉じる（テキストタブのみ・アイコン `$(close)`） |
| `editorSpotlighter.focusTab` | Editor Spotlighter: Focus Tab | 指定タブにフォーカス（プレビュー無効で開く） |
| `editorSpotlighter.spContinue` | Editor Spotlighter: Continue Session from Mobile | Claude Codeの直近セッションを開く（`claude-vscode.editor.openLast` 依存・失敗時は手動起動案内） |
| `editorSpotlighter.startRemoteView` | Editor Spotlighter: Start Remote View | リモートビュー開始 |
| `editorSpotlighter.stopRemoteView` | Editor Spotlighter: Stop Remote View | リモートビュー停止 |
