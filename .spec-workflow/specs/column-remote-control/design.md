# Design: カラム単位リモート操作（column-remote-control）

要件定義: `.spec-workflow/specs/column-remote-control/requirements.md`
タスク分解: `.spec-workflow/specs/column-remote-control/tasks.md`

---

## 1. アーキテクチャ概要

### 1.1 変更コンポーネントと責務分離

```
スマホ（ブラウザ）                         PC側（拡張ホスト）
┌──────────────────────┐                ┌─────────────────────────────────────┐
│ mobileHtml.ts（変更） │                │ extension.ts（変更）                 │
│  - 列バー動的生成     │  WS            │  - type受信→注入パイプライン起動     │
│  - 送信先列の明示     │◄──────────────►│  - tabGroups変更→列数/ラベル同期     │
│  - 切替中/結果表示    │  protocol.ts   │  - 起動時QR/案内表示・移行案内       │
│  - 閲覧専用/busy制御  │  （拡張）      │        │                            │
└──────────────────────┘                │        ▼                            │
                                        │ injectionPipeline.ts（新規）         │
┌──────────────────────┐                │  - 注入の順序保証・fail-closed統括   │
│ remoteViewServer.ts   │                │  - 多重注入抑止（busyフラグ）        │
│ （変更）              │                │        │                            │
│  - 認証/WS/配信(既存) │                │        ▼                            │
│  - 選択列の単一真実源 │◄───────────────│ focusRouter.ts（新規）               │
│  - 列数/ラベル/許可の │  内部API       │  - 列index→フォーカスコマンド対応    │
│    ブロードキャスト   │                │  - tabGroupsによるフォーカス確定検証 │
│  - injectResult配信   │                │  - Claude Codeタブ判定・活性化       │
└──────────────────────┘                ├─────────────────────────────────────┤
┌──────────────────────┐                │ qrPolicy.ts（新規・純関数）          │
│ panelDetector.ts      │                │  - bind設定→QR/URL/案内の表示判定    │
│ （変更なし・閲覧専用）│                │ remoteWebviewProvider.ts（変更）     │
│  - 画像クロップのみ   │                │  - localOnly案内の表示状態を追加     │
└──────────────────────┘                └─────────────────────────────────────┘
```

### 1.2 責務分離の原則（要件エッジケース1の構造的充足）

- **入力ルーティングの真実源は `vscode.window.tabGroups` のみ**。`panelDetector.ts` は画面クロップ（閲覧品質）専用に分離し、一切変更しない。画像解析の列境界と実グループ数がズレても、入力先の決定には影響しない配線にする。
- **選択列の真実源はサーバ（`RemoteViewServer.selectedColumn`）のみ**。スマホUIはサーバのブロードキャスト（columns メッセージ）を受けてから表示を更新する（クライアント側の楽観更新で表示と送信先が食い違う状態を作らない）。
- **検証は注入の瞬間に行う**。列数・選択列の妥当性は type 受信時点の tabGroups スナップショットで再検証し、接続時や列切替時のキャッシュを信用しない。

### 1.3 Code Reuse Analysis（既存資産の棚卸し結果）

firebase-kit は使わない（VS Code 拡張単体。委譲指示で明示済み・依存も存在しないことを package.json で確認）。

| 既存資産 | 本設計での扱い |
|---|---|
| `src/remote/remoteViewServer.ts` 認証・セッション失効・ロックアウト・IP許可・型/長さ/範囲検証・allowInput破棄 | **無変更で維持**（撤去せず積み増す）。`selectColumn` の範囲検証（remoteViewServer.ts:464-472）も維持 |
| `src/extension.ts:691-748` type/switchTab 処理 | type 処理の中身を注入パイプライン呼び出しに置換。**前面アプリ検査（extension.ts:709-731）は順序を変えて維持**。switchTab は無変更 |
| `src/extension.ts` `updateRemoteTabs()`（794-820行）の TabInfo 構築 | 列ラベル導出の入力として再利用（tabs メッセージは既存のまま） |
| `src/remote/protocol.ts` | 追加拡張のみ（既存メッセージ型は不変） |
| `src/remote/mobileHtml.ts` 再接続バナー・クリック転送・×ボタン | 維持。列バー・入力欄まわりのみ変更 |
| `src/remote/panelDetector.ts` / `src/windowDetector.ts` | **変更なし**（閲覧専用に分離） |
| `src/remoteWebviewProvider.ts` CSP/nonce/htmlEscape | 維持。表示状態を1つ追加 |
| `vscode.window.tabGroups` の利用実績（extension.ts:199-209, 733-747, 799） | フォーカス確定検証で同じAPIを使う（新規依存なし） |
| テスト基盤 vitest（`src/__tests__/`、純関数モジュールを直接テストする既存流儀） | 新規モジュールは vscode 非依存の注入可能インターフェースで切り、vitest でテストする |

