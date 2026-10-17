#!/usr/bin/env python3
"""Servidor local do Eddy — a ponte entre o app (Tauri) e o núcleo Python.

Escuta só em 127.0.0.1 e exige o token de sessão (`EDDY_TOKEN`) em todo
pedido. Com `EDDY_PORT=0` escolhe uma porta livre e a anuncia na primeira
linha da saída: `EDDY_LISTENING <porta>`.

Uso avulso (para testar no navegador com `npm run dev`):
  .venv/bin/python core/server.py      # porta 8765, token impresso na saída
"""

import json
import os
import queue
import re
import secrets
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import events  # noqa: E402
import llm  # noqa: E402
import voice  # noqa: E402
import web  # noqa: E402
from assistant import Eddy  # noqa: E402

TOKEN = os.environ.get("EDDY_TOKEN") or secrets.token_urlsafe(24)
ALLOWED_ORIGINS = {
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
    "http://127.0.0.1:1430", "http://localhost:1430",
}

eddy = Eddy()


class Api(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OpenEddy/1.0"

    def log_message(self, *_):
        pass

    # ── utilidades ────────────────────────────────────────────────────────────

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False).encode())

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n) or b"{}")

    def _authorized(self, query):
        given = self.headers.get("X-Eddy-Token") or (query.get("token") or [""])[0]
        return secrets.compare_digest(given, TOKEN)

    def _sse_start(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def _sse(self, data):
        self.wfile.write(f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
        self.wfile.flush()

    # ── verbos ────────────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Eddy-Token")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if not self._authorized(query):
            return self._json({"error": "não autorizado"}, 401)
        for m, pattern, fn in ROUTES:
            if m != method:
                continue
            match = re.fullmatch(pattern, url.path)
            if match:
                try:
                    out = fn(self, *match.groups(), **({"query": query} if m == "GET" else {}))
                    if out is not None:
                        self._json(out)
                except KeyError as e:
                    self._json({"error": str(e).strip("'")}, 404)
                except ValueError as e:
                    self._json({"error": str(e)}, 400)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as e:
                    traceback.print_exc()
                    try:
                        self._json({"error": str(e)}, 500)
                    except Exception:
                        pass
                return
        self._json({"error": "rota inexistente"}, 404)


# ── rotas ─────────────────────────────────────────────────────────────────────

def health(h, query):
    return {"ollama": llm.alive(), "models": llm.models(), "model": llm.model(),
            "model_ready": llm.model() in llm.models(), "voice": voice.ready()}


def events_stream(h, query):
    q = events.subscribe()
    try:
        h._sse_start()
        h._sse({"type": "hello"})
        while True:
            try:
                ev = q.get(timeout=15)
            except queue.Empty:
                h.wfile.write(b": ping\n\n")
                h.wfile.flush()
                continue
            h._sse(ev)
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass
    finally:
        events.unsubscribe(q)


def meta(h, query):
    return {"voices": voice.voices(), "eddy": eddy.settings()}


def eddy_turn(h):
    text = str(h._body().get("text", "")).strip()
    if not text:
        raise ValueError("mensagem vazia")
    h._sse_start()
    try:
        out = eddy.turn(text, lambda t: h._sse({"type": "token", "token": t}))
        if out.get("stale"):
            # A pessoa desligou (ou ligou outra vez) enquanto o Eddy pensava: a
            # resposta é de uma chamada que já não existe. O stream fecha sem
            # `done`, para o cliente não pintar nada na chamada nova.
            return
        h._sse({"type": "done", **out})
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as e:
        h._sse({"type": "error", "error": str(e)})


def eddy_config(h):
    return eddy.configure(h._body())


def eddy_profile(h):
    return eddy.set_profile(h._body())


def call_start(h):
    return {"text": eddy.start_call(), "voice": eddy.voice}


def listen_cancel(h):
    voice.cancel_listen()
    return {"ok": True}


def call_silence(h):
    return {"text": eddy.silence_line(final=bool(h._body().get("final")))}


def eddy_reset(h):
    eddy.reset()
    return {"ok": True}


def eddy_listen(h):
    secs = float(h._body().get("max_seconds") or 12)
    events.publish("voice.listening", on=True)
    try:
        return {"text": voice.listen(max_seconds=min(30.0, secs), lang=eddy.lang)}
    finally:
        events.publish("voice.listening", on=False)


def tts(h):
    body = h._body()
    text = str(body.get("text", "")).strip()[:2000]
    if not text:
        raise ValueError("texto vazio")
    audio, mime = voice.tts(text, body.get("voice") or eddy.voice)
    h._send(200, audio, mime)


def tts_stream(h):
    """Fala em streaming: PCM 16-bit da ElevenLabs repassado conforme chega.
    Sem ElevenLabs (ou se ela falhar), responde o WAV inteiro do Kokoro."""
    body = h._body()
    text = str(body.get("text", "")).strip()[:2000]
    if not text:
        raise ValueError("texto vazio")
    chosen = body.get("voice") or eddy.voice
    chunks = voice.tts_stream(text, chosen, eddy.lang)
    if chunks is None:
        audio, mime = voice.tts(text, "pm_alex" if chosen.startswith("eleven:") else chosen)
        return h._send(200, audio, mime)
    h.send_response(200)
    h._cors()
    h.send_header("Content-Type", f"audio/pcm;rate={voice.PCM_RATE}")
    h.send_header("Cache-Control", "no-store")
    h.send_header("Connection", "close")
    h.end_headers()
    h.close_connection = True
    for c in chunks:
        h.wfile.write(c)
        h.wfile.flush()


def news(h, query):
    return {"items": web.headlines()}


ROUTES = [
    ("GET", r"/api/health", health),
    ("GET", r"/api/events", events_stream),
    ("GET", r"/api/meta", meta),
    ("POST", r"/api/eddy/turn", eddy_turn),
    ("POST", r"/api/eddy/config", eddy_config),
    ("POST", r"/api/eddy/reset", eddy_reset),
    ("POST", r"/api/eddy/profile", eddy_profile),
    ("POST", r"/api/eddy/call/start", call_start),
    ("POST", r"/api/eddy/call/silence", call_silence),
    ("POST", r"/api/eddy/listen", eddy_listen),
    ("POST", r"/api/eddy/listen/cancel", listen_cancel),
    ("POST", r"/api/tts", tts),
    ("POST", r"/api/tts/stream", tts_stream),
    ("GET", r"/api/news", news),
]


def main():
    port = int(os.environ.get("EDDY_PORT", "8765"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Api)
    srv.daemon_threads = True
    print(f"EDDY_LISTENING {srv.server_address[1]}", flush=True)
    if "EDDY_TOKEN" not in os.environ:
        print(f"token: {TOKEN}", flush=True)
    if os.environ.get("EDDY_WATCH_STDIN") == "1":
        # Lançado pelo app: quando o app morre o stdin fecha, e o núcleo sai junto.
        def watch_parent():
            sys.stdin.read()
            os._exit(0)

        threading.Thread(target=watch_parent, daemon=True, name="parent").start()
    threading.Thread(target=llm.ensure_running, daemon=True, name="ollama").start()
    voice.warm_up()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
