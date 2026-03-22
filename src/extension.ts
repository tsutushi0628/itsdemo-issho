import * as vscode from "vscode";
import { detectWindowWidth } from "./windowDetector";
import {
  resolveActiveColumns,
  buildPresets,
  Preset,
} from "./presetManager";
import { calculateLayout, applyLayout, LayoutConfig } from "./layoutEngine";
import { TabTreeProvider } from "./tabTreeProvider";

const LEARNED_WIDTH_KEY = "learnedComfortableWidths";
const MAX_LEARNED_ENTRIES = 10;

let enabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let widthDetectTimer: ReturnType<typeof setTimeout> | undefined;

async function recalculateActiveColumns(
  context: vscode.ExtensionContext,
  totalColumns: number,
  configuredActiveColumns: number,
  presets: Preset[]
): Promise<number> {
  if (configuredActiveColumns < totalColumns) {
    return configuredActiveColumns;
  }

  const windowWidth = await detectWindowWidth();

  const learnedWidths = context.globalState.get<number[]>(
    LEARNED_WIDTH_KEY,
    []
  );

  if (learnedWidths.length > 0) {
    let comfortableMinWidth = learnedWidths[0];
    for (let i = 1; i < learnedWidths.length; i++) {
      if (learnedWidths[i] < comfortableMinWidth) {
        comfortableMinWidth = learnedWidths[i];
      }
    }

    if (windowWidth >= comfortableMinWidth) {
      return totalColumns;
    }
  }

  return resolveActiveColumns(windowWidth, totalColumns, presets);
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  enabled = config.get<boolean>("enabled", true);

  // activate時にタブ設定を初期反映
  await applyTabSettings(config);

  let totalColumns = config.get<number>("totalColumns", 4);
  let activeRatio = config.get<number>("activeRatio", 0.35);
  let inactiveRatio = config.get<number>("inactiveRatio", 0.1);
  let configuredActiveColumns = config.get<number>("activeColumns", 4);

  let activeColumns: number;

  const userPresets = config.get<Record<string, number>>("presets", {});
  let presets = buildPresets(userPresets);

  try {
    activeColumns = await recalculateActiveColumns(
      context,
      totalColumns,
      configuredActiveColumns,
      presets
    );
  } catch (error) {
    activeColumns = totalColumns;
    vscode.window.showWarningMessage(
      `Editor Spotlighter: ウィンドウ幅検出に失敗したため等間隔モードで動作します。(${(error as Error).message})`
    );
  }

  const refreshActiveColumns = () => {
    if (widthDetectTimer !== undefined) {
      clearTimeout(widthDetectTimer);
    }

    widthDetectTimer = setTimeout(async () => {
      widthDetectTimer = undefined;

      try {
        const newActiveColumns = await recalculateActiveColumns(
          context,
          totalColumns,
          configuredActiveColumns,
          presets
        );

        if (newActiveColumns !== activeColumns) {
          activeColumns = newActiveColumns;
          onFocusChange();
        }
      } catch {
        // ウィンドウ幅の再検出失敗時は現在のactiveColumnsを維持
      }
    }, 500);
  };

  const onFocusChange = () => {
    if (!enabled) {
      return;
    }

    if (activeColumns >= totalColumns) {
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
      refreshActiveColumns();
      onFocusChange();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((windowState) => {
      if (windowState.focused) {
        refreshActiveColumns();
      }
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
    vscode.commands.registerCommand("editorSpotlighter.alignLayout", async () => {
      await resetToEqual(totalColumns);

      // 学習機能: 現在のウィンドウ幅を「快適な幅」として記録
      try {
        const currentWidth = await detectWindowWidth();
        const learnedWidths = context.globalState.get<number[]>(
          LEARNED_WIDTH_KEY,
          []
        );

        learnedWidths.push(currentWidth);

        // 最大件数を超えた場合は古いものから削除
        if (learnedWidths.length > MAX_LEARNED_ENTRIES) {
          learnedWidths.splice(0, learnedWidths.length - MAX_LEARNED_ENTRIES);
        }

        await context.globalState.update(LEARNED_WIDTH_KEY, learnedWidths);

        vscode.window.showInformationMessage(
          `Editor Spotlighter: レイアウトを整形しました（ウィンドウ幅 ${currentWidth}px を学習）`
        );
      } catch {
        vscode.window.showInformationMessage(
          "Editor Spotlighter: レイアウトを整形しました"
        );
      }
    })
  );

  // TabTreeProvider の登録
  const tabTreeProvider = new TabTreeProvider();
  const treeView = vscode.window.createTreeView("editorSpotlighter.tabList", {
    treeDataProvider: tabTreeProvider,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      tabTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.focusTab",
      async (uri: vscode.Uri) => {
        await vscode.window.showTextDocument(uri, { preview: false });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.closeTab",
      async (treeItem: { tab?: vscode.Tab }) => {
        if (!treeItem.tab) {
          return;
        }
        const input = treeItem.tab.input;
        if (input instanceof vscode.TabInputText) {
          await vscode.window.tabGroups.close(treeItem.tab);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.applyRecommendedSettings",
      async () => {
        const workbenchConfig = vscode.workspace.getConfiguration("workbench.editor");
        const spotlighterConfig = vscode.workspace.getConfiguration("editorSpotlighter");
        try {
          await workbenchConfig.update(
            "openPositioning",
            "right",
            vscode.ConfigurationTarget.Global
          );
          await workbenchConfig.update(
            "enablePreview",
            false,
            vscode.ConfigurationTarget.Global
          );
          // Editor Spotlighter側の設定も一貫性を保つために更新
          await spotlighterConfig.update(
            "openTabBesideActive",
            true,
            vscode.ConfigurationTarget.Global
          );
          await spotlighterConfig.update(
            "disablePreviewMode",
            true,
            vscode.ConfigurationTarget.Global
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Editor Spotlighter: 推奨設定の適用に失敗しました。(${(error as Error).message})`
          );
          throw error;
        }
        vscode.window.showInformationMessage(
          "Editor Spotlighter: 推奨設定を適用しました"
        );
      }
    )
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

      configuredActiveColumns = updated.get<number>("activeColumns", 4);
      const updatedUserPresets = updated.get<Record<string, number>>("presets", {});
      presets = buildPresets(updatedUserPresets);

      if (configuredActiveColumns < totalColumns) {
        activeColumns = configuredActiveColumns;
      } else {
        refreshActiveColumns();
      }

      // タブ設定が変更されたらVSCode本体設定を連動書き換え
      if (
        e.affectsConfiguration("editorSpotlighter.openTabBesideActive") ||
        e.affectsConfiguration("editorSpotlighter.disablePreviewMode")
      ) {
        (async () => {
          try {
            await applyTabSettings(updated);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Editor Spotlighter: タブ設定の適用に失敗しました。(${(error as Error).message})`
            );
            throw error;
          }
        })();
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

  if (widthDetectTimer !== undefined) {
    clearTimeout(widthDetectTimer);
    widthDetectTimer = undefined;
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

async function applyTabSettings(
  config: vscode.WorkspaceConfiguration
): Promise<void> {
  const workbenchConfig = vscode.workspace.getConfiguration("workbench.editor");

  const openTabBesideActive = config.get<boolean>("openTabBesideActive", true);
  if (openTabBesideActive) {
    await workbenchConfig.update(
      "openPositioning",
      "right",
      vscode.ConfigurationTarget.Global
    );
  } else {
    await workbenchConfig.update(
      "openPositioning",
      "last",
      vscode.ConfigurationTarget.Global
    );
  }

  const disablePreviewMode = config.get<boolean>("disablePreviewMode", false);
  if (disablePreviewMode) {
    await workbenchConfig.update(
      "enablePreview",
      false,
      vscode.ConfigurationTarget.Global
    );
  } else {
    await workbenchConfig.update(
      "enablePreview",
      true,
      vscode.ConfigurationTarget.Global
    );
  }
}