同等機能の不存在確認: 列単位フォーカス・注入結果通知・bind既定の案内表示は既存コードベースに存在しない（grep で確認済み）。

---

## 2. フォーカスルーティング設計（技術検証①の確定）

### 2.1 確定手段: VS Code 標準コマンド＋tabGroups API 検証の二段構え

**フォーカス移動**は VS Code 標準コマンド `workbench.action.focus{First..Eighth}EditorGroup` で行い、**確定検証**は `vscode.window.tabGroups.activeTabGroup` で行う。

**API実在性の根拠**:

- `workbench.action.focusFirstEditorGroup` 〜 `focusEighthEditorGroup`: インストール済み VS Code 本体バンドル（`vs/workbench/workbench.desktop.main.js`）内にコマンドIDの実在を grep で確認済み。公式既定キーバインド（Cmd+1〜8）に対応する安定コマンド。
- `vscode.window.tabGroups`（TabGroups API）: 本リポジトリの `node_modules/@types/vscode/index.d.ts` に型定義が実在（`TabGroup`: 19375行、`activeTabGroup`: 19418行、`onDidChangeTabGroups`: 19423行、`TabInputWebview`: 19222行）。engines `^1.85.0`（package.json）に対し TabGroups API は 1.67 で stable 化済み。既に `extension.ts` で多用しており新規依存ではない。
- **Claude Code パネルの列内表現**: Claude Code 拡張（anthropic.claude-code 2.1.172）のバンドルを実査し、エディタ領域のセッションタブは `createWebviewPanel("claudeVSCodePanel", ...)` で生成される webview パネルであることを確認済み。よってタブは `tab.input instanceof vscode.TabInputWebview` で表現され、`viewType` に `claudeVSCodePanel` を含む（VS Code の実装上 `mainThreadWebview-` プレフィックスが付与されて報告される場合があるため、判定は完全一致ではなく `includes("claudeVSCodePanel")` とする。実行時の生値はタスク5で実機ログ確認して確定する）。

**採用しない案と理由**:
- `claude-vscode.focus`（現行実装）: ビュー全体フォーカスであり対象列を指定できない。複数セッション並列時にどのセッションへフォーカスが移るか保証がなく、別グループへフォーカスを奪う経路になるため、列ルーティング経路からは**撤去**する（要件 a-1 の明示要求）。
- `vscode.window.showTextDocument(uri, {viewColumn})`: テキストエディタ専用で webview タブに使えない。
- tabGroups API 単独: フォーカスを移すメソッドが API に存在しない（読み取り＋イベントのみ）。よって「移動=コマンド／検証=API」の分担が必須。

### 2.2 モジュール構成

```
src/remote/focusRouter.ts（新規・vscode 非依存）

  FOCUS_GROUP_COMMANDS: string[]   // index 0-7 → focusFirst..EighthEditorGroup
  isClaudeCodeTab(tab): boolean    // TabInputWebview && viewType.includes("claudeVSCodePanel")
                                   // 判定文字列は1定数に集約（実機確定タスクで差し替え可能に）

  interface FocusHost {            // vscode を注入可能にする境界（vitest用）
    getGroups(): GroupSnapshot[];          // tabGroups.all の写像
    getActiveGroupIndex(): number;         // activeTabGroup の index
    executeCommand(id: string): Promise<void>;
    openEditorAtIndex(tabIndex: number): Promise<void>; // workbench.action.openEditorAtIndex{N}
    sleep(ms: number): Promise<void>;
  }

  routeFocusToColumn(host, targetColumn, opts): Promise<FocusRouteResult>
  // FocusRouteResult = { ok: true } | { ok: false; reason: InjectAbortReason }
```

