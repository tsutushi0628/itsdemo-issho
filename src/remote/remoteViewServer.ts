import http from "http";
import { URL } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { exec } from "child_process";
import sharp from "sharp";
import { validatePassword, generateSessionToken } from "./tokenAuth";
import { getMobileHtml, getLoginHtml } from "./mobileHtml";
import { ClientMessage, ServerMessage, TabInfo, InjectAbortReason } from "./protocol";
import { detectPanelBoundaries, PanelBoundaries } from "./panelDetector";
import { getVSCodeWindowId, getWindowBoundsSync, WindowBounds } from "../windowDetector";
import { DEFAULT_BIND_ADDRESS } from "./qrPolicy";
import net from "net";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // セッション有効期限（12時間）

/**
 * 選択列が実列数の範囲外になった場合に末尾列へ寄せる純関数（エッジケース5）。
 * count が 0 の場合は 0 を返す。
 */
export function clampSelectedColumn(selected: number, count: number): number {
  if (count <= 0) return 0;
  if (selected >= count) return count - 1;
  return selected;
}

/**
 * TabInfo 配列と列数から各グループのアクティブタブ名を導出する純関数（要件 b-2）。
 * アクティブタブが無いグループは空文字。count 超過分の切り捨て、不足分は空文字で埋める。
 */
export function deriveColumnLabels(tabs: TabInfo[], count: number): string[] {
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const activeTab = tabs.find((t) => t.groupIndex === i && t.isActive);
    labels.push(activeTab ? activeTab.label : "");
  }
  return labels;
}
const LOGIN_MAX_FAILS = 5;                  // 同一IPの連続失敗許容回数
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;     // 失敗超過時のロックアウト（5分）
const MAX_TYPE_LENGTH = 2000;               // リモート入力テキストの最大長

