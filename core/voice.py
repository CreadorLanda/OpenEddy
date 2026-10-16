"""Voz do Eddy.

Com a chave da ElevenLabs: fala em streaming com o `eleven_v4_turbo` (entende
marcações como [sighs] e [laughs]) e ouvido em tempo real com o Scribe v2
Realtime (texto parcial enquanto a pessoa fala, fecha ~0,5 s depois que ela
para). Sem chave, ou se a rede cair: Kokoro e faster-whisper, locais.
"""

import base64
import io
import json
import subprocess
import threading
import time
import wave

import numpy as np

import events
from config import (DEFAULT_VOICE, ELEVEN_STT_SILENCE, ELEVEN_VOICE, KOKORO_MODEL, KOKORO_VOICES,
                    WHISPER_MODEL)
from eleven import PCM_RATE, default_voice, eleven, eleven_key, strip_tags, tts_stream  # noqa: F401 (reexportados)


KOKORO = {"pm_alex": "Alex (local)", "pm_santa": "Santa (local)", "pf_dora": "Dora (local, feminina)"}
ELEVEN = {ELEVEN_VOICE: "Sergio (ElevenLabs)"}

def voices() -> dict[str, str]:
    return {**(ELEVEN if eleven_key() else {}), **KOKORO}



_kokoro = None
_whisper = None
_tts_lock = threading.Lock()
_stt_lock = threading.Lock()
_mic_lock = threading.Lock()
_cancel = threading.Event()


def _load_kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro

        _kokoro = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
    return _kokoro


def _load_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _whisper


def warm_up():
    """Carrega os modelos em segundo plano para a primeira fala não demorar."""

    def run():
        try:
            _load_kokoro()
            if not eleven_key():
                _load_whisper()
            events.publish("voice.ready")
        except Exception as e:  # sem voz o resto continua funcionando
            events.publish("voice.error", error=str(e))

    threading.Thread(target=run, daemon=True, name="voice-warmup").start()


def ready() -> bool:
    return _kokoro is not None and (_whisper is not None or bool(eleven_key()))


def tts(text: str, voice: str | None = None) -> tuple[bytes, str]:
    """Sintetiza `text`. Devolve (áudio, tipo): MP3 da ElevenLabs ou WAV do Kokoro.

    Se a ElevenLabs falhar (sem internet, sem créditos), cai no Kokoro para a
    ligação não ficar muda — e avisa a janela.
    """
    if voice and voice.startswith("eleven:") and eleven_key():
        try:
            return eleven(text, voice.split(":", 1)[1]), "audio/mpeg"
        except Exception as e:
            events.publish("voice.error", error=str(e))
            voice = "pm_alex"
    return _kokoro_wav(strip_tags(text), voice), "audio/wav"


def _kokoro_wav(text: str, voice: str | None) -> bytes:
    with _tts_lock:
        samples, sr = _load_kokoro().create(
            text, voice=voice if voice in KOKORO else DEFAULT_VOICE, speed=1.0, lang="pt-br"
        )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def transcribe_pcm(audio: np.ndarray, lang: str = "pt") -> str:
    with _stt_lock:
        segments, _ = _load_whisper().transcribe(audio, language=lang, beam_size=5)
        return " ".join(s.text for s in segments).strip()


def cancel_listen():
    """Desligar a ligação no meio da escuta solta o microfone na hora."""
    _cancel.set()


def listen(max_seconds=15.0, start_timeout=6.0, lang="pt") -> str:
    """Ouve uma fala pelo microfone padrão (PipeWire/Pulse) e devolve o texto."""
    if eleven_key():
        try:
            return _listen_eleven(max_seconds, start_timeout, lang)
        except _NoNetwork as e:
            events.publish("voice.error", error=f"Scribe indisponível, usando o whisper local: {e}")
    return _listen_local(max_seconds, start_timeout=start_timeout, lang=lang)


class _NoNetwork(Exception):
    pass


def _mic(rate=16000, fmt="s16le"):
    return subprocess.Popen(
        ["ffmpeg", "-v", "error", "-f", "pulse", "-i", "default",
         "-ar", str(rate), "-ac", "1", "-f", fmt, "-"],
        stdout=subprocess.PIPE,
    )


