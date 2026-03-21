import * as vscode from "vscode";
import { detectResolution } from "./monitorDetector";
import { resolveActiveColumns, buildPresets } from "./presetManager";
import { calculateLayout, applyLayout, LayoutConfig } from "./layoutEngine";

let enabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  enabled = config.get<boolean>("enabled", true);

  let totalColumns = config.get<number>("totalColumns", 4);
  let activeRatio = config.get<number>("activeRatio", 0.35);
  let inactiveRatio = config.get<number>("inactiveRatio", 0.1);

  let activeColumns: number;

  const configuredActiveColumns = config.get<number>("activeColumns", 4);
  if (configuredActiveColumns < totalColumns) {
    activeColumns = configuredActiveColumns;
  } else {
    try {
      const resolution = await detectResolution();
      const userPresets = config.get<Record<string, number>>("presets", {});
      const presets = buildPresets(userPresets);
      activeColumns = resolveActiveColumns(
        resolution.width,
        totalColumns,
        presets
      );
    } catch (error) {
      activeColumns = totalColumns;
      vscode.window.showWarningMessage(
        `Editor Spotlighter: 解像度検出に失敗したため等間隔モードで動作します。(${(error as Error).message})`
      );
    }
  }

  const onFocusChange = () => {
    if (!enabled) {
      return;
    }

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;

      const tabGroups = vscode.window.tabGroups;
      const activeGroup = tabGroups.activeTabGroup;

      let focusedGroupIndex = -1;
      const allGroups = tabGroups.all;
      for (let i = 0; i < allGroups.length; i++) {
        if (allGroups[i] === activeGroup) {
          focusedGroupIndex = i;
          break;
        }
      }

      if (focusedGroupIndex < 0) {
        return;
      }

      const actualGroupCount = allGroups.length;
      let effectiveTotalColumns: number;
      if (actualGroupCount !== totalColumns) {
        effectiveTotalColumns = actualGroupCount;
      } else {
        effectiveTotalColumns = totalColumns;
      }

      let effectiveActiveColumns: number;
      if (activeColumns > effectiveTotalColumns) {
        effectiveActiveColumns = effectiveTotalColumns;
      } else {
        effectiveActiveColumns = activeColumns;
      }

      const layoutConfig: LayoutConfig = {
        totalColumns: effectiveTotalColumns,
        activeColumns: effectiveActiveColumns,
        activeRatio,
        inactiveRatio,
      };

      const layout = calculateLayout(layoutConfig, focusedGroupIndex);
      (async () => {
        try {
          await applyLayout(layout);
        } catch (error) {
          vscode.window.showWarningMessage(
            `Editor Spotlighter: レイアウト適用に失敗しました。(${(error as Error).message})`
          );
          throw error;
        }
      })();
    }, 200);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      onFocusChange();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("editorSpotlighter.toggle", async () => {
      enabled = !enabled;
      if (!enabled) {
        await resetToEqual(totalColumns);
      }
      let statusText: string;
      if (enabled) {
        statusText = "有効";
      } else {
        statusText = "無効";
      }
      vscode.window.showInformationMessage(
        `Editor Spotlighter: ${statusText}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.setColumns",
      async () => {
        const input = await vscode.window.showInputBox({
          prompt: "カラム数を入力してください",
          value: String(totalColumns),
        });
        if (input === undefined) {
          return;
        }
        const parsed = parseInt(input, 10);
        if (isNaN(parsed) || parsed < 1) {
          vscode.window.showErrorMessage(
            "Editor Spotlighter: 1以上の整数を入力してください"
          );
          return;
        }
        totalColumns = parsed;
        if (activeColumns > totalColumns) {
          activeColumns = totalColumns;
        }
        onFocusChange();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("editorSpotlighter.resetLayout", async () => {
      await resetToEqual(totalColumns);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("editorSpotlighter")) {
        return;
      }
      const updated = vscode.workspace.getConfiguration("editorSpotlighter");
      enabled = updated.get<boolean>("enabled", true);
      totalColumns = updated.get<number>("totalColumns", 4);
      activeRatio = updated.get<number>("activeRatio", 0.35);
      inactiveRatio = updated.get<number>("inactiveRatio", 0.1);

      const updatedActiveColumns = updated.get<number>("activeColumns", 4);
      if (updatedActiveColumns < totalColumns) {
        activeColumns = updatedActiveColumns;
      }

      onFocusChange();
    })
  );
}

export async function deactivate(): Promise<void> {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }

  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  const totalColumns = config.get<number>("totalColumns", 4);
  await resetToEqual(totalColumns);
}

async function resetToEqual(totalColumns: number): Promise<void> {
  const layoutConfig: LayoutConfig = {
    totalColumns,
    activeColumns: totalColumns,
    activeRatio: 1,
    inactiveRatio: 1,
  };
  const layout = calculateLayout(layoutConfig, 0);
  await applyLayout(layout);
}

