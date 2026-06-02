import * as vscode from "vscode";
import * as os from "os";
import { exec } from "child_process";
import QRCode from "qrcode";
import { detectWindowWidth } from "./windowDetector";
import { computeActiveColumns } from "./columnCalculator";
import { calculateLayout, applyLayout, LayoutConfig } from "./layoutEngine";
import { decideSidebarTargetState, SidebarTargetState } from "./sidebarPolicy";
import { TabTreeProvider } from "./tabTreeProvider";
import { RemoteViewServer } from "./remote/remoteViewServer";
import { RemoteWebviewProvider } from "./remoteWebviewProvider";
import { generateRemotePassword } from "./remote/tokenAuth";

// 出荷時に固定で入っていた既知パスワード。設定にこの値が残っている場合は
// 「未設定」とみなして起動時にランダム生成へ切り替える（既知の弱い資格情報を無効化）。
const LEGACY_DEFAULT_PASSWORD = "Hmx-12Multi";

let enabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let remoteServer: RemoteViewServer | null = null;
let remoteStatusBarItem: vscode.StatusBarItem | null = null;
let remoteWebviewProvider: RemoteWebviewProvider | null = null;
let mobileConnected = false;
let activeHistory: number[] = [];
let applyingLayout = false;
let lastLayoutSignature: string | undefined;
let lastSidebarAutoTarget: SidebarTargetState | undefined;
const SIDEBAR_OPEN_WIDTH = 300;
// VS Code はエディタ群の最小幅を 220px でハードコードしている（設定不可）。
// 幅検出は OS ウィンドウ全幅を返すが、実際のエディタ格子はスクロールバー・群間の
// 仕切り・枠の分だけ狭い。全幅で比率を作ると、VS Code がその比率を実領域へ
// スケールした際に非アクティブ列が 220px を割り、VS Code 側がクランプして
// レイアウトが指定通りにならない。実領域を必ず下回るよう保守的に差し引く安全マージン。
const EDITOR_CHROME_MARGIN = 30;

function getEffectiveSidebarWidth(): number {
  if (lastSidebarAutoTarget === "close") {
    return 0;
  }
  return SIDEBAR_OPEN_WIDTH;
}

async function syncSidebarToActiveColumns(activeColumns: number): Promise<void> {
  const target = decideSidebarTargetState(activeColumns);
  if (target === lastSidebarAutoTarget) {
    return;
  }
  lastSidebarAutoTarget = target;
  try {
    if (target === "close") {
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
    } else {
      await vscode.commands.executeCommand("workbench.action.focusSideBar");
      // フォーカスを直前のエディタへ戻す（サイドバーは開いたまま）
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    }
  } catch {
    // 失敗時は次回再試行できるよう状態を巻き戻す
    lastSidebarAutoTarget = undefined;
  }
}

const SUPPRESS_EVENT_MS = 250;

interface WindowInfo {
  activeColumns: number;
  windowWidth: number;
}

