"""O servidor web (core/webapp.py) ponta a ponta: HTTP a sério, Puter e
ElevenLabs dublês.

O servidor de verdade sobe numa porta livre, com um `dist` temporário, e cada
teste fala HTTP com ele. A identidade (Puter), a voz e o ficheiro de uso do dia
são substituídos — nenhuma requisição sai para a internet.
"""

import contextlib
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import eleven
import webapp

TOKEN_OK = "token-do-utilizador"
USER = "zeca"


def http(base, method, path, body=None, token=TOKEN_OK):
    """Um pedido ao servidor de teste: devolve (código, corpo em json ou bytes, cabeçalhos)."""
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, _corpo(r.headers.get("Content-Type", ""), r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, _corpo(e.headers.get("Content-Type", ""), e.read()), dict(e.headers)


def _corpo(ctype, raw):
    return json.loads(raw) if ctype.startswith("application/json") and raw else raw


class WebServerTest(unittest.TestCase):
    """Base: um servidor de verdade, com tudo o que é de fora trocado."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="openeddy-dist-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        os.makedirs(os.path.join(self.root, "assets"))
        for nome, corpo in (("index.html", b"<html>app</html>"),
                            ("landing.html", b"<html>landing</html>"),
                            (os.path.join("assets", "app.js"), b"console.log(1)")):
            with open(os.path.join(self.root, nome), "wb") as f:
                f.write(corpo)

        self.usage_dir = tempfile.mkdtemp(prefix="openeddy-uso-")
        self.addCleanup(shutil.rmtree, self.usage_dir, ignore_errors=True)
        patches = [
            mock.patch.object(webapp, "ROOT", self.root),
            mock.patch.object(webapp, "USAGE_FILE", os.path.join(self.usage_dir, "web-usage.json")),
            mock.patch.object(webapp, "UNLIMITED", set()),
            mock.patch.object(webapp.usage, "data", {"day": _hoje(), "users": {}, "tts_total": 0}),
            mock.patch.object(webapp, "puter_user", lambda t: USER if t == TOKEN_OK else None),
            mock.patch.object(eleven, "eleven_key", return_value=None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        webapp.usage._dirty = False

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), webapp.Web)
        self.srv.daemon_threads = True
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        # poll_interval curto: o shutdown() no cleanup não espera meio segundo por teste
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)

    # atalhos
    def get(self, path, **kw):
        return http(self.base, "GET", path, **kw)

    def post(self, path, body=None, **kw):
        return http(self.base, "POST", path, body if body is not None else {}, **kw)

    def with_key(self):
        return mock.patch.object(eleven, "eleven_key", return_value="chave-de-teste")

    def with_voice(self, chunks=(b"\x01\x02", b"\x03\x04")):
        """Voz pronta: chave presente e o streaming da ElevenLabs a responder."""
        return (mock.patch.object(eleven, "eleven_key", return_value="chave-de-teste"),
                mock.patch.object(eleven, "tts_stream",
                                  return_value=iter(chunks) if chunks is not None else None))




def _hoje():
    import datetime
    return datetime.date.today().isoformat()


class ConfigTest(WebServerTest):
    def test_the_config_needs_no_login(self):
        status, body, _ = self.get("/api/web/config")
        self.assertEqual(status, 200)
        self.assertEqual(body["model"], webapp.CHAT_MODEL)
        self.assertIn("github", body["links"])

    def test_it_says_when_the_server_has_no_voice(self):
        _, sem, _ = self.get("/api/web/config")
        self.assertFalse(sem["voice_ready"])
        with self.with_key():
            _, com, _ = self.get("/api/web/config")
        self.assertTrue(com["voice_ready"])


class StaticFilesTest(WebServerTest):
    def test_the_app_is_served(self):
        req = urllib.request.Request(self.base + "/")
        with urllib.request.urlopen(req, timeout=10) as r:
            self.assertEqual(r.read(), b"<html>app</html>")

    def test_the_landing_page_only_on_its_own_host(self):
        for host, esperado in (("openeddy.alexandrelanda.com", b"landing"), ("eddy.exemplo.pt", b"app")):
            req = urllib.request.Request(self.base + "/", headers={"Host": host})
            with urllib.request.urlopen(req, timeout=10) as r:
                self.assertTrue(r.read().startswith(b"<html>" + esperado), host)

    def test_the_build_files_can_stay_in_the_cache(self):
        with urllib.request.urlopen(self.base + "/assets/app.js", timeout=10) as r:
            self.assertIn("immutable", r.headers["Cache-Control"])

    def test_a_route_that_does_not_exist_is_a_404_json(self):
        status, body, _ = self.get("/api/web/inexistente")
        self.assertEqual((status, body), (404, {"error": "rota inexistente"}))

    def test_it_does_not_walk_out_of_the_build_folder(self):
        with urllib.request.urlopen(self.base + "/../../../etc/passwd", timeout=10) as r:
            self.assertEqual(r.read(), b"<html>app</html>")  # caiu no index do SPA


class AuthTest(WebServerTest):
    """Todo /api precisa do token da Puter da pessoa — sem ele, nada sai."""

    def test_no_token_is_no_voice(self):
        status, body, _ = self.post("/api/web/start", {"profile": {"nome": "Zeca"}}, token=None)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "entre com o Puter primeiro")

    def test_a_token_the_puter_does_not_know_is_401(self):
        status, _, _ = self.post("/api/web/start", {"profile": {}}, token="inventado")
        self.assertEqual(status, 401)

    def test_an_unknown_post_route_is_404_before_even_looking_at_the_token(self):
        status, body, _ = self.post("/api/web/inexistente", token=None)
        self.assertEqual(status, 404)


class StartTest(WebServerTest):
    def test_the_call_starts_with_the_prompt_and_the_greeting(self):
        status, body, _ = self.post("/api/web/start", {"profile": {"nome": "Zeca", "idade": 30}})
        self.assertEqual(status, 200)
        self.assertIn("Zeca", body["system"])
        self.assertTrue(body["greeting"])

    def test_a_hostile_profile_is_cleaned_before_the_persona(self):
        _, body, _ = self.post("/api/web/start", {"profile": {"nome": "x" * 500, "idade": -3,
                                                               "sexo": "root", "idioma": "xx"}})
        self.assertIn("pessoa, 1 anos.", body["system"])
        self.assertIn("português do Brasil", body["system"])

    def test_a_body_that_is_not_json_is_a_400_and_not_a_crash(self):
        """JSON malformado é um pedido mau, não uma falha do servidor."""
        req = urllib.request.Request(self.base + "/api/web/start", data="isto não é json".encode(),
                                     headers={"Authorization": f"Bearer {TOKEN_OK}",
                                              "Content-Type": "application/json"}, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(err.exception.code, 400)


class RouteTest(WebServerTest):
    def test_a_routed_answer_comes_with_the_news_when_there_is_any(self):
        with mock.patch.object(webapp.assistant.web, "headlines",
                               return_value=[{"source": "G1", "title": "Notícia", "link": "u"}]):
            _, body, _ = self.post("/api/web/route", {"text": "notícias", "profile": {"nome": "Zeca"}})
        self.assertIn("Notícia", body["text"])
        self.assertEqual(body["news"][0]["title"], "Notícia")

    def test_an_answer_that_needs_the_model_is_null_so_the_browser_asks_puter(self):
        _, body, _ = self.post("/api/web/route", {"text": "me explica a relatividade", "profile": {}})
        self.assertIsNone(body["text"])
        self.assertNotIn("news", body)

    def test_the_text_is_truncated_before_the_shortcut_looks_at_it(self):
        with mock.patch.object(webapp.assistant.web, "headlines") as hl:
            self.post("/api/web/route", {"text": "x" * 5000, "profile": {}})
        hl.assert_not_called()


class SilenceTest(WebServerTest):
    def test_the_line_is_not_repeated_within_the_same_call(self):
        perfil = {"nome": "Zeca"}
        _, primeira, _ = self.post("/api/web/silence", {"profile": perfil, "seen": []})
        _, segunda, _ = self.post("/api/web/silence", {"profile": perfil, "seen": [primeira["text"]]})
        self.assertNotEqual(primeira["text"], segunda["text"])

    def test_the_farewell_comes_from_the_bye_pool(self):
        _, body, _ = self.post("/api/web/silence", {"profile": {}, "final": True})
        inícios = [t.split("{")[0].strip() for t in webapp.assistant.LANGS["pt"]["bye"]]
        self.assertTrue(any(body["text"].startswith(i) for i in inícios), body["text"])

    def test_too_many_seen_lines_do_not_break_it(self):
        _, body, _ = self.post("/api/web/silence", {"profile": {}, "seen": ["x"] * 500})
        self.assertTrue(body["text"])


class TtsTest(WebServerTest):
    def tts(self, body, chunks=(b"\x01\x02", b"\x03\x04"), *extra):
        key, stream = self.with_voice(chunks)
        with contextlib.ExitStack() as fora:
            for patch in (key, stream, *extra):
                fora.enter_context(patch)
            return self.post("/api/web/tts", body)

    def test_empty_text_is_a_400(self):
        status, body, _ = self.tts({"text": "   "})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "texto vazio")

    def test_a_server_without_a_key_says_so_instead_of_sending_silence(self):
        status, body, _ = self.post("/api/web/tts", {"text": "olá"})
        self.assertEqual(status, 503)
        self.assertIn("voz indisponível", body["error"])

    def test_the_voice_comes_as_pcm_with_the_rate_the_browser_needs(self):
        key, stream = self.with_voice(iter((b"\x01\x02", b"\x03\x04")))
        with key, stream:
            req = urllib.request.Request(self.base + "/api/web/tts",
                                         data=json.dumps({"text": "olá", "lang": "pt"}).encode(),
                                         headers={"Authorization": f"Bearer {TOKEN_OK}",
                                                  "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as r:
                self.assertEqual(r.headers["Content-Type"], f"audio/pcm;rate={eleven.PCM_RATE}")
                self.assertEqual(r.read(), b"\x01\x02\x03\x04")

    def test_an_unknown_language_falls_back_to_portuguese(self):
        tts = mock.Mock(return_value=iter((b"\x01",)))
        self.tts({"text": "olá", "lang": "fr"}, (b"\x01",), mock.patch.object(eleven, "tts_stream", tts))
        self.assertEqual(tts.call_args[0][2], "pt")

    def test_the_language_of_the_profile_goes_to_the_voice(self):
        tts = mock.Mock(return_value=iter((b"\x01",)))
        self.tts({"text": "olá", "lang": "es"}, (b"\x01",), mock.patch.object(eleven, "tts_stream", tts))
        self.assertEqual(tts.call_args[0][2], "es")

    def test_when_the_elevenlabs_fails_the_browser_voice_takes_over(self):
        # tts_stream a devolver None = a ElevenLabs não respondeu antes do primeiro byte
        status, body, _ = self.tts({"text": "olá"}, chunks=None)
        self.assertEqual(status, 502)
        self.assertIn("não respondeu", body["error"])

    def test_the_daily_budget_is_counted_without_the_tags(self):
        with mock.patch.object(webapp, "TTS_CHARS_USER", 10):
            status, _, _ = self.tts({"text": "[sighs] " + "y" * 10})
            self.assertEqual(status, 200)  # "y"*10 = 10 caracteres; as marcas não contam
            status, body, _ = self.tts({"text": "z"})
        self.assertEqual(status, 429)
        self.assertIn("já gastou", body["error"])

    def test_the_budget_of_the_whole_server_is_shared(self):
        with mock.patch.object(webapp, "TTS_CHARS_ALL", 5), \
                mock.patch.object(webapp, "TTS_CHARS_USER", 1000):
            self.assertEqual(self.tts({"text": "aaaaa"})[0], 200)
            status, body, _ = self.tts({"text": "b"})
        self.assertEqual(status, 429)
        self.assertIn("todo mundo", body["error"])

    def test_the_owner_has_no_limit(self):
        with mock.patch.object(webapp, "UNLIMITED", {USER}), \
                mock.patch.object(webapp, "TTS_CHARS_USER", 1):
            self.assertEqual(self.tts({"text": "y" * 50})[0], 200)
            self.assertEqual(self.tts({"text": "y" * 50})[0], 200)


class SttTokenTest(WebServerTest):
    def token(self, **kw):
        with self.with_key(), mock.patch.object(eleven, "single_use_token", **kw):
            return self.post("/api/web/stt-token")

    def test_a_server_without_a_key_cannot_listen(self):
        status, body, _ = self.post("/api/web/stt-token")
        self.assertEqual(status, 503)
        self.assertIn("microfone", body["error"])

    def test_the_browser_gets_a_token_and_the_key_stays_on_the_server(self):
        status, body, _ = self.token(return_value="uso-unico")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"token": "uso-unico"})

    def test_the_daily_number_of_listens_is_capped(self):
        with mock.patch.object(webapp, "STT_SESSIONS_USER", 2):
            for _ in range(2):
                self.assertEqual(self.token(return_value="t")[0], 200)
            status, body, _ = self.token(return_value="t")
        self.assertEqual(status, 429)
        self.assertIn("microfone", body["error"])

    def test_a_refusal_from_the_elevenlabs_is_a_502(self):
        erro = urllib.error.HTTPError("https://api.elevenlabs.io", 401, "no", {}, None)
        status, body, _ = self.token(side_effect=erro)
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "ElevenLabs 401")


if __name__ == "__main__":
    unittest.main()