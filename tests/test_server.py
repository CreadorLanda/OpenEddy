"""A ponte local do app (core/server.py): o token de sessão, os turnos em SSE e
as rotas que o Tauri chama.

Servidor de verdade numa porta livre; Ollama, voz e microfone são dublês. A
única coisa que este ficheiro garante é a fronteira: sem o token certo, nada
passa — nem o health, nem a voz, nem o turno.
"""

import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import assistant
import eleven
import events
import llm
import memory
import server
import voice

TOKEN = server.TOKEN

# `llm.urllib` é o próprio módulo `urllib`: um dublê posto no `urlopen` do Ollama
# apanharia também o cliente HTTP destes testes. Este é o de verdade, guardado antes
# de qualquer troca.
_URLOPEN = urllib.request.urlopen


def http(base, method, path, body=None, token=TOKEN, in_query=False):
    headers = {"X-Eddy-Token": token} if token is not None else {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if in_query:
        path = f"{path}?token={token}"
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with _URLOPEN(req, timeout=10) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def as_json(raw):
    return json.loads(raw or b"{}")


class Linhas:
    """O que o urlopen devolve ao `llm.chat`: linhas do stream do Ollama."""

    def __init__(self, linhas):
        self.linhas = linhas

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def __iter__(self):
        return iter(self.linhas)


def sse_events(raw):
    """Separa os blocos `data:` de uma resposta SSE."""
    out = []
    for bloco in raw.decode().split("\n\n"):
        for linha in bloco.splitlines():
            if linha.startswith("data: "):
                out.append(json.loads(linha[6:]))
    return out


class ServerTest(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch.object(llm, "alive", return_value=True),
            mock.patch.object(llm, "models", return_value=[llm.model()]),
            mock.patch.object(llm, "warm_up"),
            mock.patch.object(voice, "ready", return_value=True),
            mock.patch.object(voice, "warm_up"),
            mock.patch.object(assistant, "greeting", return_value="[sighs] Alô, garoto."),
            mock.patch.object(assistant.Eddy, "silence_line", return_value="[scoffs] Silêncio?"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        # As rotas leem o `eddy` global do servidor, e o `Eddy` guarda o estado da
        # chamada (voz, perfil, conversa, falas de silêncio já usadas). Um teste que
        # muda a voz ou enche a conversa deixaria isso para o teste seguinte, e
        # `set_profile` só limpa o histórico. Cada teste recebe um Eddy novo e o
        # global volta ao sítio no cleanup — que corre mesmo se o teste falhar.
        self.eddy = assistant.Eddy()
        patcher = mock.patch.object(server, "eddy", self.eddy)
        patcher.start()
        self.addCleanup(patcher.stop)
        # A memória de cada teste vive numa base temporária: a de quem está a
        # correr a suíte nunca é tocada.
        self.mem_dir = tempfile.TemporaryDirectory(prefix="openeddy-server-mem-")
        self.addCleanup(self.mem_dir.cleanup)
        self.eddy.memory = memory.Memory(os.path.join(self.mem_dir.name, "memory.db"))
        self.eddy.set_profile({"nome": "Zeca", "idade": 30, "idioma": "pt"})

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Api)
        self.srv.daemon_threads = True
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.02},
                         daemon=True).start()
        # LIFO: shutdown primeiro, só depois de fechar o socket
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)

    def get(self, path, **kw):
        status, raw, headers = http(self.base, "GET", path, **kw)
        return status, as_json(raw), headers

    def post(self, path, body=None, **kw):
        status, raw, headers = http(self.base, "POST", path, body if body is not None else {}, **kw)
        return status, as_json(raw), headers

    def delete(self, path, **kw):
        status, raw, headers = http(self.base, "DELETE", path, None, **kw)
        return status, as_json(raw), headers

    def first_bytes(self, path, n=200, token=TOKEN):
        """Os primeiros bytes de uma resposta que fica aberta (o stream de eventos)."""
        cab = f"X-Eddy-Token: {token}\r\n" if token else ""
        req = f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{cab}\r\n"
        with socket.create_connection(("127.0.0.1", self.srv.server_address[1]), timeout=5) as s:
            s.sendall(req.encode())
            s.settimeout(2)
            buf = b""
            while len(buf) < n:
                try:
                    parte = s.recv(n - len(buf))
                except TimeoutError:
                    break
                if not parte:
                    break
                buf += parte
            return buf

    def post_sse(self, path, body, **kw):
        status, raw, headers = http(self.base, "POST", path, body, **kw)
        return status, sse_events(raw), headers