export class RemoteViewServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private password: string;
  private allowInput: boolean;
  // session token -> 失効エポックms。Set ではなく期限付き Map にして無期限滞留を防ぐ。
  private sessions: Map<string, number> = new Map();
  // 接続元IP -> ログイン失敗の {回数, 直近失敗時刻}。総当たりをロックアウトで抑止。
  private loginFails: Map<string, { count: number; last: number }> = new Map();
  // 開いている各WS接続 -> その接続のセッショントークン。失効後に接続を閉じるため。
  private clientSessions: Map<WebSocket, string> = new Map();
  // 失効セッション・古い失敗記録・期限切れ接続を定期的に掃除するタイマー。
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private windowId: string | null = null;
  private capturing = false;
  private screenWidth = 780;
  private messageCallback: ((msg: ClientMessage) => void) | null = null;
  private currentTabs: TabInfo[] = [];
  private selectedColumn = 0;
  private columnCount = 0;
  private columnLabels: string[] = [];
  private lastColumnPayload: string = "";  // setColumns の重複ブロードキャスト抑止（B-9）
  private panelCache: PanelBoundaries | null = null;
  private connectCallback: (() => void) | null = null;
  private disconnectCallback: (() => void) | null = null;

  constructor(password: string, _projectPath: string, allowInput: boolean = true) {
    this.password = password;
    this.allowInput = allowInput;
  }

  // 接続元IPを正規化して取得（IPv4-mapped IPv6 を素のIPv4に）。
  private clientIp(req: http.IncomingMessage): string {
    const raw = req.socket.remoteAddress ?? (req.connection as net.Socket).remoteAddress ?? "";
    return raw.replace(/^::ffff:/, "");
  }

  // 失効済みセッションを掃除する。
  private pruneSessions(now: number): void {
    for (const [token, exp] of this.sessions) {
      if (exp <= now) {
        this.sessions.delete(token);
      }
    }
  }

  // ロックアウト窓を過ぎたログイン失敗記録を掃除する（Map の無制限増加=メモリ枯渇を防ぐ）。
  private pruneLoginFails(now: number): void {
    for (const [ip, info] of this.loginFails) {
      if (now - info.last >= LOGIN_LOCKOUT_MS) {
        this.loginFails.delete(ip);
      }
    }
  }

  // セッションが失効した開きっぱなしのWS接続を閉じる（確立時だけでなく継続中も失効を反映）。
  private closeExpiredClients(): void {
    for (const [client, token] of this.clientSessions) {
      if (!this.hasValidSession(token)) {
        this.clientSessions.delete(client);
        try { client.close(4001, "Session expired"); } catch { /* noop */ }
      }
    }
  }

  // 配信先として有効か（OPEN かつセッション有効）。失効した接続には画面フレーム等を一切送らない。
  private canSendTo(client: WebSocket): boolean {
    return (
      client.readyState === WebSocket.OPEN &&
      this.hasValidSession(this.clientSessions.get(client) ?? null)
    );
  }

  private hasValidSession(token: string | null): boolean {
    if (!token) return false;
    const exp = this.sessions.get(token);
    if (exp === undefined) return false;
    if (exp <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  // 接続が https 経由か（プロトコルヒント用途のみ。アクセス制御には使わない）。
  private isHttps(req: http.IncomingMessage): boolean {
    const visitor = req.headers["cf-visitor"];
    return (
      req.headers["x-forwarded-proto"] === "https" ||
      (typeof visitor === "string" && visitor.includes('"scheme":"https"'))
    );
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
      if (this.canSendTo(client)) {
        client.send(payload);
      }
    }
  }

  onClientMessage(callback: (msg: ClientMessage) => void): void {
    this.messageCallback = callback;
  }

  getSelectedColumn(): number {
    return this.selectedColumn;
  }

  /**
   * 実グループ数ベースで列数とラベルを更新し、選択列をクランプしてブロードキャスト。
   * 既存の setColumnCount を置換（design 2.4, 3.3）。
   */
  setColumns(count: number, labels: string[]): void {
    this.columnCount = count;
    this.columnLabels = labels;
    this.selectedColumn = clampSelectedColumn(this.selectedColumn, count);
    // 前回送信ペイロードと同一なら省略（selectColumn 経由の broadcastColumns は無条件維持・ACK契約）
    const payload = this.buildColumnsPayload();
    if (payload === this.lastColumnPayload) return;
    this.lastColumnPayload = payload;
    this.broadcastColumnsWithPayload(payload);
  }

  sendInjectResult(result: { ok: boolean; reason?: InjectAbortReason; column: number }): void {
    if (!this.wss || this.wss.clients.size === 0) return;
    const msg: ServerMessage = { type: "injectResult", ...result };
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (this.canSendTo(client)) client.send(payload);
    }
  }

  /** テスト可能にするため package-internal export。現在の columns 状態を JSON 文字列で返す。 */
  buildColumnsPayload(): string {
    const msg: ServerMessage = {
      type: "columns",
      count: this.columnCount,
      active: this.selectedColumn,
      labels: this.columnLabels,
      allowInput: this.allowInput,
    };
    return JSON.stringify(msg);
  }

  private broadcastColumnsWithPayload(payload: string): void {
    if (!this.wss || this.wss.clients.size === 0) return;
    for (const client of this.wss.clients) {
      if (this.canSendTo(client)) client.send(payload);
    }
  }

  private broadcastColumns(): void {
    this.broadcastColumnsWithPayload(this.buildColumnsPayload());
  }

  /** 特定の接続1本へ現在の columns 状態を送る（再同期用）。 */
  sendColumnsTo(ws: WebSocket): void {
    if (this.canSendTo(ws)) {
      ws.send(this.buildColumnsPayload());
    }
  }

  onFirstConnect(callback: () => void): void {
    this.connectCallback = callback;
  }

  onAllDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

  async start(port: number, host: string = DEFAULT_BIND_ADDRESS): Promise<void> {
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
      // bind 先を明示。既定はローカルのみ（トンネル経由向け・安全）。LAN 直結は "0.0.0.0" を渡す。
      this.httpServer.listen(port, host, () => {
        // listen 成功時だけ掃除タイマーを起動（listen 失敗で reject した際のタイマー残留を防ぐ）。
        if (!this.maintenanceTimer) {
          this.maintenanceTimer = setInterval(() => {
            const now = Date.now();
            this.pruneSessions(now);
            this.pruneLoginFails(now);
            this.closeExpiredClients();
          }, 60 * 1000);
        }
        resolve();
      });
      this.httpServer.on("error", (error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    this.stopCapture();

    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    this.clientSessions.clear();

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



  async captureOnce(): Promise<void> {
    if (!this.wss || this.wss.clients.size === 0) return;
    if (this.capturing) return;
    if (!this.windowId) {
      try { this.windowId = getVSCodeWindowId(); } catch { return; }
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
          .extract({ left: col.left, top: 0, width: col.width, height: this.panelCache.editorBottom })
          .resize(this.screenWidth)
          .jpeg({ quality: 80 })
          .toBuffer();

        // 4. Base64送信（column はクライアント側の列タグ判定に使う・B-5）
        const base64 = buf.toString("base64");
        const msg: ServerMessage = { type: "frame", data: "data:image/jpeg;base64," + base64, column: this.selectedColumn };
        const payload = JSON.stringify(msg);
        for (const client of this.wss!.clients) {
          // 失効した接続には編集画面のフレームを送らない（受動的な画面流出を防ぐ）。
          if (this.canSendTo(client)) client.send(payload);
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
    try { bounds = getWindowBoundsSync(); } catch { return; }

    // x,y はクロップ済み画像上の相対座標 (0-1)
    // panelCacheから選択中カラムの位置を取得
    const col = this.panelCache?.columns[this.selectedColumn];
    if (!col) return;

    // クロップ画像上の比率 → ウィンドウ全体のピクセル座標
    const imgX = col.left + x * col.width;
    const imgY = y * (this.panelCache?.editorBottom ?? bounds.height);

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
      const ip = this.clientIp(req);
      const now = Date.now();

      // 総当たり対策: 同一IPが連続失敗したらロックアウト
      const fail = this.loginFails.get(ip);
      if (fail && fail.count >= LOGIN_MAX_FAILS && now - fail.last < LOGIN_LOCKOUT_MS) {
        res.writeHead(429, {
          "Content-Type": "text/plain",
          "Retry-After": String(Math.ceil(LOGIN_LOCKOUT_MS / 1000)),
        });
        res.end("Too Many Requests");
        return;
      }

      let body = "";
      let aborted = false;
      req.on("data", (chunk) => {
        if (aborted) return;
        body += chunk;
        // 認証本文に上限。無制限蓄積によるメモリ枯渇DoSを防ぐ。
        if (body.length > 4096) {
          aborted = true;
          res.writeHead(413, { "Content-Type": "text/plain" });
          res.end("Payload Too Large");
          req.destroy();
        }
      });
      req.on("end", () => {
        if (aborted) return;
        const params = new URLSearchParams(body);
        const pw = params.get("password") || "";
        if (validatePassword(pw, this.password)) {
          this.loginFails.delete(ip);
          const t = Date.now();
          this.pruneSessions(t);
          const session = generateSessionToken();
          this.sessions.set(session, t + SESSION_TTL_MS);
          const secure = this.isHttps(req) ? " Secure;" : "";
          res.writeHead(302, {
            "Set-Cookie": `session=${session}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
            "Location": "/",
          });
          res.end();
        } else {
          const prev = this.loginFails.get(ip);
          const recent = prev && now - prev.last < LOGIN_LOCKOUT_MS ? prev.count : 0;
          this.loginFails.set(ip, { count: recent + 1, last: now });
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
      if (!this.hasValidSession(sessionToken)) {
        res.writeHead(302, { "Location": "/login" });
        res.end();
        return;
      }
      // WS URL はクライアント側で location から組むため Host ヘッダを埋め込まない。
      const html = getMobileHtml();
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
    if (!this.hasValidSession(sessionToken)) {
      ws.close(4001, "Unauthorized");
      return;
    }
    // この接続のセッションを記録（失効時にこの接続を閉じるため）。
    this.clientSessions.set(ws, sessionToken as string);

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
    // columns情報を送信（再接続直後の状態同期含む・エッジケース6）
    this.sendColumnsTo(ws);

    ws.on("message", (rawData) => {
      const data = rawData.toString();
      let message: ClientMessage;
      try {
        message = JSON.parse(data) as ClientMessage;
      } catch {
        return;
      }

      // どのメッセージでも毎回セッション有効性を再確認（確立後に失効していたら即閉じる）。
      // selectColumn 経由の画面キャプチャ誘発や disconnect の悪用も含めて締め出す。
      {
        const tok = this.clientSessions.get(ws) ?? null;
        if (!this.hasValidSession(tok)) {
          this.clientSessions.delete(ws);
          ws.close(4001, "Session expired");
          return;
        }
      }

      if (message.type === "click") {
        // 画面クリックはホストへの入力。許可フラグと座標域（0-1）を検証してから実行。
        if (!this.allowInput) return;
        const { x, y } = message;
        if (
          typeof x !== "number" || typeof y !== "number" ||
          !isFinite(x) || !isFinite(y) ||
          x < 0 || x > 1 || y < 0 || y > 1
        ) {
          return;
        }
        this.handleClick(x, y);
      } else if (message.type === "selectColumn") {
        // カラム選択は画面ナビのみ（ホスト入力ではない）。範囲を検証。
        // 範囲外・型不正の場合も必ずその接続へ現在状態の columns を返して
        // クライアント状態を再同期させる（design 5.2 / ACK 必須契約）。
        const c = message.column;
        if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= this.columnCount) {
          this.sendColumnsTo(ws);
          return;
        }
        this.selectedColumn = c;
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
        // 攻撃者制御の幅を sharp.resize に渡すとメモリ枯渇DoS。妥当域にクランプ。
        const w = message.width;
        this.screenWidth =
          typeof w === "number" && isFinite(w) && w >= 100 && w <= 4000 ? Math.round(w) : 780;
      } else if (message.type === "type") {
        // リモート入力。許可フラグと型・長さを検証してから転送。
        if (!this.allowInput) return;
        if (typeof message.text !== "string" || message.text.length === 0 || message.text.length > MAX_TYPE_LENGTH) {
          return;
        }
        if (this.messageCallback) {
          this.messageCallback(message);
        }
      } else if (message.type === "switchTab") {
        if (!this.allowInput) return;
        if (this.messageCallback) {
          this.messageCallback(message);
        }
      }
    });

    ws.on("close", () => {
      this.clientSessions.delete(ws);
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
    // 許可判定は「実際の接続元ソケットIP」だけで行う。攻撃者が任意に付けられる
    // cf-connecting-ip / cf-ray 等のヘッダは信用しない（なりすましで許可リストを
    // 突破されるため）。Cloudflare Tunnel 利用時も cloudflared は localhost から
    // 接続するため、下の 127.0.0.1 / ::1 許可で正しく通る。
    const addr = this.clientIp(req);
    if (!addr) {
      return false;
    }

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