### 2.3 注入シーケンスと順序保証（fail-closed）

`src/remote/injectionPipeline.ts`（新規）が以下を**直列に**実行する。各ステップは検証成功が次ステップの前提条件であり、固定待ち時間だけを根拠に次へ進む箇所を持たない（要件 a-2。現行の setTimeout 500ms 起点の注入は廃止）。

```
type受信（サーバ検証済: allowInput/型/長さ）
  │
  ├─ [0] 多重注入抑止: injectionInFlight なら即中止（reason: busy）
  │
  ├─ [1] 列の有効性検証: target = server.getSelectedColumn()
  │       tabGroups.all.length を実測し target が範囲外なら中止（reason: columnOutOfRange）
  │
  ├─ [2] Claude Code タブ存在検証: 対象グループ内に isClaudeCodeTab を満たすタブが
  │       無ければ中止（reason: noClaudeTab）
  │
  ├─ [3] フォーカス移動: FOCUS_GROUP_COMMANDS[target] を executeCommand
  │       （target > 7 は [1] で columnOutOfRange として既に中止）
  │
  ├─ [4] フォーカス確定検証（ポーリング）: 50ms間隔で activeTabGroup の index === target を
  │       確認。1500ms 以内に確定しなければ中止（reason: focusUnverified）
  │
  ├─ [5] Claude Code タブ活性化: 対象グループのアクティブタブが Claude Code タブで
  │       なければ workbench.action.openEditorAtIndex{N} で活性化し、tabGroups で
  │       isActive を再検証。検証不能なら中止（reason: noClaudeTab）
  │
  ├─ [6] 直前再検証（TOCTOU窓の最小化）: server.getSelectedColumn() === target かつ
  │       activeTabGroup index === target を再確認。不一致なら中止（reason: stateChanged）
  │       （注入処理中の列切替・グループ削除との競合対策。エッジケース5の競合分岐）
  │
  ├─ [7] クリップボード書込（遅延・復元）: vscode.env.clipboard.writeText(text)。書込は
  │       この位置（前面検査・貼り付けの直前）まで遅らせ、[1]-[6] のいずれかで中止した
  │       経路ではユーザーのクリップボードにリモート入力文字列を残さない。書込前に既存の
  │       クリップボード内容を退避し、注入完了/中止後に復元する（リモート文字列が PC 側の
  │       手動 Cmd+V で別箇所へ漏れる残留リスクを消す）。
  │
  ├─ [8] 前面アプリ検査＋貼り付けの単一 osascript 統合（既存ガードの維持・強化・要件 a-4）:
  │       1回の osascript 内で frontmost プロセスの bundle identifier を取得し、VS Code 系
  │       （com.microsoft.VSCode / com.microsoft.VSCodeInsiders / 開発実行時 com.github.Electron）
  │       に完全一致したときのみ、同一スクリプト内で keystroke "v" using command down →
  │       delay → keystroke return を実行する。一致しなければ貼り付けず中止
  │       （reason: frontAppNotVSCode）。検査と貼り付けを別プロセスに分けない＝検査後〜貼り付け
  │       前に前面アプリが切り替わる TOCTOU 窓を構造的に閉じる。プロセス名の部分一致
  │       （現行の /code|electron|visual studio code/i）は Xcode 等「code」を含む別アプリを
  │       VS Code と誤判定して意図しないアプリへ注入する経路になるため使わず、bundle
  │       identifier の完全一致で判定する（非機能要件「意図しないアプリへの注入をゼロに」の充足）。
  │
  ├─ [9] 外部コマンドのタイムアウト: [8] の osascript・[3]/[5] のコマンド実行は実行上限時間を
  │       設け、アクセシビリティ許可ダイアログ等でハングしても上限超過で中止（reason:
  │       internalError）に倒す。タイムアウトが無いと await が永久に解決せず finally が
  │       走らず injectionInFlight が解放されないため、以後すべての注入が busy で恒久的に
  │       詰まる（feature が沈黙停止する）。
  │
  └─ [10] 結果通知: server.sendInjectResult({ ok, reason?, column: target }) を全接続へ配信
          （成功・中止のいずれでも必ず送る。要件 a-3）
```