class TokenTest(ServerTest):
    """Sem o token de sessão, o núcleo local não responde a nada."""

    def test_no_token_is_401(self):
        status, body, _ = self.get("/api/health", token=None)
        self.assertEqual((status, body), (401, {"error": "não autorizado"}))

    def test_a_wrong_token_is_401(self):
        self.assertEqual(self.get("/api/health", token="inventado")[0], 401)

    def test_the_health_also_needs_the_token(self):
        self.assertEqual(self.get("/api/health", token=None)[0], 401)

    def test_a_turn_without_the_token_speaks_nothing(self):
        with mock.patch.object(llm, "chat", side_effect=AssertionError("não deve chamar o modelo")):
            status, _, _ = self.post("/api/eddy/turn", {"text": "oi"}, token=None)
        self.assertEqual(status, 401)

    def test_the_event_stream_takes_the_token_in_the_query(self):
        """O `EventSource` do navegador não manda cabeçalhos: a token vai na URL.
        O stream fica aberto, por isso lê-se só o primeiroHello."""
        self.assertIn(b'data: {"type": "hello"}', self.first_bytes("/api/events?token=" + TOKEN, n=400))
        self.assertIn(b"401", self.first_bytes("/api/events", token=None))


class HealthTest(ServerTest):
    def test_it_says_if_the_model_and_the_voice_are_there(self):
        status, body, _ = self.get("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ollama": True, "models": [llm.model()], "model": llm.model(),
                                "model_ready": True, "voice": True})

    def test_a_model_that_is_not_pulled_shows_up_in_the_app(self):
        with mock.patch.object(llm, "models", return_value=[]):
            _, body, _ = self.get("/api/health")
        self.assertFalse(body["model_ready"])


class RoutingTest(ServerTest):
    def test_a_route_that_does_not_exist_is_404(self):
        status, body, _ = self.post("/api/eddy/nada-disso")
        self.assertEqual((status, body), (404, {"error": "rota inexistente"}))

    def test_a_route_with_the_wrong_method_is_404(self):
        status, _, _ = self.get("/api/eddy/turn")
        self.assertEqual(status, 404)

    def test_a_body_that_is_not_json_is_a_400(self):
        req = urllib.request.Request(self.base + "/api/eddy/turn", data="isto não é json".encode(),
                                     headers={"X-Eddy-Token": TOKEN, "Content-Type": "application/json"},
                                     method="POST")
        with self.assertRaises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(err.exception.code, 400)