def _listen_eleven(max_seconds: float, start_timeout: float, lang: str) -> str:
    """Scribe v2 Realtime: manda o microfone em blocos de 100 ms e espera o
    trecho ser fechado pelo VAD deles. Mostra o texto parcial ao vivo."""
    from websockets.sync.client import connect

    if not _mic_lock.acquire(blocking=False):
        raise RuntimeError("o microfone já está em uso")
    _cancel.clear()
    url = ("wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime"
           f"&language_code={lang}&audio_format=pcm_16000&commit_strategy=vad"
           f"&vad_silence_threshold_secs={ELEVEN_STT_SILENCE}")
    p = None
    try:
        try:
            ws = connect(url, additional_headers={"xi-api-key": eleven_key() or ""}, open_timeout=6)
        except Exception as e:
            raise _NoNetwork(str(e)) from e
        p = _mic()
        state = {"heard": "", "done": False}
        t0 = time.time()

        def send():
            try:
                while not state["done"] and not _cancel.is_set():
                    raw = p.stdout.read(3200)  # 100 ms
                    if not raw:
                        break
                    a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                    rms = float(np.sqrt((a ** 2).mean() + 1e-12))
                    events.publish("voice.level", level=min(1.0, rms * 12))
                    ws.send(json.dumps({"message_type": "input_audio_chunk", "sample_rate": 16000,
                                        "audio_base_64": base64.b64encode(raw).decode(), "commit": False}))
                    if time.time() - t0 > max_seconds:
                        ws.send(json.dumps({"message_type": "input_audio_chunk", "sample_rate": 16000,
                                            "audio_base_64": "", "commit": True}))
                        break
            except Exception:
                pass  # o socket fechou: o laço de leitura trata

        threading.Thread(target=send, daemon=True, name="scribe-send").start()
        try:
            with ws:
                while not _cancel.is_set():
                    if not state["heard"] and time.time() - t0 > start_timeout:
                        return ""  # ninguém falou
                    if time.time() - t0 > max_seconds + 4:
                        return state["heard"]
                    try:
                        m = json.loads(ws.recv(timeout=0.25))
                    except TimeoutError:
                        continue
                    kind = m.get("message_type") or ""
                    if kind == "partial_transcript":
                        if m.get("text"):
                            state["heard"] = m["text"]
                            events.publish("voice.partial", text=m["text"])
                    elif kind == "committed_transcript":
                        text = (m.get("text") or "").strip()
                        if text:
                            return text
                    elif kind.endswith("error"):
                        raise _NoNetwork(m.get("error") or kind)
                return ""
        finally:
            state["done"] = True
    finally:
        if p:
            p.kill()
            p.wait()
        _mic_lock.release()


def _listen_local(max_seconds=12.0, silence=1.1, start_timeout=5.0, lang="pt") -> str:
    """Whisper local: grava até a pessoa parar de falar e transcreve.

    VAD por energia: começa a contar o silêncio só depois que houve fala, e
    desiste se ninguém falar em `start_timeout` segundos. Publica o nível do
    microfone (`voice.level`) para a cara do Eddy reagir.
    """
    if not _mic_lock.acquire(blocking=False):
        raise RuntimeError("o microfone já está em uso")
    _cancel.clear()
    try:
        sr = 16000
        block = sr // 20  # 50 ms
        p = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-f", "pulse", "-i", "default",
             "-ar", str(sr), "-ac", "1", "-f", "f32le", "-"],
            stdout=subprocess.PIPE,
        )
        chunks: list[np.ndarray] = []
        noise = None
        spoke = False
        quiet = 0.0
        t0 = time.time()
        try:
            while time.time() - t0 < max_seconds:
                if _cancel.is_set():
                    return ""
                raw = p.stdout.read(block * 4)
                if not raw:
                    break
                a = np.frombuffer(raw, dtype=np.float32)
                chunks.append(a)
                rms = float(np.sqrt((a ** 2).mean() + 1e-12))
                # piso de ruído adaptativo nos primeiros 300 ms
                if noise is None or (not spoke and len(chunks) <= 6):
                    noise = rms if noise is None else 0.7 * noise + 0.3 * rms
                thr = max(0.012, noise * 3.0)
                events.publish("voice.level", level=min(1.0, rms / max(thr * 4, 1e-6)))
                if rms > thr:
                    spoke, quiet = True, 0.0
                elif spoke:
                    quiet += 0.05
                    if quiet >= silence:
                        break
                elif time.time() - t0 > start_timeout:
                    break
        finally:
            p.kill()
            p.wait()
        if not spoke or not chunks:
            return ""
        return transcribe_pcm(np.concatenate(chunks), lang)
    finally:
        _mic_lock.release()
