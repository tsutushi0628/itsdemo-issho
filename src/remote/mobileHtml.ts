export function getMobileHtml(wsUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
<title>Editor Spotlighter Remote</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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

  #tabBar {
    display: flex;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    background: #f3f4f6;
    border-top: 1px solid #e5e7eb;
    min-height: 44px;
    flex-shrink: 0;
    scrollbar-width: none;
  }

  #tabBar::-webkit-scrollbar {
    display: none;
  }

  .tab-item {
    display: flex;
    align-items: center;
    padding: 0 16px;
    white-space: nowrap;
    font-size: 13px;
    color: #6b7280;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    flex-shrink: 0;
    min-height: 44px;
    transition: color 0.15s, border-color 0.15s;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .tab-item:active {
    background: #e5e7eb;
  }

  .tab-item.active {
    color: #7c3aed;
    border-bottom-color: #7c3aed;
    font-weight: 600;
  }

  #inputBar {
    flex-shrink: 0;
    padding: 8px 12px calc(env(safe-area-inset-bottom, 8px) + 8px);
    background: #ffffff;
    border-top: 1px solid #e5e7eb;
    z-index: 10;
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

  .no-tabs {
    display: none;
  }
</style>
</head>
<body>

<div class="reconnecting-banner" id="reconnectBanner">Reconnecting...</div>

<div class="app">
  <div id="screen">
    <button id="closeBtn" aria-label="Close">&times;</button>
    <img id="frame" />
  </div>

  <div id="tabBar" class="no-tabs"></div>

  <div id="inputBar">
    <div class="input-row">
      <input id="textInput" type="text" placeholder="Type here..." />
      <button id="sendBtn">&#9654;</button>
    </div>
  </div>
</div>

<script>
(function() {
  var frame = document.getElementById('frame');
  var textInput = document.getElementById('textInput');
  var sendBtn = document.getElementById('sendBtn');
  var closeBtn = document.getElementById('closeBtn');
  var reconnectBanner = document.getElementById('reconnectBanner');
  var tabBar = document.getElementById('tabBar');
  var ws = null;
  var reconnectTimer = null;

  // ダブルタップは将来のスクロール調整用に予約

  function connect() {
    ws = new WebSocket('${wsUrl}');

    ws.onopen = function() {
      reconnectBanner.classList.remove('visible');
      var pixelWidth = Math.round(screen.width * (window.devicePixelRatio || 1));
      ws.send(JSON.stringify({ type: 'screenInfo', width: pixelWidth }));
    };

    ws.onclose = function() {
      reconnectBanner.classList.add('visible');
      reconnectBanner.textContent = 'Reconnecting in 3s...';
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
      } else if (msg.type === 'tabs') {
        renderTabs(msg.data);
      } else if (msg.type === 'viewport') {
        // Server sends cropped image, no CSS transform needed
        frame.style.width = '100%';
        frame.style.marginLeft = '0';
      }
    };
  }

  function renderTabs(tabs) {
    if (!tabs || tabs.length === 0) {
      tabBar.className = 'no-tabs';
      tabBar.textContent = '';
      return;
    }

    tabBar.className = '';
    tabBar.id = 'tabBar';
    tabBar.textContent = '';

    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var el = document.createElement('div');
      el.className = 'tab-item';
      if (tab.isActive) {
        el.className = 'tab-item active';
      }
      el.textContent = tab.label;
      el.dataset.groupIndex = tab.groupIndex;
      el.dataset.tabIndex = tab.tabIndex;
      el.addEventListener('click', function() {
        if (!ws || ws.readyState !== WebSocket.OPEN) { return; }
        ws.send(JSON.stringify({
          type: 'switchTab',
          groupIndex: parseInt(this.dataset.groupIndex, 10),
          tabIndex: parseInt(this.dataset.tabIndex, 10)
        }));
      });
      tabBar.appendChild(el);
    }

    // アクティブタブを表示領域にスクロール
    var activeEl = tabBar.querySelector('.tab-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }

  frame.addEventListener('click', function(e) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { return; }
    var rect = frame.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var y = (e.clientY - rect.top) / rect.height;
    ws.send(JSON.stringify({ type: 'click', x: x, y: y }));
  });

  sendBtn.addEventListener('click', function() {
    var text = textInput.value;
    if (!text) { return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { return; }
    ws.send(JSON.stringify({ type: 'type', text: text }));
    textInput.value = '';
  });

  textInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      sendBtn.click();
    }
  });

  closeBtn.addEventListener('click', function() {
    // 自動再接続を停止
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (ws) {
      ws.onclose = null;  // 再接続ハンドラを無効化
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