class TurnTest(ServerTest):
    def test_an_empty_turn_is_refused_before_the_model(self):
        with mock.patch.object(llm, "chat", side_effect=AssertionError("não deve chamar o modelo")):
            status, body, _ = self.post("/api/eddy/turn", {"text": "   "})
        self.assertEqual((status, body), (400, {"error": "mensagem vazia"}))

    def test_the_answer_arrives_token_by_token_and_then_done(self):
        def chat(_model, messages, on_token=None, **_):
            for parte in ("[sighs] ", "Olá, ", "garoto."):
                on_token(parte)
            return {"content": "[sighs] Olá, garoto."}

        with mock.patch.object(llm, "chat", side_effect=chat):
            status, eventos, headers = self.post_sse("/api/eddy/turn", {"text": "oi"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/event-stream")
        self.assertEqual([e["type"] for e in eventos], ["token", "token", "token", "done"])
        self.assertEqual(eventos[0]["token"], "[sighs] ")
        self.assertEqual(eventos[-1]["text"], "[sighs] Olá, garoto.")

    def test_a_failing_model_arrives_as_an_error_event_not_a_dead_stream(self):
        with mock.patch.object(llm, "chat", side_effect=RuntimeError("ollama: modelo não encontrado")):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "oi"})
        self.assertEqual(eventos[-1]["type"], "error")
        self.assertIn("modelo não encontrado", eventos[-1]["error"])

    def test_a_shortcut_answers_in_a_single_token(self):
        with mock.patch.object(llm, "chat", side_effect=AssertionError("não deve chamar o modelo")), \
                mock.patch.object(assistant.web, "now_text", return_value="17 de outubro"):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "que dia é hoje"})
        self.assertEqual([e["type"] for e in eventos], ["token", "done"])
        self.assertIn("17 de outubro", eventos[0]["token"])

    def test_a_turn_from_a_finished_call_is_never_published(self):
        """O turno continua a pensar depois de a pessoa desligar e ligar outra vez:
        o stream fecha sem `done`, para o cliente não pintar a resposta velha."""

        def chat(*_a, **_kw):
            self.post("/api/eddy/call/start")  # a chamada nova, a meio do turno velho
            return {"content": "resposta velha"}

        with mock.patch.object(llm, "chat", side_effect=chat):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "pergunta velha"})
        self.assertEqual(eventos, [])
        self.assertEqual(self.eddy.history, [])

    def test_a_token_from_a_call_that_just_ended_never_reaches_the_client(self):
        """A geração muda entre o `should_stop` e a emissão do token: esse token já
        é da chamada velha e não pode aparecer no stream. A verificação por
        fragmento, sozinha, não chega — a troca acontece a seguir."""
        real_chat = llm.chat

        def chat_trocando(*args, on_token=None, should_stop=None, **kwargs):
            def verifica_e_troca():
                parar = should_stop()
                if not parar:  # só depois de decidir que continua é que a chamada muda
                    self.post("/api/eddy/call/start")
                return parar
            return real_chat(*args, on_token=on_token, should_stop=verifica_e_troca, **kwargs)

        linhas = [json.dumps({"message": {"content": parte}}).encode() + b"\n"
                  for parte in ("[sighs] token", " da chamada velha")]
        with mock.patch.object(llm, "chat", side_effect=chat_trocando), \
                mock.patch.object(llm.urllib.request, "urlopen", return_value=Linhas(linhas)):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "pergunta velha"})
        self.assertEqual(eventos, [])
        self.assertEqual(self.eddy.history, [])

    def test_a_current_turn_still_publishes_its_answer(self):
        with mock.patch.object(llm, "chat", return_value={"content": "resposta da chamada"}):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "pergunta"})
        self.assertEqual([e["type"] for e in eventos], ["done"])
        self.assertEqual(eventos[0]["text"], "resposta da chamada")
        self.assertEqual(len(self.eddy.history), 2)

    def test_a_current_turn_still_streams_its_tokens(self):
        """O token a sério continua a sair um a um, como antes."""
        linhas = [json.dumps({"message": {"content": parte}}).encode() + b"\n"
                  for parte in ("Bom ", "dia.")]
        with mock.patch.object(llm.urllib.request, "urlopen", return_value=Linhas(linhas)):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "bom dia"})
        self.assertEqual([e["type"] for e in eventos], ["token", "token", "done"])
        self.assertEqual([e["token"] for e in eventos[:2]], ["Bom ", "dia."])


