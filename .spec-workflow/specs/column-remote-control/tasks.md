# Tasks: カラム単位リモート操作（column-remote-control）

前提: TDD（テスト作成→実装→リファクタ）。1タスク=1検証可能な変更。テストは vitest（既存流儀どおり、vscode 非依存の注入可能インターフェースでモジュールを切る）。
要件・設計の参照: `.spec-workflow/specs/column-remote-control/requirements.md` / `design.md`（節番号は design.md）。

- [x] 1. プロトコル拡張の型定義
  - `src/remote/protocol.ts` に `InjectAbortReason`・`injectResult` メッセージ・`columns` への `labels`/`allowInput` 追加（design 3.1）。既存メッセージ型は不変。
  - 検証: `npx tsc --noEmit` が通る（既存利用箇所のコンパイルエラーで互換破壊を検出）。
  - 要件: a-3, b-2, b-3, エッジ3

- [x] 2. focusRouter のテスト作成
  - `src/__tests__/focusRouter.test.ts` 新規。FakeFocusHost で以下を検証: ①範囲外列→columnOutOfRange ②Claude タブ不在グループ→noClaudeTab ③フォーカスコマンド後 activeGroupIndex が一致しない（タイムアウト）→focusUnverified ④一致→ok ⑤Claude タブ非アクティブ時の活性化→再検証 ⑥9列目以降（index 8+）→columnOutOfRange ⑦`isClaudeCodeTab` が viewType `mainThreadWebview-claudeVSCodePanel`/`claudeVSCodePanel` 両方を真、テキストタブを偽と判定（design 2.2-2.3）。
  - 検証: テストが失敗する状態で完了（実装前）。
  - 要件: a-1, a-2, エッジ1, エッジ2

- [x] 3. focusRouter の実装
  - `src/remote/focusRouter.ts` 新規。`FOCUS_GROUP_COMMANDS`（First〜Eighth の8要素）・`isClaudeCodeTab`（判定文字列は1定数）・`routeFocusToColumn`（50ms間隔・1500msタイムアウトのポーリング検証、fail-closed）（design 2.2, 2.3 [1]-[5]）。
  - 検証: タスク2のテストが全件 PASS。
  - 要件: a-1, a-2, エッジ1, エッジ2

- [x] 4. FocusHost の vscode 実装（アダプタ）
  - `src/remote/focusRouter.ts` または extension 側に `createVSCodeFocusHost()` を追加: `vscode.window.tabGroups` のスナップショット化・`executeCommand`・`openEditorAtIndex{N}` 呼び出しの薄い写像（design 2.2）。ロジックを持たせない（テスト済みコアに寄せる）。
  - 検証: `npx tsc --noEmit` が通る。ロジック分岐がアダプタに存在しないことをレビューで確認。
  - 要件: a-1

- [x] 5. Claude Code タブ実機検証（判定文字列の確定）
  - 拡張をビルドして実機 VS Code で起動し、Claude Code セッションタブを開いた状態で `tabGroups` 全タブの `input` 型・`viewType` 生値・`label` を既存デバッグログ（OutputChannel）へ出力。`claudeVSCodePanel` を含むことを確認し、判定定数を生値に合わせて確定。`workbench.action.openEditorAtIndex1` の動作（webview タブ活性化）も同時に確認。
  - 検証: ログに実 viewType が記録され、`isClaudeCodeTab` が実タブで真になる（結果を findings に1行記録）。
  - 要件: a-1（design 2.1 の実在性確認・リスク2/4の解消）

- [x] 6. injectionPipeline のテスト作成
  - `src/__tests__/injectionPipeline.test.ts` 新規。注入される依存（focusRouter 結果・クリップボード・前面アプリ検査＋貼り付け統合実行・selectedColumn 取得・結果通知）をすべてフェイク化し検証: ①順序保証（フォーカス検証成功前に前面検査・貼り付けが呼ばれない・クリップボード書込は再検証[6]通過後の[7]でのみ起きる） ②各中止理由で貼り付け未発行＋injectResult 通知（busy/columnOutOfRange/noClaudeTab/focusUnverified/frontAppNotVSCode/stateChanged/internalError） ③成功時 貼り付け発行＋ok 通知 ④in-flight 中の2発目→busy ⑤直前再検証で列変化→stateChanged ⑥例外時も in-flight フラグ解除＋internalError 通知 ⑦外部コマンドがタイムアウトした場合に internalError 中止＋in-flight 解除（[9] デッドロック防止） ⑧中止経路でクリップボードが退避内容へ復元される（design 2.3 [0]-[10]）。
  - 検証: テストが失敗する状態で完了（実装前）。
  - 要件: a-2, a-3, エッジ2, エッジ5, 非機能（誤爆防止）

