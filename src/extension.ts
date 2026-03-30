import * as vscode from "vscode";
import * as os from "os";
import { exec } from "child_process";
import QRCode from "qrcode";
import { detectWindowWidth } from "./windowDetector";
import { computeActiveColumns } from "./columnCalculator";
import { calculateLayout, applyLayout, LayoutConfig } from "./layoutEngine";
import { TabTreeProvider } from "./tabTreeProvider";
import { RemoteViewServer } from "./remote/remoteViewServer";
import { RemoteWebviewProvider } from "./remoteWebviewProvider";

let enabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let remoteServer: RemoteViewServer | null = null;
let remoteStatusBarItem: vscode.StatusBarItem | null = null;
let remoteWebviewProvider: RemoteWebviewProvider | null = null;
let mobileConnected = false;

async function recalculateActiveColumns(
  totalColumns: number,
  minColumnWidth: number,
  fullWidthThreshold: number
): Promise<number> {
  const windowWidth = await detectWindowWidth();
  return computeActiveColumns(windowWidth, minColumnWidth, totalColumns, fullWidthThreshold);
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Editor Spotlighter");
  outputChannel.appendLine("=== Editor Spotlighter activated ===");

  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  enabled = config.get<boolean>("enabled", true);


  // activate時にタブ設定を初期反映
  await applyTabSettings(config);

  let totalColumns = config.get<number>("totalColumns", 4);
  let activeRatio = config.get<number>("activeRatio", 0.35);
  let inactiveRatio = config.get<number>("inactiveRatio", 0.1);
  let minColumnWidth = config.get<number>("minColumnWidth", 850);
  let fullWidthThreshold = config.get<number>("fullWidthThreshold", 3000);

  let activeColumns: number;

  try {
    activeColumns = await recalculateActiveColumns(totalColumns, minColumnWidth, fullWidthThreshold);
  } catch (error) {
    activeColumns = totalColumns;
    vscode.window.showWarningMessage(
      `Editor Spotlighter: ウィンドウ幅検出に失敗したため等間隔モードで動作します。(${(error as Error).message})`
    );
  }

  outputChannel.appendLine(`[init] activeColumns=${activeColumns}, totalColumns=${totalColumns}, minColumnWidth=${minColumnWidth}`);

  // デバッグ: ログをファイルにも書き出す
  const fs = require("fs");
  const debugLogPath = "/tmp/editor-spotlighter-debug.log";
  function debugLog(msg: string) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    outputChannel.appendLine(msg);
    fs.appendFileSync(debugLogPath, line);
  }
  debugLog(`[init] activeColumns=${activeColumns}, totalColumns=${totalColumns}, minColumnWidth=${minColumnWidth}`);

  // ウィンドウ幅の再取得（整形ボタン or 初回のみ）
  const refreshWindowWidth = async () => {
    try {
      const newActiveColumns = await recalculateActiveColumns(totalColumns, minColumnWidth, fullWidthThreshold);
      activeColumns = newActiveColumns;
      debugLog(`[width-refresh] activeColumns=${activeColumns}`);
    } catch {
      // 取得失敗時は前の値を維持
    }
  };

  const onFocusChange = () => {
    if (!enabled) {
      return;
    }

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      debounceTimer = undefined;

      debugLog(`[focus] activeColumns=${activeColumns}, totalColumns=${totalColumns}`);

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

      // ウルトラワイド等で全カラムアクティブなら等間隔に
      if (activeColumns >= totalColumns) {
        await resetToEqual(totalColumns);
        return;
      }

      // アコーディオン適用（常にtotalColumnsを使う）
      const layoutConfig: LayoutConfig = {
        totalColumns,
        activeColumns,
        activeRatio,
        inactiveRatio,
      };

      const layout = calculateLayout(layoutConfig, focusedGroupIndex);
      try {
        await applyLayout(layout);
      } catch (error) {
        vscode.window.showWarningMessage(
          `Editor Spotlighter: レイアウト適用に失敗しました。(${(error as Error).message})`
        );
        throw error;
      }
    }, 200);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      onFocusChange();

      // モバイル接続中はタブ情報を更新（viewportは不要）
      if (mobileConnected && remoteServer) {
        updateRemoteTabs();
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
      await refreshWindowWidth();
      onFocusChange();
      vscode.window.showInformationMessage(
        "Editor Spotlighter: レイアウトを整形しました"
      );
    })
  );

  // TabTreeProvider の登録
  const tabTreeProvider = new TabTreeProvider();
  const treeView = vscode.window.createTreeView("editorSpotlighter.tabList", {
    treeDataProvider: tabTreeProvider,
  });
  context.subscriptions.push(treeView);

  // モバイル接続時のコールバック定義
  const handleMobileConnect = async () => {
    debugLog("[mobile] connected");
    mobileConnected = true;
    if (remoteServer) {
      remoteServer.setColumnCount(totalColumns);
      remoteServer.captureOnce();
    }
    debugLog("[mobile] column count set");
  };

  const handleMobileDisconnect = async () => {
    debugLog("[mobile] disconnected");
    mobileConnected = false;
  };

  // RemoteWebviewProvider の登録（サイドバー内WebView）
  remoteWebviewProvider = new RemoteWebviewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RemoteWebviewProvider.viewType,
      remoteWebviewProvider
    )
  );

  remoteWebviewProvider.onDidReceiveMessage(async (message) => {
    if (message.command === "start") {
      if (!remoteServer) {
        await startRemoteViewServer(context, handleMobileConnect, handleMobileDisconnect);
      }
    } else if (message.command === "stop") {
      await stopRemoteViewServer();
    }
  });

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      tabTreeProvider.refresh();
      updateRemoteTabs();
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

  // spContinue: Open latest Claude Code session
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.spContinue",
      async () => {
        try {
          await vscode.commands.executeCommand(
            "claude-vscode.editor.openLast"
          );
          vscode.window.showInformationMessage(
            "Editor Spotlighter: Claude Codeのセッションを開きました"
          );
        } catch {
          vscode.window.showInformationMessage(
            "Editor Spotlighter: Claude Codeを手動で開いてください（Cmd+Shift+P → Claude Code: Open）"
          );
        }
      }
    )
  );

  // Remote View commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.startRemoteView",
      async () => {
        if (remoteServer) {
          vscode.window.showInformationMessage(
            "Editor Spotlighter: Remote View is already running"
          );
          return;
        }
        await startRemoteViewServer(context, handleMobileConnect, handleMobileDisconnect);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editorSpotlighter.stopRemoteView",
      async () => {
        await stopRemoteViewServer();
      }
    )
  );

  // Auto-start remote view if enabled in settings
  const remoteConfig = vscode.workspace.getConfiguration("editorSpotlighter");
  const remoteEnabled = remoteConfig.get<boolean>("remoteView.enabled", false);
  if (remoteEnabled) {
    await startRemoteViewServer(context, handleMobileConnect, handleMobileDisconnect);
  }

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
      minColumnWidth = updated.get<number>("minColumnWidth", 850);
      fullWidthThreshold = updated.get<number>("fullWidthThreshold", 3000);
      openInNextColumn = updated.get<boolean>("openInNextColumn", true);

      onFocusChange();

      if (remoteServer && mobileConnected) {
        remoteServer.setColumnCount(totalColumns);
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

  if (remoteServer) {
    remoteServer.stopAll();
  }
  await stopRemoteViewServer();

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

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) {
      continue;
    }
    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

