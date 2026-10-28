// Measure each server node's real WebSocket RTT so "Auto" can pick the fastest node.
import api, { BACKEND_URL } from "@/api";

const CACHE_KEY = "virtue_fastest_node";
const CACHE_MS = 120000;

function wsBase() {
  const u = new URL(BACKEND_URL);
  return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/api/ws/nodeping`;
}

function openOnNode(code, attempt = 0) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase()}?node=${encodeURIComponent(code)}&node_try=${attempt}`);
    let opened = false;
    ws.onopen = () => { opened = true; resolve(ws); };
    ws.onclose = () => {
      if (opened) return;
      if (attempt < 5) openOnNode(code, attempt + 1).then(resolve);
      else resolve(null);
    };
  });
}

// Returns min RTT in ms for `code`, or null if that node couldn't be reached directly.
export async function measureNode(code, samples = 4) {
  const ws = await openOnNode(code);
  if (!ws) return null;
  return new Promise((resolve) => {
    const rtts = [];
    let sentAt = 0;
    let landed = null;
    const done = (v) => { try { ws.close(); } catch {} resolve(v); };
    const ping = () => { sentAt = performance.now(); ws.send("p"); };
    ws.onmessage = (ev) => {
      if (landed === null) {
        try { landed = JSON.parse(ev.data).landed !== false; } catch { landed = true; }
        if (!landed) return done(null);
        return ping();
      }
      rtts.push(performance.now() - sentAt);
      if (rtts.length >= samples) return done(Math.round(Math.min(...rtts.slice(1))));
      ping();
    };
    ws.onclose = () => resolve(rtts.length > 1 ? Math.round(Math.min(...rtts.slice(1))) : null);
    setTimeout(() => done(rtts.length > 1 ? Math.round(Math.min(...rtts.slice(1))) : null), 2500);
  });
}

export async function listNodes() {
  const { data } = await api.get("/cluster/nodes");
  return data.nodes || [];
}

// Fastest node code, or "auto" (node hosting matches) when it can't be measured.
export async function pickFastestNode() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (c && Date.now() - c.at < CACHE_MS) return c.code;
  } catch {}
  try {
    const nodes = await listNodes();
    if (nodes.length <= 1) return nodes[0]?.code || "auto";
    const results = await Promise.all(nodes.map(async (n) => ({ code: n.code, ms: await measureNode(n.code) })));
    const best = results.filter((r) => r.ms != null).sort((a, b) => a.ms - b.ms)[0];
    const code = best ? best.code : "auto";
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ code, at: Date.now() })); } catch {}
    return code;
  } catch {
    return "auto";
  }
}
