import * as vscode from "vscode";
import * as os from "os";
import { exec } from "child_process";
import QRCode from "qrcode";
import { detectWindowWidth } from "./windowDetector";
import { computeActiveColumns, deriveEditorWidth } from "./columnCalculator";
import { calculateLayout, applyLayout, readBackLayout, layoutMatches, LayoutConfig, EditorLayout } from "./layoutEngine";
import { decideSidebarTargetState, SidebarTargetState } from "./sidebarPolicy";
import { TabTreeProvider } from "./tabTreeProvider";
import { RemoteViewServer } from "./remote/remoteViewServer";
import { RemoteWebviewProvider } from "./remoteWebviewProvider";
import { generateRemotePassword } from "./remote/tokenAuth";
import { runInjectionPipeline, createVSCodeInjectionDeps } from "./remote/injectionPipeline";
import { createVSCodeFocusHost, routeFocusToColumn } from "./remote/focusRouter";
import { deriveColumnLabels } from "./remote/remoteViewServer";
import { decideRemoteAccessDisplay, DEFAULT_BIND_ADDRESS, buildQrUrl } from "./remote/qrPolicy";

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
// プライマリサイドバーが開いているときに編集領域から差し引く幅。
// 実機（27インチ・1920px）でユーザーが常用するサイドバー幅の実測値。設定で上書き可能。
let sidebarWidthWhenOpen = 230;
// VS Code はエディタ群の最小幅を 220px でハードコードしている（設定不可）。
// 幅検出は OS ウィンドウ全幅を返すが、実際のエディタ格子はアクティビティバー（約48px）・
// 群間の仕切り・スクロールバーの分だけ狭い。全幅で比率を作ると、VS Code がその比率を
// 実領域へスケールした際に非アクティブ列が 220px を割り、VS Code 側がクランプして
// レイアウトが崩れる（選んだ列しか表示されない）。アクティビティバー＋仕切りを覆い、
// 実領域を必ず下回るよう保守的に差し引く安全マージン。
const EDITOR_CHROME_MARGIN = 60;