**設計上の要点**:
- [4] のポーリングは成功時に初回〜数回（〜100ms）で抜けるため、現行の固定500ms待ちより成功経路は速い。タイムアウト1500msは失敗経路でのみ発生する（非機能要件「応答性」と「誤爆ゼロ優先」の両立。トレードオフは安全側）。
- [8] の前面アプリ検査は現行の callback ネストを promisify して直列パイプラインに組み込むが、現行の「プロセス名の部分一致＋検査と貼り付けを別 exec に分割」は ① Xcode 等の誤マッチ ② 検査後〜貼り付け前の前面アプリ切替 TOCTOU の2経路で誤爆を残すため、bundle identifier 完全一致＋単一 osascript 統合へ**強化する**（要件 a-4「維持」を満たしつつ非機能要件「誤爆ゼロ」へ寄せる強化側変更）。警告表示の文言は変えない。
- 中止時はどのステップでも**注入ゼロ**（クリップボード書込済みでも keystroke を発行しない）＋スマホへ理由通知。クリップボードは [7] で退避済みの内容へ復元する。自動リトライはしない（要件エッジケース2: 再送はユーザー判断）。
- `injectionInFlight` フラグは [0] でセットし [10] の通知送信後に解除する。解除漏れ防止のため try/finally で必ず解除する。外部コマンド（[3]/[5]/[8]）には [9] のタイムアウトを必ず噛ませ、ハングで finally に到達しないデッドロックを防ぐ。
- **既知の残余リスク（現行と同等）**: webview 内部の入力ボックスへの DOM フォーカスは VS Code API から観測できない。本設計の検証境界は「正しい列の Claude Code タブがアクティブグループとして確定していること」までで、webview 内オートフォーカスは Claude Code 側挙動に依存する（現行実装も同じ仮定）。実機 QA（タスク20）で動作確認する。[8] 内の delay の間の競合窓（貼り付け後〜Enter 前に前面アプリが変わる）は単一スクリプト統合後も理論上残るが、検査と貼り付けが同一プロセス・連続実行のため現行（別 exec・500ms固定で無検証）より大幅に縮小。

### 2.4 列数・ラベルの同期（サーバ状態の真実源を tabGroups に変更）

現行は `setColumnCount(totalColumns設定値)` で「設定上の列数」を配っているが、入力先の真実源は実グループ数であるため、**columns メッセージの count を `tabGroups.all.length` に変更**する。

- 同期タイミング: モバイル接続時・`onDidChangeTabGroups`・`onDidChangeTabs`（ラベル追従。要件 b-2受け入れ条件「タブ切替時に追従」）。既存リスナー（extension.ts:300-313, 427-431）に同期呼び出しを足すだけで新規リスナーは増やさない。
- ラベル導出: `deriveColumnLabels(tabs: TabInfo[], count: number): string[]`（純関数・新規）。既存 `updateRemoteTabs()` が構築する TabInfo（groupIndex/label/isActive）から各グループのアクティブタブ label を取り出す。アクティブタブが無いグループは空文字。
- 列減少時の選択列クランプ: `clampSelectedColumn(selected: number, count: number): number`（純関数・サーバ内）で末尾列へ寄せ、columns を即時ブロードキャスト（エッジケース5）。
- 表示クロップ（panelDetector の columns 配列）と count がズレた場合: `captureOnce` の既存ガード `if (col)`（remoteViewServer.ts:242）でフレーム送信スキップとなり、閲覧品質の劣化に留まる（エッジケース1の切り分け）。

---

## 3. プロトコル拡張（src/remote/protocol.ts）

### 3.1 追加・拡張するメッセージ型