async function startRemoteViewServer(
  context: vscode.ExtensionContext,
  onMobileConnect?: () => void,
  onMobileDisconnect?: () => void
): Promise<void> {
  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  const port = config.get<number>("remoteView.port", 19280);
  const password = config.get<string>("remoteView.password", "Hmx-12Multi");

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage(
      "Editor Spotlighter: No workspace folder open"
    );
    return;
  }
  const projectPath = workspaceFolders[0].uri.fsPath;

  remoteServer = new RemoteViewServer(password, projectPath);

  remoteServer.onFirstConnect(() => {
    mobileConnected = true;
    if (onMobileConnect) {
      onMobileConnect();
    }
  });

  remoteServer.onAllDisconnect(() => {
    if (onMobileDisconnect) {
      onMobileDisconnect();
    }
  });

  remoteServer.onClientMessage(async (msg) => {
    if (msg.type === "type") {
      await vscode.env.clipboard.writeText(msg.text);
      try {
        await vscode.commands.executeCommand("claude-vscode.focus");
      } catch {
        // Claude Code extension may not be installed
      }
      // osascriptで Cmd+V → Enter を送信
      exec(`osascript -e 'delay 0.3' -e 'tell application "System Events" to keystroke "v" using command down' -e 'delay 0.2' -e 'tell application "System Events" to keystroke return'`, (err) => {
        if (err) {
          console.error(`[Editor Spotlighter][type] osascript error: ${err.message}`);
          vscode.window.showWarningMessage(
            "Editor Spotlighter: テキスト送信にはアクセシビリティ権限が必要です。システム設定 → プライバシーとセキュリティ → アクセシビリティ で Visual Studio Code を許可してください。"
          );
        }
      });
    } else if (msg.type === "switchTab") {
      const groups = vscode.window.tabGroups.all;
      if (msg.groupIndex < groups.length) {
        const group = groups[msg.groupIndex];
        if (msg.tabIndex < group.tabs.length) {
          const tab = group.tabs[msg.tabIndex];
          const input = tab.input;
          if (input instanceof vscode.TabInputText) {
            await vscode.window.showTextDocument(input.uri, {
              viewColumn: group.viewColumn,
              preview: false,
            });
          }
        }
      }
    }
  });

  try {
    await remoteServer.start(port);
  } catch (error) {
    remoteServer = null;
    vscode.window.showErrorMessage(
      `Editor Spotlighter: Failed to start Remote View server. (${(error as Error).message})`
    );
    throw error;
  }

  remoteStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  remoteStatusBarItem.text = `$(remote) Remote: ${port}`;
  remoteStatusBarItem.tooltip = `Remote View running on port ${port}`;
  remoteStatusBarItem.command = "editorSpotlighter.stopRemoteView";
  remoteStatusBarItem.show();
  context.subscriptions.push(remoteStatusBarItem);

  // QRコードをサイドバーのWebViewに表示
  // Cloudflare Tunnel経由の固定URL（設定可能）
  const tunnelDomain = config.get<string>("remoteView.tunnelDomain", "");
  let url: string;
  if (tunnelDomain) {
    url = `https://${tunnelDomain}/`;
  } else {
    const localIp = getLocalIpAddress();
    url = `http://${localIp}:${port}/`;
  }
  const qrSvg = await QRCode.toString(url, { type: "svg" });

  if (remoteWebviewProvider) {
    remoteWebviewProvider.setRunning(qrSvg, url);
  }

  // タブ情報の初期送信のみ（リスナーはactivate内で1回だけ登録済み）
  updateRemoteTabs();

  vscode.window.showInformationMessage(
    `Editor Spotlighter: Remote View started on port ${port}`
  );
}

function updateRemoteTabs(): void {
  if (!remoteServer) {
    return;
  }
  const tabs = [];
  for (const group of vscode.window.tabGroups.all) {
    const groupIndex = vscode.window.tabGroups.all.indexOf(group);
    for (let i = 0; i < group.tabs.length; i++) {
      const tab = group.tabs[i];
      const input = tab.input;
      let label = tab.label;
      if (input instanceof vscode.TabInputText) {
        const fileName = input.uri.path.split("/").pop();
        if (fileName) {
          label = fileName;
        }
      }
      tabs.push({
        groupIndex,
        tabIndex: i,
        label,
        isActive: tab.isActive,
      });
    }
  }
  remoteServer.setTabInfo(tabs);
}

async function stopRemoteViewServer(): Promise<void> {
  if (remoteServer) {
    await remoteServer.stop();
    remoteServer = null;
  }
  if (remoteStatusBarItem) {
    remoteStatusBarItem.dispose();
    remoteStatusBarItem = null;
  }
  if (remoteWebviewProvider) {
    remoteWebviewProvider.setStopped();
  }
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