async function recalculateActiveColumns(
  totalColumns: number,
  minColumnWidth: number,
  fullWidthThreshold: number,
  effectiveSidebarWidth: number = 0
): Promise<WindowInfo> {
  const windowWidth = await detectWindowWidth();
  const editorWidth = Math.max(1, windowWidth - effectiveSidebarWidth - EDITOR_CHROME_MARGIN);
  const activeColumns = computeActiveColumns(editorWidth, minColumnWidth, totalColumns, fullWidthThreshold);
  return { activeColumns, windowWidth };
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Editor Spotlighter");

  const fs = require("fs");
  const LOG_PATH = "/tmp/editor-spotlighter-debug.log";
  function log(msg: string) {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const ts = jst.toISOString().replace('T', ' ').replace('Z', ' JST');
    const line = `${ts} ${msg}\n`;
    outputChannel.appendLine(msg);
    try { fs.appendFileSync(LOG_PATH, line); } catch {}
  }

  // ログローテーション: 1MB超えたら後半512KBに切り詰め
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > 1024 * 1024) {
      const content = fs.readFileSync(LOG_PATH, "utf-8");
      fs.writeFileSync(LOG_PATH, content.slice(-512 * 1024));
    }
  } catch {}

  log("=== Editor Spotlighter activated ===");

  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  enabled = config.get<boolean>("enabled", true);


  // activate時にタブ設定を初期反映
  await applyTabSettings(config);

  let totalColumns = config.get<number>("totalColumns", 5);
  let minColumnWidth = config.get<number>("minColumnWidth", 600);
  let fullWidthThreshold = config.get<number>("fullWidthThreshold", 3000);

  let activeColumns: number;
  let windowWidth: number;

  try {
    const info = await recalculateActiveColumns(totalColumns, minColumnWidth, fullWidthThreshold, getEffectiveSidebarWidth());
    activeColumns = info.activeColumns;
    windowWidth = info.windowWidth;
  } catch (error) {
    activeColumns = totalColumns;
    windowWidth = totalColumns * minColumnWidth;
    vscode.window.showWarningMessage(
      `Editor Spotlighter: ウィンドウ幅検出に失敗したため等間隔モードで動作します。(${(error as Error).message})`
    );
  }

  log(`[init] activeColumns=${activeColumns}, totalColumns=${totalColumns}, minColumnWidth=${minColumnWidth}, windowWidth=${windowWidth}, sidebarOpenWidth=${SIDEBAR_OPEN_WIDTH}`);

  await syncSidebarToActiveColumns(activeColumns);

  // ウィンドウ幅の再取得（整形ボタン or 初回のみ）
  const refreshWindowWidth = async () => {
    try {
      const info = await recalculateActiveColumns(totalColumns, minColumnWidth, fullWidthThreshold, getEffectiveSidebarWidth());
      activeColumns = info.activeColumns;
      windowWidth = info.windowWidth;
      log(`[width-refresh] activeColumns=${activeColumns}, windowWidth=${windowWidth}`);
    } catch {
      // 取得失敗時は前の値を維持
    }
  };

  const onFocusChange = () => {
    if (!enabled) {
      return;
    }

    if (applyingLayout) {
      return;
    }

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
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
      // ウィンドウ幅を再取得してactiveColumnsを更新
      try {
        const info = await recalculateActiveColumns(totalColumns, minColumnWidth, fullWidthThreshold, getEffectiveSidebarWidth());
        activeColumns = info.activeColumns;
        windowWidth = info.windowWidth;
      } catch {
        // 取得失敗時は前の値を維持
      }

      await syncSidebarToActiveColumns(activeColumns);

      log(`[focus] activeColumns=${activeColumns}, totalColumns=${totalColumns}, groups=${allGroups.length}, focused=${focusedGroupIndex}, windowWidth=${windowWidth}, minColumnWidth=${minColumnWidth}, historyLen=${activeHistory.length}, history=[${activeHistory.join(',')}]`);

      if (focusedGroupIndex < 0) {
        return;
      }

      // 既にアクティブなら先頭に移動
      activeHistory = activeHistory.filter(i => i !== focusedGroupIndex);
      activeHistory.unshift(focusedGroupIndex);
      // activeColumns数を超えたら古いものを押し出す
      if (activeHistory.length > activeColumns) {
        activeHistory = activeHistory.slice(0, activeColumns);
      }
      const activeIndices = new Set(activeHistory);

      // ウルトラワイド等で全カラムアクティブならレイアウトを触らない
      if (activeColumns >= totalColumns) {
        return;
      }

      // アコーディオン適用（常にtotalColumnsを使う）
      const effectiveSidebarWidth = getEffectiveSidebarWidth();
      const editorWidth = Math.max(1, windowWidth - effectiveSidebarWidth - EDITOR_CHROME_MARGIN);
      const layoutConfig: LayoutConfig = {
        totalColumns,
        windowWidth: editorWidth,  // エディタ領域の幅
        minColumnWidth,
      };

      const layout = calculateLayout(layoutConfig, activeIndices);
      const sizes = layout.groups.map((g, i) => {
        const pxEstimate = Math.round(g.size * editorWidth);
        const isActive = activeIndices.has(i);
        return `col${i}=${(g.size * 100).toFixed(1)}%(${pxEstimate}px)${isActive ? '*' : ''}`;
      }).join(', ');
      const signature = layout.groups.map(g => g.size.toFixed(4)).join('|');
      if (signature === lastLayoutSignature) {
        log(`[apply-layout-skip] unchanged signature=${signature}`);
        return;
      }

      log(`[apply-layout] windowWidth=${windowWidth}, effectiveSidebarWidth=${effectiveSidebarWidth}, editorWidth=${editorWidth}, activeColumns=${activeColumns}, sizes=[${sizes}]`);
      applyingLayout = true;
      try {
        await applyLayout(layout);
        lastLayoutSignature = signature;
      } catch (error) {
        vscode.window.showWarningMessage(
          `Editor Spotlighter: レイアウト適用に失敗しました。(${(error as Error).message})`
        );
        throw error;
      } finally {
        setTimeout(() => { applyingLayout = false; }, SUPPRESS_EVENT_MS);
      }
    }, 200);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      log(`[event] onDidChangeActiveTextEditor fired: editor=${editor?.document?.fileName ?? 'none'}, viewColumn=${editor?.viewColumn ?? 'none'}`);
      onFocusChange();

      // モバイル接続中はタブ情報を更新
      if (mobileConnected && remoteServer) {
        updateRemoteTabs();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups((e) => {
      log(`[event] onDidChangeTabGroups fired`);
      onFocusChange();
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
        // 履歴もリセット（全カラムをアクティブ扱いに）
        activeHistory = [];
        await vscode.workspace.getConfiguration("editorSpotlighter").update(
          "totalColumns",
          totalColumns,
          vscode.ConfigurationTarget.Global
        );
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
      // 履歴もリセット（全カラムをアクティブ扱いに）
      activeHistory = [];
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
    log("[mobile] connected");
    mobileConnected = true;
    if (remoteServer) {
      remoteServer.setColumnCount(totalColumns);
      remoteServer.captureOnce();
    }
    log("[mobile] column count set");
  };

  const handleMobileDisconnect = async () => {
    log("[mobile] disconnected");
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
      totalColumns = updated.get<number>("totalColumns", 5);
      minColumnWidth = updated.get<number>("minColumnWidth", 600);
      fullWidthThreshold = updated.get<number>("fullWidthThreshold", 3000);

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

      // 履歴もリセット（全カラムをアクティブ扱いに）
      activeHistory = [];
    })
  );
}

