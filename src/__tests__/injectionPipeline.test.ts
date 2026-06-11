import { describe, it, expect } from "vitest";
import { runInjectionPipeline, InjectionDeps } from "../remote/injectionPipeline";
import { InjectAbortReason } from "../remote/protocol";

function makeDeps(overrides: Partial<InjectionDeps> = {}): InjectionDeps & {
  clipboardWritten: string[];
  clipboardRestored: string[];
  injectResults: Array<{ ok: boolean; reason?: InjectAbortReason; column: number }>;
  pasteAndEnterCalled: boolean[];
} {
  const clipboardWritten: string[] = [];
  const clipboardRestored: string[] = [];
  const focusResultsQueue: Array<{ ok: true } | { ok: false; reason: InjectAbortReason }> = [
    { ok: true },
  ];
  const injectResults: Array<{ ok: boolean; reason?: InjectAbortReason; column: number }> = [];
  const pasteAndEnterCalled: boolean[] = [];

  return {
    clipboardWritten,
    clipboardRestored,
    injectResults,
    pasteAndEnterCalled,

    getSelectedColumn: () => 0,
    getGroupCount: () => 3,
    routeFocus: async () => {
      const result = focusResultsQueue.shift() ?? { ok: true };
      return result;
    },
    getActiveGroupIndex: () => 0,
    readClipboard: async () => "ORIGINAL",
    writeClipboard: async (text) => { clipboardWritten.push(text); },
    restoreClipboard: async (text) => { clipboardRestored.push(text); },
    pasteAndEnter: async () => {
      pasteAndEnterCalled.push(true);
    },
    sendInjectResult: (result) => { injectResults.push(result); },
    ...overrides,
  };
}