class CallTest(ServerTest):
    def test_a_new_call_greets(self):
        status, body, _ = self.post("/api/eddy/call/start")
        self.assertEqual(status, 200)
        self.assertEqual(body["text"], "[sighs] Alô, garoto.")
        # a voz deste Eddy (novo em cada teste): se o estado vaza de um teste para
        # outro, este valor deixa de ser a voz padrão e o teste dá por si
        self.assertEqual(body["voice"], eleven.default_voice())

    def test_the_silence_line_is_answered(self):
        status, body, _ = self.post("/api/eddy/call/silence", {"final": False})
        self.assertEqual((status, body["text"]), (200, "[scoffs] Silêncio?"))

    def test_the_farewell_is_asked_for_explicitly(self):
        with mock.patch.object(assistant.Eddy, "silence_line", return_value="[sighs] Tchau.") as farewell:
            _, body, _ = self.post("/api/eddy/call/silence", {"final": True})
        self.assertEqual(farewell.call_args.kwargs, {"final": True})
        self.assertEqual(body["text"], "[sighs] Tchau.")

    def test_the_profile_is_saved_and_cleaned(self):
        _, body, _ = self.post("/api/eddy/profile", {"nome": "x" * 80, "idade": "velho", "sexo": "x"})
        self.assertEqual(len(body["profile"]["nome"]), 40)
        self.assertEqual(body["profile"]["idade"], 25)
        self.assertEqual(body["profile"]["sexo"], "outro")

    def test_another_voice_can_be_chosen(self):
        # uma voz diferente da padrão, para o teste apanhar se a escolha vazar
        _, body, _ = self.post("/api/eddy/config", {"voice": "pm_santa"})
        self.assertEqual(body["voice"], "pm_santa")


class ListenTest(ServerTest):
    def test_listening_says_when_the_microphone_is_on_and_off_again(self):
        with mock.patch.object(voice, "listen", return_value="oi Eddy") as escuta, \
                mock.patch.object(events, "publish") as pub:
            status, body, _ = self.post("/api/eddy/listen", {"max_seconds": 5})
        self.assertEqual((status, body), (200, {"text": "oi Eddy"}))
        self.assertEqual(escuta.call_args.kwargs["max_seconds"], 5.0)
        estados = [c.kwargs["on"] for c in pub.call_args_list if c[0][0] == "voice.listening"]
        self.assertEqual(estados, [True, False])  # mesmo que a escuta falhe

    def test_the_microphone_is_turned_off_even_when_the_listen_fails(self):
        with mock.patch.object(voice, "listen", side_effect=RuntimeError("o microfone já está em uso")), \
                mock.patch.object(events, "publish") as pub:
            status, body, _ = self.post("/api/eddy/listen")
        self.assertEqual(status, 500)
        estados = [c.kwargs["on"] for c in pub.call_args_list if c[0][0] == "voice.listening"]
        self.assertEqual(estados, [True, False])

    def test_hanging_up_releases_the_microphone(self):
        with mock.patch.object(voice, "cancel_listen") as cancela:
            status, body, _ = self.post("/api/eddy/listen/cancel")
        self.assertEqual((status, body), (200, {"ok": True}))
        cancela.assert_called_once_with()

    def test_a_very_long_listen_is_cut_to_thirty_seconds(self):
        with mock.patch.object(voice, "listen", return_value="") as escuta:
            self.post("/api/eddy/listen", {"max_seconds": 9999})
        self.assertEqual(escuta.call_args.kwargs["max_seconds"], 30.0)


