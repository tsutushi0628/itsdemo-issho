export function getMobileHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
<title>itsudemo-issho</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #ffffff;
    color: #1a1a1a;
    -webkit-text-size-adjust: 100%;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  #screen {
    flex: 1;
    overflow: hidden;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x pan-y pinch-zoom;
    background: #f8f9fa;
    position: relative;
  }

  #frame {
    width: 100%;
    height: auto;
    display: block;
  }

  /* タスク13: 切替中オーバーレイ */
  #switchingOverlay {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 12;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
  }

  #switchingOverlay.visible {
    display: flex;
  }

  #columnBar {
    display: flex;
    background: #f3f4f6;
    border-top: 1px solid #e5e7eb;
    min-height: 56px;
    flex-shrink: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* タスク11: 動的生成ボタンのスタイル（2段表示対応） */
  .col-btn {
    flex: 1;
    min-width: 60px;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.15s, border-color 0.15s;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px 6px;
    gap: 2px;
  }

  .col-btn:active {
    background: #e5e7eb;
  }

  .col-btn.active {
    border-bottom-color: #7c3aed;
  }

  .col-btn.active .col-num {
    color: #7c3aed;
  }

  .col-btn.active .col-label {
    color: #7c3aed;
  }

  .col-btn.switching {
    opacity: 0.5;
    pointer-events: none;
  }

  .col-num {
    font-size: 16px;
    font-weight: 600;
    color: #9ca3af;
    line-height: 1;
  }

  .col-label {
    font-size: 10px;
    color: #9ca3af;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 70px;
    line-height: 1;
  }

  #inputBar {
    flex-shrink: 0;
    padding: 6px 12px calc(env(safe-area-inset-bottom, 8px) + 8px);
    background: #ffffff;
    border-top: 1px solid #e5e7eb;
    z-index: 10;
  }

  /* タスク13: 送信先表示 */
  #destinationBar {
    font-size: 11px;
    color: #6b7280;
    padding: 2px 4px 4px;
    min-height: 18px;
  }

  .input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  #textInput {
    flex: 1;
    padding: 8px 16px;
    border: 1px solid #d1d5db;
    border-radius: 20px;
    font-size: 14px;
    font-family: inherit;
    color: #1a1a1a;
    background: #ffffff;
    outline: none;
  }

  #textInput:focus {
    border-color: #7c3aed;
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
  }

  #textInput::placeholder {
    color: #9ca3af;
  }

  #textInput:disabled {
    background: #f3f4f6;
    color: #9ca3af;
    border-color: #e5e7eb;
  }

  #sendBtn {
    width: 36px;
    height: 36px;
    background: #7c3aed;
    border: none;
    border-radius: 50%;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  #sendBtn:active {
    background: #6d28d9;
    transform: scale(0.95);
  }

  #sendBtn:disabled {
    background: #d1d5db;
    cursor: default;
    transform: none;
  }

  /* タスク14: 閲覧専用表示 */
  #readonlyLabel {
    display: none;
    font-size: 11px;
    color: #9ca3af;
    padding: 2px 4px;
    text-align: center;
  }

  #readonlyLabel.visible {
    display: block;
  }

  /* タスク14: トースト通知 */
  #toast {
    display: none;
    position: fixed;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 90px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.9);
    color: #fff;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    max-width: 80vw;
    text-align: center;
    z-index: 30;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  #toast.visible {
    display: block;
  }

  .reconnecting-banner {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #fef3c7;
    color: #92400e;
    text-align: center;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    z-index: 20;
  }

  .reconnecting-banner.visible {
    display: block;
  }

  #closeBtn {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    background: rgba(0,0,0,0.5);
    color: #fff;
    border: none;
    border-radius: 50%;
    font-size: 18px;
    cursor: pointer;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
  }

  #closeBtn:active {
    background: rgba(0,0,0,0.7);
  }

</style>
</head>
<body>

<div class="reconnecting-banner" id="reconnectBanner">Reconnecting...</div>
<div id="toast"></div>

