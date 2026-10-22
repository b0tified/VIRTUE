"""Multi-replica coordination: one pod is elected leader (Mongo lease) and every
other pod transparently proxies /api HTTP + WebSocket traffic to it, so all
players share the same in-memory matches, queues, parties and presence."""
import asyncio
import logging
import os
import socket
import time

import httpx
import websockets

logger = logging.getLogger("cluster")

LEASE_TTL_S = 10.0
RENEW_EVERY_S = 3.0
BAD_LEADER_COOLDOWN_S = 60.0
PROXY_HEADER = "x-virtue-proxied"
POD_PORT = 8001
HOP_HEADERS = {"host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade",
               "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-accept"}


def _pod_ip() -> str:
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return "127.0.0.1"


STATE = {
    "node": f"{socket.gethostname()}-{os.getpid()}",
    "addr": f"{_pod_ip()}:{POD_PORT}",
    "is_leader": True,
    "leader_addr": None,
    "leader_node": None,
    "bad_until": 0.0,
    "proxied_http": 0,
    "proxied_ws": 0,
}


async def leader_loop(db) -> None:
    """Claim or renew the leader lease; followers record the leader address."""
    while True:
        now = time.time()
        try:
            doc = await db.meta.find_one_and_update(
                {"_id": "cluster_leader", "$or": [{"expires": {"$lt": now}}, {"node": STATE["node"]}]},
                {"$set": {"node": STATE["node"], "addr": STATE["addr"], "expires": now + LEASE_TTL_S}},
                upsert=False, return_document=True,
            )
            if doc is None:
                try:
                    await db.meta.insert_one({"_id": "cluster_leader", "node": STATE["node"],
                                              "addr": STATE["addr"], "expires": now + LEASE_TTL_S})
                    doc = {"node": STATE["node"], "addr": STATE["addr"]}
                except Exception:
                    doc = await db.meta.find_one({"_id": "cluster_leader"})
            was = STATE["is_leader"]
            STATE["is_leader"] = bool(doc) and doc.get("node") == STATE["node"]
            STATE["leader_addr"] = None if STATE["is_leader"] else (doc or {}).get("addr")
            STATE["leader_node"] = (doc or {}).get("node")
            if was != STATE["is_leader"]:
                logger.info("cluster role: %s (leader=%s)", "LEADER" if STATE["is_leader"] else "follower", STATE["leader_node"])
        except Exception as e:
            logger.warning("leader lease error: %s", e)
            STATE["is_leader"] = True
            STATE["leader_addr"] = None
        await asyncio.sleep(RENEW_EVERY_S)


def _proxy_target() -> str | None:
    if STATE["is_leader"] or not STATE["leader_addr"] or time.time() < STATE["bad_until"]:
        return None
    if STATE["leader_node"] == STATE["node"]:
        return None
    return STATE["leader_addr"]


def _mark_bad(e: Exception) -> None:
    STATE["bad_until"] = time.time() + BAD_LEADER_COOLDOWN_S
    logger.warning("leader %s unreachable, serving locally for %ss: %s", STATE["leader_addr"], BAD_LEADER_COOLDOWN_S, e)


class ClusterProxyMiddleware:
    def __init__(self, app):
        self.app = app
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=2.0))

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or not scope.get("path", "").startswith("/api"):
            return await self.app(scope, receive, send)
        headers = [(k.decode().lower(), v.decode()) for k, v in scope.get("headers", [])]
        if any(k == PROXY_HEADER for k, _ in headers) or scope.get("path") == "/api/server_info_local":
            return await self.app(scope, receive, send)
        target = _proxy_target()
        if not target:
            return await self.app(scope, receive, send)
        fwd = [(k, v) for k, v in headers if k not in HOP_HEADERS] + [(PROXY_HEADER, STATE["node"])]
        qs = scope.get("query_string", b"").decode()
        path = scope["path"] + (f"?{qs}" if qs else "")
        if scope["type"] == "http":
            return await self._http(target, path, scope, receive, send, fwd)
        return await self._ws(target, path, scope, receive, send, fwd)

    async def _http(self, target, path, scope, receive, send, fwd):
        body = b""
        while True:
            msg = await receive()
            body += msg.get("body", b"")
            if not msg.get("more_body"):
                break
        try:
            r = await self.client.request(scope["method"], f"http://{target}{path}", headers=fwd, content=body)
        except httpx.TransportError as e:
            _mark_bad(e)
            replay = [{"type": "http.request", "body": body, "more_body": False}]

            async def _again():
                return replay.pop(0) if replay else {"type": "http.disconnect"}
            return await self.app(scope, _again, send)
        STATE["proxied_http"] += 1
        out = [(k.encode(), v.encode()) for k, v in r.headers.items() if k.lower() not in HOP_HEADERS and k.lower() != "content-encoding"]
        out.append((b"content-length", str(len(r.content)).encode()))
        await send({"type": "http.response.start", "status": r.status_code, "headers": out})
        await send({"type": "http.response.body", "body": r.content})

    async def _ws(self, target, path, scope, receive, send, fwd):
        try:
            # No per-message compression on the in-cluster hop: it only burns relay CPU.
            upstream = await websockets.connect(f"ws://{target}{path}", additional_headers=fwd,
                                                open_timeout=3, max_size=None, ping_interval=None,
                                                compression=None, write_limit=2 ** 20)
            sock = upstream.transport.get_extra_info("socket")
            if sock is not None:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception as e:
            _mark_bad(e)
            return await self.app(scope, receive, send)
        STATE["proxied_ws"] += 1
        first = await receive()
        if first["type"] != "websocket.connect":
            await upstream.close()
            return
        await send({"type": "websocket.accept"})

        async def client_to_up():
            while True:
                m = await receive()
                if m["type"] == "websocket.receive":
                    await upstream.send(m["text"] if m.get("text") is not None else m.get("bytes"))
                else:
                    await upstream.close()
                    return

        async def up_to_client():
            try:
                async for m in upstream:
                    await send({"type": "websocket.send", "text": m} if isinstance(m, str) else {"type": "websocket.send", "bytes": m})
            finally:
                try:
                    await send({"type": "websocket.close", "code": upstream.close_code or 1000})
                except Exception:
                    pass

        tasks = [asyncio.create_task(client_to_up()), asyncio.create_task(up_to_client())]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in tasks:
            t.cancel()
        await upstream.close()