export async function deactivate(): Promise<void> {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }

  await stopRemoteViewServer();

  const config = vscode.workspace.getConfiguration("editorSpotlighter");
  const totalColumns = config.get<number>("totalColumns", 5);
  await resetToEqual(totalColumns);
}

async function resetToEqual(totalColumns: number): Promise<void> {
  const allIndices = new Set<number>();
  for (let i = 0; i < totalColumns; i++) {
    allIndices.add(i);
  }
  const layoutConfig: LayoutConfig = {
    totalColumns,
    windowWidth: 1,
    minColumnWidth: 1,
  };
  const layout = calculateLayout(layoutConfig, allIndices);
  const sizes = layout.groups.map((g, i) => `col${i}=${(g.size * 100).toFixed(1)}%`).join(', ');
  const fs = require("fs");
  try { fs.appendFileSync("/tmp/editor-spotlighter-debug.log", `${new Date(Date.now() + 9*60*60*1000).toISOString().replace('T',' ').replace('Z',' JST')} [reset-equal] totalColumns=${totalColumns}, sizes=[${sizes}]
`); } catch {}
  applyingLayout = true;
  try {
    await applyLayout(layout);
    lastLayoutSignature = layout.groups.map(g => g.size.toFixed(4)).join('|');
  } finally {
    setTimeout(() => { applyingLayout = false; }, SUPPRESS_EVENT_MS);
  }
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
  const configuredPassword = config.get<string>("remoteView.password", "");
  // 未設定または旧固定値なら、起動ごとに高エントロピーのワンタイムパスワードを生成。
  // 生成値はサイドバーUIに表示し、ユーザーがスマホで入力する。
  const password =
    !configuredPassword || configuredPassword === LEGACY_DEFAULT_PASSWORD
      ? generateRemotePassword()
      : configuredPassword;
  // リモート入力（キーボード/クリック/タブ切替）の許可。閲覧専用にしたい場合は false。
  const allowRemoteInput = config.get<boolean>("remoteView.allowRemoteInput", true);
  // bind 先。既定は LAN（スマホ直結）。トンネル専用なら "127.0.0.1" に設定可能。
  const bindAddress = config.get<string>("remoteView.bindAddress", "0.0.0.0");

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage(
      "Editor Spotlighter: No workspace folder open"
    );
    return;
  }
  const projectPath = workspaceFolders[0].uri.fsPath;

  remoteServer = new RemoteViewServer(password, projectPath, allowRemoteInput);

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
      // サーバ側でも検証済みだが、入力注入は防衛多層化のため型・長さを再検証。
      if (typeof msg.text !== "string" || msg.text.length === 0 || msg.text.length > 2000) {
        return;
      }
      await vscode.env.clipboard.writeText(msg.text);

      // まずClaude Codeのフォーカスを試みる
      try {
        await vscode.commands.executeCommand("claude-vscode.focus");
      } catch {
        // Claude Code extension may not be installed
      }

      // フォーカス完了まで少し待ってからキーストローク送信。
      // ただし「前面アプリが VS Code のときだけ」貼り付け+Enterを送る。
      // 別アプリ（ターミナル等）が前面に来ている隙に誤爆させないためのガード。
      setTimeout(() => {
        exec(
          `osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'`,
          (frontErr, frontStdout) => {
            const front = (frontStdout || "").trim();
            const isVSCode = /code|electron|visual studio code/i.test(front);
            if (frontErr || !isVSCode) {
              vscode.window.showWarningMessage(
                `Editor Spotlighter: 前面アプリ（${front || "不明"}）がVS Codeでないため、リモート入力を中止しました。`
              );
              return;
            }
            exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down' -e 'delay 0.3' -e 'tell application "System Events" to keystroke return'`, (err) => {
              if (err) {
                console.error(`[Editor Spotlighter][type] osascript error: ${err.message}`);
                vscode.window.showWarningMessage(
                  "Editor Spotlighter: テキスト送信にはアクセシビリティ権限が必要です。システム設定 → プライバシーとセキュリティ → アクセシビリティ で Visual Studio Code を許可してください。"
                );
              }
            });
          }
        );
      }, 500);
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
    await remoteServer.start(port, bindAddress);
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
    remoteWebviewProvider.setRunning(qrSvg, url, password);
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