```ts
// 中止理由（PC→スマホ）。スマホ側で日本語文言にマッピングする
export type InjectAbortReason =
  | "busy"               // 注入処理中の連打
  | "columnOutOfRange"   // 選択列が実グループ数の範囲外
  | "noClaudeTab"        // 対象列に Claude Code セッションが無い/活性化できない
  | "focusUnverified"    // フォーカス確定検証タイムアウト
  | "frontAppNotVSCode"  // 前面アプリが VS Code でない
  | "stateChanged"       // 注入中に選択列/グループ構成が変わった
  | "internalError";     // コマンド実行例外等

export type ServerMessage =
  | { type: "frame"; data: string }                       // 既存・不変
  | { type: "tabs"; data: TabInfo[] }                     // 既存・不変
  | { type: "viewport"; ... }                             // 既存・不変
  | { type: "columns"; count: number; active: number;     // 既存フィールドは不変
      labels: string[];                                   // 追加: 各列のアクティブタブ名
      allowInput: boolean }                               // 追加: 入力許可状態
  | { type: "injectResult"; ok: boolean;                  // 追加: 注入結果通知
      reason?: InjectAbortReason; column: number };

// ClientMessage は変更なし（type メッセージに列番号を載せない。
// 送信先列はサーバ保持の selectedColumn が単一真実源であり、
// クライアント申告の列番号を信用する経路を作らない＝なりすまし/不整合の排除）
```

### 3.2 互換性

- すべて**追加のみ**（既存メッセージの型・意味は不変）。モバイルHTMLは同一サーバが配信するため版ズレは接続単位で発生しない。未知 type を受けても両者の既存分岐は無視する構造（クライアントは if/else if、サーバは type 別分岐）で後方互換。
- `columns` への `allowInput` 追加により、入力許可OFFを初めてクライアントへ伝達できる（エッジケース3）。サーバ側の type/click/switchTab 破棄（既存防御）はそのまま維持し、UI表示はその上に積む。
- **`labels`（タブ名）はスマホDOMの新しい注入面**: タブ名は実体がエディタのファイル名等であり、ユーザーが `<img src=x onerror=...>` のような名前のファイル/タブを開けば任意文字列がラベルとして全クライアントへ配信される。スマホ側がこれを `innerHTML` で描画すると DOM XSS となり、攻撃者は閲覧者のセッションで `type`/`click` を送出＝リモート操作チャネルを乗っ取れる。よって列バーのラベル・送信先表示・トースト文言など**サーバ由来文字列のDOM挿入は必ず `textContent`（またはエスケープ）で行い、`innerHTML` を使わない**ことを実装制約とする（_common-rules セキュリティ方針「DOM更新は textContent」準拠）。`injectResult.reason` はクライアント内の固定マップ経由で日本語文言へ変換し、サーバ値を直接表示しない（未知 reason は汎用文言へフォールバック）。

### 3.3 サーバ内部APIの追加（remoteViewServer.ts）

```ts
getSelectedColumn(): number                  // 注入パイプラインが参照
setColumns(count: number, labels: string[]): void  // setColumnCount を置換（clamp＋broadcast込み）
sendInjectResult(result: { ok: boolean; reason?: InjectAbortReason; column: number }): void
  // canSendTo を通る全クライアントへ配信（1人運用・全クライアント状態共有の仕様と整合）
```

WS確立時の初期送出（remoteViewServer.ts:423-430）に labels/allowInput を含めた columns を送る（エッジケース6: 再接続直後の状態同期）。

---

## 4. 待ち受け安全化設計（bind 既定の 127.0.0.1 化）

### 4.1 既定値変更の影響範囲

| 箇所 | 変更 |
|---|---|
| `package.json` の `editorSpotlighter.remoteView.bindAddress` | default `"0.0.0.0"` → `"127.0.0.1"`、description を「既定はローカルのみ（トンネル経由向け・安全）。同一LANのスマホから直結する場合は 0.0.0.0 に変更。ただし LAN 直結は平文HTTP（TLS未対応）であり、同一ネットワーク上の第三者にパスワード・セッション・画面が盗聴され得る。可能ならトンネル（HTTPS）経由を推奨」へ更新（平文LANの残リスクを設定UI上で明示） |
| `src/extension.ts:665` の `config.get` フォールバック | `"0.0.0.0"` → `"127.0.0.1"`（package.json と二重定義のため両方変更必須） |
| `src/remote/remoteViewServer.ts:153` `start()` の引数既定 `"0.0.0.0"` | `"127.0.0.1"` へ変更（呼び出し側は常に明示渡しだが、既定値の意味を安全側に統一） |
| 既存コメント（remoteViewServer.ts:169 等「既定は LAN」） | 実態に合わせ更新 |

