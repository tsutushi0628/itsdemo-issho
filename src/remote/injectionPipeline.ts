import { InjectAbortReason } from "./protocol";
import { FocusRouteResult } from "./focusRouter";

// 注入処理の依存を注入可能なインターフェースとして定義（vitest 用・vscode 非依存）
export interface InjectionDeps {
  getSelectedColumn(): number;
  getGroupCount(): number;
  routeFocus(targetColumn: number): Promise<FocusRouteResult>;
  getActiveGroupIndex(): number;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  restoreClipboard(text: string): Promise<void>;
  // 前面アプリ検査と貼り付けを単一 osascript に統合した処理（design 2.3 [8]）
  // bundle identifier 完全一致で VS Code 系か確認し、貼り付け+Enter を発行する
  // 失敗時は Error をスローする（reason プロパティ付きの場合は InjectAbortReason として扱う）
  pasteAndEnter(): Promise<void>;
  sendInjectResult(result: { ok: boolean; reason?: InjectAbortReason; column: number }): void;
}

// 多重注入抑止フラグ（モジュールスコープで単一保持）
let injectionInFlight = false;

/**
 * 注入パイプライン（design 2.3 [0]-[10]）を直列に実行する。
 * 各ステップは検証成功が次ステップの前提条件。fail-closed 設計。
 */
export async function runInjectionPipeline(
  text: string,
  deps: InjectionDeps
): Promise<void> {
  // [0] 多重注入抑止
  if (injectionInFlight) {
    deps.sendInjectResult({ ok: false, reason: "busy", column: deps.getSelectedColumn() });
    return;
  }
  injectionInFlight = true;

  const targetColumn = deps.getSelectedColumn();

  try {
    // [1] 列の有効性検証
    const groupCount = deps.getGroupCount();
    if (targetColumn < 0 || targetColumn >= groupCount) {
      deps.sendInjectResult({ ok: false, reason: "columnOutOfRange", column: targetColumn });
      return;
    }

    // [2]-[5] フォーカス移動と確定検証（focusRouter に委譲）
    const focusResult = await deps.routeFocus(targetColumn);
    if (!focusResult.ok) {
      deps.sendInjectResult({ ok: false, reason: focusResult.reason, column: targetColumn });
      return;
    }

    // [6] 直前再検証（TOCTOU 窓の最小化）
    const currentColumn = deps.getSelectedColumn();
    const activeGroupIndex = deps.getActiveGroupIndex();
    if (currentColumn !== targetColumn || activeGroupIndex !== targetColumn) {
      deps.sendInjectResult({ ok: false, reason: "stateChanged", column: targetColumn });
      return;
    }

    // [7] クリップボード退避と書込（再検証通過後のみ・中止経路ではクリップボードに触れない）
    const savedClipboard = await deps.readClipboard();
    await deps.writeClipboard(text);

    try {
      // [8] 前面アプリ検査＋貼り付け（単一 osascript 統合・bundle id 完全一致）
      await deps.pasteAndEnter();

      // [10] 成功通知
      deps.sendInjectResult({ ok: true, column: targetColumn });
    } catch (err) {
      // pasteAndEnter が reason プロパティ付きで throw した場合はその理由を使う
      const errWithReason = err as { reason?: InjectAbortReason };
      const reason: InjectAbortReason = errWithReason.reason ?? "internalError";
      deps.sendInjectResult({ ok: false, reason, column: targetColumn });
    } finally {
      // クリップボードを退避内容へ復元（成功・中止のいずれでも）。
      // 復元失敗は通知済みの ok/reason を覆さない。件数のみ記録（B-6）。
      try {
        await deps.restoreClipboard(savedClipboard);
      } catch {
        // restoreClipboard 失敗: injectResult は送出済みのためここでは送らない
        console.warn("[editor-spotlighter] clipboard restore failed: 1 occurrence");
      }
    }
  } catch {
    // 予期しない例外: internalError で中止通知
    try {
      deps.sendInjectResult({ ok: false, reason: "internalError", column: targetColumn });
    } catch {
      // sendInjectResult 自体が失敗する場合は無視（最低限 in-flight 解除を保証）
    }
  } finally {
    // [9] in-flight フラグは try/finally で必ず解除（ハング時のデッドロック防止）
    injectionInFlight = false;
  }
}

