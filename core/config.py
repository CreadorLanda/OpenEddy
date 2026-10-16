"""Caminhos e constantes compartilhados pelo núcleo do Open Eddy."""

import os

# open-eddy/ (onde ficam bin/, lib/, kokoro/, voices/, .venv/)
HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_BIN = os.path.join(HOME, "bin", "ollama")
# Gemma 4 E2B quantizado (QAT, 4,3 GB): cabe com folga num notebook de 16 GB
# sem ir para o swap. Troque com EDDY_MODEL.
MODEL = os.environ.get("EDDY_MODEL", "gemma4:e2b-it-qat")

KOKORO_MODEL = os.path.join(HOME, "kokoro", "kokoro-v1.0.onnx")
KOKORO_VOICES = os.path.join(HOME, "kokoro", "voices-v1.0.bin")
DEFAULT_VOICE = "pf_dora"
WHISPER_MODEL = os.environ.get("EDDY_WHISPER", "small")

# ElevenLabs: a chave fica no cofre do sistema (Secret Service/KWallet), nunca
# no disco nem no git:  secret-tool store --label="Open Eddy — ElevenLabs" \
#                         service open-eddy account elevenlabs
# (ou ELEVENLABS_API_KEY no ambiente).
ELEVEN_VOICE = "eleven:RGbeQtiShYRDVCrd9b9w"  # Sergio - Friendly and Encouraging (pt-BR)
# v4 Turbo: tempo real e interpreta marcações de áudio ([sighs], [laughs]…).
# O flash_v2_5 é mais barato, mas LÊ as marcações em voz alta.
ELEVEN_MODEL = os.environ.get("EDDY_ELEVEN_MODEL", "eleven_v4_turbo")
# Silêncio (s) que o VAD do Scribe espera antes de fechar a fala.
ELEVEN_STT_SILENCE = float(os.environ.get("EDDY_STT_SILENCE", "0.7"))

# Estado do usuário (bots, conversas, memória, arquivos) — nunca dentro do repo.
DATA = os.path.join(
    os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "open-eddy"
)
CONVERSATIONS = os.path.join(DATA, "conversations")
WORKSPACE = os.path.join(DATA, "workspace")

for _d in (DATA, CONVERSATIONS, WORKSPACE):
    os.makedirs(_d, exist_ok=True)
