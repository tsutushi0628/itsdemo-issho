// vscode の型のみインポート（実行時は vscode 本体が注入される）
import type * as vscode from "vscode";
import { InjectAbortReason } from "./protocol";

// VS Code 標準コマンド: エディタグループ index 0-7 → focusFirst..EighthEditorGroup
export const FOCUS_GROUP_COMMANDS: string[] = [
  "workbench.action.focusFirstEditorGroup",
  "workbench.action.focusSecondEditorGroup",
  "workbench.action.focusThirdEditorGroup",
  "workbench.action.focusFourthEditorGroup",
  "workbench.action.focusFifthEditorGroup",
  "workbench.action.focusSixthEditorGroup",
  "workbench.action.focusSeventhEditorGroup",
  "workbench.action.focusEighthEditorGroup",
];

// Claude Code タブの判定に使う文字列定数（実機確認後に差し替え可能）
const CLAUDE_CODE_PANEL_VIEW_TYPE = "claudeVSCodePanel";

// タブの最小表現（FocusHost から取得する写像）
export interface TabSnapshot {
  isActive: boolean;
  input?: { viewType?: string; uri?: string };
}

// エディタグループの最小写像
export interface GroupSnapshot {
  tabs: TabSnapshot[];
}

// vscode を注入可能にする境界（vitest 用）
export interface FocusHost {
  getGroups(): GroupSnapshot[];
  getActiveGroupIndex(): number;
  executeCommand(id: string): Promise<void>;
  openEditorAtIndex(tabIndex: number): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export type FocusRouteResult = { ok: true } | { ok: false; reason: InjectAbortReason };

export interface FocusRouteOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 1500;

/**
 * vscode を注入可能な FocusHost の本番実装（薄いアダプタ。ロジックを持たない）。
 * vscode.window.tabGroups を GroupSnapshot に写像し、コマンド実行を委譲する。
 */
export function createVSCodeFocusHost(vs: typeof vscode): FocusHost {
  return {
    getGroups(): GroupSnapshot[] {
      return vs.window.tabGroups.all.map((group) => ({
        tabs: group.tabs.map((tab) => {
          // TabInputWebview は viewType を持つ
          const input = tab.input as { viewType?: string; uri?: { toString(): string } } | undefined;
          return {
            isActive: tab.isActive,
            input: input
              ? { viewType: (input as any).viewType, uri: (input as any).uri?.toString() }
              : undefined,
          };
        }),
      }));
    },
    getActiveGroupIndex(): number {
      const all = vs.window.tabGroups.all;
      const active = vs.window.tabGroups.activeTabGroup;
      return all.indexOf(active);
    },
    async executeCommand(id: string): Promise<void> {
      await vs.commands.executeCommand(id);
    },
    async openEditorAtIndex(tabIndex: number): Promise<void> {
      // workbench.action.openEditorAtIndex は 1-based
      await vs.commands.executeCommand(`workbench.action.openEditorAtIndex${tabIndex + 1}`);
    },
    async sleep(ms: number): Promise<void> {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    },
  };
}

/**
 * タブが Claude Code タブかどうかを判定する。
 * TabInputWebview の viewType が CLAUDE_CODE_PANEL_VIEW_TYPE を含む場合に真。
 */
export function isClaudeCodeTab(tab: { input?: { viewType?: string; uri?: string } }): boolean {
  if (!tab.input) return false;
  const { viewType } = tab.input;
  if (typeof viewType !== "string") return false;
  return viewType.includes(CLAUDE_CODE_PANEL_VIEW_TYPE);
}

/**
 * 指定列へのフォーカス移動と確定検証を行う。
 * フォーカス確定が検証できない場合や Claude タブが無い場合は fail-closed で中止。
 * design 2.3 [1]-[5] を担当する。
 */
export async function routeFocusToColumn(
  host: FocusHost,
  targetColumn: number,
  opts?: FocusRouteOptions
): Promise<FocusRouteResult> {
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // [1] 列の有効性検証（FOCUS_GROUP_COMMANDS の上限 7 = 8列分）
  const groups = host.getGroups();
  if (targetColumn < 0 || targetColumn >= groups.length || targetColumn >= FOCUS_GROUP_COMMANDS.length) {
    return { ok: false, reason: "columnOutOfRange" };
  }

  // [2] Claude Code タブ存在検証
  const targetGroup = groups[targetColumn];
  const hasClaudeTab = targetGroup.tabs.some(isClaudeCodeTab);
  if (!hasClaudeTab) {
    return { ok: false, reason: "noClaudeTab" };
  }

  // [3] フォーカス移動
  await host.executeCommand(FOCUS_GROUP_COMMANDS[targetColumn]);

  // [4] フォーカス確定検証（ポーリング）
  const start = Date.now();
  while (true) {
    const currentIndex = host.getActiveGroupIndex();
    if (currentIndex === targetColumn) break;
    if (Date.now() - start >= timeoutMs) {
      return { ok: false, reason: "focusUnverified" };
    }
    await host.sleep(pollIntervalMs);
  }

  // [5] Claude Code タブ活性化: アクティブタブが Claude Code タブでなければ活性化
  const updatedGroups = host.getGroups();
  const updatedGroup = updatedGroups[targetColumn];
  const activeTab = updatedGroup.tabs.find((t) => t.isActive);
  if (!activeTab || !isClaudeCodeTab(activeTab)) {
    // Claude Code タブの index を特定して openEditorAtIndex で活性化
    const claudeTabIndex = updatedGroup.tabs.findIndex(isClaudeCodeTab);
    if (claudeTabIndex < 0) {
      return { ok: false, reason: "noClaudeTab" };
    }
    await host.openEditorAtIndex(claudeTabIndex);

    // タブ活性化の非同期反映ラグに対応するため [4] と同じ間隔・最大 500ms でポーリング再検証。
    // タイムアウト時は fail-closed で noClaudeTab として中止。
    const TAB_ACTIVATE_TIMEOUT_MS = 500;
    const tabStart = Date.now();
    while (true) {
      const afterOpen = host.getGroups();
      const afterGroup = afterOpen[targetColumn];
      const afterActiveTab = afterGroup.tabs.find((t) => t.isActive);
      if (afterActiveTab && isClaudeCodeTab(afterActiveTab)) break;
      if (Date.now() - tabStart >= TAB_ACTIVATE_TIMEOUT_MS) {
        return { ok: false, reason: "noClaudeTab" };
      }
      await host.sleep(pollIntervalMs);
    }
  }

  return { ok: true };
}
