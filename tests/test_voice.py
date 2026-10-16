"""O ouvido e a voz do Eddy no PC: quem ouve, quem cancela e o que acontece
quando a ElevenLabs (ou a internet) não está lá.

O ffmpeg, o WebSocket do Scribe, o Whisper e o Kokoro são dublês. O que se
testa aqui é o VAD por energia, a reserva do cancelamento e a queda para o
Whisper local — que é o que decide se a pessoa fica muda ou não.
"""

import json
import threading
import time
import unittest
from unittest import mock

import numpy as np

import events
import voice

SAMPLE = 16000
BLOCK = SAMPLE // 20 * 4  # 50 ms em float32, como o ffmpeg entrega


class FakeMic:
    """O que o ffmpeg devolve: blocos de áudio e um `kill` sem processo."""

    def __init__(self, blocks):
        self.blocks = list(blocks)
        self.stdout = mock.Mock(read=mock.Mock(side_effect=self._read))
        self.killed = 0

    def _read(self, _n):
        return self.blocks.pop(0) if self.blocks else b""

    def kill(self):
        self.killed += 1

    def wait(self):
        pass


def audio(seconds, level):
    """`seconds` de som contínuo no nível dado (0 = silêncio)."""
    n = int(SAMPLE * seconds)
    return (np.full(n, level, dtype=np.float32)).tobytes()


ROOM = 0.02  # zumbido da sala: o piso de ruído que o VAD aprende


def said(seconds):
    """Fala depois do zumbido da sala, com vaivém para não virar ruído de fundo."""
    out = [audio(0.35, ROOM)]
    blocos = int(SAMPLE * seconds / 50)
    for i in range(blocos):
        out.append(audio(0.05, 0.6 if i % 2 == 0 else 0.25))
    return b"".join(out)


def blocks(*parts):
    """Junta pedaços em blocos do tamanho que a voz lê."""
    out = b"".join(parts)
    return [out[i:i + BLOCK] for i in range(0, len(out), BLOCK)]


class ListenFallbackTest(unittest.TestCase):
    """Com chave, tenta o Scribe; se a rede falhar, o Whisper local assume."""

    def test_without_a_key_goes_straight_to_the_local_whisper(self):
        with mock.patch.object(voice, "eleven_key", return_value=None), \
                mock.patch.object(voice, "_listen_local", return_value="local") as local, \
                mock.patch.object(voice, "_listen_eleven") as scribe:
            self.assertEqual(voice.listen(), "local")
        scribe.assert_not_called()
        local.assert_called_once()

    def test_a_dead_scribe_falls_back_to_the_local_whisper_and_says_why(self):
        with mock.patch.object(voice, "eleven_key", return_value="k"), \
                mock.patch.object(voice, "_listen_eleven", side_effect=voice._NoNetwork("sem rede")), \
                mock.patch.object(voice, "_listen_local", return_value="whisper") as local, \
                mock.patch.object(events, "publish") as pub:
            self.assertEqual(voice.listen(), "whisper")
        local.assert_called_once()
        avisos = [c for c in pub.call_args_list if c[0][0] == "voice.error"]
        self.assertEqual(len(avisos), 1)
        self.assertIn("whisper local", avisos[0].kwargs["error"])

    def test_a_failure_that_is_not_the_network_is_not_swallowed(self):
        """O microfone ocupado é um erro do utilizador, não falta de rede: tem de
        aparecer, senão a pessoa fica sem perceber por que a ligação calou."""
        with mock.patch.object(voice, "eleven_key", return_value="k"), \
                mock.patch.object(voice, "_listen_eleven", side_effect=RuntimeError("o microfone já está em uso")), \
                mock.patch.object(voice, "_listen_local") as local:
            with self.assertRaises(RuntimeError):
                voice.listen()
        local.assert_not_called()


class MicLockTest(unittest.TestCase):
    """A reserva do microfone é global: uma escuta por vez, e sempre libertada."""

    def test_two_listens_at_once_do_not_share_the_microphone(self):
        voice._mic_lock.acquire()
        try:
            with mock.patch.object(voice, "eleven_key", return_value=None), \
                    mock.patch.object(voice.subprocess, "Popen", side_effect=AssertionError("não deve abrir o mic")):
                with self.assertRaises(RuntimeError):
                    voice.listen()
        finally:
            voice._mic_lock.release()

    def test_the_lock_comes_back_even_when_the_scribe_dies_mid_listen(self):
        with mock.patch.object(voice, "eleven_key", return_value="k"), \
                mock.patch.object(voice, "_listen_eleven", side_effect=voice._NoNetwork("caiu")), \
                mock.patch.object(voice, "_listen_local", return_value=""):
            voice.listen()
        self.assertFalse(voice._mic_lock.locked())