<div class="app">
  <div id="screen">
    <button id="closeBtn" aria-label="Close">&times;</button>
    <img id="frame" />
    <!-- タスク13: 切替中オーバーレイ -->
    <div id="switchingOverlay"></div>
  </div>

  <!-- タスク11: 動的生成に変更（固定4ボタンを撤去） -->
  <div id="columnBar"></div>

  <div id="inputBar">
    <!-- タスク13: 送信先表示 -->
    <div id="destinationBar"></div>
    <div class="input-row">
      <input id="textInput" type="text" placeholder="Type here..." maxlength="2000" />
      <button id="sendBtn">&#9654;</button>
    </div>
    <!-- タスク14: 閲覧専用表示 -->
    <div id="readonlyLabel">閲覧専用</div>
  </div>
</div>

<script>
(function() {
  var frame = document.getElementById('frame');
  var textInput = document.getElementById('textInput');
  var sendBtn = document.getElementById('sendBtn');
  var closeBtn = document.getElementById('closeBtn');
  var reconnectBanner = document.getElementById('reconnectBanner');
  var columnBar = document.getElementById('columnBar');
  var switchingOverlay = document.getElementById('switchingOverlay');
  var destinationBar = document.getElementById('destinationBar');
  var readonlyLabel = document.getElementById('readonlyLabel');
  var toastEl = document.getElementById('toast');
  var ws = null;
  var reconnectTimer = null;

  // タスク13/14: クライアント状態（design.md 5.2 状態遷移）
  // 状態: 'syncing' | 'idle' | 'switching' | 'sending'
  var clientState = 'syncing';
  var activeColumn = 0;
  var columnLabels = [];
  var allowInput = false;
  var sendingTimer = null;
  var toastTimer = null;
  // 差し戻し修正1 / F-1: オーバーレイ早期解除防止フラグ（b-4対応）
  // awaitingAck=true の間（列タップ後〜ACK columns受信前）は frame によるオーバーレイ解除を行わない
  // awaitingFrame=true（ACK columns受信後〜次フレーム受信前）になってから解除する
  var awaitingAck = false;
  var awaitingFrame = false;
  // F-1: タップした列番号を記録（ACK相関用。ACK columns の msg.active と照合する）
  var pendingColumn = -1;
  // F-7: 前回の columns 適用値（DOM再生成スキップ判定用）
  var lastColumnsCount = -1;
  var lastColumnsLabels = [];
  var lastColumnsActive = -1;
  var lastColumnsAllowInput = true;

  // タスク14: reason→日本語文言マップ（固定文言・サーバ値を直接描画しない・design 3.2）
  var INJECT_REASON_MESSAGES = {
    busy: '送信中です。完了後に再送してください',
    columnOutOfRange: '選択した列が存在しません',
    noClaudeTab: 'この列に Claude Code セッションがありません',
    focusUnverified: 'フォーカスを確定できませんでした',
    frontAppNotVSCode: '前面アプリが VS Code ではありません',
    stateChanged: '送信中に列の状態が変わりました',
    internalError: '内部エラーが発生しました'
  };
  var INJECT_REASON_FALLBACK = '送信を中止しました';
  var INJECT_TIMEOUT_MESSAGE = '結果不明・画面で確認してください';

  // タスク14: トースト表示（textContent で挿入・innerHTML 不使用）
  function showToast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    toastTimer = setTimeout(function() {
      toastEl.classList.remove('visible');
    }, 3000);
  }

  // タスク14: 入力コントロールの有効/無効状態を設定
  function setInputEnabled(enabled) {
    textInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  // タスク13/14: 状態遷移を一元管理
  function applyState() {
    if (clientState === 'syncing') {
      // WS open 後は columns 受信まで入力無効（エッジケース6）
      setInputEnabled(false);
      destinationBar.textContent = '同期中...';
      return;
    }
    if (!allowInput) {
      // 閲覧専用（エッジケース3）
      setInputEnabled(false);
      readonlyLabel.classList.add('visible');
      updateDestinationDisplay();
      return;
    }
    readonlyLabel.classList.remove('visible');
    if (clientState === 'switching') {
      setInputEnabled(false);
      updateDestinationDisplay();
      return;
    }
    if (clientState === 'sending') {
      setInputEnabled(false);
      updateDestinationDisplay();
      return;
    }
    // idle
    setInputEnabled(true);
    updateDestinationDisplay();
  }

  // タスク13: 送信先表示を更新（サーバACK後のみ・textContent で挿入）
  function updateDestinationDisplay() {
    var colNum = activeColumn + 1;
    var label = columnLabels[activeColumn] || '';
    if (label) {
      destinationBar.textContent = '→ 列' + colNum + '・' + label;
    } else {
      destinationBar.textContent = '→ 列' + colNum;
    }
  }

  // タスク11: columns メッセージから列バーのボタンを動的生成（textContent で挿入）
  function rebuildColumnBar(count, labels, active) {
    while (columnBar.firstChild) {
      columnBar.removeChild(columnBar.firstChild);
    }
    for (var i = 0; i < count; i++) {
      var btn = document.createElement('button');
      btn.className = 'col-btn' + (i === active ? ' active' : '');
      btn.dataset.col = String(i);

      var numSpan = document.createElement('span');
      numSpan.className = 'col-num';
      numSpan.textContent = String(i + 1);

      var labelSpan = document.createElement('span');
      labelSpan.className = 'col-label';
      // タブ名は textContent で挿入（innerHTML 禁止・design 3.2）
      labelSpan.textContent = labels[i] || '';

      btn.appendChild(numSpan);
      btn.appendChild(labelSpan);

      btn.addEventListener('click', (function(col) {
        return function() {
          handleColumnTap(col);
        };
      })(i));

      columnBar.appendChild(btn);
    }
  }

  // タスク13: 列タップ処理（切替中状態に遷移・ACK待ち）
  function handleColumnTap(col) {
    if (clientState !== 'idle') return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 差し戻し修正2: 同一列タップは無操作（サーバが columns を返さず切替中で固着する経路を防ぐ）
    if (col === activeColumn) return;
    // 切替中状態に遷移（送信先表示はサーバACK＝columns受信まで更新しない）
    clientState = 'switching';
    // F-1: タップ列を記録（ACK相関用）
    pendingColumn = col;
    // 差し戻し修正1: ACK待ちフラグをセット（この間の frame ではオーバーレイ解除しない）
    awaitingAck = true;
    awaitingFrame = false;
    // 切替中オーバーレイ表示（textContent で挿入）
    switchingOverlay.textContent = '列' + (col + 1) + ' に切替中…';
    switchingOverlay.classList.add('visible');
    // 全ボタンを切替中スタイルに
    var btns = columnBar.querySelectorAll('.col-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.add('switching');
    }
    applyState();
    ws.send(JSON.stringify({ type: 'selectColumn', column: col }));
  }

  // F-7: columns の各値が前回適用値と一致するか判定（DOM再生成スキップ用）
  function columnsUnchanged(count, labels, active, ai) {
    if (count !== lastColumnsCount || active !== lastColumnsActive || ai !== lastColumnsAllowInput) {
      return false;
    }
    if (labels.length !== lastColumnsLabels.length) { return false; }
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] !== lastColumnsLabels[i]) { return false; }
    }
    return true;
  }

  // タスク11/12: columns 受信処理（動的生成＋差分更新・タブ名追従）
  function handleColumnsMessage(msg) {
    var newLabels = msg.labels || [];
    var newCount = msg.count;
    var newActive = msg.active;
    var newAllowInput = msg.allowInput !== false;

    // F-1: ACK相関判定（ACK判定は DOM 更新・スキップ判定より先に行う）
    // switching 中かつ awaitingAck の場合のみ ACK として扱う
    // ACK条件: msg.active === pendingColumn（正常到達）
    //          または pendingColumn >= msg.count（列削除でクランプされた）
    var isAck = awaitingAck && clientState === 'switching' &&
      (newActive === pendingColumn || pendingColumn >= newCount);

    // 非ACK の columns は switching 状態を維持したままラベル・列バーを更新するだけにする
    // （PC側タブ変更等の無関係なブロードキャストで switching が解除されないようにする）

    // 状態変数を更新
    activeColumn = newActive;
    columnLabels = newLabels;
    allowInput = newAllowInput;

    // F-7: 前回適用値と完全一致なら DOM 再生成をスキップ（横スクロール位置を保護）
    // ただし ACK 受領時はアクティブボタン強調の更新が必要なためスキップしない
    if (!isAck && columnsUnchanged(newCount, newLabels, newActive, newAllowInput)) {
      // DOM再生成スキップ（状態変数は既に更新済み）
    } else {
      // タスク11: ボタンを動的生成（textContent 使用で XSS 防止）
      rebuildColumnBar(newCount, newLabels, newActive);
      // F-7: 適用値を記録
      lastColumnsCount = newCount;
      lastColumnsLabels = newLabels.slice();
      lastColumnsActive = newActive;
      lastColumnsAllowInput = newAllowInput;
    }

    // F-1: ACK のときだけ switching を解除して awaitingFrame に遷移
    if (isAck) {
      clientState = 'idle';
      pendingColumn = -1;
      awaitingAck = false;
      awaitingFrame = true;
    } else if (clientState === 'syncing') {
      // 初回 columns 受信で syncing を解除
      clientState = 'idle';
      awaitingAck = false;
      awaitingFrame = false;
    }
    // switching 中で非ACKの場合は clientState = 'switching' のまま維持

    applyState();
  }

  function connect() {
    // WS URL はサーバ側で Host ヘッダを埋め込まず、ブラウザの location から組む
    // （攻撃者制御の Host ヘッダによる反射XSSを構造的に排除）。
    var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      reconnectBanner.classList.remove('visible');
      // タスク14: WS open 後は columns 受信まで入力無効
      clientState = 'syncing';
      // F-2: 再接続時に切替中フラグ・ペンディング状態をリセット（前回の状態を引きずらない）
      pendingColumn = -1;
      awaitingAck = false;
      awaitingFrame = false;
      switchingOverlay.classList.remove('visible');
      // 前回の columns キャッシュをクリア（再接続後は必ずサーバ値で再描画する）
      lastColumnsCount = -1;
      lastColumnsLabels = [];
      lastColumnsActive = -1;
      lastColumnsAllowInput = true;
      applyState();
      var pixelWidth = Math.round(screen.width * (window.devicePixelRatio || 1));
      ws.send(JSON.stringify({ type: 'screenInfo', width: pixelWidth }));
    };

    ws.onclose = function() {
      reconnectBanner.classList.add('visible');
      reconnectBanner.textContent = 'Reconnecting in 3s...';
      // 切断時は sending タイムアウトをクリア
      clearTimeout(sendingTimer);
      sendingTimer = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(function() {
        reconnectBanner.textContent = 'Reconnecting...';
        connect();
      }, 3000);
    };

    ws.onmessage = function(e) {
      var msg = JSON.parse(e.data);
      if (msg.type === 'frame') {
        frame.src = msg.data;
        // F-3 / 差し戻し修正1: オーバーレイ解除は awaitingFrame=true の時のみ
        // awaitingAck 中（列タップ後〜ACK columns受信前）の旧列フレームでは解除しない
        // F-3: frame に column フィールドが付与されている場合は activeColumn と照合する
        //      column 未付与（undefined）の frame では従来どおり awaitingFrame のみで解除（後方互換）
        if (awaitingFrame) {
          var frameCol = msg.column;
          var colMatch = (typeof frameCol !== 'number') || (frameCol === activeColumn);
          if (colMatch) {
            awaitingFrame = false;
            switchingOverlay.classList.remove('visible');
          }
        }
      } else if (msg.type === 'columns') {
        // タスク11/12/13/14: columns 受信処理
        handleColumnsMessage(msg);
      } else if (msg.type === 'injectResult') {
        // タスク14: 注入結果トースト表示
        clearTimeout(sendingTimer);
        sendingTimer = null;
        var savedText = pendingText;
        pendingText = '';
        if (clientState === 'sending') {
          clientState = 'idle';
          applyState();
        }
        if (msg.ok) {
          showToast('列' + (msg.column + 1) + ' に送信しました');
        } else {
          var reason = msg.reason;
          // reason はクライアント内固定マップ経由で日本語文言化（サーバ値を直接描画しない）
          // F-6: hasOwnProperty.call ガードでプロトタイプ連鎖参照（"constructor" 等）を遮断
          var reasonText = (reason && Object.prototype.hasOwnProperty.call(INJECT_REASON_MESSAGES, reason))
            ? INJECT_REASON_MESSAGES[reason]
            : INJECT_REASON_FALLBACK;
          showToast(reasonText);
          // F-5: 失敗時に入力欄が空なら本文を復元（再入力の全損を防ぐ）
          if (!textInput.value && savedText) {
            textInput.value = savedText;
          }
        }
      }
    };
  }

  frame.addEventListener('click', function(e) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { return; }
    var rect = frame.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var y = (e.clientY - rect.top) / rect.height;
    ws.send(JSON.stringify({ type: 'click', x: x, y: y }));
  });

  // F-5: 失敗時の本文復元用に送信中テキストを保持
  var pendingText = '';

  sendBtn.addEventListener('click', function() {
    var text = textInput.value;
    if (!text) { return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { return; }
    if (clientState !== 'idle') { return; }
    // タスク14: 送信中状態に遷移（送信ボタン無効化）
    clientState = 'sending';
    // F-5: 送信本文を保持（injectResult ok:false 受信時に復元する）
    pendingText = text;
    applyState();
    ws.send(JSON.stringify({ type: 'type', text: text }));
    textInput.value = '';
    // タスク14: 10秒安全タイムアウト（injectResult が届かない場合の解除）
    clearTimeout(sendingTimer);
    sendingTimer = setTimeout(function() {
      sendingTimer = null;
      if (clientState === 'sending') {
        clientState = 'idle';
        pendingText = '';
        applyState();
        showToast(INJECT_TIMEOUT_MESSAGE);
      }
    }, 10000);
  });

  textInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      sendBtn.click();
    }
  });

  closeBtn.addEventListener('click', function() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearTimeout(sendingTimer);
    sendingTimer = null;
    if (ws) {
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'disconnect' }));
      }
      ws.close();
      ws = null;
    }
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:16px;color:#6b7280;">Disconnected</div>';
  });

  connect();
})();
</script>
</body>
</html>`;
}

export function getLoginHtml(hasError: boolean): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>itsudemo-issho</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f8f9fa;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .login-card {
    background: #fff;
    border-radius: 16px;
    padding: 32px 24px;
    width: 90%;
    max-width: 320px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    text-align: center;
  }
  .login-card h1 {
    font-size: 20px;
    color: #1a1a1a;
    margin-bottom: 24px;
  }
  .login-card input[type="password"] {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 16px;
    outline: none;
    margin-bottom: 16px;
  }
  .login-card input[type="password"]:focus {
    border-color: #7c3aed;
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
  }
  .login-card button {
    width: 100%;
    padding: 12px;
    background: #7c3aed;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
  }
  .login-card button:active {
    background: #6d28d9;
  }
  .error {
    color: #dc2626;
    font-size: 14px;
    margin-bottom: 12px;
  }
</style>
</head>
<body>
<div class="login-card">
  <h1>itsudemo-issho</h1>
  ${hasError ? '<p class="error">パスワードが違います</p>' : ''}
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="パスワード" autofocus />
    <button type="submit">接続</button>
  </form>
</div>
</body>
</html>`;
}
