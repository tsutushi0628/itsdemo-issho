export function getMobileHtml(wsUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
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

  #screen {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 56px;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    background: #f8f9fa;
  }

  #frame {
    width: 100%;
    height: auto;
    display: block;
  }

  #inputBar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
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
</style>
</head>
<body>

<div class="reconnecting-banner" id="reconnectBanner">Reconnecting...</div>

<div id="screen">
  <img id="frame" />
</div>

<div id="inputBar">
  <div class="input-row">
    <input id="textInput" type="text" placeholder="Type here..." />
    <button id="sendBtn">&#9654;</button>
  </div>
</div>

<script>
(function() {
  var frame = document.getElementById('frame');
  var textInput = document.getElementById('textInput');
  var sendBtn = document.getElementById('sendBtn');
  var reconnectBanner = document.getElementById('reconnectBanner');
  var ws = null;
  var reconnectTimer = null;

  function connect() {
    ws = new WebSocket('${wsUrl}');

    ws.onopen = function() {
      reconnectBanner.classList.remove('visible');
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

  connect();
})();
</script>
</body>
</html>`;
}