class LocalListenTest(unittest.TestCase):
    """O VAD por energia: começa a contar o silêncio depois que houve fala."""

    def setUp(self):
        self.nivel = []
        pub = mock.patch.object(events, "publish", side_effect=lambda k, **d: self.nivel.append((k, d)))
        pub.start()
        self.addCleanup(pub.stop)

    def hear(self, *parts, lang="pt"):
        mic = FakeMic(blocks(*parts))
        with mock.patch.object(voice.subprocess, "Popen", return_value=mic), \
                mock.patch.object(voice, "transcribe_pcm", return_value="a frase") as stt:
            texto = voice._listen_local(lang=lang)
        return texto, mic, stt

    def test_silence_all_the_way_is_not_a_turn(self):
        texto, mic, stt = self.hear(audio(0.3, 0.0))
        self.assertEqual(texto, "")
        stt.assert_not_called()
        self.assertEqual(mic.killed, 1)

    def test_a_sentence_with_a_pause_at_the_end_ends_the_turn(self):
        # alguém a falar, 1,2 s em silêncio: fecha, sem esperar o limite de 12 s
        texto, _, stt = self.hear(said(0.3), audio(1.2, 0.0))
        self.assertEqual(texto, "a frase")
        stt.assert_called_once()
        self.assertEqual(stt.call_args.args[1], "pt")

    def test_a_pause_in_the_middle_is_not_the_end_of_the_turn(self):
        texto, _, _ = self.hear(said(0.4), audio(0.4, 0.0), said(0.3), audio(1.2, 0.0))
        self.assertEqual(texto, "a frase")

    def test_the_language_goes_to_the_whisper(self):
        _, _, stt = self.hear(said(0.3), audio(1.2, 0.0), lang="en")
        self.assertEqual(stt.call_args.args[1], "en")

    def test_the_microphone_level_is_published_for_the_face(self):
        self.hear(said(0.3), audio(1.2, 0.0))
        niveis = [d["level"] for k, d in self.nivel if k == "voice.level"]
        self.assertTrue(niveis)
        self.assertTrue(all(0.0 <= n <= 1.0 for n in niveis))
        self.assertGreater(max(niveis), 0.5)

    def test_hanging_up_mid_listen_gives_the_microphone_back_at_once(self):
        """O `cancel_listen` é para a escuta que já está a acontecer: desliga a
        ligação no meio de uma frase e o microfone tem de soltar-se na hora."""
        gate = threading.Event()
        mic = FakeMic([])
        mic.stdout.read = lambda n: gate.wait(2) and audio(0.05, 0.6)
        resultado = []
        with mock.patch.object(voice.subprocess, "Popen", return_value=mic), \
                mock.patch.object(voice, "transcribe_pcm") as stt:
            t = threading.Thread(target=lambda: resultado.append(voice._listen_local()))
            t.start()
            while not voice._mic_lock.locked():
                time.sleep(0.005)  # a escuta já pegou o microfone
            voice.cancel_listen()
            t.join(3)
        self.assertFalse(t.is_alive())
        self.assertEqual(resultado, [""])
        self.assertEqual(mic.killed, 1)
        stt.assert_not_called()
        self.assertFalse(voice._mic_lock.locked())


class FakeWs:
    """O Scribe v2 Realtime, em memória."""

    def __init__(self, script=()):
        self.script = list(script)
        self.sent = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True

    def send(self, data):
        self.sent.append(json.loads(data))

    def recv(self, timeout=None):
        # o áudio e a transcrição correm em duas pontas; aqui o áudio sai sempre
        # primeiro, senão o teste depende da ordem em que as duas threads acordam
        fim = time.time() + 2
        while not self.sent and time.time() < fim:
            time.sleep(0.005)
        if not self.script:
            raise TimeoutError()
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return json.dumps(item)

    def close(self):
        self.closed = True


def eleven_listen(script=(), connect_error=None, mic_blocks=None, **kw):
    """Roda o Scribe com o WebSocket e o ffmpeg trocados (o relógio é o de
    verdade, mas com prazos de milissegundos: o teste não espera segundos)."""
    ws = FakeWs(script=script)
    mic = FakeMic(mic_blocks if mic_blocks is not None else blocks(said(0.2)))
    cliente = mock.Mock(connect=mock.Mock(side_effect=connect_error) if connect_error
                        else mock.Mock(return_value=ws))
    with mock.patch.dict("sys.modules", {"websockets": mock.Mock(), "websockets.sync": mock.Mock(),
                                         "websockets.sync.client": cliente}), \
            mock.patch.object(voice, "eleven_key", return_value="k"), \
            mock.patch.object(voice, "_mic", return_value=mic):
        return voice._listen_eleven(max_seconds=kw.pop("max_seconds", 5.0),
                                    start_timeout=kw.pop("start_timeout", 0.05),
                                    lang=kw.pop("lang", "pt")), ws, mic


