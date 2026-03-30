import http from "http";
import { URL } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { exec, execSync } from "child_process";
import sharp from "sharp";
import { validatePassword, generateSessionToken } from "./tokenAuth";
import { getMobileHtml, getLoginHtml } from "./mobileHtml";
import { ClientMessage, ServerMessage, TabInfo } from "./protocol";
import { detectPanelBoundaries, PanelBoundaries } from "./panelDetector";
import net from "net";

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class RemoteViewServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private password: string;
  private sessions: Set<string> = new Set();
  private windowId: string | null = null;
  private capturing = false;
  private screenWidth = 780;
  private messageCallback: ((msg: ClientMessage) => void) | null = null;
  private currentTabs: TabInfo[] = [];
  private selectedColumn = 0;
  private columnCount = 4;
  private panelCache: PanelBoundaries | null = null;
  private connectCallback: (() => void) | null = null;
  private disconnectCallback: (() => void) | null = null;

  constructor(password: string, _projectPath: string) {
    this.password = password;
  }

  setTabInfo(tabs: TabInfo[]): void {
    this.currentTabs = tabs;
    this.broadcastTabs();
  }

  private broadcastTabs(): void {
    if (!this.wss || this.wss.clients.size === 0) {
      return;
    }
    const msg: ServerMessage = { type: "tabs", data: this.currentTabs };
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  onClientMessage(callback: (msg: ClientMessage) => void): void {
    this.messageCallback = callback;
  }

  setColumnCount(count: number): void {
    this.columnCount = count;
    this.broadcastColumns();
  }

  private broadcastColumns(): void {
    if (!this.wss || this.wss.clients.size === 0) return;
    const msg: ServerMessage = { type: "columns", count: this.columnCount, active: this.selectedColumn };
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  onFirstConnect(callback: () => void): void {
    this.connectCallback = callback;
  }

  onAllDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

  async start(port: number): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      this.handleWebSocketConnection(ws, req);
    });

    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        reject(new Error("HTTP server not initialized"));
        return;
      }
      this.httpServer.listen(port, () => {
        resolve();
      });
      this.httpServer.on("error", (error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    this.stopCapture();

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }

    return new Promise((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close(() => {
        this.httpServer = null;
        resolve();
      });
    });
  }

  stopAll(): void {
    this.stopCapture();
  }

  private getVSCodeWindowId(): string {
    const result = execSync(`swift -e '
import CoreGraphics
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String, owner == "Code" || owner == "Visual Studio Code",
       let bounds = w["kCGWindowBounds"] as? [String: Any],
       let width = bounds["Width"] as? Double,
       width >= 500,
       let id = w["kCGWindowNumber"] as? Int {
        print(id)
        break
    }
}
'`).toString().trim();
    return result;
  }

  private getWindowBounds(): WindowBounds {
    const result = execSync(`swift -e '
import CoreGraphics
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String, owner == "Code" || owner == "Visual Studio Code",
       let bounds = w["kCGWindowBounds"] as? [String: Any],
       let width = bounds["Width"] as? Double,
       width >= 500,
       let x = bounds["X"] as? Double,
       let y = bounds["Y"] as? Double,
       let height = bounds["Height"] as? Double {
        print("\\(x),\\(y),\\(width),\\(height)")
        break
    }
}
'`).toString().trim();
    const parts = result.split(",");
    return {
      x: parseFloat(parts[0]),
      y: parseFloat(parts[1]),
      width: parseFloat(parts[2]),
      height: parseFloat(parts[3]),
    };
  }

  async captureOnce(): Promise<void> {
    if (!this.wss || this.wss.clients.size === 0) return;
    if (this.capturing) return;
    if (!this.windowId) {
      try { this.windowId = this.getVSCodeWindowId(); } catch { return; }
    }

    this.capturing = true;
    try {
      // 1. screencapture
      await new Promise<void>((resolve, reject) => {
        exec(`screencapture -x -o -l ${this.windowId} -t jpg /tmp/es-frame.jpg`, (err) => err ? reject(err) : resolve());
      });

      // 2. パネル境界検出
      this.panelCache = await detectPanelBoundaries("/tmp/es-frame.jpg");

      // 3. 選択カラムのクロップ＋リサイズ
      const col = this.panelCache.columns[this.selectedColumn];
      if (col) {
        const buf = await sharp("/tmp/es-frame.jpg")
          .extract({ left: col.left, top: 0, width: col.width, height: this.panelCache.imageHeight })
          .resize(this.screenWidth)
          .jpeg({ quality: 80 })
          .toBuffer();

        // 4. Base64送信
        const base64 = buf.toString("base64");
        const msg: ServerMessage = { type: "frame", data: "data:image/jpeg;base64," + base64 };
        const payload = JSON.stringify(msg);
        for (const client of this.wss!.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
      }
    } catch {
      // skip
    } finally {
      this.capturing = false;
    }
  }

  private stopCapture(): void {
    this.windowId = null;
  }

  private handleClick(x: number, y: number): void {
    let bounds: WindowBounds;
    try { bounds = this.getWindowBounds(); } catch { return; }

    // x,y はクロップ済み画像上の相対座標 (0-1)
    // panelCacheから選択中カラムの位置を取得
    const col = this.panelCache?.columns[this.selectedColumn];
    if (!col) return;

    // クロップ画像上の比率 → ウィンドウ全体のピクセル座標
    const imgX = col.left + x * col.width;
    const imgY = y * (this.panelCache?.imageHeight ?? bounds.height);

    // 画像ピクセル → ウィンドウ座標の比率変換
    const absX = Math.round(bounds.x + (imgX / (this.panelCache?.imageWidth ?? bounds.width)) * bounds.width);
    const absY = Math.round(bounds.y + (imgY / (this.panelCache?.imageHeight ?? bounds.height)) * bounds.height);

    exec(`swift -e '
import CoreGraphics
let point = CGPoint(x: ${absX}, y: ${absY})
let mouseDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
let mouseUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
mouseDown?.post(tap: .cghidEventTap)
mouseUp?.post(tap: .cghidEventTap)
'`);
  }

  private getSessionFromCookie(req: http.IncomingMessage): string | null {
    const cookie = req.headers.cookie;
    if (!cookie) return null;
    const match = cookie.match(/session=([a-f0-9]+)/);
    return match ? match[1] : null;
  }

  private handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (!this.isAllowedAccess(req)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // POST /login — パスワード認証
    if (req.method === "POST" && requestUrl.pathname === "/login") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const pw = params.get("password") || "";
        if (validatePassword(pw, this.password)) {
          const session = generateSessionToken();
          this.sessions.add(session);
          res.writeHead(302, {
            "Set-Cookie": `session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 24 * 60 * 60}`,
            "Location": "/"
          });
          res.end();
        } else {
          res.writeHead(302, { "Location": "/login?error=1" });
          res.end();
        }
      });
      return;
    }

    // GET /login — ログイン画面
    if (requestUrl.pathname === "/login") {
      const hasError = requestUrl.searchParams.has("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getLoginHtml(hasError));
      return;
    }

    // GET / — セッション検証
    if (requestUrl.pathname === "/" || requestUrl.pathname === "") {
      const sessionToken = this.getSessionFromCookie(req);
      if (!sessionToken || !this.sessions.has(sessionToken)) {
        res.writeHead(302, { "Location": "/login" });
        res.end();
        return;
      }
      const isHttps = req.headers["x-forwarded-proto"] === "https" || req.headers["cf-visitor"]?.includes('"scheme":"https"');
      const wsProtocol = isHttps ? "wss" : "ws";
      const host = req.headers.host ?? "localhost";
      const wsUrl = `${wsProtocol}://${host}/ws`;
      const html = getMobileHtml(wsUrl);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }

  private handleWebSocketConnection(
    ws: WebSocket,
    req: http.IncomingMessage
  ): void {
    if (!this.isAllowedAccess(req)) {
      ws.close(4003, "Forbidden");
      return;
    }

    const sessionToken = this.getSessionFromCookie(req);
    if (!sessionToken || !this.sessions.has(sessionToken)) {
      ws.close(4001, "Unauthorized");
      return;
    }

    // 最初のクライアント接続でキャプチャ開始＋コールバック呼び出し
    const wasFirstClient = this.wss!.clients.size === 1;
    this.captureOnce();

    if (wasFirstClient && this.connectCallback) {
      this.connectCallback();
    }

    // 接続時にタブ情報とカラム情報を即座に送信
    if (this.currentTabs.length > 0) {
      const tabMsg: ServerMessage = { type: "tabs", data: this.currentTabs };
      ws.send(JSON.stringify(tabMsg));
    }
    // columns情報を送信
    const colMsg: ServerMessage = { type: "columns", count: this.columnCount, active: this.selectedColumn };
    ws.send(JSON.stringify(colMsg));

    ws.on("message", (rawData) => {
      const data = rawData.toString();
      let message: ClientMessage;
      try {
        message = JSON.parse(data) as ClientMessage;
      } catch {
        return;
      }

      if (message.type === "click") {
        this.handleClick(message.x, message.y);
      } else if (message.type === "selectColumn") {
        this.selectedColumn = message.column;
        this.broadcastColumns();
        this.captureOnce();
      } else if (message.type === "disconnect") {
        // スマホから明示的切断 → 全クライアント閉じてキャプチャ停止+復元
        for (const client of this.wss!.clients) {
          client.close();
        }
        this.stopCapture();
        if (this.disconnectCallback) {
          this.disconnectCallback();
        }
      } else if (message.type === "screenInfo") {
        this.screenWidth = message.width || 780;
      } else if (message.type === "type" || message.type === "switchTab") {
        if (this.messageCallback) {
          this.messageCallback(message);
        }
      }
    });

    ws.on("close", () => {
      // 全クライアント切断時にキャプチャ停止＋コールバック呼び出し
      if (this.wss && this.wss.clients.size === 0) {
        this.stopCapture();
        if (this.disconnectCallback) {
          this.disconnectCallback();
        }
      }
    });
  }

  private isAllowedAccess(req: http.IncomingMessage): boolean {
    // Cloudflare Tunnel経由のアクセスを許可
    if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"]) {
      return true;
    }

    const remoteAddress =
      req.socket.remoteAddress ?? (req.connection as net.Socket).remoteAddress;
    if (!remoteAddress) {
      return false;
    }

    const addr = remoteAddress.replace(/^::ffff:/, "");

    if (addr === "127.0.0.1" || addr === "::1" || addr === "localhost") {
      return true;
    }

    if (addr.startsWith("10.")) {
      return true;
    }
    if (addr.startsWith("192.168.")) {
      return true;
    }
    if (addr.startsWith("172.")) {
      const secondOctet = parseInt(addr.split(".")[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }

    return false;
  }
}
