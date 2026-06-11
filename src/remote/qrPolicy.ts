/**
 * 待ち受けアドレス設定と tunnel 設定から QR/URL/案内の表示種別を決定する純関数。
 * design 4.2 参照。
 */

/** bind 既定値の単一真実源（B-12）。extension.ts・remoteViewServer.ts が参照する。 */
export const DEFAULT_BIND_ADDRESS = "127.0.0.1";

export type RemoteAccessDisplay =
  | { kind: "tunnel"; url: string }    // tunnelDomain 設定済 → https://{domain}/
  | { kind: "lan"; url: string }       // LAN 待ち受け → http://{urlHost}:{port}/
  | { kind: "localOnly"; url: string }; // 127.0.0.1 待ち受け×tunnel 未設定 → QR なし＋案内

const LOCAL_ONLY_ADDRESSES = ["127.0.0.1", "localhost", "::1"];

export function decideRemoteAccessDisplay(input: {
  bindAddress: string;
  tunnelDomain: string;
  port: number;
  lanIp: string;
}): RemoteAccessDisplay {
  const { bindAddress, tunnelDomain, port, lanIp } = input;

  // tunnel 設定済みなら bind 設定に関わらず tunnel URL（最優先）
  if (tunnelDomain) {
    return { kind: "tunnel", url: `https://${tunnelDomain}/` };
  }

  // 127.0.0.1 / localhost / ::1 かつ tunnel 未設定 → localOnly
  if (LOCAL_ONLY_ADDRESSES.includes(bindAddress)) {
    return { kind: "localOnly", url: `http://127.0.0.1:${port}/` };
  }

  // 0.0.0.0 / "::" は全インターフェース待ち受け → LAN IP でアクセスできる（B-4）
  // 具体 IP 指定（VPN/複数NIC 等）→ そのアドレスでしか listen していないため bindAddress を使う
  const urlHost = (bindAddress === "0.0.0.0" || bindAddress === "::") ? lanIp : bindAddress;
  return { kind: "lan", url: `http://${urlHost}:${port}/` };
}