- [x] 7. injectionPipeline の実装
  - `src/remote/injectionPipeline.ts` 新規。design 2.3 のシーケンス [0]-[10] を直列実装。前面アプリ検査と貼り付けを**単一 osascript に統合**し、frontmost プロセスの bundle identifier が VS Code 系（com.microsoft.VSCode / com.microsoft.VSCodeInsiders / 開発時 com.github.Electron）に**完全一致したときのみ**同一スクリプト内で Cmd+V→delay→return を発行する（現行のプロセス名部分一致 /code|electron|.../ は Xcode 等を誤判定するため使わない・design 2.3 [8]）。警告メッセージ文言は現行を維持。クリップボード書込は再検証[6]通過後の[7]へ遅らせ、書込前に既存クリップボードを退避し完了/中止後に復元。外部コマンド（[3]/[5]/[8]）に実行タイムアウトを噛ませ、try/finally で busy フラグを必ず解除（ハング時の恒久 busy を防ぐ・[9]）。注入テキスト本文はログに残さない（件数・reason のみ）。
  - 検証: タスク6のテストが全件 PASS。既存テストも緑（`npm test`）。type 経路に旧 `/code|electron|visual studio code/i` の部分一致判定が残っていないことを grep で確認。
  - 要件: a-2, a-3, a-4, エッジ2, エッジ5, 非機能（誤爆防止）

- [x] 8. extension.ts の type 処理置換
  - `onClientMessage` の type 分岐（extension.ts:692-731）を injectionPipeline 呼び出しに置換。`claude-vscode.focus` と setTimeout 500ms を撤去。switchTab 分岐は無変更（design 1.3, 2.3）。
  - 検証: `npx tsc --noEmit`・ビルド成功。type 経路に `claude-vscode.focus`/`setTimeout` が残っていないことを grep で確認。
  - 要件: a-1, a-2, a-4

- [x] 9. サーバの状態API拡張（テスト→実装）
  - `clampSelectedColumn(selected, count)` を純関数として切り出しテスト作成（範囲内維持・縮小時末尾寄せ・0列時0）→ `src/remote/remoteViewServer.ts` に `getSelectedColumn()`・`setColumns(count, labels)`（クランプ＋columns ブロードキャスト）・`sendInjectResult()` を実装。WS確立時の初期 columns 送出（remoteViewServer.ts:429-430）に labels/allowInput を含める。`selectColumn` の既存範囲検証は維持（design 2.4, 3.3）。
  - 検証: 新規純関数テスト PASS・既存テスト緑・`npx tsc --noEmit`。
  - 要件: a-3, b-3, エッジ3, エッジ4, エッジ5, エッジ6

- [x] 10. 列ラベル導出（テスト→実装）と同期配線
  - `deriveColumnLabels(tabs, count)` のテスト作成（アクティブタブ名抽出・アクティブ無しグループは空文字・count超過分の切り捨て）→ 純関数実装 → extension.ts の `updateRemoteTabs()` 後段と `onDidChangeTabGroups`/`onDidChangeTabs` 既存リスナーから `setColumns(tabGroups.all.length, labels)` を呼ぶ配線。`setColumnCount(totalColumns)` の既存呼び出し（接続時・設定変更時）を実グループ数ベースに置換（design 2.4）。
  - 検証: テスト PASS。実機でグループ増減時に columns メッセージの count が追従することをログで確認。
  - 要件: b-2, b-3, エッジ1, エッジ5

- [x] 11. モバイルUI: 列バーの動的生成
  - `src/remote/mobileHtml.ts` の固定4ボタン（181-186行）を撤去し、columns メッセージの count/labels からボタンを動的生成。各ボタンは列番号＋タブ名（ellipsis）の2段表示（design 5.1）。**タブ名は `textContent` で挿入し `innerHTML` を使わない**（タブ名＝ファイル名は実質ユーザー制御値で、innerHTML 描画は DOM XSS → リモート操作チャネル乗っ取りになる・design 3.2）。
  - 検証: 実機で列数2と5の構成それぞれでボタン数が実列数と一致（b-3 受け入れ条件）。`<img src=x onerror=...>` 等を名前に含むファイル/タブを開いた状態でスクリプト実行されないこと（textContent 描画）をレビューと実機で確認。コードに列ラベルの innerHTML 代入が無いことを grep で確認。
  - 要件: b-2, b-3, 非機能（セキュリティガード維持）

- [x] 12. モバイルUI: タブ名追従の確認
  - 列バーのラベルが columns 再受信で更新されることを確認し、必要なら差分更新処理を補完。PC側でタブを切り替えた直後にスマホの列ラベルが追従することを実機確認（b-2 受け入れ条件）。
  - 検証: 実機確認で追従を目視。
  - 要件: b-2

- [x] 13. モバイルUI: 送信先表示と切替中オーバーレイ
  - 入力欄上部の送信先表示「→ 列N・{タブ名}」を追加。タブ名は `textContent` で挿入（innerHTML 禁止・design 3.2）。列タップ時は selectColumn 送信→サーバACK（columns受信）まで送信先表示を更新せず送信を無効化、画面に「切替中」オーバーレイ→新フレーム受信で解除（design 5.1, 5.2）。他クライアント起因の columns 受信でも同経路で同期。
  - 検証: 実機で列切替直後から送信先表示が選択列と一致（b-1 受け入れ条件）、切替中に旧列画像が現在画面として見えない（b-4 受け入れ条件）。送信先表示のタブ名が textContent 描画であることをレビューで確認。
  - 要件: b-1, b-4, エッジ4