describe("runInjectionPipeline", () => {
  it("[0] 2発目の注入は busy を返す（多重注入抑止）", async () => {
    // 最初の注入を開始した状態で2発目を送る
    let secondResult: { ok: boolean; reason?: InjectAbortReason; column: number } | undefined;
    let pasteResolve: () => void;
    const pausedPaste = new Promise<void>((resolve) => { pasteResolve = resolve; });

    const deps = makeDeps({
      pasteAndEnter: async () => {
        await pausedPaste; // 1発目を途中で止める
      },
      sendInjectResult: (result) => {
        secondResult = result;
      },
    });

    const first = runInjectionPipeline("hello", deps);
    // 1発目が走っている間に2発目を開始
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const secondDeps = makeDeps({
      sendInjectResult: (result) => {
        secondResult = result;
      },
    });
    await runInjectionPipeline("world", secondDeps);
    expect(secondResult).toMatchObject({ ok: false, reason: "busy" });

    pasteResolve!();
    await first;
  });

  it("[1] 選択列が実グループ数の範囲外なら columnOutOfRange", async () => {
    const deps = makeDeps({
      getSelectedColumn: () => 5,
      getGroupCount: () => 3,
    });
    await runInjectionPipeline("hi", deps);
    expect(deps.injectResults[0]).toMatchObject({ ok: false, reason: "columnOutOfRange" });
  });

  it("[2][3] フォーカス失敗（noClaudeTab）時は貼り付け未発行＋injectResult通知", async () => {
    const deps = makeDeps({
      routeFocus: async () => ({ ok: false, reason: "noClaudeTab" as const }),
    });
    await runInjectionPipeline("hi", deps);
    expect(deps.pasteAndEnterCalled).toHaveLength(0);
    expect(deps.injectResults[0]).toMatchObject({ ok: false, reason: "noClaudeTab" });
  });

  it("[4] フォーカス確定失敗（focusUnverified）時は貼り付け未発行＋injectResult通知", async () => {
    const deps = makeDeps({
      routeFocus: async () => ({ ok: false, reason: "focusUnverified" as const }),
    });
    await runInjectionPipeline("hi", deps);
    expect(deps.pasteAndEnterCalled).toHaveLength(0);
    expect(deps.injectResults[0]).toMatchObject({ ok: false, reason: "focusUnverified" });
  });

  it("[6] 直前再検証で列変化（selectedColumn != target）→ stateChanged + 貼り付け未発行", async () => {
    let callCount = 0;
    const deps = makeDeps({
      getSelectedColumn: () => {
        callCount++;
        // 初回（有効性検証）は 0 を返し、直前再検証時（2回目以降）は別の値を返す
        return callCount <= 1 ? 0 : 1;
      },
    });
    await runInjectionPipeline("hi", deps);
    expect(deps.pasteAndEnterCalled).toHaveLength(0);
    expect(deps.injectResults[0]).toMatchObject({ ok: false, reason: "stateChanged" });
  });

  it("[6] 直前再検証で activeGroupIndex != target → stateChanged", async () => {
    const deps = makeDeps({
      getActiveGroupIndex: () => 99, // 不一致
    });
    await runInjectionPipeline("hi", deps);
    expect(deps.pasteAndEnterCalled).toHaveLength(0);
    expect(deps.injectResults[0]).toMatchObject({ ok: false, reason: "stateChanged" });
  });

  it("[7] クリップボード書込は再検証[6]通過後のみ発生する（中止経路では書込なし）", async () => {
    const deps = makeDeps({
      routeFocus: async () => ({ ok: false, reason: "noClaudeTab" as const }),
    });
    await runInjectionPipeline("secret text", deps);
    expect(deps.clipboardWritten).toHaveLength(0);
  });

  it("[7] 中止後にクリップボードが退避内容へ復元される", async () => {
    const deps = makeDeps({
      getActiveGroupIndex: () => 99, // stateChanged で中止
    });
    await runInjectionPipeline("secret text", deps);
    // 書込なし → 復元もなし（クリップボードに触れていない）
    expect(deps.clipboardWritten).toHaveLength(0);
    expect(deps.clipboardRestored).toHaveLength(0);
  });

  it("成功時: 貼り付け発行＋ok 通知＋クリップボードを退避内容で復元", async () => {
    const deps = makeDeps();
    await runInjectionPipeline("hello world", deps);
    expect(deps.pasteAndEnterCalled).toHaveLength(1);
    expect(deps.injectResults[0]).toMatchObject({ ok: true, column: 0 });
    // クリップボードに書いた後、ORIGINAL に戻す
    expect(deps.clipboardWritten).toContain("hello world");
    expect(deps.clipboardRestored).toContain("ORIGINAL");
  });

  it("[8] pasteAndEnter が frontAppNotVSCode を返したとき中止通知", async () => {
    const deps = makeDeps({
      pasteAndEnter: async () => {
        throw Object.assign(new Error("front app not vscode"), { reason: "frontAppNotVSCode" });
      },
    });
    await runInjectionPipeline("hi", deps);
    expect(deps.injectResults[0]).toMatchObject({ ok: false });
  });

  it("例外時も in-flight フラグが解除され次の注入が受け付けられる（[9] デッドロック防止）", async () => {
    const deps1 = makeDeps({
      pasteAndEnter: async () => { throw new Error("unexpected"); },
      sendInjectResult: () => {},
    });
    await runInjectionPipeline("first", deps1);

    // 次の注入が busy にならないことを確認
    const deps2 = makeDeps();
    await runInjectionPipeline("second", deps2);
    expect(deps2.injectResults[0]).toMatchObject({ ok: true });
  });

  it("全中止理由で injectResult が必ず送信される（a-3）", async () => {
    const reasons: InjectAbortReason[] = [
      "columnOutOfRange",
      "noClaudeTab",
      "focusUnverified",
      "stateChanged",
    ];
    for (const reason of reasons) {
      let deps: ReturnType<typeof makeDeps>;
      switch (reason) {
        case "columnOutOfRange":
          deps = makeDeps({ getSelectedColumn: () => 99 });
          break;
        case "noClaudeTab":
        case "focusUnverified":
          deps = makeDeps({ routeFocus: async () => ({ ok: false, reason }) });
          break;
        case "stateChanged":
          deps = makeDeps({ getActiveGroupIndex: () => 99 });
          break;
        default:
          throw new Error(`Unhandled reason: ${reason}`);
      }
      await runInjectionPipeline("hi", deps);
      expect(deps.injectResults).toHaveLength(1);
      expect(deps.injectResults[0].ok).toBe(false);
    }
  });
});
