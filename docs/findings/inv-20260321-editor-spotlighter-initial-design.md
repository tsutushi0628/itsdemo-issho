# Editor Spotlighter 初期設計・実装の経緯

## 結論
VSCode拡張「Editor Spotlighter」の初期実装を完了。architect/tech-leadレビューで致命的問題3件を発見・修正済み。ユーザーとの対話で機能要件が大きく進化した。

## 発端
- ユーザーは44インチウルトラワイド / 13インチMacBook Air / 27インチモニターを使い分けている
- 画面サイズに応じてVSCodeのレイアウトを毎回調整するのが面倒
- 既存のVSCode拡張には画面サイズ検知→レイアウト自動切り替え機能が存在しない
- VSCode Extension APIにウィンドウサイズ取得APIがない（GitHub Issue #195406, #208658）

## 技術選定
- macOSの`system_profiler SPDisplaysDataType`でモニター解像度取得（ハック）
- `vscode.setEditorLayout` APIでカラム比率制御
- esbuild（webpack比で高速）、vitest（Jest比で高速）

## レビューで発見した致命的問題
1. setEditorLayoutのリーフノード構造が間違い → `{ groups: [{}], size }` に修正
2. 実グループ数とtotalColumnsのズレ → effectiveTotalColumnsで対応
3. applyLayoutのPromise未ハンドル → async即時関数+catch

## ユーザーとの対話で進化した機能要件

### 当初の想定
- フォーカスしたカラムが自動で広がるアコーディオン動作

### 進化後
1. **レイアウト整形ボタン**（手動トリガー）: エディタアクション（右上）に配置。押すと設定どおりにカラム幅が揃う。その後は自由にドラッグで変更可能
2. **アコーディオン**（自動、画面狭いときだけ）: activeColumns < totalColumnsのときのみ発動。ウルトラワイドでは等間隔のまま
3. **タブサイドバーパネル**: アクティビティバーにESアイコン→サイドバーにカラムごとのタブ一覧TreeView。Firefox/Chromeのタブサイドバー的UX
4. **タブ設定UI**: 設定画面のチェックボックスでopenPositioning/enablePreviewを制御
5. **推奨設定一括適用コマンド**: コマンドパレットからVSCode設定を一発セット

### 重要な設計判断
- 自動リサイズ（onDidChangeActiveTextEditor）はデフォルトoff → ユーザーの自由なレイアウト調整を阻害しない
- アコーディオンは「画面が狭いときだけ」発動する自動モード
- タブ設定はVSCode本体設定のラッパー（二重管理にならない）

## 現在のファイル構成
```
editor-spotlighter/
├── src/
│   ├── extension.ts        # エントリポイント
│   ├── layoutEngine.ts     # レイアウト計算
│   ├── monitorDetector.ts  # macOS解像度検知
│   ├── presetManager.ts    # プリセット管理
│   └── __tests__/          # vitest 15ケース
├── .spec-workflow/specs/editor-spotlighter/
│   ├── product.md, tech.md, structure.md
├── package.json, tsconfig.json, esbuild.config.mjs
```

## 次のアクション
- アクティビティバー+タブサイドバーパネルの実装
- エディタアクションにレイアウト整形ボタン追加
- アコーディオン動作の修正（activeColumns < totalColumnsのときのみ）
- vsixリビルド→再インストール→動作確認