- [x] 14. モバイルUI: 注入結果トースト・busy制御・閲覧専用・再接続ゲート
  - injectResult 受信でトースト表示（reason→日本語文言マップ。サーバ値を直接描画せずマップ経由の固定文言を `textContent` で表示、未知 reason は汎用文言にフォールバック・design 3.2）。送信中は送信ボタン無効化＋10s安全タイムアウト。allowInput=false で入力欄・送信を disabled＋「閲覧専用」表示。WS open 後は columns 受信まで入力無効（design 5.1, 5.2）。
  - 検証: 実機で中止時に理由が表示される（a-3 受け入れ条件）、入力許可OFFで閲覧専用表示（エッジ3）、再接続直後に旧状態で送信できない（エッジ6）。トースト文言が固定マップ経由の textContent 描画であることをレビューで確認。
  - 要件: a-3, エッジ3, エッジ6

- [x] 15. qrPolicy のテスト作成
  - `src/__tests__/qrPolicy.test.ts` 新規。①tunnelDomain 設定→tunnel URL ②bind 127.0.0.1/localhost/::1 × tunnel 未設定→localOnly（QRなし） ③bind 0.0.0.0→LAN URL ④bind に LAN IP 明示→LAN URL（design 4.2）。
  - 検証: テストが失敗する状態で完了（実装前）。
  - 要件: c-2

- [x] 16. qrPolicy の実装と extension 配線
  - `src/remote/qrPolicy.ts` 新規実装 → extension.ts の QR 生成分岐（770-784行）を qrPolicy 呼び出しに置換。
  - 検証: タスク15のテスト PASS・`npx tsc --noEmit`。
  - 要件: c-2

- [x] 17. bind 既定値の 127.0.0.1 化
  - `package.json` の bindAddress default と description、extension.ts:665 の `config.get` フォールバック、remoteViewServer.ts:153 の `start()` 引数既定、関連コメント（remoteViewServer.ts:169 等）を一括変更（design 4.1）。IP 許可リスト判定（remoteViewServer.ts:516-544）は変更しない。
  - 検証: 設定未変更状態で起動し `lsof -iTCP:19280 -sTCP:LISTEN` で待ち受けが 127.0.0.1 のみであること（c-1 受け入れ条件）。tunnelDomain 設定環境で接続が従来どおり通ること。
  - 要件: c-1, 非機能（セキュリティガード維持）

- [x] 18. サイドバー localOnly 表示状態の追加
  - `src/remoteWebviewProvider.ts` に localOnly 状態を追加: QR を描画せず、待ち受け範囲の説明＋「設定を開く」ボタン（`workbench.action.openSettings` で `editorSpotlighter.remoteView` を開く）＋パスワード・Stop は従来表示（design 4.2）。CSP/nonce/htmlEscape の既存方式を踏襲。
  - 検証: 実機で 127.0.0.1×トンネル未設定時に LAN URL の QR が表示されない（c-2 受け入れ条件）、設定ボタンから設定画面が開く。
  - 要件: c-2

- [x] 19. 初回移行案内
  - extension.ts のサーバ起動処理に globalState キー `remoteView.bindMigrationNoticeShown` による1回限りの案内（showInformationMessage＋「設定を開く」アクション）を追加。bindAddress 実効値が 127.0.0.1 系×tunnel 未設定のときのみ（design 4.3）。
  - 検証: 初回起動で案内が出る・2回目は出ない・bindAddress 明示設定済み環境では出ない（c-3 受け入れ条件）。
  - 要件: c-3

- [ ] 20. 既存機能の回帰確認
  - 全自動テスト緑（`npm test`、出力本体の passed 件数を直読）。実機で既存挙動の無変化を確認: 画面閲覧・click タップ・switchTab・再接続バナー・×ボタン切断・ログインロックアウト・前面に別アプリがある状態での送信が注入ゼロで中止（a-4 受け入れ条件）。誤マッチ回帰: **Xcode 等「code」を名前に含むアプリを前面にした状態での送信が注入ゼロで中止される**こと（bundle id 完全一致への強化が効いていることの確認）。
  - 検証: 上記チェックリスト全項目の目視結果を findings に記録。
  - 要件: a-4, 非機能（既存閲覧互換・セキュリティガード維持）

- [ ] 21. 受け入れ条件の実機E2E（主シナリオ・誤爆ゼロ）
  - 3列以上×各列に別 Claude Code セッションの実機構成で、スマホから列を切り替えながら送信した各テキストがそれぞれ選択列のセッションにのみ入力されること（a-1 受け入れ条件）を全列で確認。フォーカス検証失敗系（対象列の Claude タブを閉じて送信→noClaudeTab 中止通知）・列削除と送信の競合（エッジ5）・体感応答性（現行比で悪化なし）も確認。
  - 検証: 確認結果（列ごとの成否・中止通知の表示）を findings に記録。スクリーンショットは `e2e/screenshots/` 配下。
  - 要件: a-1, a-2, a-3, エッジ2, エッジ5, 非機能（誤爆防止・応答性）
