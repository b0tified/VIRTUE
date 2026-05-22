import { BACKEND_URL } from "@/api";

export class GameSocket {
  constructor({ onMessage, onClose, onOpen } = {}) {
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});
    this.onOpen = onOpen || (() => {});
    this.ws = null;
  }

  connect(token, mode, extraParams) {
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
    const url = `${wsProto}//${httpUrl.host}/api/ws/game?${params.toString()}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this._intentional = false;
    ws.onopen = () => this.onOpen();
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.onMessage(msg);
      } catch {}
    };
    ws.onclose = () => this.onClose(this._intentional);
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