Cloudflare Tunnel 経由運用: cloudflared は localhost から接続するため 127.0.0.1 待ち受けで動作継続（既存の IP 許可判定 remoteViewServer.ts:516-544 のコメントにも明記済みの動作）。既存の LAN IP 許可リスト判定は**撤去しない**（0.0.0.0 にオプトインした場合の防御として残す。非機能要件「既存防御を弱めない」）。

### 4.2 QR/URL 表示の整合（qrPolicy.ts 新規・純関数）

```ts
decideRemoteAccessDisplay(input: {
  bindAddress: string; tunnelDomain: string; port: number; lanIp: string;
}): 
  | { kind: "tunnel"; url: string }      // tunnelDomain 設定済 → https://{domain}/ の QR（bind不問）
  | { kind: "lan"; url: string }         // LAN待ち受け → http://{lanIp}:{port}/ の QR（従来表示）
  | { kind: "localOnly"; url: string }   // 127.0.0.1待ち受け×トンネル未設定 → QRなし＋案内
```

判定: `tunnelDomain` 非空 → tunnel。`bindAddress` が `127.0.0.1`/`localhost`/`::1` かつ tunnel 未設定 → localOnly。それ以外（`0.0.0.0`・LAN IP 指定）→ lan。

- **localOnly のサイドバー表示**（remoteWebviewProvider.ts に表示状態を追加）: 繋がらない LAN URL の QR を**描画しない**（要件 c-2 受け入れ条件）。代わりに「待ち受けはこの Mac 内のみ（127.0.0.1）。トンネル設定（remoteView.tunnelDomain）または LAN 直結（remoteView.bindAddress を 0.0.0.0）で外部から接続できます」の案内文＋「設定を開く」ボタン（`workbench.action.openSettings` に `editorSpotlighter.remoteView` を渡す）を表示する。パスワード表示・Stop ボタンは従来どおり。
- `extension.ts:770-784` の QR 生成分岐を qrPolicy 呼び出しに置換する。

### 4.3 初回移行案内（c-3）

- `context.globalState` のキー `remoteView.bindMigrationNoticeShown` で1回制御。
- サーバ起動時、`bindAddress` 実効値が 127.0.0.1 系かつ tunnelDomain 未設定かつ未表示なら、`showInformationMessage` で「リモートビューの待ち受け既定がローカルのみに変わりました。LAN 直結（QR読み取り）を使うには設定変更が必要です」＋「設定を開く」アクションを表示し、表示済みフラグを立てる。
- ユーザーが既に bindAddress を明示設定している場合（0.0.0.0 含む）は挙動が変わらないため案内しない。

---

## 5. モバイルUI設計（mobileHtml.ts）

### 5.1 変更箇所

| UI要素 | 現行 | 変更後 |
|---|---|---|
| 列バー `#columnBar` | 固定4ボタン（mobileHtml.ts:181-186）を display 切替 | columns メッセージの count/labels から動的生成。各ボタンは「列番号＋アクティブタブ名（CSS ellipsis で切り詰め）」の2段表示（要件 b-2, b-3）。**ラベルは `textContent` で挿入**（タブ名＝ファイル名は実質ユーザー制御値・innerHTML 禁止。3.2 のDOM注入面対策） |
| 入力欄 `#inputBar` | プレースホルダのみ | 入力欄上部に送信先表示「→ 列N・{タブ名}」を常設（要件 b-1）。タブ名は `textContent` で挿入。allowInput=false 時は入力欄/送信ボタンを disabled＋「閲覧専用」表示（エッジケース3） |
| 画面 `#screen` | フレーム即時差し替え | 列切替中は半透明オーバーレイ「列N に切替中…」を表示し、新フレーム受信で解除（要件 b-4: 旧列画像の誤認防止） |
| 通知 | なし | injectResult 受信でトースト表示（成功:「列N に送信しました」/中止: 理由別の日本語文言）。reason→文言マップをスクリプト内に持ち、サーバ値を直接描画せずマップ経由の固定文言を `textContent` で表示（未知 reason は汎用文言にフォールバック）（要件 a-3） |

### 5.2 クライアント状態遷移

