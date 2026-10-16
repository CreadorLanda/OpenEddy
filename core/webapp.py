#!/usr/bin/env python3
"""Open Eddy na web — o servidor de openeddy.alexandrelanda.com.

Diferente do app no PC, aqui o servidor é compartilhado e não guarda estado:
  - cérebro: Puter AI, no navegador de cada pessoa (paga a conta Puter dela);
  - ouvido: o navegador fala direto com o Scribe Realtime da ElevenLabs, com um
    token de uso único que este servidor emite;
  - voz: este servidor repassa o streaming da ElevenLabs (a chave fica aqui);
  - atalhos (notícias, clima, hora) e o roteiro do Eddy (prompt, "alô").

Todo pedido de /api precisa do token Puter da pessoa (Authorization: Bearer),
conferido em api.puter.com/whoami. A ElevenLabs tem limite por pessoa e por dia.

Só stdlib: nada de numpy, Kokoro, Whisper nem Ollama aqui.

  ELEVENLABS_API_KEY=... EDDY_WEB_ROOT=app/dist python3 core/webapp.py
"""

import datetime
import json
import mimetypes
import os
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assistant  # noqa: E402
import eleven  # noqa: E402
from config import DATA, ELEVEN_VOICE  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.realpath(os.environ.get("EDDY_WEB_ROOT") or os.path.join(HERE, "..", "app", "dist"))
HOST = os.environ.get("EDDY_WEB_HOST", "127.0.0.1")
PORT = int(os.environ.get("EDDY_WEB_PORT", "8120"))

# Puter AI: modelo rápido para conversa falada; o cliente cai no padrão do Puter se este falhar.
CHAT_MODEL = os.environ.get("EDDY_WEB_MODEL", "gemini-3.5-flash-lite")

# Limites diários (a ElevenLabs é paga com a chave do dono do servidor).
TTS_CHARS_USER = int(os.environ.get("EDDY_TTS_CHARS_PER_USER", "4000"))
TTS_CHARS_ALL = int(os.environ.get("EDDY_TTS_CHARS_TOTAL", "60000"))
STT_SESSIONS_USER = int(os.environ.get("EDDY_STT_PER_USER", "150"))

LINKS = {
    "github": "https://github.com/CreadorLanda/OpenEddy",
    "kofi": "https://ko-fi.com/alexandrelanda",
}

USAGE_FILE = os.path.join(DATA, "web-usage.json")


# ── identidade (Puter) ────────────────────────────────────────────────────────

_who: dict[str, tuple[float, str]] = {}  # token → (expira, username)
_who_lock = threading.Lock()


def puter_user(token: str) -> str | None:
    """Confere o token na Puter. Cache de 10 min para não perguntar a cada frase."""
    if not token or len(token) > 4096:
        return None
    now = time.time()
    with _who_lock:
        hit = _who.get(token)
        if hit and hit[0] > now:
            return hit[1]
    req = urllib.request.Request("https://api.puter.com/whoami", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            user = json.loads(r.read()).get("username")
    except Exception:
        return None
    if user:
        with _who_lock:
            if len(_who) > 5000:
                _who.clear()
            _who[token] = (now + 600, user)
    return user


# ── limites diários ───────────────────────────────────────────────────────────

class Usage:
    def __init__(self):
        self.lock = threading.Lock()
        try:
            with open(USAGE_FILE, encoding="utf-8") as f:
                self.data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.data = {}
        self._dirty = False
        threading.Thread(target=self._flush_loop, daemon=True).start()

    def _today(self):
        day = datetime.date.today().isoformat()
        if self.data.get("day") != day:
            self.data = {"day": day, "users": {}, "tts_total": 0}
        return self.data

    def take(self, user: str, tts_chars=0, stt=0) -> str | None:
        """Reserva o uso; devolve o motivo se passar do limite."""
        with self.lock:
            d = self._today()
            u = d["users"].setdefault(user, {"tts": 0, "stt": 0})
            if tts_chars:
                if d["tts_total"] + tts_chars > TTS_CHARS_ALL:
                    return "A voz do Eddy esgotou por hoje para todo mundo. Volta amanhã!"
                if u["tts"] + tts_chars > TTS_CHARS_USER:
                    return "Você já gastou a voz do Eddy de hoje. Volta amanhã (ou rode o app no seu PC)."
                u["tts"] += tts_chars
                d["tts_total"] += tts_chars
            if stt:
                if u["stt"] + stt > STT_SESSIONS_USER:
                    return "Você já usou o microfone o bastante por hoje. Volta amanhã!"
                u["stt"] += stt
            self._dirty = True
            return None

    def _flush_loop(self):
        while True:
            time.sleep(30)
            with self.lock:
                if not self._dirty:
                    continue
                snapshot = json.dumps(self.data)
                self._dirty = False
            tmp = USAGE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(snapshot)
            os.replace(tmp, USAGE_FILE)


usage = Usage()


# ── HTTP ──────────────────────────────────────────────────────────────────────

class Web(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OpenEddy"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body=b"", ctype="application/json", cache="no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False).encode())

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 64_000:
            raise ValueError("pedido grande demais")
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _user(self):
        auth = self.headers.get("Authorization") or ""
        return puter_user(auth[7:] if auth.startswith("Bearer ") else "")

    # arquivos do app (dist/ do Vite)
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/web/config":
            return self._json({"model": CHAT_MODEL, "links": LINKS, "voice": ELEVEN_VOICE,
                               "voice_ready": bool(eleven.eleven_key())})
        if path.startswith("/api/"):
            return self._json({"error": "rota inexistente"}, 404)
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.realpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT + os.sep) or not os.path.isfile(full):
            full = os.path.join(ROOT, "index.html")  # SPA
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            body = f.read()
        # arquivos com hash do Vite podem ficar em cache; o index não
        cache = "public, max-age=31536000, immutable" if "/assets/" in full else "no-cache"
        self._send(200, body, ctype, cache)

    do_HEAD = do_GET

    def do_POST(self):
        path = urlparse(self.path).path
        route = POST_ROUTES.get(path)
        if not route:
            return self._json({"error": "rota inexistente"}, 404)
        user = self._user()
        if not user:
            return self._json({"error": "entre com o Puter primeiro"}, 401)
        try:
            out = route(self, user, self._body())
            if out is not None:
                self._json(out)
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


