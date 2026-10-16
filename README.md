# Open Eddy

[![Ko-fi](https://img.shields.io/badge/Ko--fi-apoie%20o%20projeto-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/alexandrelanda)
[![GitHub](https://img.shields.io/badge/GitHub-CreadorLanda%2FOpenEddy-181717?logo=github)](https://github.com/CreadorLanda/OpenEddy)

**Web:** openeddy.alexandrelanda.com (em preparação) · **Linux:** app desktop (abaixo) · **Apoie:** [ko-fi.com/alexandrelanda](https://ko-fi.com/alexandrelanda)

> Projeto de fã, sem ligação com a Disney. O Eddy pertence aos seus donos.

Ligue para o **Eddy** de Lab Rats: egocêntrico, sarcástico, dramático — e, no fim, útil.
Holograma desenhado em código, conversa de voz mãos-livres, tudo rodando no seu PC.

1. **Entrar com Puter** — a conta [Puter](https://puter.com) guarda seu perfil (`puter.kv`).
2. **Perfil** — nome, idade, sexo e idioma (português é o padrão; inglês e espanhol também). É assim que o Eddy decide se te chama de “garoto”, “garota”, “tiozão”, “vovó”… (nunca “senhor”).
3. **Ligar** — toca, o Eddy atende, e a conversa segue sozinha: ele ouve, pensa, fala, ouve de novo. Mudo, teclado e desligar como num telefone. Espaço/Esc ou clique no rosto interrompem a fala.

| Parte | Ferramenta | Modelo |
|---|---|---|
| Cérebro | Ollama (`bin/ollama`) | Gemma 4 E2B quantizado — `gemma4:e2b-it-qat` (4,3 GB) |
| Ouvido | **ElevenLabs Scribe v2 Realtime** (WebSocket; fecha a fala ~0,5 s depois que você para, com texto parcial ao vivo) | reserva: faster-whisper `small`, local |
| Voz | **ElevenLabs `eleven_v4_turbo`**, em streaming (PCM, ~0,8 s até o primeiro som) | **Sergio — Friendly and Encouraging** (pt-BR) |
| Voz reserva | Kokoro-82M ONNX, local | `pm_alex`, `pm_santa`, `pf_dora` — usada se a ElevenLabs falhar |
| Conta | Puter.js (`https://js.puter.com/v2/`) | — |

**Interpretação:** o Eddy escreve marcações de áudio em inglês — `[sighs]`, `[laughs]`, `[scoffs]`, `[sarcastic]`, `[gasps]`… — que o v4 Turbo interpreta (suspiro, risada) e que também mudam a cara do holograma — 14 expressões (feliz, risada, superior, tédio, irritado, surpreso, bravo, triste, chorando, piscadinha, desconfiado, orgulhoso, maquiavélico, enojado), a partir da galeria da série. A expressão fica entre as falas: ouvir (anéis) e pensar (órbita) não trocam o rosto.

Atalhos que respondem na hora, sem o modelo (só em português): *notícias*, *clima (em <cidade>)*, *que horas são*, *voz feminina* / *voz masculina*.

## Como roda

```
app/  (Tauri 2: Rust + TypeScript)             core/  (Python)
  login Puter · perfil · ligação ─ HTTP/SSE ─▶  server.py     127.0.0.1:<porta livre>, token por sessão
  src-tauri: sobe/derruba o núcleo,             assistant.py  personalidade, apelidos, “alô”, atalhos
  popup do puter.com, links → navegador         voice.py      Kokoro · whisper + VAD (cancelável)
                                                llm.py        Ollama; carrega o modelo enquanto toca
```

O login do Puter abre um popup do `puter.com`; o app só permite popups desse domínio (qualquer outro link abre no navegador).

## Usar

Pré-requisitos: `.venv/`, `bin/ollama`, `kokoro/` (já nesta pasta), Rust, Node 20+, `libwebkit2gtk-4.1-dev`, `ffmpeg`, PipeWire/Pulse e internet para o login.

```bash
./bin/ollama pull gemma4:e2b-it-qat   # só na primeira vez
cd app
npm install
npm run tauri dev
```

| Variável | Padrão | Para quê |
|---|---|---|
| `EDDY_MODEL` | `gemma4:e2b-it-qat` | modelo do Ollama |
| `EDDY_WHISPER` | `small` | modelo do faster-whisper |
| `EDDY_HOME` | pasta do checkout | onde ficam `core/`, `.venv/`, `bin/`, `kokoro/` |
| `EDDY_ELEVEN_MODEL` | `eleven_v4_turbo` | outro modelo de voz; o `eleven_flash_v2_5` é mais barato mas lê as marcações em voz alta |
| `EDDY_STT_SILENCE` | `0.7` | segundos de silêncio para o Scribe fechar a sua fala |

### Chave da ElevenLabs

Fica no cofre do sistema (Secret Service / KWallet), nunca no disco nem no git:

```bash
secret-tool store --label="Open Eddy — ElevenLabs" service open-eddy account elevenlabs
# cola a chave e Enter; para trocar, rode de novo. ELEVENLABS_API_KEY no ambiente também vale.
```

Sem chave, o Eddy usa só a voz local (Kokoro).

O Gemma 4 E2B QAT ocupa ~3,9 GB de RAM e gera ~6–7 tokens/s num i5-10210U; a primeira resposta da ligação demora mais porque o modelo carrega enquanto o telefone toca.

## Outros

- `src/` — scripts antigos (CLI `friday.py`, PyQt `eddy_gui.py` / `eddy_holo.py`).
- `arquivo/bots-e-mochis/` — os mini bots, a ilha e a janela Bots de antes. Fora do app.
- O Eddy é personagem da Disney (Lab Rats): uso pessoal. Para distribuir, crie um personagem próprio.
