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
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest import mock

import eleven
import limits
import webapp

TOKEN_OK = "token-do-utilizador"
USER = "zeca"
# A função de verdade: o setUp troca `webapp.puter_user` por uma duble, e o
# semáforo da Puter vive dentro dela.
PUTER_USER_REAL = webapp.puter_user


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
            mock.patch.object(webapp, "LIMITES", webapp._limites()),
            mock.patch.object(webapp, "LUGARES_PUTER", limits.Semaforo(webapp.PUTER_MAX)),
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


class LimitesTest(WebServerTest):
    """Balde de fichas por pessoa e semáforo por operação cara (Issue #6).

    Os números são escolhidos por aqui para cada teste; o que está em produção
    vive em `_limites()` e é verificado em `test_os_limites_padrao_...`.
    """

    def com_limites(self, start=(2, 0.0), rota=(20, 0.0), silencio=(30, 0.0), lugares=8):
        return mock.patch.object(webapp, "LIMITES", {
            "/api/web/start": (limits.RateLimit(*start), None),
            "/api/web/route": (limits.RateLimit(*rota), limits.Semaforo(lugares)),
            "/api/web/silence": (limits.RateLimit(*silencio), None),
        })

    def com_duas_pessoas(self):
        return mock.patch.object(webapp, "puter_user",
                                 lambda t: {"token-zeca": "zeca", "token-bruno": "bruno"}.get(t))

    def atalho_bloqueado(self):
        """Um `headlines` que não volta até o teste mandar: assim há pedidos
        realmente a decorrer ao mesmo tempo, sem `sleep` a fingir que há."""
        largar = threading.Event()
        self.addCleanup(largar.set)
        chegou = threading.Condition()
        dentro = []

        def headlines(*args, **kw):
            with chegou:
                dentro.append(1)
                chegou.notify_all()
            # a espera fica fora do `with`: um Event.wait dentro de uma Condition
            # segura a fechadura dela e o próximo pedido nunca mais chega aqui
            largar.wait(5)
            return [{"source": "G1", "title": f"Notícia {len(dentro)}", "link": "u"}]

        return mock.patch.object(webapp.assistant.web, "headlines", headlines), chegou, dentro, largar

    # ── fichas por pessoa ─────────────────────────────────────────────────────

    def test_uma_enxurrada_de_respostas_e_recusada(self):
        with self.com_limites(start=(2, 0.0)):
            self.assertEqual(self.post("/api/web/start", {})[0], 200)
            self.assertEqual(self.post("/api/web/start", {})[0], 200)
            status, body, headers = self.post("/api/web/start", {})
        self.assertEqual(status, 429)
        self.assertIn("depressa demais", body["error"])
        self.assertGreaterEqual(int(headers["Retry-After"]), 1)

    def test_o_balde_do_silencio_nao_comeca_o_da_resposta(self):
        with self.com_limites(start=(1, 0.0), silencio=(1, 0.0)):
            self.assertEqual(self.post("/api/web/silence", {})[0], 200)
            self.assertEqual(self.post("/api/web/silence", {})[0], 429)
            self.assertEqual(self.post("/api/web/start", {})[0], 200, "o silêncio não gasta a resposta")

    def test_o_balde_e_por_pessoa(self):
        with self.com_limites(start=(1, 0.0)), self.com_duas_pessoas():
            self.assertEqual(self.post("/api/web/start", {}, token="token-zeca")[0], 200)
            self.assertEqual(self.post("/api/web/start", {}, token="token-zeca")[0], 429)
            self.assertEqual(self.post("/api/web/start", {}, token="token-bruno")[0], 200,
                             "o bruno não entra na conta do zeca")

    def test_um_token_inventado_da_401_e_nao_gasta_o_balde_de_ninguem(self):
        with self.com_limites(start=(1, 0.0)):
            self.assertEqual(self.post("/api/web/start", {}, token="inventado")[0], 401)
            self.assertEqual(self.post("/api/web/start", {})[0], 200)

    def test_uma_chamada_a_serio_passa_nos_limites_de_producao(self):
        """Uma chamada a sério: começa, ouve duas vezes sem palavras, ouve uma
        terceira, e o fim chama o silêncio. Com os números que vão para produção
        (`_limites()`), nada disto bate num limite."""
        perfil = {"nome": "Zeca", "idade": 30}
        with mock.patch.object(webapp, "LIMITES", webapp._limites()):
            self.assertEqual(self.post("/api/web/start", {"profile": perfil})[0], 200)
            for _ in range(2):
                self.assertEqual(self.post("/api/web/silence", {"profile": perfil, "seen": []})[0], 200)
            self.assertEqual(self.post("/api/web/route", {"text": "que horas são", "profile": perfil})[0], 200)
            self.assertEqual(self.post("/api/web/silence", {"profile": perfil, "final": True})[0], 200)

    def test_os_limites_padrao_cobrem_as_tres_rotas_e_so_elas(self):
        padrao = webapp._limites()
        self.assertEqual(set(padrao), {"/api/web/start", "/api/web/route", "/api/web/silence"})
        self.assertIsNone(padrao["/api/web/start"][1], "a resposta não sai para fora")
        self.assertIsNone(padrao["/api/web/silence"][1], "o silêncio não sai para fora")
        self.assertEqual(padrao["/api/web/route"][1].n, webapp.ROUTE_MAX)
        for balde, _ in padrao.values():
            self.assertGreater(balde.capacidade, 0)
            self.assertGreater(balde.por_segundo, 0)

    def test_a_voz_e_o_microfone_ficam_so_ao_orcamento_diario(self):
        """`/api/web/tts` e `/api/web/stt-token` já têm o orçamento de `Usage`
        (caracteres por pessoa e do servidor, sessões de microfone). Um balde
        por cima seriam duas portas para o mesmo dinheiro — e o 429 do balde
        desligaria a voz do browser, que é o que o 429 do orçamento já faz."""
        self.assertNotIn("/api/web/tts", webapp.LIMITES)
        self.assertNotIn("/api/web/stt-token", webapp.LIMITES)

    def test_um_pedido_recusado_nao_parte_a_ligacao_seguinte(self):
        """O corpo do pedido é lido antes do limite de propósito: responder sem
        o ler deixaria o resto do pedido na ligação e o pedido seguinte na mesma
        ligação leria lixo."""
        with self.com_limites(start=(0, 0.0)):
            ligacao = HTTPConnection(*self.srv.server_address, timeout=10)
            self.addCleanup(ligacao.close)
            headers = {"Authorization": f"Bearer {TOKEN_OK}", "Content-Type": "application/json"}
            ligacao.request("POST", "/api/web/start",
                            body=json.dumps({"profile": {"nome": "Zeca"}}).encode(), headers=headers)
            primeira = ligacao.getresponse()
            self.assertEqual(primeira.status, 429)
            primeira.read()
            ligacao.request("POST", "/api/web/silence", body=json.dumps({"profile": {}}).encode(),
                            headers=headers)
            segunda = ligacao.getresponse()
            self.assertEqual(segunda.status, 200)
            self.assertTrue(json.loads(segunda.read())["text"])

    # ── concorrência ──────────────────────────────────────────────────────────

    def test_o_atalho_caro_nao_corre_de_perto(self):
        atalho, chegou, dentro, largar = self.atalho_bloqueado()
        respostas = {}
        pendentes = []
        with self.com_limites(rota=(20, 0.0), lugares=2), atalho:
            try:
                pendentes = [threading.Thread(target=lambda i=i: respostas.__setitem__(
                    i, self.post("/api/web/route", {"text": "notícias"})[0])) for i in range(2)]
                for t in pendentes:
                    t.start()
                with chegou:
                    self.assertTrue(chegou.wait_for(lambda: len(dentro) == 2, 5),
                                    f"os dois atalhos tinham de ficar a aguardar, chegou {len(dentro)}")
                status, body, headers = self.post("/api/web/route", {"text": "notícias"})
            finally:
                # antes de sair do `with`: com a duble retirada, um atalho ainda
                # à espera ia mesmo buscar notícias aos jornais
                largar.set()
                for t in pendentes:
                    t.join(10)
        self.assertEqual(status, 503, "sem lugares: o terceiro é recusado, não posto em fila")
        self.assertIn("atender toda a gente", body["error"])
        self.assertGreaterEqual(int(headers["Retry-After"]), 1)
        self.assertEqual(sorted(respostas.values()), [200, 200], "os dois que estavam dentro passaram")

    def test_o_lugar_volta_assim_que_o_atalho_termina(self):
        with self.com_limites(rota=(20, 0.0), lugares=1), \
                mock.patch.object(webapp.assistant.web, "headlines", return_value=[]):
            self.assertEqual(self.post("/api/web/route", {"text": "notícias"})[0], 200)
            self.assertEqual(webapp.LIMITES["/api/web/route"][1].livres(), 1)
            self.assertEqual(self.post("/api/web/route", {"text": "que horas são"})[0], 200)

    def test_o_lugar_volta_mesmo_quando_o_atalho_falha(self):
        with self.com_limites(rota=(20, 0.0), lugares=1), \
                mock.patch.object(webapp.assistant.web, "headlines",
                                  side_effect=RuntimeError("a news caiu")):
            self.assertEqual(self.post("/api/web/route", {"text": "notícias"})[0], 500)
            self.assertEqual(webapp.LIMITES["/api/web/route"][1].livres(), 1,
                             "o `finally` tem de largar o lugar mesmo com a rota em baixo")
        self.assertEqual(self.post("/api/web/route", {"text": "que horas são"})[0], 200)

    def test_um_pedido_recusado_pelo_balde_nao_prende_lugar(self):
        with self.com_limites(rota=(0, 0.0), lugares=2):
            self.assertEqual(self.post("/api/web/route", {"text": "que horas são"})[0], 429)
            self.assertEqual(webapp.LIMITES["/api/web/route"][1].livres(), 2,
                             "recusar por balde não pode custar um lugar de execução")

    # ── lá fora ───────────────────────────────────────────────────────────────

    def test_um_servico_de_fora_que_demorou_demais_e_504(self):
        with mock.patch.object(webapp.assistant.web, "weather",
                               side_effect=TimeoutError("passou do tempo")):
            status, body, _ = self.post("/api/web/route", {"text": "clima"})
        self.assertEqual(status, 504)
        self.assertIn("demorou demais", body["error"])

    def test_um_timeout_vencido_pelo_urlopen_e_504(self):
        """O `urlopen` embrulha o timeout num `URLError` em vez de o atirar
        cru. É o mesmo "não respondeu a tempo" e tem de dar o mesmo 504 — com a
        mensagem curta, sem o URL do serviço do dono do servidor e sem traceback
        nenhum na cara de quem pediu."""
        erro = urllib.error.URLError(socket.timeout("timed out"))
        with mock.patch.object(webapp.assistant.web, "weather", side_effect=erro), \
                mock.patch.object(webapp.traceback, "print_exc") as log:
            status, body, _ = self.post("/api/web/route", {"text": "clima"})
        self.assertEqual(status, 504)
        self.assertEqual(list(body), ["error"])
        self.assertIn("demorou demais", body["error"])
        self.assertNotIn("open-meteo", body["error"], "o URL do serviço não sai para o browser")
        log.assert_not_called()

    def test_um_timeout_cru_tambem_nao_deixa_traceback(self):
        with mock.patch.object(webapp.assistant.web, "weather", side_effect=TimeoutError()), \
                mock.patch.object(webapp.traceback, "print_exc") as log:
            status, body, _ = self.post("/api/web/route", {"text": "clima"})
        self.assertEqual(status, 504)
        self.assertIn("demorou demais", body["error"])
        log.assert_not_called()

    def test_uma_rede_quebrada_nao_vira_504(self):
        """Só o tempo esgotado é 504. Uma DNS que não resolve, ou alguém que
        devolveu 500, continuam a ser 500 — dizer "tenta outra vez" a quem tem
        de esperar por outra coisa seria mentira."""
        for erro in (urllib.error.URLError("nome não resolvido"),
                     urllib.error.HTTPError("https://api.exemplo.pt", 500, "caiu", {}, None),
                     urllib.error.URLError(ConnectionResetError("resetado"))):
            with self.subTest(erro=type(erro).__name__):
                with mock.patch.object(webapp.assistant.web, "weather", side_effect=erro):
                    status, _, _ = self.post("/api/web/route", {"text": "clima"})
                self.assertEqual(status, 500)

    def test_o_504_tem_o_mesmo_jeito_aconteça_como_o_timeout(self):
        """As duas maneiras de o exterior passar do tempo têm de dar
        exatamente a mesma resposta."""
        respostas = []
        for erro in (TimeoutError("passou do tempo"),
                     urllib.error.URLError(socket.timeout("timed out"))):
            with mock.patch.object(webapp.assistant.web, "weather", side_effect=erro):
                respostas.append(self.post("/api/web/route", {"text": "clima"})[:2])
        self.assertEqual(respostas[0], respostas[1])

    def test_o_504_nao_parte_o_servidor(self):
        with mock.patch.object(webapp.assistant.web, "weather", side_effect=TimeoutError("caiu")):
            self.post("/api/web/route", {"text": "clima"})
        self.assertEqual(self.post("/api/web/start", {"profile": {}})[0], 200)
        self.assertEqual(self.post("/api/web/silence", {"profile": {}})[0], 200)

    def test_quando_a_puter_nao_tem_lugar_o_token_da_401_sem_sair_de_casa(self):
        with mock.patch.object(webapp, "LUGARES_PUTER", limits.Semaforo(0)), \
                mock.patch.object(webapp, "_who", {}), \
                mock.patch.object(urllib.request, "urlopen") as abrir:
            self.assertIsNone(PUTER_USER_REAL("token-novo"))
        abrir.assert_not_called()

    def test_o_lugar_da_conferencia_volta_mesmo_se_a_puter_cair(self):
        with mock.patch.object(webapp, "LUGARES_PUTER", limits.Semaforo(1)), \
                mock.patch.object(webapp, "_who", {}), \
                mock.patch.object(urllib.request, "urlopen", side_effect=TimeoutError("caiu")):
            self.assertIsNone(PUTER_USER_REAL("token-novo"))
            self.assertEqual(webapp.LUGARES_PUTER.livres(), 1)
            self.assertIsNone(PUTER_USER_REAL("outro-token"))


