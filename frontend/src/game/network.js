import { BACKEND_URL } from "@/api";

export class GameSocket {
  constructor({ onMessage, onClose, onOpen } = {}) {
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});
    this.onOpen = onOpen || (() => {});
    this.ws = null;
  }

  // `node` (in extraParams) pins a server node; the server rejects wrong-node handshakes so we retry.
  connect(token, mode, extraParams, attempt = 0) {
    const httpUrl = new URL(BACKEND_URL);
    const wsProto = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (mode) params.set("mode", mode);
    if (extraParams && typeof extraParams === "object") {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v != null && v !== "") params.set(k, String(v));
      }
    }
    const pinned = params.has("node");
    if (pinned) params.set("node_try", String(attempt));
    const url = `${wsProto}//${httpUrl.host}/api/ws/game?${params.toString()}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this._intentional = false;
    let opened = false;
    ws.onopen = () => { opened = true; this.onOpen(); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "node_info") {
          this.nodeInfo = msg;
          if (!msg.landed) this.onNodeMiss?.(msg);
          return;
        }
        this.onMessage(msg);
      } catch {}
    };
    ws.onclose = () => {
      if (pinned && !opened && !this._intentional && attempt < 6) {
        setTimeout(() => { if (!this._intentional) this.connect(token, mode, extraParams, attempt + 1); }, 40);
        return;
      }
      this.onClose(this._intentional);
    };
    ws.onerror = () => {};
    return ws;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this._intentional = true;
    this.ws?.close();
  }
}