def _profile(body):
    return assistant.clean_profile(body.get("profile") or {})


def r_start(h, user, body):
    p = _profile(body)
    return {"system": assistant.system_prompt(p), "greeting": assistant.greeting(p)}


def r_route(h, user, body):
    out = assistant.route(str(body.get("text", ""))[:500], _profile(body))
    return {"text": out[0], **out[1]} if out else {"text": None}


def r_silence(h, user, body):
    return {"text": assistant.silence_line(_profile(body), bool(body.get("final")))}


def r_tts(h, user, body):
    text = str(body.get("text", "")).strip()[:600]
    if not text:
        raise ValueError("texto vazio")
    if not eleven.eleven_key():
        return h._json({"error": "voz indisponível neste servidor"}, 503)
    spoken = len(eleven.strip_tags(text))
    why = usage.take(user, tts_chars=spoken)
    if why:
        return h._json({"error": why}, 429)
    lang = body.get("lang") if body.get("lang") in assistant.LANGS else "pt"
    chunks = eleven.tts_stream(text, ELEVEN_VOICE, lang)
    if chunks is None:
        return h._json({"error": "a ElevenLabs não respondeu"}, 502)
    h.send_response(200)
    h.send_header("Content-Type", f"audio/pcm;rate={eleven.PCM_RATE}")
    h.send_header("Cache-Control", "no-store")
    h.send_header("Connection", "close")
    h.end_headers()
    h.close_connection = True
    for c in chunks:
        h.wfile.write(c)
        h.wfile.flush()


def r_stt_token(h, user, body):
    if not eleven.eleven_key():
        return h._json({"error": "microfone indisponível neste servidor"}, 503)
    why = usage.take(user, stt=1)
    if why:
        return h._json({"error": why}, 429)
    try:
        return {"token": eleven.single_use_token()}
    except urllib.error.HTTPError as e:
        return h._json({"error": f"ElevenLabs {e.code}"}, 502)


POST_ROUTES = {
    "/api/web/start": r_start,
    "/api/web/route": r_route,
    "/api/web/silence": r_silence,
    "/api/web/tts": r_tts,
    "/api/web/stt-token": r_stt_token,
}


def main():
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        sys.exit(f"não achei o app em {ROOT} — rode `npm run build` em app/")
    os.makedirs(DATA, exist_ok=True)
    srv = ThreadingHTTPServer((HOST, PORT), Web)
    srv.daemon_threads = True
    print(f"Open Eddy web em http://{HOST}:{PORT} (app: {ROOT}, voz: {'sim' if eleven.eleven_key() else 'não'})",
          flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
