"""A voz que vem da ElevenLabs: marcações, streaming, token e como ela falha.

Nenhuma chamada sai daqui: `urllib.request.urlopen` é dublê, a chave é dublê.
"""

import io
import json
import unittest
import urllib.error
from unittest import mock

import eleven
import events


class FakeResponse(io.BytesIO):
    """O que o urlopen devolve: um arquivo com `read1`, como o streaming."""

    def __init__(self, data=b"", chunk=None):
        super().__init__(data)
        self.chunk = chunk

    def read1(self, size=-1):
        return super().read1(self.chunk if self.chunk else size)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def http_error(code, body=b"detalhe da ElevenLabs"):
    return urllib.error.HTTPError("https://api.elevenlabs.io", code, "Bad", {}, io.BytesIO(body))


class StripTagsTest(unittest.TestCase):
    """As marcações são para o ator de voz; a legenda e o Kokoro não as querem."""

    def test_takes_the_tags_out(self):
        self.assertEqual(eleven.strip_tags("[sighs] Tá bom. [laughs]"), "Tá bom.")

    def test_keeps_brackets_that_are_not_a_tag(self):
        # a marcação é o que está entre colchetes, mesmo com espaços dentro
        self.assertEqual(eleven.strip_tags("a [ b ] c"), "a c")

    def test_only_takes_tags_up_to_thirty_characters(self):
        longa = "x" * 31
        self.assertEqual(eleven.strip_tags(f"[{longa}]oi"), f"[{longa}]oi")

    def test_collapses_the_gap_the_tags_left_behind(self):
        self.assertEqual(eleven.strip_tags("Tá  bom [sighs] demais"), "Tá bom demais")


class KeyTest(unittest.TestCase):
    def test_looks_once_and_stays_with_the_answer(self):
        with mock.patch.object(eleven, "_eleven_checked", False), \
                mock.patch.dict("os.environ", {"ELEVENLABS_API_KEY": "chave-de-teste"}), \
                mock.patch.object(eleven.subprocess, "run", side_effect=AssertionError("não deve ir ao cofre")) as cofre:
            self.assertEqual(eleven.eleven_key(), "chave-de-teste")
            with mock.patch.dict("os.environ", {"ELEVENLABS_API_KEY": ""}):
                self.assertEqual(eleven.eleven_key(), "chave-de-teste")
        cofre.assert_not_called()

    def test_without_key_stays_none_instead_of_raising(self):
        with mock.patch.object(eleven, "_eleven_checked", False), \
                mock.patch.object(eleven, "_eleven_key", None), \
                mock.patch.dict("os.environ", {"ELEVENLABS_API_KEY": ""}, clear=False), \
                mock.patch.object(eleven.subprocess, "run", side_effect=OSError("sem secret-tool")):
            self.assertIsNone(eleven.eleven_key())

    def test_a_keyring_that_never_answers_is_not_a_crash(self):
        with mock.patch.object(eleven, "_eleven_checked", False), \
                mock.patch.object(eleven, "_eleven_key", None), \
                mock.patch.dict("os.environ", {"ELEVENLABS_API_KEY": ""}, clear=False), \
                mock.patch.object(eleven.subprocess, "run", side_effect=eleven.subprocess.TimeoutExpired("secret-tool", 10)):
            self.assertIsNone(eleven.eleven_key())


class TtsStreamTest(unittest.TestCase):
    def test_without_key_does_not_even_try(self):
        with mock.patch.object(eleven, "eleven_key", return_value=None), \
                mock.patch.object(eleven.urllib.request, "urlopen", side_effect=AssertionError("não deve chamar")):
            self.assertIsNone(eleven.tts_stream("olá", "eleven:SERGIO", "pt"))

    def test_a_local_voice_does_not_go_to_the_elevenlabs(self):
        with mock.patch.object(eleven, "eleven_key", return_value="k"), \
                mock.patch.object(eleven.urllib.request, "urlopen", side_effect=AssertionError("não deve chamar")):
            self.assertIsNone(eleven.tts_stream("olá", "pf_dora", "pt"))

    def test_yields_the_audio_as_it_arrives(self):
        data = b"\x01\x02\x03\x04\x05\x06"
        with mock.patch.object(eleven, "eleven_key", return_value="k"), \
                mock.patch.object(eleven.urllib.request, "urlopen",
                                  return_value=FakeResponse(data, chunk=2)) as call:
            out = eleven.tts_stream("[sighs] olá", "eleven:SERGIO", "en")
            self.assertEqual(list(out), [b"\x01\x02", b"\x03\x04", b"\x05\x06"])
        req = call.call_args[0][0]
        self.assertIn("/v1/text-to-speech/SERGIO/stream", req.full_url)
        self.assertIn("output_format=pcm_24000", req.full_url)
        body = json.loads(req.data)
        self.assertEqual(body, {"text": "[sighs] olá", "model_id": eleven.ELEVEN_MODEL, "language_code": "en"})
        self.assertEqual(req.headers["Xi-api-key"], "k")

    def test_a_failure_before_the_first_byte_becomes_none_and_a_warning(self):
        with mock.patch.object(eleven, "eleven_key", return_value="k"), \
                mock.patch.object(eleven.urllib.request, "urlopen", side_effect=http_error(401)), \
                mock.patch.object(events, "publish") as pub:
            self.assertIsNone(eleven.tts_stream("olá", "eleven:SERGIO", "pt"))
        kind, kwargs = pub.call_args[0][0], pub.call_args[1]
        self.assertEqual(kind, "voice.error")
        self.assertIn("detalhe da ElevenLabs", kwargs["error"])

    def test_a_network_failure_before_the_first_byte_becomes_none(self):
        with mock.patch.object(eleven, "eleven_key", return_value="k"), \
                mock.patch.object(eleven.urllib.request, "urlopen", side_effect=TimeoutError("sem rede")), \
                mock.patch.object(events, "publish") as pub:
            self.assertIsNone(eleven.tts_stream("olá", "eleven:SERGIO", "pt"))
        self.assertEqual(pub.call_args[0][0], "voice.error")


class SingleUseTokenTest(unittest.TestCase):
    def test_reads_the_token(self):
        with mock.patch.object(eleven, "eleven_key", return_value="k"), \
                mock.patch.object(eleven.urllib.request, "urlopen",
                                  return_value=FakeResponse(json.dumps({"token": "uso-unico"}).encode())) as call:
            self.assertEqual(eleven.single_use_token(), "uso-unico")
        self.assertEqual(call.call_args[0][0].full_url, f"{eleven.API}/v1/single-use-token/realtime_scribe")

    def test_a_refusal_reaches_the_caller(self):
        with mock.patch.object(eleven, "eleven_key", return_value="k"), \
                mock.patch.object(eleven.urllib.request, "urlopen", side_effect=http_error(429)):
            with self.assertRaises(urllib.error.HTTPError) as err:
                eleven.single_use_token()
        self.assertEqual(err.exception.code, 429)


class DefaultVoiceTest(unittest.TestCase):
    def test_sergio_with_a_key(self):
        with mock.patch.object(eleven, "eleven_key", return_value="k"):
            self.assertEqual(eleven.default_voice(), eleven.ELEVEN_VOICE)

    def test_the_local_voice_without_a_key(self):
        with mock.patch.object(eleven, "eleven_key", return_value=None):
            self.assertEqual(eleven.default_voice(), eleven.DEFAULT_VOICE)


if __name__ == "__main__":
    unittest.main()