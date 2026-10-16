"""ElevenLabs sem dependências pesadas (só stdlib): chave, fala em streaming,
fala inteira e o token de uso único do Scribe. Usado pelo app no PC e pelo
servidor web (que não tem numpy, Kokoro nem Whisper).
"""

import json
import os
import re
import subprocess
import urllib.error
import urllib.request

import events
from config import DEFAULT_VOICE, ELEVEN_MODEL, ELEVEN_VOICE

PCM_RATE = 24000  # saída da ElevenLabs em streaming: PCM 16-bit mono
TAG = re.compile(r"\[[^\]]{1,30}\]")
API = "https://api.elevenlabs.io"

_eleven_key: str | None = None
_eleven_checked = False


def eleven_key() -> str | None:
    """A chave da ElevenLabs, do ambiente ou do cofre do sistema (uma vez só)."""
    global _eleven_key, _eleven_checked
    if not _eleven_checked:
        _eleven_checked = True
        _eleven_key = os.environ.get("ELEVENLABS_API_KEY")
        if not _eleven_key:
            try:
                r = subprocess.run(["secret-tool", "lookup", "service", "open-eddy", "account", "elevenlabs"],
                                   capture_output=True, text=True, timeout=10)
                _eleven_key = r.stdout.strip() or None
            except (OSError, subprocess.TimeoutExpired):
                _eleven_key = None
    return _eleven_key


def strip_tags(text: str) -> str:
    """Tira [sighs], [laughs]… — para a legenda e para o Kokoro, que leria em voz alta."""
    return re.sub(r"\s{2,}", " ", TAG.sub("", text)).strip()


def tts_stream(text: str, voice: str | None, lang: str = "pt"):
    """Abre o streaming da ElevenLabs. Devolve um iterador de blocos PCM, ou None
    se essa voz não é da ElevenLabs (ou ela falhou antes do primeiro byte)."""
    if not (voice and voice.startswith("eleven:") and eleven_key()):
        return None
    req = urllib.request.Request(
        f"{API}/v1/text-to-speech/{voice.split(':', 1)[1]}/stream"
        f"?output_format=pcm_{PCM_RATE}",
        data=json.dumps({"text": text, "model_id": ELEVEN_MODEL, "language_code": lang}).encode(),
        headers={"xi-api-key": eleven_key() or "", "Content-Type": "application/json"},
    )
    try:
        r = urllib.request.urlopen(req, timeout=30)
    except Exception as e:
        detail = e.read().decode(errors="replace")[:200] if isinstance(e, urllib.error.HTTPError) else str(e)
        events.publish("voice.error", error=f"ElevenLabs: {detail}")
        return None

    def chunks():
        with r:
            while True:
                b = r.read1(4800)
                if not b:
                    break
                yield b

    return chunks()


def eleven(text: str, voice_id: str) -> bytes:
    req = urllib.request.Request(
        f"{API}/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": ELEVEN_MODEL, "language_code": "pt"}).encode(),
        headers={"xi-api-key": eleven_key() or "", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:200]
        raise RuntimeError(f"ElevenLabs {e.code}: {detail}") from e


def single_use_token() -> str:
    """Token de 15 min para o navegador falar direto com o Scribe Realtime
    (a chave nunca vai para o cliente)."""
    req = urllib.request.Request(f"{API}/v1/single-use-token/realtime_scribe", data=b"",
                                 headers={"xi-api-key": eleven_key() or ""}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["token"]


def default_voice() -> str:
    """Sergio (ElevenLabs) quando há chave; senão a voz local do Kokoro."""
    return ELEVEN_VOICE if eleven_key() else DEFAULT_VOICE
