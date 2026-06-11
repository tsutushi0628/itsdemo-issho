import { describe, it, expect } from "vitest";
import {
  isClaudeCodeTab,
  routeFocusToColumn,
  FocusHost,
  GroupSnapshot,
} from "../remote/focusRouter";

// フェイク実装
function makeGroup(tabs: Array<{ isActive: boolean; viewType?: string; isText?: boolean }>): GroupSnapshot {
  return {
    tabs: tabs.map((t) => ({
      isActive: t.isActive,
      input: t.viewType !== undefined
        ? { viewType: t.viewType }
        : t.isText
        ? { uri: "file:///foo.ts" }
        : undefined,
    })),
  };
}

function makeFakeHost(opts: {
  groups: GroupSnapshot[];
  initialActiveIndex?: number;
  focusSetsActiveIndex?: number; // executeCommand 後にアクティブになるグループ index
  openEditorSetsActiveTabIndex?: number; // openEditorAtIndex 後にアクティブになるタブ index
}): FocusHost & { commandsExecuted: string[]; editorIndicesOpened: number[]; sleepMs: number[] } {
  let activeGroupIndex = opts.initialActiveIndex ?? -1;
  const commandsExecuted: string[] = [];
  const editorIndicesOpened: number[] = [];
  const sleepMs: number[] = [];

  return {
    commandsExecuted,
    editorIndicesOpened,
    sleepMs,
    getGroups: () => opts.groups,
    getActiveGroupIndex: () => activeGroupIndex,
    executeCommand: async (id: string) => {
      commandsExecuted.push(id);
      if (opts.focusSetsActiveIndex !== undefined) {
        activeGroupIndex = opts.focusSetsActiveIndex;
      }
    },
    openEditorAtIndex: async (tabIndex: number) => {
      editorIndicesOpened.push(tabIndex);
      if (opts.openEditorSetsActiveTabIndex !== undefined) {
        // タブのisActiveを更新（immutableなので新しいGroupSnapshotに差し替え）
        const targetGroup = opts.groups[activeGroupIndex];
        if (targetGroup) {
          opts.groups[activeGroupIndex] = {
            tabs: targetGroup.tabs.map((t, i) => ({
              ...t,
              isActive: i === (opts.openEditorSetsActiveTabIndex ?? tabIndex),
            })),
          };
        }
      }
    },
    sleep: async (ms: number) => {
      sleepMs.push(ms);
    },
  };
}

describe("isClaudeCodeTab", () => {
  it("viewType が claudeVSCodePanel を含む WebviewTab を真と判定する", () => {
    expect(isClaudeCodeTab({ input: { viewType: "claudeVSCodePanel" } } as any)).toBe(true);
  });

  it("viewType が mainThreadWebview-claudeVSCodePanel の場合も真と判定する", () => {
    expect(isClaudeCodeTab({ input: { viewType: "mainThreadWebview-claudeVSCodePanel" } } as any)).toBe(true);
  });

  it("テキストタブ（uri を持つ）は偽と判定する", () => {
    expect(isClaudeCodeTab({ input: { uri: "file:///foo.ts" } } as any)).toBe(false);
  });

  it("input が undefined のタブは偽と判定する", () => {
    expect(isClaudeCodeTab({ input: undefined } as any)).toBe(false);
  });

  it("viewType が別の webview（claudeVSCodePanel を含まない）は偽と判定する", () => {
    expect(isClaudeCodeTab({ input: { viewType: "someOtherPanel" } } as any)).toBe(false);
  });
});

describe("routeFocusToColumn", () => {
  it("①範囲外の列（存在しないグループ index）は columnOutOfRange を返す", async () => {
    const groups = [
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }]),
    ];
    const host = makeFakeHost({ groups, initialActiveIndex: 0, focusSetsActiveIndex: 0 });
    const result = await routeFocusToColumn(host, 5);
    expect(result).toEqual({ ok: false, reason: "columnOutOfRange" });
  });

  it("⑥ index 8以上（9列目以降）も columnOutOfRange を返す", async () => {
    const groups = Array.from({ length: 9 }, () =>
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }])
    );
    const host = makeFakeHost({ groups, initialActiveIndex: 0, focusSetsActiveIndex: 0 });
    const result = await routeFocusToColumn(host, 8);
    expect(result).toEqual({ ok: false, reason: "columnOutOfRange" });
  });

  it("② Claude Code タブが無いグループは noClaudeTab を返す", async () => {
    const groups = [
      makeGroup([{ isActive: true, isText: true }]),
      makeGroup([{ isActive: true, isText: true }]),
    ];
    const host = makeFakeHost({ groups, initialActiveIndex: 0, focusSetsActiveIndex: 1 });
    const result = await routeFocusToColumn(host, 1);
    expect(result).toEqual({ ok: false, reason: "noClaudeTab" });
  });

  it("③ フォーカスコマンド後にアクティブグループが一致しない（タイムアウト）は focusUnverified を返す", async () => {
    const groups = [
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }]),
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }]),
    ];
    // focusSetsActiveIndex を意図的に不一致にする（グループ0のまま）
    const host = makeFakeHost({ groups, initialActiveIndex: 0, focusSetsActiveIndex: 0 });
    const result = await routeFocusToColumn(host, 1, { pollIntervalMs: 10, timeoutMs: 50 });
    expect(result).toEqual({ ok: false, reason: "focusUnverified" });
  });

  it("④ フォーカス確定後は ok: true を返す", async () => {
    const groups = [
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }]),
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }]),
    ];
    const host = makeFakeHost({ groups, initialActiveIndex: 0, focusSetsActiveIndex: 1 });
    const result = await routeFocusToColumn(host, 1);
    expect(result).toEqual({ ok: true });
  });

  it("⑤ Claude Code タブが非アクティブ時に openEditorAtIndex を呼んで活性化し ok を返す", async () => {
    // グループ1 には claudeCodeTab (index 1) と textTab (index 0) があり、初期は textTab がアクティブ
    const groups = [
      makeGroup([{ isActive: true, viewType: "claudeVSCodePanel" }]),
      makeGroup([
        { isActive: true, isText: true },               // index 0: text tab (active)
        { isActive: false, viewType: "claudeVSCodePanel" }, // index 1: claude tab (inactive)
      ]),
    ];
    const host = makeFakeHost({
      groups,
      initialActiveIndex: 0,
      focusSetsActiveIndex: 1,
      openEditorSetsActiveTabIndex: 1, // index 1 のタブをアクティブにする
    });
    const result = await routeFocusToColumn(host, 1);
    expect(result).toEqual({ ok: true });
    // openEditorAtIndex が呼ばれたことを確認
    expect(host.editorIndicesOpened.length).toBeGreaterThan(0);
  });

  it("⑦ isClaudeCodeTab が claudeVSCodePanel を含む viewType を正しく判定する（回帰）", () => {
    // design 2.2 の判定定数の回帰確認（上位 describe の個別テストと重複するため1本に集約）
    expect(isClaudeCodeTab({ input: { viewType: "claudeVSCodePanel" } } as any)).toBe(true);
  });
});