class TtsTest(ServerTest):
    def test_empty_text_is_refused(self):
        for rota in ("/api/tts", "/api/tts/stream"):
            status, body, _ = self.post(rota, {"text": "  "})
            self.assertEqual((status, body), (400, {"error": "texto vazio"})), rota

    def test_the_voice_comes_with_the_type_it_is(self):
        with mock.patch.object(voice, "tts", return_value=(b"ID3-mp3", "audio/mpeg")) as fala:
            status, raw, headers = http(self.base, "POST", "/api/tts", {"text": "olá"})
        self.assertEqual((status, raw), (200, b"ID3-mp3"))
        self.assertEqual(headers["Content-Type"], "audio/mpeg")
        self.assertEqual(fala.call_args[0][0], "olá")

    def test_without_elevenlabs_the_stream_falls_back_to_the_whole_wav(self):
        with mock.patch.object(voice, "tts_stream", return_value=None), \
                mock.patch.object(voice, "tts", return_value=(b"RIFF-wav", "audio/wav")) as fala:
            status, raw, headers = http(self.base, "POST", "/api/tts/stream",
                                        {"text": "olá", "voice": "eleven:SERGIO"})
        self.assertEqual((status, raw), (200, b"RIFF-wav"))
        self.assertEqual(headers["Content-Type"], "audio/wav")
        # a voz escolhida era da ElevenLabs, que não está a responder: usa o Alex local
        self.assertEqual(fala.call_args[0][1], "pm_alex")

    def test_with_elevenlabs_the_pcm_is_relayed_as_it_arrives(self):
        with mock.patch.object(voice, "tts_stream", return_value=iter((b"\x01\x02", b"\x03\x04"))):
            status, raw, headers = http(self.base, "POST", "/api/tts/stream", {"text": "olá"})
        self.assertEqual((status, raw), (200, b"\x01\x02\x03\x04"))
        self.assertEqual(headers["Content-Type"], f"audio/pcm;rate={voice.PCM_RATE}")

    def test_the_tags_go_to_the_voice_untouched(self):
        with mock.patch.object(voice, "tts_stream", return_value=iter((b"\x01",))) as stream:
            http(self.base, "POST", "/api/tts/stream", {"text": "[sighs] olá", "voice": "eleven:SERGIO"})
        self.assertEqual(stream.call_args[0][0], "[sighs] olá")

    def test_a_local_voice_is_synthesised_whole_from_the_start(self):
        """`tts_stream` devolve None para quem não é da ElevenLabs: aí o WAV do
        Kokoro vai todo de uma vez, com o Content-Type certo."""
        with mock.patch.object(voice, "tts_stream", return_value=None) as stream, \
                mock.patch.object(voice, "tts", return_value=(b"RIFF-wav", "audio/wav")) as fala:
            http(self.base, "POST", "/api/tts/stream", {"text": "olá", "voice": "pf_dora"})
        self.assertEqual(stream.call_args[0][1], "pf_dora")
        self.assertEqual(fala.call_args[0][1], "pf_dora")