```
[未接続] --WS open--> [同期待ち]（入力disabled・送信先表示「同期中」）
[同期待ち] --columns受信--> [操作可]（active/labels/allowInput反映。エッジケース6:
                              切断前のローカル状態は破棄しサーバ値で上書き）
[操作可] --列タップ--> [切替中]（selectColumn送信・オーバーレイ表示・送信disabled。
                              送信先表示はサーバACK＝columns受信まで更新しない）
[切替中] --columns受信--> 送信先表示更新 --frame受信--> オーバーレイ解除 → [操作可]
[操作可] --送信タップ--> [送信中]（type送信・送信ボタンdisabled）
[送信中] --injectResult受信--> トースト表示 → [操作可]
[送信中] --10s無応答--> 安全側タイムアウト解除（「結果不明・画面で確認してください」表示）→ [操作可]
[任意] --WS close--> 再接続バナー（既存挙動）→ open で [同期待ち] へ
```

- 送信先表示の更新を**サーバACK後のみ**にすることで「表示と送信先の食い違い」を構造的に排除（要件 b-1。エッジケース4: 他クライアントの切替も columns ブロードキャストで同経路同期）。
- [切替中]・[送信中] の間は列タップ・送信を無効化し、注入パイプラインの busy 中止（[0]）と二重の抑止にする。

---

## 6. 要件追跡表

| 要件ID / エッジケース | design.md 該当節 | tasks.md タスク |
|---|---|---|
| a-1 入力先=選択列（claude-vscode.focus 置換） | 2.1, 2.3 [1][3][5] | 2,3,5,8,9 |
| a-2 順序保証・固定待ち廃止・fail-closed | 2.3 [3][4][6]（500ms起点廃止） | 6,7,8 |
| a-3 注入結果フィードバック | 2.3 [10], 3.1 injectResult, 3.2 DOM注入面対策, 5.1 トースト | 1,9,14 |
| a-4 前面アプリ検査の維持・強化 | 2.3 [8]（bundle id 完全一致＋単一osascript統合） | 7,8,20 |
| b-1 閲覧列=送信先列の同一性表示 | 5.1 送信先表示, 5.2（ACK後更新） | 13 |
| b-2 列の識別情報（アクティブタブ名） | 2.4 deriveColumnLabels, 3.1 labels, 5.1 列バー | 10,11,12 |
| b-3 列数の動的追従 | 2.4（count=tabGroups実数）, 5.1 動的生成 | 10,11,12 |
| b-4 切替中表示・旧画像誤認防止 | 5.1 オーバーレイ, 5.2 | 13 |
| c-1 bind 既定 127.0.0.1 化 | 4.1 | 17 |
| c-2 LAN直結オプトイン・繋がらないQR非表示 | 4.2 qrPolicy, localOnly 表示 | 15,16,18 |
| c-3 初回移行案内 | 4.3 globalState 1回表示 | 19 |
| エッジ1 列構成ズレ（真実源=tabGroups・panelDetector閲覧専用） | 1.2, 2.3 [1], 2.4 | 6,7,10 |
| エッジ2 フォーカス確定失敗（注入ゼロ・自動リトライなし） | 2.3 [4]（タイムアウト→中止・リトライなし） | 2,3,6,7 |
| エッジ3 入力許可OFF（サーバ破棄維持＋UI閲覧専用表示） | 3.2, 5.1 | 1,9,14 |
| エッジ4 複数クライアント同時接続（選択列共有・即時同期） | 1.2, 3.3 sendInjectResult, 5.2 | 9,13 |
| エッジ5 列の増減（クランプ・即時配信・競合中止） | 2.4 clamp, 2.3 [1][6] | 6,7,9,10 |
| エッジ6 再接続直後（サーバ状態受信まで入力不可） | 3.3 初期送出, 5.2 同期待ち | 9,14 |
| 非機能: 誤爆防止 fail-closed | 2.3 全ステップ | 2,3,6,7,21 |
| 非機能: 応答性（成功経路は現行500ms固定より高速） | 2.3 [4] ポーリング設計 | 6,7,21 |
| 非機能: 既存閲覧機能の互換 | 1.3（click/switchTab/再接続/切断 無変更） | 20 |
| 非機能: セキュリティ既存ガード維持・bind強化 | 1.3, 4.1（IP許可リスト存置） | 17,20 |

