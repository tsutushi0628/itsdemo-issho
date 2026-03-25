import * as vscode from "vscode";

export class RemoteWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "editorSpotlighter.remoteView";

  private _view?: vscode.WebviewView;
  private _state: "stopped" | "running" = "stopped";
  private _qrSvg: string = "";
  private _url: string = "";
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

  setRunning(qrSvg: string, url: string): void {
    this._state = "running";
    this._qrSvg = qrSvg;
    this._url = url;
    this._update();
  }

  setStopped(): void {
    this._state = "stopped";
    this._qrSvg = "";
    this._url = "";
    this._update();
  }

  private _update(): void {
    if (!this._view) {
      return;
    }

    if (this._state === "stopped") {
      this._view.webview.html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: var(--vscode-font-family); padding: 12px; text-align: center; color: var(--vscode-foreground); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; width: 100%; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  p { font-size: 12px; margin-bottom: 12px; }
</style></head>
<body>
  <p>Scan QR code from your phone</p>
  <button onclick="startRemote()">&#9654; Start Remote</button>
  <script>
    const vscode = acquireVsCodeApi();
    function startRemote() { vscode.postMessage({ command: 'start' }); }
  </script>
</body></html>`;
    } else {
      this._view.webview.html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: var(--vscode-font-family); padding: 12px; text-align: center; color: var(--vscode-foreground); }
  .qr { width: 100%; max-width: 200px; margin: 0 auto; }
  .qr svg { width: 100%; height: auto; }
  .url { font-size: 10px; color: var(--vscode-descriptionForeground); word-break: break-all; margin-top: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%; margin-top: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
  <div class="qr">${this._qrSvg}</div>
  <div class="url">${this._url}</div>
  <button onclick="stopRemote()">&#9724; Stop Remote</button>
  <script>
    const vscode = acquireVsCodeApi();
    function stopRemote() { vscode.postMessage({ command: 'stop' }); }
  </script>
</body></html>`;
    }
  }
}