class TimeoutRealTest(WebServerTest):
    """O timeout a sério, não uma excepção injectada: um servidor local que
    aceita a ligação e nunca responde. O `urlopen` atira o que atiraria com um
    jornal em baixo, e a resposta tem de ser a mesma."""

    def setUp(self):
        super().setUp()
        self.calado = socket.socket()
        self.calado.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.calado.bind(("127.0.0.1", 0))
        self.calado.listen(5)
        self.addCleanup(self.calado.close)
        self.porta = self.calado.getsockname()[1]
        self.ligacoes = []
        threading.Thread(target=self._engolir, daemon=True).start()

    def _engolir(self):
        while True:
            try:
                ligacao, _ = self.calado.accept()
            except OSError:
                return
            self.ligacoes.append(ligacao)  # fica aberta, e calada

    def test_um_servico_que_nunca_responde_da_504(self):
        def calado(url, timeout=12, **kw):
            return urllib.request.urlopen(f"http://127.0.0.1:{self.porta}/", timeout=0.3).read()

        with mock.patch.object(webapp.assistant.web, "http_get", calado), \
                mock.patch.object(webapp.traceback, "print_exc") as log:
            status, body, _ = self.post("/api/web/route", {"text": "clima em Luanda"})
        self.assertEqual(status, 504)
        self.assertIn("demorou demais", body["error"])
        log.assert_not_called()
        self.assertTrue(self.ligacoes, "o urlopen foi mesmo bater ao servidor calado")

    def test_as_maneiras_como_o_urlopen_atira_um_timeout(self):
        """Medido contra a rede, não de memória: um timeout de leitura vem como
        `TimeoutError` cru, um timeout de ligação vem embrulhado num `URLError`
        com `reason` a ser `TimeoutError`. Os dois têm de ser 504. Uma DNS que
        não existe dá `URLError` mas com `reason` a ser `gaierror` — essa não
        é timeout, e é um 500."""
        self.assertTrue(webapp._passou_do_tempo(TimeoutError("timed out")))
        self.assertTrue(webapp._passou_do_tempo(urllib.error.URLError(socket.timeout("timed out"))))
        self.assertFalse(webapp._passou_do_tempo(urllib.error.URLError(socket.gaierror("não existe"))))
        self.assertFalse(webapp._passou_do_tempo(urllib.error.HTTPError("u", 504, "", {}, None)))
        self.assertFalse(webapp._passou_do_tempo(urllib.error.URLError(ConnectionResetError("reset"))))
        self.assertFalse(webapp._passou_do_tempo(RuntimeError("qualquer outra coisa")))


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