import http from "http";
import fs from "fs";
import { URL } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { exec, execSync } from "child_process";
import { validateToken } from "./tokenAuth";
import { getMobileHtml } from "./mobileHtml";
import { ClientMessage, ServerMessage, TabInfo } from "./protocol";
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
  private token: string;
  private captureInterval: NodeJS.Timeout | null = null;
  private windowId: string | null = null;
  private messageCallback: ((msg: ClientMessage) => void) | null = null;
  private currentTabs: TabInfo[] = [];
  private viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  private connectCallback: (() => void) | null = null;
  private disconnectCallback: (() => void) | null = null;

  constructor(token: string, _projectPath: string) {
    this.token = token;
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

  setViewport(
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    this.viewport = { x, y, width, height };
    this.broadcastViewport();
  }

  clearViewport(): void {
    this.viewport = null;
  }

  private broadcastViewport(): void {
    if (!this.wss || this.wss.clients.size === 0 || !this.viewport) {
      return;
    }
    const msg: ServerMessage = {
      type: "viewport",
      x: this.viewport.x,
      y: this.viewport.y,
      width: this.viewport.width,
      height: this.viewport.height,
    };
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  onFirstConnect(callback: () => void): void {
    this.connectCallback = callback;
  }

  onAllDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

  private sendFrame(): void {
    let data: Buffer;
    try {
      data = fs.readFileSync("/tmp/es-frame.jpg");
    } catch {
      return;
    }
    const base64 = data.toString("base64");
    const msg: ServerMessage = {
      type: "frame",
      data: "data:image/jpeg;base64," + base64,
    };
    const payload = JSON.stringify(msg);
    for (const client of this.wss!.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
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
var bestId: Int = 0
var maxWidth: Double = 0
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String, owner == "Code",
       let id = w["kCGWindowNumber"] as? Int,
       let bounds = w["kCGWindowBounds"] as? [String: Any],
       let width = bounds["Width"] as? Double {
        if width > maxWidth {
            maxWidth = width
            bestId = id
        }
    }
}
if bestId > 0 {
    print(bestId)
}
'`).toString().trim();
    return result;
  }

  private getWindowBounds(): WindowBounds {
    const result = execSync(`swift -e '
import CoreGraphics
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
var bestWindow: [String: Any]? = nil
var maxWidth: Double = 0
for w in list {
    if let owner = w["kCGWindowOwnerName"] as? String, owner == "Code",
       let bounds = w["kCGWindowBounds"] as? [String: Any],
       let width = bounds["Width"] as? Double {
        if width > maxWidth {
            maxWidth = width
            bestWindow = bounds
        }
    }
}
if let b = bestWindow,
   let x = b["X"] as? Double,
   let y = b["Y"] as? Double,
   let w = b["Width"] as? Double,
   let h = b["Height"] as? Double {
    print("\\(x),\\(y),\\(w),\\(h)")
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

  private startCapture(): void {
    if (this.captureInterval) {
      return;
    }

    try {
      this.windowId = this.getVSCodeWindowId();
    } catch {
      return;
    }

    this.captureInterval = setInterval(() => {
      if (!this.wss || this.wss.clients.size === 0) {
        return;
      }

      exec(
        `screencapture -x -o -l ${this.windowId} -t jpg /tmp/es-frame.jpg`,
        (err) => {
          if (err) {
            return;
          }
          this.sendFrame();
        }
      );
    }, 500);
  }

  private stopCapture(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    this.windowId = null;
  }

  private handleClick(x: number, y: number): void {
    let bounds: WindowBounds;
    try {
      bounds = this.getWindowBounds();
    } catch {
      return;
    }

    const absX = Math.round(bounds.x + x * bounds.width);
    const absY = Math.round(bounds.y + y * bounds.height);

    exec(`swift -e '
import CoreGraphics
let point = CGPoint(x: ${absX}, y: ${absY})
let mouseDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
let mouseUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
mouseDown?.post(tap: .cghidEventTap)
mouseUp?.post(tap: .cghidEventTap)
'`);
  }

  private handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (!this.isAllowedAccess(req)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: Only LAN access is allowed");
      return;
    }

    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const tokenParam = requestUrl.searchParams.get("token");

    if (!tokenParam || !validateToken(tokenParam, this.token)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized: Invalid token");
      return;
    }

    if (requestUrl.pathname === "/" || requestUrl.pathname === "") {
      const isHttps = req.headers["x-forwarded-proto"] === "https" || req.headers["cf-visitor"]?.includes('"scheme":"https"');
      const wsProtocol = isHttps ? "wss" : "ws";
      const host = req.headers.host ?? "localhost";
      const wsUrl = `${wsProtocol}://${host}/ws?token=${tokenParam}`;
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
      ws.close(4003, "Forbidden: Only LAN access is allowed");
      return;
    }

    const requestUrl = new URL(
      req.url ?? "/",
      `http://${req.headers.host}`
    );
    const tokenParam = requestUrl.searchParams.get("token");

    if (!tokenParam || !validateToken(tokenParam, this.token)) {
      ws.close(4001, "Unauthorized: Invalid token");
      return;
    }

    // 最初のクライアント接続でキャプチャ開始＋コールバック呼び出し
    const wasFirstClient = this.wss!.clients.size === 1;
    this.startCapture();

    if (wasFirstClient && this.connectCallback) {
      this.connectCallback();
    }

    // 接続時にタブ情報とviewportを即座に送信
    if (this.currentTabs.length > 0) {
      const tabMsg: ServerMessage = { type: "tabs", data: this.currentTabs };
      ws.send(JSON.stringify(tabMsg));
    }
    if (this.viewport) {
      const vpMsg: ServerMessage = {
        type: "viewport",
        x: this.viewport.x,
        y: this.viewport.y,
        width: this.viewport.width,
        height: this.viewport.height,
      };
      ws.send(JSON.stringify(vpMsg));
    }

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
      } else if (message.type === "disconnect") {
        // スマホから明示的切断 → 全クライアント閉じてキャプチャ停止+復元
        for (const client of this.wss!.clients) {
          client.close();
        }
        this.stopCapture();
        if (this.disconnectCallback) {
          this.disconnectCallback();
        }
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