class MemoryRouteTest(ServerTest):
    """A memória pela API: o âmbito é o dono ligado no núcleo, nunca o corpo."""

    def entra(self, owner="ana"):
        return self.post("/api/eddy/profile", {"nome": "Zeca", "idade": 30, "idioma": "pt", "owner": owner})

    def test_sem_dono_a_memoria_diz_que_nao_da(self):
        status, body, _ = self.get("/api/eddy/memory")
        self.assertEqual(status, 400)
        self.assertIn("dono", body["error"])

    def test_comeca_desligada_e_vazia(self):
        self.entra()
        self.assertEqual(self.get("/api/eddy/memory")[1], {"enabled": False, "entries": []})

    def test_o_ciclo_completo_pela_api(self):
        self.entra()
        self.assertEqual(self.post("/api/eddy/memory", {"enabled": True})[1], {"enabled": True})
        _, guardado, _ = self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        self.assertTrue(guardado["id"] > 0)

        _, estado, _ = self.get("/api/eddy/memory")
        self.assertTrue(estado["enabled"])
        self.assertEqual([e["text"] for e in estado["entries"]], ["mora em Luanda"])

        _, apagado, _ = self.delete(f"/api/eddy/memory/{guardado['id']}")
        self.assertTrue(apagado["deleted"])
        self.assertEqual(self.get("/api/eddy/memory")[1]["entries"], [])

    def test_desligar_mantem_o_que_esta_guardado(self):
        self.entra()
        self.post("/api/eddy/memory", {"enabled": True})
        self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        self.assertEqual(self.post("/api/eddy/memory", {"enabled": False})[1], {"enabled": False})
        self.assertEqual(len(self.get("/api/eddy/memory")[1]["entries"]), 1)

    def test_esquecer_tudo(self):
        self.entra()
        self.post("/api/eddy/memory", {"enabled": True})
        for texto in ("mora em Luanda", "bebe café"):
            self.post("/api/eddy/memory/add", {"text": texto})
        self.assertEqual(self.post("/api/eddy/memory/clear")[1], {"removed": 2})
        self.assertEqual(self.get("/api/eddy/memory")[1]["entries"], [])

    def test_a_memoria_de_outra_conta_nao_se_vê_nem_se_apaga(self):
        self.entra("ana")
        self.post("/api/eddy/memory", {"enabled": True})
        _, guardado, _ = self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        self.entra("bruno")  # a mesma pessoa, outra conta
        _, estado, _ = self.get("/api/eddy/memory")
        self.assertFalse(estado["enabled"])
        self.assertEqual(estado["entries"], [])
        # e o id do outro não se apaga daqui
        self.assertFalse(self.delete(f"/api/eddy/memory/{guardado['id']}")[1]["deleted"])
        self.entra("ana")
        self.assertEqual(len(self.get("/api/eddy/memory")[1]["entries"]), 1)

    def test_o_corpo_do_pedido_nao_escolhe_o_ambito(self):
        self.entra("ana")
        self.post("/api/eddy/memory", {"enabled": True})
        self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        self.post("/api/eddy/memory/add", {"text": "segredo do bruno", "owner": "bruno"})
        _, estado, _ = self.get("/api/eddy/memory", )  # o GET também não leva dono
        self.assertEqual([e["text"] for e in estado["entries"]], ["segredo do bruno", "mora em Luanda"])
        self.assertEqual(self.post("/api/eddy/memory/clear", {"owner": "bruno"})[1], {"removed": 2})

    # ── validação ─────────────────────────────────────────────────────────────

    def test_um_enabled_que_nao_se_booleano_e_recusado(self):
        self.entra()
        for valor in ("sim", 1, None):
            with self.subTest(valor=valor):
                status, body, _ = self.post("/api/eddy/memory", {"enabled": valor})
                self.assertEqual((status, "error" in body), (400, True))

    def test_um_facto_vazio_ou_sem_texto_e_recusado(self):
        self.entra()
        self.post("/api/eddy/memory", {"enabled": True})
        for corpo in ({}, {"text": "   "}):
            with self.subTest(corpo=corpo):
                self.assertEqual(self.post("/api/eddy/memory/add", corpo)[0], 400)

    def test_apagar_um_id_que_nao_e_numero_e_uma_rota_desconhecida(self):
        self.entra()
        self.assertEqual(self.delete("/api/eddy/memory/abc")[0], 404)

    def test_apagar_o_que_nao_existe_diz_que_nao_apagou(self):
        self.entra()
        self.assertEqual(self.delete("/api/eddy/memory/999")[1], {"deleted": False})

    def test_tudo_isto_exige_o_token_da_sessao(self):
        self.entra()
        for method, rota, corpo in (("GET", "/api/eddy/memory", None),
                                    ("POST", "/api/eddy/memory", {"enabled": True}),
                                    ("POST", "/api/eddy/memory/add", {"text": "oi"}),
                                    ("POST", "/api/eddy/memory/clear", {}),
                                    ("DELETE", "/api/eddy/memory/1", None)):
            with self.subTest(rota=rota):
                status, _, _ = http(self.base, method, rota, corpo, token=None)
                self.assertEqual(status, 401)

    # ── a conversa ────────────────────────────────────────────────────────────

    def test_o_turno_injecta_a_memoria_da_conta_ativa(self):
        self.entra("ana")
        self.post("/api/eddy/memory", {"enabled": True})
        self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        with mock.patch.object(llm, "chat", return_value={"content": "boa"}) as chat:
            self.post_sse("/api/eddy/turn", {"text": "em que cidade moro?"})
        sistema = chat.call_args[0][1][0]["content"]
        self.assertIn("mora em Luanda", sistema)

    def test_o_turno_nao_injecta_memoria_de_outra_conta(self):
        self.entra("ana")
        self.post("/api/eddy/memory", {"enabled": True})
        self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        self.entra("bruno")
        self.post("/api/eddy/memory", {"enabled": True})
        with mock.patch.object(llm, "chat", return_value={"content": "boa"}) as chat:
            self.post_sse("/api/eddy/turn", {"text": "em que cidade moro?"})
        self.assertNotIn("mora em Luanda", chat.call_args[0][1][0]["content"])

    def test_a_memoria_nunca_entra_na_conversa_da_chamada(self):
        self.entra()
        self.post("/api/eddy/memory", {"enabled": True})
        self.post("/api/eddy/memory/add", {"text": "mora em Luanda"})
        with mock.patch.object(llm, "chat", return_value={"content": "boa"}):
            self.post_sse("/api/eddy/turn", {"text": "olá"})
        for mensagem in self.eddy.history:
            self.assertNotIn("mora em Luanda", mensagem["content"])