class ElevenListenTest(unittest.TestCase):
    def test_a_socket_that_will_not_open_is_treated_as_no_network(self):
        with self.assertRaises(voice._NoNetwork):
            eleven_listen(connect_error=OSError("recusou a conexão"))

    def test_the_committed_text_closes_the_turn(self):
        texto, ws, mic = eleven_listen(script=[
            {"message_type": "partial_transcript", "text": "olá"},
            {"message_type": "committed_transcript", "text": "olá, Eddy"},
        ])
        self.assertEqual(texto, "olá, Eddy")
        self.assertEqual(mic.killed, 1)

    def test_an_error_from_the_scribe_is_treated_as_no_network(self):
        with self.assertRaises(voice._NoNetwork):
            eleven_listen(script=[{"message_type": "session_error", "error": "token expirado"}])

    def test_nobody_speaks_until_the_start_timeout(self):
        texto, _, mic = eleven_listen(script=[], max_seconds=5.0, start_timeout=0.05)
        self.assertEqual(texto, "")
        self.assertEqual(mic.killed, 1)

    def test_the_run_of_a_turn_stays_on_the_wire(self):
        texto, ws, _ = eleven_listen(script=[{"message_type": "committed_transcript", "text": "oi"}])
        self.assertEqual(texto, "oi")
        audio_msgs = [m for m in ws.sent if m["message_type"] == "input_audio_chunk"]
        self.assertTrue(audio_msgs)
        for m in audio_msgs:
            self.assertEqual(m["sample_rate"], 16000)
            self.assertFalse(m["commit"])

    def test_the_microphone_comes_back_after_every_path(self):
        for script in ([], [{"message_type": "committed_transcript", "text": "oi"}]):
            try:
                eleven_listen(script=list(script), max_seconds=5.0, start_timeout=0.05)
            except voice._NoNetwork:
                pass
            self.assertFalse(voice._mic_lock.locked())


class TtsTest(unittest.TestCase):
    """A voz: ElevenLabs quando há chave, Kokoro quando ela falha."""

    def test_the_elevenlabs_answers_with_mp3(self):
        with mock.patch.object(voice, "eleven_key", return_value="k"), \
                mock.patch.object(voice, "eleven", return_value=b"mp3") as call:
            self.assertEqual(voice.tts("[sighs] olá", "eleven:SERGIO"), (b"mp3", "audio/mpeg"))
        self.assertEqual(call.call_args[0][0], "[sighs] olá")

    def test_a_failing_elevenlabs_falls_back_to_the_local_voice_and_says_why(self):
        with mock.patch.object(voice, "eleven_key", return_value="k"), \
                mock.patch.object(voice, "eleven", side_effect=RuntimeError("ElevenLabs 500")), \
                mock.patch.object(voice, "_kokoro_wav", return_value=b"wav") as kokoro, \
                mock.patch.object(events, "publish") as pub:
            self.assertEqual(voice.tts("olá", "eleven:SERGIO"), (b"wav", "audio/wav"))
        self.assertEqual(kokoro.call_args[0][1], "pm_alex")  # o Sergio voltou atrás
        self.assertEqual(pub.call_args[0][0], "voice.error")

    def test_the_local_voice_never_reads_the_tags_out_loud(self):
        with mock.patch.object(voice, "eleven_key", return_value=None), \
                mock.patch.object(voice, "_kokoro_wav", return_value=b"wav") as kokoro:
            voice.tts("[sighs] [laughs] bom dia", "pf_dora")
        self.assertEqual(kokoro.call_args[0][0], "bom dia")


class VoicesTest(unittest.TestCase):
    def test_sergio_only_shows_up_with_a_key(self):
        with mock.patch.object(voice, "eleven_key", return_value=None):
            self.assertNotIn(voice.ELEVEN_VOICE, voice.voices())
        with mock.patch.object(voice, "eleven_key", return_value="k"):
            self.assertIn(voice.ELEVEN_VOICE, voice.voices())

    def test_the_local_voices_are_always_there(self):
        with mock.patch.object(voice, "eleven_key", return_value=None):
            self.assertIn("pf_dora", voice.voices())


class WarmUpTest(unittest.TestCase):
    def test_a_broken_model_warns_instead_of_taking_the_app_down(self):
        with mock.patch.object(voice.threading, "Thread") as thread, \
                mock.patch.object(voice, "_load_kokoro", side_effect=OSError("kokoro-onnx não instalado")), \
                mock.patch.object(voice, "_load_whisper", side_effect=OSError("faster-whisper não instalado")), \
                mock.patch.object(events, "publish") as pub:
            voice.warm_up()
            thread.call_args.kwargs["target"]()  # a carga corre em segundo plano: aqui, já
        self.assertEqual(pub.call_args[0][0], "voice.error")

    def test_the_app_keeps_working_when_the_models_load(self):
        with mock.patch.object(voice.threading, "Thread") as thread, \
                mock.patch.object(voice, "_load_kokoro") as kokoro, \
                mock.patch.object(voice, "_load_whisper") as whisper, \
                mock.patch.object(voice, "eleven_key", return_value="k"), \
                mock.patch.object(events, "publish") as pub:
            voice.warm_up()
            thread.call_args.kwargs["target"]()
        kokoro.assert_called_once()
        whisper.assert_not_called()  # com chave da ElevenLabs, o whisper nem é preciso
        self.assertEqual(pub.call_args[0][0], "voice.ready")


if __name__ == "__main__":
    unittest.main()