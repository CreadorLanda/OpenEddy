#!/usr/bin/env python3
"""Open Eddy na web — o servidor de openeddy.alexandrelanda.com.

Diferente do app no PC, aqui o servidor é compartilhado e não guarda estado:
  - cérebro: Puter AI, no navegador de cada pessoa (paga a conta Puter dela);
  - ouvido: o navegador fala direto com o Scribe Realtime da ElevenLabs, com um
    token de uso único que este servidor emite;
  - voz: este servidor repassa o streaming da ElevenLabs (a chave fica aqui);
  - atalhos (notícias, clima, hora) e o roteiro do Eddy (prompt, "alô").

Todo pedido de /api precisa do token Puter da pessoa (Authorization: Bearer),
conferido em api.puter.com/whoami. A ElevenLabs tem limite por pessoa e por dia,
e os atalhos têm balde de fichas por pessoa e semáforo (ver `LIMITES`).

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
import scenes  # noqa: E402
import eleven  # noqa: E402
from config import DATA, ELEVEN_VOICE  # noqa: E402
from limits import RateLimit, Semaforo  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.realpath(os.environ.get("EDDY_WEB_ROOT") or os.path.join(HERE, "..", "app", "dist"))
HOST = os.environ.get("EDDY_WEB_HOST", "127.0.0.1")
PORT = int(os.environ.get("EDDY_WEB_PORT", "8120"))
# Domínios que mostram a landing em "/" (os outros abrem o app direto).
LANDING_HOSTS = {h.strip() for h in os.environ.get("EDDY_LANDING_HOSTS", "openeddy.alexandrelanda.com").split(",") if h.strip()}

# Puter AI: modelo rápido para conversa falada; o cliente cai no padrão do Puter se este falhar.
CHAT_MODEL = os.environ.get("EDDY_WEB_MODEL", "gemini-3.5-flash-lite")

# Limites diários (a ElevenLabs é paga com a chave do dono do servidor).
TTS_CHARS_USER = int(os.environ.get("EDDY_TTS_CHARS_PER_USER", "8000"))
TTS_CHARS_ALL = int(os.environ.get("EDDY_TTS_CHARS_TOTAL", "60000"))
STT_SESSIONS_USER = int(os.environ.get("EDDY_STT_PER_USER", "150"))
# Usuários Puter sem limite (o dono do servidor), separados por vírgula.
UNLIMITED = {u.strip() for u in os.environ.get("EDDY_UNLIMITED_USERS", "").split(",") if u.strip()}


# ── limites por pessoa e de concorrência ───────────────────────────────────────
#
# Protecções que já existiam e não são repetidas aqui: o token da Puter em todos
# os /api, os orçamentos diários de `Usage` (voz por pessoa e do servidor, e
# microfone), e os timeouts de `web.http_get`. O que faltava era o que vem a
# seguir — as respostas em si (`/api/web/start`) e os atalhos (`/api/web/route`,
# `/api/web/silence`) podiam ser pedidos sem parar.
#
# Cada rota tem o seu balde porque não custam o mesmo: `start` dá o prompt e o
# "alô" (nada de rede), `silence` dá uma frase (idem), e `route` é o único que
# sai para fora — é o que ganha também o semáforo, porque é o que pode ficar
# à espera de um RSS lento. Os números são folgados de propósito: um pedido
# recusado aparece como erro na cara de quem estava a conversar, e o silêncio é
# o único sítio onde a pessoa não fez nada para o merecer.

START_BURST = float(os.environ.get("EDDY_START_BURST", "10"))
START_REFILL = float(os.environ.get("EDDY_START_REFILL", "0.2"))
ROUTE_BURST = float(os.environ.get("EDDY_ROUTE_BURST", "20"))
ROUTE_REFILL = float(os.environ.get("EDDY_ROUTE_REFILL", "0.5"))
SILENCE_BURST = float(os.environ.get("EDDY_SILENCE_BURST", "30"))
SILENCE_REFILL = float(os.environ.get("EDDY_SILENCE_REFILL", "1"))
# Quantos atalhos caros o servidor inteiro atende ao mesmo tempo (sem fila:
# quem não entra recebe 503 em vez de ficar à espera).
ROUTE_MAX = int(os.environ.get("EDDY_ROUTE_MAX", "8"))
# Quantas conferências de token Puter ao mesmo tempo. Cada token novo é uma
# saída para a internet com 10 s de espera: sem este tecto, uma enxurrada de
# tokens inventados prende uma thread por pedido. Quem não entra é recusado com
# 401 e pode tentar outra vez — o token continua no cache quando é válido.
PUTER_MAX = int(os.environ.get("EDDY_PUTER_MAX", "16"))


def _limites():
    """Um conjunto novo de limites. Existe como função para os testes partirem
    sempre de um balde virgem, sem que o pedido anterior fique a contar."""
    return {
        "/api/web/start": (RateLimit(START_BURST, START_REFILL), None),
        "/api/web/route": (RateLimit(ROUTE_BURST, ROUTE_REFILL), Semaforo(ROUTE_MAX)),
        "/api/web/silence": (RateLimit(SILENCE_BURST, SILENCE_REFILL), None),
    }


LIMITES = _limites()
LUGARES_PUTER = Semaforo(PUTER_MAX)


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
    if not LUGARES_PUTER.adquirir():  # já há quem a conferir tokens: não se junta à fila
        return None
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            user = json.loads(r.read()).get("username")
    except Exception:
        return None
    finally:
        LUGARES_PUTER.largar()
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
        if user in UNLIMITED:
            return None
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

    def _send(self, code, body=b"", ctype="application/json", cache="no-store", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        for nome, valor in (extra or {}).items():
            self.send_header(nome, valor)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False).encode())

    def _recusa(self, msg, code, espera):
        """Resposta a um pedido que não entra: o mesmo formato de erro de sempre,
        mais o `Retry-After` que o HTTP usa para dizer quando se pode voltar.
        Um limite absoluto (reposição a zero) dá uma espera infinita: diz-se o
        mesmo que para qualquer outro, cinco minutos."""
        espera = min(espera, 300.0)
        self._send(code, json.dumps({"error": msg}, ensure_ascii=False).encode(),
                   extra={"Retry-After": str(max(1, int(espera) + 1))})

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
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        home = "landing.html" if host in LANDING_HOSTS else "index.html"
        rel = home if path in ("/", "") else path.lstrip("/")
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
            # O corpo lê-se antes dos limites: responder sem o ler deixaria o
            # pedido pela metade na ligação e o próximo pedido no mesmo
            # socket leria lixo. São 64 KB no máximo, é barato de ler e é
            # descartado a seguir.
            body = self._body()
        except ValueError as e:
            return self._json({"error": str(e)}, 400)
        limite, semaforo = LIMITES.get(path, (None, None))
        if limite:
            pode, espera = limite.pega(user)
            if not pode:
                return self._recusa("calma aí: estás a pedir depressa demais. Tenta daqui a pouco.",
                                    429, espera)
        if semaforo and not semaforo.adquirir():
            return self._recusa("o Eddy está a atender toda a gente. Tenta daqui a pouco.", 503, 0.0)
        try:
            out = route(self, user, body)
            if out is not None:
                self._json(out)
        except (TimeoutError, urllib.error.URLError) as e:
            # `urlopen` atira `TimeoutError` cru no connect/read e, noutros
            # caminhos, embrulha-o num `URLError`. Os dois são "não respondeu a
            # tempo" e valem um 504 — não é culpa de quem pediu, e o código que
            # distingue "tente outra vez" de "isto está partido" é este. O que
            # não for timeout (uma DNS que não resolve, um 500 de alguém) fica
            # a ser o 500 de sempre, com o traceback no log do servidor.
            if _passou_do_tempo(e):
                try:
                    self._json({"error": "um serviço lá fora demorou demais. Tenta outra vez."}, 504)
                except Exception:
                    pass
            else:
                traceback.print_exc()
                try:
                    self._json({"error": str(e)}, 500)
                except Exception:
                    pass
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
        finally:
            if semaforo:
                semaforo.largar()  # nem que a rota tenha falhado a meio


def _profile(body):
    return assistant.clean_profile(body.get("profile") or {})


def _passou_do_tempo(e):
    """Se a exceção é um pedido ao exterior que passou do tempo. O `urlopen` dá
    `TimeoutError` cru no connect e no read, e embrulha-o em `URLError` noutros
    caminhos; `socket.timeout` é o mesmo `TimeoutError` desde o Python 3.10.
    Uma `URLError` por outro motivo (DNS, ligação recusada, 500 de alguém) não
    é disto."""
    if isinstance(e, TimeoutError):
        return True
    return isinstance(e, urllib.error.URLError) and isinstance(getattr(e, "reason", None), TimeoutError)


def r_start(h, user, body):
    p = _profile(body)
    return {"system": assistant.system_prompt(p), "greeting": assistant.greeting(p),
            "scenes": scenes.bundle(p["idioma"])}


def r_route(h, user, body):
    text = str(body.get("text", ""))[:500]
    p = _profile(body)
    event = scenes.detect(text, p["idioma"])
    if event:
        return {"text": None, "event": event}  # o navegador gera a fala com a nota de direção
    out = assistant.route(text, p)
    return {"text": out[0], **out[1]} if out else {"text": None}


def r_silence(h, user, body):
    seen = [str(x) for x in (body.get("seen") or [])][:40]
    return {"text": assistant.silence_line(_profile(body), bool(body.get("final")), seen)}


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