class ResetRouteTest(ServerTest):
    """`POST /api/eddy/reset` limpa a conversa sem desligar: a mesma voz, o mesmo
    perfil, e o que estava a pensar passa a ser resposta velha."""

    def test_reset_answers_ok_and_clears_the_conversation(self):
        self.eddy.history.extend([{"role": "user", "content": "pergunta"},
                                  {"role": "assistant", "content": "resposta"}])
        self.eddy.seen.append("[sighs] fala de silêncio já usada")
        status, body, _ = self.post("/api/eddy/reset")
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertEqual(self.eddy.history, [])
        self.assertEqual(self.eddy.seen, [])

    def test_reset_keeps_the_profile_and_the_voice(self):
        self.post("/api/eddy/config", {"voice": "pm_santa"})
        self.post("/api/eddy/reset")
        _, body, _ = self.get("/api/meta")
        self.assertEqual(body["eddy"]["voice"], "pm_santa")
        self.assertEqual(body["eddy"]["profile"]["nome"], "Zeca")

    def test_a_token_from_before_the_reset_never_reaches_the_client(self):
        """O reset cai entre o `should_stop` e a emissão do token: esse token é de
        antes do reset, por isso não sai nem volta a escrever no historial."""
        real_chat = llm.chat

        def chat_que_reseta(*args, on_token=None, should_stop=None, **kwargs):
            def verifica_e_reseta():
                parar = should_stop()
                if not parar:  # só depois de decidir que continua é que a conversa é limpa
                    self.post("/api/eddy/reset")
                return parar
            return real_chat(*args, on_token=on_token, should_stop=verifica_e_reseta, **kwargs)

        linhas = [json.dumps({"message": {"content": parte}}).encode() + b"\n"
                  for parte in ("[sighs] token", " anterior ao reset")]
        with mock.patch.object(llm, "chat", side_effect=chat_que_reseta), \
                mock.patch.object(llm.urllib.request, "urlopen", return_value=Linhas(linhas)):
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "pergunta"})
        self.assertEqual(eventos, [])
        self.assertEqual(self.eddy.history, [])

    def test_a_turn_after_the_reset_starts_from_an_empty_conversation(self):
        self.eddy.history.extend([{"role": "user", "content": "pergunta antiga"}])
        self.post("/api/eddy/reset")
        with mock.patch.object(llm, "chat", return_value={"content": "resposta nova"}) as chat:
            _, eventos, _ = self.post_sse("/api/eddy/turn", {"text": "pergunta nova"})
        self.assertEqual([e["type"] for e in eventos], ["done"])
        # o modelo só viu a pergunta nova: o historial antigo não veio atrás
        mensagens = chat.call_args[0][1]
        self.assertEqual(mensagens[-1]["content"], "pergunta nova")
        self.assertEqual(len(mensagens), 2)
        self.assertEqual([m["content"] for m in self.eddy.history], ["pergunta nova", "resposta nova"])


if __name__ == "__main__":
    unittest.main()