---

## 7. リスク・懸念（プレモーテム）

1. **webview 内入力ボックスのフォーカスは API 検証不能**（2.3 既知の残余リスク）。検証境界を「列とタブの確定」までと定義し、実機 QA（タスク21）で「3列×別セッションで送信→各列のみに入力」の受け入れ条件を直接確認する。
2. **`claudeVSCodePanel` は Claude Code 拡張の内部識別子**であり、将来の拡張更新で変わり得る。判定文字列を1定数に集約し（2.2）、変わった場合は noClaudeTab 中止＝fail-closed に倒れる（誤爆方向には壊れない）。
3. **9グループ以上**は focus コマンドが存在しない（First〜Eighth）。[1] の範囲検証は `min(tabGroups.all.length, 8)` を上限とし、9列目以降の選択は columnOutOfRange で中止する（totalColumns 既定5・実運用上限内）。
4. **`workbench.action.openEditorAtIndex{N}`**（2.3 [5]）も VS Code 本体の安定コマンド（既定キーバインド ctrl+1..9 系列）。コマンドの N はグループ内タブのインデックス指定で、既定キーバインドが1始まりのため `tabIndex` から +1 したコマンドIDを選ぶ（focusRouter のアダプタで1-based 変換）。実在確認はタスク5の実機検証に含める。万一動作しない場合も isActive 再検証で中止に倒れる。

5. **DOM注入面（スマホ側）**: タブ名ラベル・トーストをサーバから配るため、スマホ側で `innerHTML` 描画すると DOM XSS でリモート操作チャネルを乗っ取られる（3.2）。実装制約として全サーバ由来文字列を `textContent` 描画に固定し、タスク11/13/14 のレビューで innerHTML 不使用を確認する。

## 8. 残余リスク（本スコープで塞がない・別タスクの線引き）

| 残余リスク | 重大度 | 本スコープで塞がない理由 | 扱い |
|---|---|---|---|
| LAN 直結時の平文HTTP（TLS未対応）でパスワード・セッション・画面が盗聴され得る | 高（LAN opt-in 時のみ） | 既定 127.0.0.1 化で既定の露出は解消。LAN は明示 opt-in であり、TLS 導入は別系統の大改修（証明書・cloudflared 代替）。設定 description で平文リスクを明示（4.1）し利用者判断に委ねる | 別タスク（TLS/証明書対応）。要件スコープ外に既記載 |
| トンネル経由は全リクエストが 127.0.0.1（cloudflared）として観測され、ログイン失敗ロックアウトが loopback バケットに集約される。攻撃者がトンネル越しに5回失敗させると正規ユーザーも巻き込んでロックアウト（可用性DoS）。逆に IP 許可リストはトンネルトラフィックに対し実質無効（防御はパスワード＋セッションのみ） | 中 | 既存挙動であり本改修で新たに悪化させない。bind 既定変更でトンネルが主経路になるため関連性は上がるが、安全な送信元識別子がトンネル前段に存在せず（ヘッダは詐称可能）即時の安全な是正手段がない | 別タスク（トンネル時のレート制御方式の見直し）。本スコープでは現状維持＋本表に記録 |
| 注入直前のクリップボード退避・復元（[7]）を実装しない場合、リモート入力文字列が PC のクリップボードに残る | 低〜中 | [7] で退避・復元を設計に組み込み済み。退避不能・復元失敗時の挙動（例: 復元前にユーザーが上書き）は完全には保証できない | 本スコープで [7] により最小化。完全保証は対象外 |
| 注入テキスト本文がデバッグログ（/tmp の固定パス）に平文で残り得る | 低 | 注入パイプラインのログにテキスト本文を含めない方針とする（件数・reason のみ）。/tmp 固定パスのスクショ・ログ保存先見直し自体は別タスク | パイプライン実装でテキスト本文を非ログ化（タスク7のレビュー観点）。保存先見直しは別タスク（要件スコープ外に既記載） |
| 公開 vsix へのソースマップ同梱・サーバ自動テスト未整備 | 中 | 要件スコープ外に明記済み。本機能の振る舞いと独立 | 別タスク |