// bundle identifier 完全一致で VS Code 系か確認し、同一スクリプト内で貼り付け+Enter。
// モジュール定数として1回だけ構築する（B-10）。
// AppleScript の正式属性名は "bundle identifier"（"bundleID" は存在しない）。
// missing value 対策: bundle identifier が取得できない場合は "ABORT:unknown" を返す（B-11）。
const VSCODE_BUNDLE_IDS = [
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.github.Electron", // 開発実行時
];
const _idChecks = VSCODE_BUNDLE_IDS.map((id) =>
  `  if frontBundleId is "${id}" then\n` +
  `    keystroke "v" using command down\n` +
  `    delay 0.3\n` +
  `    keystroke return\n` +
  `    return\n` +
  `  end if`
).join("\n");

export const PASTE_OSASCRIPT = [
  `tell application "System Events"`,
  // frontmost プロセスの bundle identifier を変数に一度だけ取得（TOCTOU 窓解消）。
  // missing value（取得不能）の場合は型エラーを防ぐため "unknown" にフォールバック（B-11）。
  `  set rawId to bundle identifier of first application process whose frontmost is true`,
  `  if rawId is missing value then`,
  `    set frontBundleId to "unknown"`,
  `  else`,
  `    set frontBundleId to rawId`,
  `  end if`,
  _idChecks,
  // いずれにも一致しない場合は中止（貼り付けず終了）
  `  set abortMsg to "ABORT:" & frontBundleId`,
  `  return abortMsg`,
  `end tell`,
].join("\n");

const PASTE_TIMEOUT_MS = 5000;

/**
 * vscode 環境用の InjectionDeps 実装を生成するファクトリ。
 * pasteAndEnter は bundle identifier 完全一致で VS Code 系か確認する単一 osascript を使う。
 * 注入テキスト本文はログに残さない（件数・reason のみ）。
 * サーバ起動時に1回だけ呼ぶ（B-10）。
 */
export function createVSCodeInjectionDeps(opts: {
  getSelectedColumn: () => number;
  getGroupCount: () => number;
  routeFocus: (col: number) => Promise<FocusRouteResult>;
  getActiveGroupIndex: () => number;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  showWarning: (msg: string) => void;
  execWithTimeout: (cmd: string, timeoutMs: number) => Promise<string>;
  sendInjectResult: (result: { ok: boolean; reason?: InjectAbortReason; column: number }) => void;
}): InjectionDeps {
  return {
    getSelectedColumn: opts.getSelectedColumn,
    getGroupCount: opts.getGroupCount,
    routeFocus: opts.routeFocus,
    getActiveGroupIndex: opts.getActiveGroupIndex,
    readClipboard: opts.readClipboard,
    writeClipboard: opts.writeClipboard,
    restoreClipboard: async (text: string) => {
      await opts.writeClipboard(text);
    },
    pasteAndEnter: async () => {
      let output: string;
      try {
        output = await opts.execWithTimeout(`osascript -e '${PASTE_OSASCRIPT}'`, PASTE_TIMEOUT_MS);
      } catch (err) {
        opts.showWarning(
          "Editor Spotlighter: テキスト送信にはアクセシビリティ権限が必要です。システム設定 → プライバシーとセキュリティ → アクセシビリティ で Visual Studio Code を許可してください。"
        );
        throw Object.assign(new Error("osascript error"), { reason: "internalError" as InjectAbortReason });
      }

      if (output.startsWith("ABORT:")) {
        const bundleId = output.slice("ABORT:".length).trim();
        opts.showWarning(
          `Editor Spotlighter: 前面アプリ（${bundleId}）がVS Codeでないため、リモート入力を中止しました。`
        );
        throw Object.assign(new Error("front app not vscode"), { reason: "frontAppNotVSCode" as InjectAbortReason });
      }
    },
    sendInjectResult: opts.sendInjectResult,
  };
}
