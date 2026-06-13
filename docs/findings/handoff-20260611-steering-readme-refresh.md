# 引継書: Steering3点刷新 & README新規作成

- 対象リポジトリ: editor-spotlighter
- セッション種別: ドキュメント刷新（コード変更ゼロ）
- 作成日: 2026-06-13

---

## 概要

Steering3点（product.md / tech.md / structure.md）が実装に追従していない状態を解消し、README.mdを新規作成したセッション。前回セッション（QR自動ログイン＋画面自動更新）で機能実装が完了したことを受け、ドキュメントを実コードと突合・全面更新した。

---

## 整備した内容

### 課題

- 既存Steering3点が実装に追従しておらず、新規モジュール（src/sidebarPolicy.ts・src/remote/qrPolicy.ts・focusRouter.ts・injectionPipeline.ts）がディレクトリ図に欠落
- 「イベント駆動キャプチャ」等の旧記述が残存
- カラム単位リモート操作・QR自動ログイン・画面自動更新が未反映
- README.md が存在しなかった

### 対応フロー

Workflow で3フェーズ・計12エージェントを実行:

1. 実コード精査（4観点: レイアウト系／リモート系／マニフェスト設定ビルドテスト／既存乖離監査）
2. product.md / tech.md / structure.md / README.md の並列生成
3. 各ドキュメントを実コードと突合する検証（4観点）

### 各ドキュメントの更新内容

**product.md**
Product Purpose / Target Users / Key Features（10項目）/ Business Objectives / Success Metrics / Product Principles（7項目）/ Future Vision / Known Limitations に全面再生成。

**tech.md**
Architecture を現存全モジュール（src直下7＋src/remote配下8）で再構成。Decision Log を現行設計（ピクセルベース計算・読み戻し自己回復・接続中定期キャプチャ+二段ハッシュ変化検知・bundle identifier完全一致注入・QRフラグメント鍵・bind既定127.0.0.1）に更新。Known Limitations 拡充。

**structure.md**
Directory Layout を実ツリー（src直下・src/remote・__tests__全10ファイル・column-remote-control spec）に更新。Commands表を package.json 全コマンドと一致させた。

**README.md（新規・約157行）**
タイトル＋概要 / 主な機能 / インストール（npm install→build→ローカル拡張フォルダ自動配置→リロード・Marketplace未公開）/ 使い方 / 設定一覧（全 editorSpotlighter.* キーを既定値付き表）/ コマンド一覧（全コマンドID表）/ リモートビュー（起動手順・QR/パスワード/自動ログイン・閲覧と操作・画面自動更新・セキュリティ注意）/ ビルドとテスト / 対応プラットフォーム / 開発（モジュール要約）。日本語。

### 実コード突合検証で検出・修正した不一致（全て low・修正済み）

| # | 検出内容 | 修正対象 |
|---|---|---|
| 1 | fullWidthThreshold の境界は「超」でなく「以上」（src/columnCalculator.ts:41 が `>=`） | product.md の表記訂正 |
| 2 | アコーディオンのフォーカス履歴は「FIFO」でなく MRU保持＋最古退避（src/extension.ts:287-291 が `unshift`＋`slice(0, activeColumns)`） | product.md / tech.md / README.md の呼称を振る舞い表現に訂正 |
| 3 | リモートビュー起動中のステータスバー項目（src/extension.ts:841 が `$(remote) Remote: {port}` 表示・クリックで stopRemoteView） | README リモートビュー起動手順に追記 |
| 4 | structure.md の Directory Layout に README.md が欠落 | 追記（.vsix は .gitignore 対象のため非掲載が正） |

---

## コミット一覧

| SHA | メッセージ |
|---|---|
| ca280cd | docs(steering): Steering3点を現行の構成・振る舞いに全面更新 |
| d5d7603 | docs(readme): READMEを新規作成 |

両コミットとも origin/main 反映済み。

前提コミット（参照用）:

| SHA | メッセージ |
|---|---|
| 325975d | QR自動ログイン＋画面自動更新（前セッション実装） |
| 79a5975 | 前回引継書 |

---

## 本番稼働状況

- Marketplace公開なし（ローカルインストール運用）
- 本セッションはドキュメントのみの変更でコード・ビルドへの影響なし

---

## 動作確認済み項目

### 形式整合層（確認済み）

- 実コード突合検証4観点（product / tech / structure / README）を通過
- tech.md: issues 0
- product.md / structure.md / README.md: low 指摘のみで全て修正済み
- FIFO呼称の全消しをメインが横断 grep で最終確認（検出ゼロ）
- 機密（本名・個人絶対パス・秘密値）検出ゼロをメインが grep で最終確認

### 意味価値層（未実施）

- ドキュメントの読み手（次に触る開発者）にとって過不足ないかのオーナー目視は未実施

---

## 既知の注意点・未対応項目

1. **【最優先・次セッション冒頭】** スマホ実機でのQR自動ログイン＋画面自動更新のend-to-end目視（前セッションから継続）。手順: ウィンドウリロード → 新QRをスマホで読む → パスワード入力なしでログイン → 画面が約1.5秒ごとに更新・操作直後に即反映。リロードはオーナーが行う。
2. カラム単位リモート操作のタスク20-21（実機回帰・3列以上の実機E2E）が未実施。
3. Steering/READMEは実装変更のたびに追従が要る。今後コード機能を追加する際は同一セッションでドキュメントも更新する運用が望ましい。
4. リモートサーバ（remoteViewServer.ts）の認証・セッション失効・ロックアウトにはサーバ自動テストが依然なし（純関数テストのみ）。
5. 平文LAN経路のTLS未対応・スクショ/tmp固定パス・公開vsixへのソースマップ/ドキュメント同梱は従来からの既知残課題。

残置（今回も触っていない）: `.mcp.json`（前セッション以前からの未コミット残置・本セッションのスコープ外）。

---

## 開発中に得た教訓

### 教訓1: ドキュメント検証は観点別エージェントだけでは用語レベルの不一致を拾えない

何が起きたか: 実コード突合検証でtech.mdは「accurate（issues 0）」と判定されたが、FIFO呼称の不正確さは検証観点（ファイル/コマンド/設定キーの実在＋主要振る舞い）の外で見逃された。メインが全ドキュメント横断の grep 全消し確認をして初めて捕捉した。

再発防止: ドキュメント検証では観点別エージェントに加え、用語・呼称（データ構造名・境界条件の「超/以上」等）の横断 grep をメインが最後に必ず回す。

反映先候補: プロジェクト固有度が高く本引継書に留める。

### 教訓2: Workflowの生成エージェントが書いた直後のファイルはEditが弾かれる

何が起きたか: 生成エージェントが出力したファイルをメインが直後にEditしようとすると「File has been modified since read」エラーが発生した。

再発防止: Workflow生成直後のファイルは編集前に必ず再Readする。

反映先候補: ツール仕様の運用知。wasurenagusa/引継書に留める（恒久ルール化不要）。

---

## 次セッションへの引継指示（優先順）

1. **【最優先】** スマホ実機でのQR自動ログイン＋画面自動更新のend-to-end目視（前セッションから継続・手順は「既知の注意点1」）。リロード後にメインがデバッグログ（/tmp/editor-spotlighter-debug.log）で接続・キャプチャ挙動を裏取りする。
2. カラム単位リモート操作のタスク20-21（実機回帰・3列以上の実機E2E）。
3. （要望あれば）MacBook Air向けカラム数自動削減・固定パスワード時のQR埋め込みスキップ。
4. 今後コード機能を追加する際はSteering/READMEを同一セッションで更新する。