function getEffectiveSidebarWidth(): number {
  if (lastSidebarAutoTarget === "close") {
    return 0;
  }
  return sidebarWidthWhenOpen;
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
  maxActiveColumns: number
): Promise<WindowInfo> {
  const windowWidth = await detectWindowWidth();
  // アクティブ本数の判定は「サイドバーは開いている」固定前提で行う。
  // 実サイドバー状態（開↔閉）を判定の入力にすると、サイドバーの開閉自体が本数を
  // 変え、その本数がまたサイドバーの開閉を呼ぶ循環で、中間帯のウィンドウ幅では
  // レイアウトが振動する。判定を固定前提に切り離して循環を断つ。
  const editorWidth = deriveEditorWidth(windowWidth, sidebarWidthWhenOpen, EDITOR_CHROME_MARGIN);
  const activeColumns = computeActiveColumns(editorWidth, minColumnWidth, totalColumns, fullWidthThreshold, maxActiveColumns);
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
  let minColumnWidth = config.get<number>("minColumnWidth", 460);
  let fullWidthThreshold = config.get<number>("fullWidthThreshold", 3000);
  let maxActiveColumns = config.get<number>("maxActiveColumns", 2);
  sidebarWidthWhenOpen = config.get<number>("sidebarWidthWhenOpen", 230);

  let activeColumns: number;
  let windowWidth: number;

  try {
    const info = await recalculateActiveColumns(totalColumns, minColumnWidth, fullWidthThreshold, maxActiveColumns);
    activeColumns = info.activeColumns;
    windowWidth = info.windowWidth;
  } catch (error) {
    activeColumns = totalColumns;
    windowWidth = totalColumns * minColumnWidth;
    vscode.window.showWarningMessage(
      `Editor Spotlighter: ウィンドウ幅検出に失敗したため等間隔モードで動作します。(${(error as Error).message})`
    );
  }

  log(`[init] activeColumns=${activeColumns}, totalColumns=${totalColumns}, minColumnWidth=${minColumnWidth}, windowWidth=${windowWidth}, sidebarOpenWidth=${sidebarWidthWhenOpen}`);

  await syncSidebarToActiveColumns(activeColumns);

  // ウィンドウ幅の実測はOSプロセス起動を伴い1〜2秒かかる。フォーカス処理の中で
  // 待つと「広がるまでの遅延」になり、待っている間に別フォーカスの処理が割り込んで
  // レイアウトが二重適用される不安定も生む（MacBook Air単体時に顕著だった実害）。
  // 実測は裏で1本だけ走らせ、幅が変わっていた時だけ再整形を通す。
  // 最短間隔: フォーカス連発中に実測プロセスが切れ目なく立ち続けるのを防ぐ
  // （実測自体が1〜2秒かかるため、無制限だとほぼ常時OSプロセスが走る）。
  // ディスプレイ切替への追従はこの間隔＋実測時間ぶん遅れるだけで自動回復する。
  const WIDTH_REFRESH_MIN_INTERVAL_MS = 5000;
  let widthRefreshInFlight = false;
  let lastWidthRefreshAt = 0;
  const refreshWindowWidthInBackground = () => {
    if (widthRefreshInFlight || Date.now() - lastWidthRefreshAt < WIDTH_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    widthRefreshInFlight = true;
    detectWindowWidth()
      .then((w) => {
        if (w !== windowWidth) {
          log(`[width-refresh] windowWidth ${windowWidth} -> ${w}`);
          windowWidth = w;
          // 幅が変わった＝ディスプレイ切替や窓リサイズ。前回適用済み比率の記録を
          // 破棄して、新しい幅での再整形を必ず通す。
          lastLayoutSignature = undefined;
          onFocusChange();
        }
      })
      .catch(() => {
        // 取得失敗時は前回の幅を維持（次回の呼び出しで再試行される）
      })
      .finally(() => {
        widthRefreshInFlight = false;
        lastWidthRefreshAt = Date.now();
      });
  };

  // 適用が VS Code 側グリッドへ反映されたかを読み戻しで検証し、不一致なら段階的に
  // 自己回復する。ディスプレイ切替後にグリッドが旧ウィンドウ幅のまま固まり、適用
  // しても右端の列が画面外へはみ出したまま見えなくなる実害（2026-06-11）への対処。
  const LAYOUT_MATCH_TOLERANCE = 0.05;
  const LAYOUT_RECOVERY_MIN_INTERVAL_MS = 30000;
  let lastLayoutRecoveryAt = 0;
  // 戻り値: 反映を確認できたか。false の間は呼び出し元が適用済み記録（署名）を
  // 残さず、次のフォーカスで必ず再適用を試みる（崩れたまま固定されるのを防ぐ）。
  const verifyAndRecoverLayout = async (layout: EditorLayout): Promise<boolean> => {
    const first = await readBackLayout();
    if (first === undefined) {
      // 読み戻し非対応環境では検証せず従来挙動のまま進める
      return true;
    }
    if (layoutMatches(layout, first, LAYOUT_MATCH_TOLERANCE)) {
      return true;
    }
    // 回復が効かない環境でフォーカスのたびにサイドバーが点滅し続けるのを防ぐ
    if (Date.now() - lastLayoutRecoveryAt < LAYOUT_RECOVERY_MIN_INTERVAL_MS) {
      log(`[apply-verify-fail] recovery cooldown中のためスキップ`);
      return false;
    }
    lastLayoutRecoveryAt = Date.now();
    log(`[apply-verify-fail] actual=${JSON.stringify(first.groups.map(g => g.size))} -> evenEditorWidthsで回復試行`);
    await vscode.commands.executeCommand("workbench.action.evenEditorWidths");
    await applyLayout(layout);
    const afterEven = await readBackLayout();
    if (layoutMatches(layout, afterEven, LAYOUT_MATCH_TOLERANCE)) {
      log(`[apply-verify-recovered] evenEditorWidths`);
      return true;
    }
    // サイドバーを2回トグルしてワークベンチ全体の再レイアウトを誘発し、グリッドを
    // 実ウィンドウ幅へ追従させてから再適用する
    await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
    await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    await applyLayout(layout);
    const final = await readBackLayout();
    if (layoutMatches(layout, final, LAYOUT_MATCH_TOLERANCE)) {
      log(`[apply-verify-recovered] sidebar-relayout`);
      return true;
    }
    log(`[apply-verify-fail] persists actual=${JSON.stringify(final?.groups.map(g => g.size))}`);
    // 回復不能の有力原因はウィンドウ幅キャッシュの陳腐化（ディスプレイ切替）。
    // 最短間隔を無視して実測を即時にやり直し、根本側から自動回復させる。
    lastWidthRefreshAt = 0;
    refreshWindowWidthInBackground();
    return false;
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
      // アクティブ本数はキャッシュ済みのウィンドウ幅から即時計算する（実測を
      // ここで待たない）。実測は裏で走らせ、幅が変わっていた時だけ再整形が入る。
      const editorWidthForCount = deriveEditorWidth(windowWidth, sidebarWidthWhenOpen, EDITOR_CHROME_MARGIN);
      activeColumns = computeActiveColumns(editorWidthForCount, minColumnWidth, totalColumns, fullWidthThreshold, maxActiveColumns);
      refreshWindowWidthInBackground();

      await syncSidebarToActiveColumns(activeColumns);

      log(`[focus] activeColumns=${activeColumns}, totalColumns=${totalColumns}, groups=${allGroups.length}, focused=${focusedGroupIndex}, windowWidth=${windowWidth}, minColumnWidth=${minColumnWidth}, historyLen=${activeHistory.length}, history=[${activeHistory.join(',')}]`);

      if (focusedGroupIndex < 0) {
        return;
      }

      // レイアウトモデルは totalColumns 列の固定格子。それを超える実グループに
      // フォーカスがある間は格子で表現できないため、レイアウトを触らない。
      if (focusedGroupIndex >= totalColumns) {
        log(`[apply-layout-skip] focused=${focusedGroupIndex} exceeds totalColumns=${totalColumns}`);
        return;
      }

      // グループ削減後に残った範囲外の履歴を捨て（範囲外indexが混ざると比率の合計が
      // 1を割り、VS Code側の再正規化で幅が崩れる）、既にアクティブなら先頭へ移動
      activeHistory = activeHistory.filter(i => i < totalColumns && i !== focusedGroupIndex);
      activeHistory.unshift(focusedGroupIndex);
      // activeColumns数を超えたら古いものを押し出す
      if (activeHistory.length > activeColumns) {
        activeHistory = activeHistory.slice(0, activeColumns);
      }

      // 全カラムアクティブ（ウルトラワイド・等間隔モード）では履歴に依らず全列を
      // アクティブ扱いにして等間隔を適用する。従来はここで return しており、
      // 画面切替やグループ開閉で偏った幅が放置されていた（手動整形54回の実害）。
      const activeIndices = activeColumns >= totalColumns
        ? new Set(Array.from({ length: totalColumns }, (_, i) => i))
        : new Set(activeHistory);

      // アコーディオン適用（常にtotalColumnsを使う）
      const effectiveSidebarWidth = getEffectiveSidebarWidth();
      const editorWidth = deriveEditorWidth(windowWidth, effectiveSidebarWidth, EDITOR_CHROME_MARGIN);
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
        // 反映を確認できた時だけ署名を記録する。未確認のまま記録すると、次の
        // フォーカスが「計算結果が同じ」スキップに吸われ、崩れが固定される。
        if (await verifyAndRecoverLayout(layout)) {
          lastLayoutSignature = signature;
        }
      } catch (error) {
        log(`[apply-error] ${(error as Error).message}`);
        vscode.window.showWarningMessage(
          `Editor Spotlighter: レイアウト適用に失敗しました。(${(error as Error).message})`
        );
        throw error;
      } finally {
        setTimeout(() => { applyingLayout = false; }, SUPPRESS_EVENT_MS);
      }
      // 100ms = フォーカス移動イベントの連発をまとめる待ち時間。幅実測を待たなく
      // なった分ここが体感遅延の主成分になる。ログ上のイベント連発は数十ms間隔
      // なので100msで十分に合流できる。
    }, 100);
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
      log(`[event] onDidChangeTabGroups fired (opened=${e.opened.length}, closed=${e.closed.length})`);
      // グループの増減時はVS Codeが幅を勝手に再配分する。前回適用済み比率の記録が
      // 残っていると「計算結果が前回と同じ」でスキップされ崩れたまま放置されるため、
      // 記録を破棄して次回の再整形を必ず通す。
      if (e.opened.length > 0 || e.closed.length > 0) {
        lastLayoutSignature = undefined;
      }
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
      await resetToEqual(totalColumns, verifyAndRecoverLayout);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("editorSpotlighter.alignLayout", async () => {
      await resetToEqual(totalColumns, verifyAndRecoverLayout);
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
      // 実グループ数ベースで列数とラベルを初期化（要件 b-2, b-3）
      updateRemoteTabs();
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
    } else if (message.command === "openSettings") {
      // localOnly 案内の「設定を開く」ボタン（要件 c-2）
      await vscode.commands.executeCommand("workbench.action.openSettings", "editorSpotlighter.remoteView");
    }
  });

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      tabTreeProvider.refresh();
      if (mobileConnected) {
        updateRemoteTabs();
      }
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
      minColumnWidth = updated.get<number>("minColumnWidth", 460);
      fullWidthThreshold = updated.get<number>("fullWidthThreshold", 3000);
      maxActiveColumns = updated.get<number>("maxActiveColumns", 2);
      sidebarWidthWhenOpen = updated.get<number>("sidebarWidthWhenOpen", 230);

      if (remoteServer && mobileConnected) {
        // 設定変更時も実グループ数ベースで再同期（要件 b-3）
        updateRemoteTabs();
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

      // 履歴をリセットし、設定変更を即座にレイアウトへ反映する（Reload不要）。
      // 設定変更の監視自体は元から効いているが、従来は次にエディタへフォーカスする
      // まで再描画が遅延していた。ここで再計算＋再レイアウトを明示的に走らせ、
      // 設定画面でスライダーを動かした瞬間に反映されるようにする。
      activeHistory = [];
      onFocusChange();
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

async function resetToEqual(
  totalColumns: number,
  // ユーザー起動の整形コマンドからは読み戻し検証を渡す（固着グリッドでの無音
  // 空振り防止）。無効化・終了時の後始末では渡さず従来挙動のまま戻す。
  verify?: (layout: import("./layoutEngine").EditorLayout) => Promise<boolean>
): Promise<void> {
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
    if (!verify || await verify(layout)) {
      lastLayoutSignature = layout.groups.map(g => g.size.toFixed(4)).join('|');
    }
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
  // 生成値はQR画像に埋め込まれ、スキャンで自動ログインする（手入力はフォールバック）。
  const password =
    !configuredPassword || configuredPassword === LEGACY_DEFAULT_PASSWORD
      ? generateRemotePassword()
      : configuredPassword;
  // リモート入力（キーボード/クリック/タブ切替）の許可。閲覧専用にしたい場合は false。
  const allowRemoteInput = config.get<boolean>("remoteView.allowRemoteInput", true);
  // bind 先。既定はローカルのみ（トンネル経由向け・安全）。LAN 直結は 0.0.0.0 に変更。
  const bindAddress = config.get<string>("remoteView.bindAddress", DEFAULT_BIND_ADDRESS);

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

  const focusHost = createVSCodeFocusHost(vscode);

  // InjectionDeps はサーバ起動時に1回だけ生成する（B-10）。
  // type メッセージが来るたびに再生成していたのを巻き上げ。
  const server = remoteServer;
  const injectionDeps = createVSCodeInjectionDeps({
    getSelectedColumn: () => server.getSelectedColumn(),
    getGroupCount: () => vscode.window.tabGroups.all.length,
    routeFocus: (col) => routeFocusToColumn(focusHost, col),
    getActiveGroupIndex: () => focusHost.getActiveGroupIndex(),
    readClipboard: () => Promise.resolve(vscode.env.clipboard.readText()),
    writeClipboard: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
    showWarning: (m) => vscode.window.showWarningMessage(m),
    execWithTimeout: (cmd, timeoutMs) =>
      new Promise<string>((resolve, reject) => {
        const child = exec(cmd, (err, stdout) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve(stdout.trim());
        });
        // タイムアウト時に子プロセスを kill してから reject する。
        // kill しないと生き残った osascript が遅延 keystroke を発火し、
        // クリップボード復元後の前面アプリへ貼り付けが漏れる（fail-closed 違反）。
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("osascript timeout"));
        }, timeoutMs);
      }),
    sendInjectResult: (result) => server.sendInjectResult(result),
  });

  remoteServer.onClientMessage(async (msg) => {
    if (msg.type === "type") {
      // サーバ側でも検証済みだが、入力注入は防衛多層化のため型・長さを再検証。
      if (typeof msg.text !== "string" || msg.text.length === 0 || msg.text.length > 2000) {
        return;
      }
      // 注入パイプライン経由で列ルーティング・フォーカス確定検証・束ね検査を実行する。
      // claude-vscode.focus / setTimeout 500ms は撤去済み（要件 a-1, a-2）。
      await runInjectionPipeline(msg.text, injectionDeps);
      // R-6: 描画フラッシュ待ち 150ms 後にキャプチャ（直後撮影はハッシュ不変スキップになる）。
      // R-7: 同クロージャ内の `server` を使い、モジュール変数 remoteServer への null ガードをやめる。
      setTimeout(() => { server.captureOnce(); }, 150);
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
      // R-11: タブ切替後も type/click と同様に描画フラッシュ待ち 150ms でキャプチャ。
      setTimeout(() => { server.captureOnce(); }, 150);
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

  // QRコードをサイドバーの WebView に表示（qrPolicy で表示種別を決定）
  const tunnelDomain = config.get<string>("remoteView.tunnelDomain", "");
  const localIp = getLocalIpAddress();
  const accessDisplay = decideRemoteAccessDisplay({
    bindAddress,
    tunnelDomain,
    port,
    lanIp: localIp,
  });

  if (remoteWebviewProvider) {
    if (accessDisplay.kind === "localOnly") {
      // 127.0.0.1 待ち受け×tunnel 未設定 → 繋がらない QR を出さず案内を表示
      remoteWebviewProvider.setLocalOnly(accessDisplay.url, password);
    } else {
      const url = accessDisplay.url;
      // QR画像にのみ認証キーをフラグメントとして埋め込む（buildQrUrl が単一真実源）。
      // サイドバー表示用の url は素のまま変えない。
      let qrSvg: string;
      try {
        qrSvg = await QRCode.toString(buildQrUrl(url, password), { type: "svg" });
      } catch {
        // 容量超過等で失敗した場合は鍵なしの素URLで再生成して起動フローを継続する
        qrSvg = await QRCode.toString(url, { type: "svg" });
      }
      remoteWebviewProvider.setRunning(qrSvg, url, password);
    }
  }

  // タブ情報の初期送信のみ（リスナーはactivate内で1回だけ登録済み）
  updateRemoteTabs();

  vscode.window.showInformationMessage(
    `Editor Spotlighter: Remote View started on port ${port}`
  );

  // 初回移行案内（c-3）: bindAddress が 127.0.0.1 系×tunnel 未設定×明示設定なしのとき1回だけ表示
  const MIGRATION_NOTICE_KEY = "remoteView.bindMigrationNoticeShown";
  // accessDisplay.kind === "localOnly" は上で確定済みのため再判定不要（B-3）
  const isLocalOnly = accessDisplay.kind === "localOnly";
  // config.get は default があるため常に非 undefined。inspect で明示設定有無を正しく判定（B-2）
  const bindInspect = config.inspect<string>("remoteView.bindAddress");
  const isUserExplicit =
    bindInspect?.globalValue !== undefined ||
    bindInspect?.workspaceValue !== undefined ||
    bindInspect?.workspaceFolderValue !== undefined;
  const noticeShown = context.globalState.get<boolean>(MIGRATION_NOTICE_KEY, false);

  if (isLocalOnly && !isUserExplicit && !noticeShown) {
    await context.globalState.update(MIGRATION_NOTICE_KEY, true);
    // fire-and-forget: アクティベーション完了を案内応答まで待たせない（B-1）
    vscode.window.showInformationMessage(
      "Editor Spotlighter: リモートビューの待ち受け既定がローカルのみ（127.0.0.1）に変わりました。LAN 直結（QR読み取り）を使うには設定変更が必要です",
      "設定を開く"
    ).then((action) => {
      if (action === "設定を開く") {
        vscode.commands.executeCommand("workbench.action.openSettings", "editorSpotlighter.remoteView");
      }
    });
  }
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

  // 実グループ数ベースで列数とラベルを更新（要件 b-2, b-3）
  const groupCount = vscode.window.tabGroups.all.length;
  const labels = deriveColumnLabels(tabs, groupCount);
  remoteServer.setColumns(groupCount, labels);
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
