import * as vscode from "vscode";
import * as crypto from "crypto";

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class RemoteWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "editorSpotlighter.remoteView";

  private _view?: vscode.WebviewView;
  private _state: "stopped" | "running" = "stopped";
  private _qrSvg: string = "";
  private _url: string = "";
  private _password: string = "";
  private _onMessage?: (message: { command: string }) => void;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage((message: { command: string }) => {
      if (this._onMessage) {
        this._onMessage(message);
      }
    });

    this._update();
  }

  onDidReceiveMessage(handler: (message: { command: string }) => void): void {
    this._onMessage = handler;
  }

  setRunning(qrSvg: string, url: string, password: string): void {
    this._state = "running";
    this._qrSvg = qrSvg;
    this._url = url;
    this._password = password;
    this._update();
  }

  setStopped(): void {
    this._state = "stopped";
    this._qrSvg = "";
    this._url = "";
    this._password = "";
    this._update();
  }

  private _update(): void {
    if (!this._view) {
      return;
    }

    // インラインスクリプトには nonce を付与し、CSP で nonce 付き script 以外の実行を禁止。
    // url/password は外部設定・生成値なので必ずエスケープしてから埋め込む。
    const nonce = crypto.randomBytes(16).toString("hex");
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}';`;
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

    if (this._state === "stopped") {
      this._view.webview.html = `<!DOCTYPE html>
<html><head>${cspMeta}<style>
  body { font-family: var(--vscode-font-family); padding: 12px; text-align: center; color: var(--vscode-foreground); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; width: 100%; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  p { font-size: 12px; margin-bottom: 12px; }
</style></head>
<body>
  <p>Scan QR code from your phone</p>
  <button id="startBtn">&#9654; Start Remote</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('startBtn').addEventListener('click', function () {
      vscode.postMessage({ command: 'start' });
    });
  </script>
</body></html>`;
    } else {
      this._view.webview.html = `<!DOCTYPE html>
<html><head>${cspMeta}<style>
  body { font-family: var(--vscode-font-family); padding: 12px; text-align: center; color: var(--vscode-foreground); }
  .qr { width: 100%; max-width: 200px; margin: 0 auto; }
  .qr svg { width: 100%; height: auto; }
  .url { font-size: 10px; color: var(--vscode-descriptionForeground); word-break: break-all; margin-top: 8px; }
  .pw-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 12px; }
  .pw { font-size: 16px; font-weight: 700; font-family: var(--vscode-editor-font-family, monospace); letter-spacing: 1px; user-select: all; margin-top: 2px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%; margin-top: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
  <div class="qr">${this._qrSvg}</div>
  <div class="url">${htmlEscape(this._url)}</div>
  <div class="pw-label">Password (enter on phone)</div>
  <div class="pw">${htmlEscape(this._password)}</div>
  <button id="stopBtn">&#9724; Stop Remote</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('stopBtn').addEventListener('click', function () {
      vscode.postMessage({ command: 'stop' });
    });
  </script>
</body></html>`;
    }
  }
}
