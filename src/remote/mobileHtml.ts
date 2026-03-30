export function getMobileHtml(wsUrl: string): string {
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

  #columnBar {
    display: flex;
    background: #f3f4f6;
    border-top: 1px solid #e5e7eb;
    min-height: 48px;
    flex-shrink: 0;
  }

  .col-btn {
    flex: 1;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    font-size: 16px;
    font-weight: 600;
    color: #9ca3af;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.15s, border-color 0.15s;
  }

  .col-btn:active {
    background: #e5e7eb;
  }

  .col-btn.active {
    color: #7c3aed;
    border-bottom-color: #7c3aed;
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

</style>
</head>
<body>

<div class="reconnecting-banner" id="reconnectBanner">Reconnecting...</div>

<div class="app">
  <div id="screen">
    <button id="closeBtn" aria-label="Close">&times;</button>
    <img id="frame" />
  </div>

  <div id="columnBar">
    <button class="col-btn active" data-col="0">1</button>
    <button class="col-btn" data-col="1">2</button>
    <button class="col-btn" data-col="2">3</button>
    <button class="col-btn" data-col="3">4</button>
  </div>

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
  var ws = null;
  var reconnectTimer = null;

  var columnBar = document.getElementById('columnBar');
  var colBtns = columnBar.querySelectorAll('.col-btn');
  var activeColumn = 0;

  function selectColumn(col) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    activeColumn = col;
    for (var i = 0; i < colBtns.length; i++) {
      colBtns[i].className = colBtns[i].dataset.col == col ? 'col-btn active' : 'col-btn';
    }
    ws.send(JSON.stringify({ type: 'selectColumn', column: col }));
  }

  for (var i = 0; i < colBtns.length; i++) {
    colBtns[i].addEventListener('click', function() {
      selectColumn(parseInt(this.dataset.col, 10));
    });
  }

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
      } else if (msg.type === 'columns') {
        for (var i = 0; i < colBtns.length; i++) {
          colBtns[i].style.display = i < msg.count ? '' : 'none';
          colBtns[i].className = i === msg.active ? 'col-btn active' : 'col-btn';
        }
        activeColumn = msg.active;
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
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
