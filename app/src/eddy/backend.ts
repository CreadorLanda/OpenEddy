// Duas formas de rodar o mesmo Eddy, com a mesma interface para a tela:
//
//   desktop (Tauri) → núcleo Python local: Ollama/Gemma, microfone pelo ffmpeg,
//                     ElevenLabs com a chave do cofre do sistema.
//   web             → Puter AI no navegador (cada pessoa usa a própria conta),
//                     microfone do navegador direto no Scribe, voz pelo servidor
//                     (core/webapp.py) com limite diário.

import { Api, IS_TAURI } from "../core/api";
import type { Profile } from "../core/types";
import type { NewsItem, SceneBundle } from "../core/api";
import { WebMic } from "./mic";

export const WEB = !IS_TAURI && !new URLSearchParams(location.search).has("api");

export const LINKS = {
  github: "https://github.com/CreadorLanda/OpenEddy",
  kofi: "https://ko-fi.com/alexandrelanda",
};

export type SceneKind =
  | "bye" | "bye_callback" | "insult" | "insult_callback" | "rival" | "rival_return"
  | "praise" | "surprise_call" | "surprise_declined" | "hold" | "hold_back";

export interface TurnResult {
  text: string;
  event?: SceneKind;
  news?: NewsItem[];
  settings?: { voice: string };
}

export interface HearOptions {
  lang: string;
  onPartial?: (text: string) => void;
  onLevel?: (level: number) => void;
}

export interface Backend {
  web: boolean;
  /** Vozes para o formulário e a voz padrão; `note` = aviso para a tela inicial. */
  init(): Promise<{ voices: Record<string, string>; voice: string; note: string }>;
  setProfile(p: Profile, voice?: string): Promise<void>;
  callStart(p: Profile): Promise<{ greeting: string; voice: string }>;
  tts(text: string, voice: string, lang: string): Promise<Response>;
  openMic(): Promise<void>;
  closeMic(): void;
  hear(o: HearOptions): Promise<string>;
  cancelHear(): void;
  silence(p: Profile, final: boolean): Promise<string>;
  turn(text: string, p: Profile, onToken: (t: string) => void): Promise<TurnResult>;
  /** Notas e falas de reserva das cenas, no idioma da pessoa. */
  scenes(p: Profile): Promise<SceneBundle>;
  /** Fala de uma cena sem fala da pessoa (ligar de volta, voltar do gelo…). */
  sceneLine(kind: SceneKind, p: Profile): Promise<string>;
}

export function sceneFallback(b: SceneBundle | null, kind: SceneKind): string {
  const pool = b?.fallback[kind];
  if (Array.isArray(pool) && pool.length) return pool[Math.floor(Math.random() * pool.length)];
  return typeof pool === "string" ? pool : "";
}

// ── desktop ───────────────────────────────────────────────────────────────────

const desktop: Backend = {
  web: false,
  async init() {
    const [meta, health] = await Promise.all([Api.meta(), Api.health()]);
    let note = "";
    if (!health.ollama) note = "O Ollama não está rodando — o núcleo está tentando subir o bin/ollama.";
    else if (!health.model_ready) note = `Modelo ${health.model} não instalado: ./bin/ollama pull ${health.model}`;
    return { voices: meta.voices, voice: meta.eddy.voice, note };
  },
  async setProfile(p, voice) {
    await Promise.all([Api.profile(p), voice ? Api.config({ voice }) : Promise.resolve()]);
  },
  async callStart() {
    const r = await Api.callStart();
    return { greeting: r.text, voice: r.voice };
  },
  tts: (text, voice) => Api.ttsStream(text, voice),
  async openMic() {},
  closeMic() {},
  async hear() {
    return (await Api.listen(15)).text;
  },
  cancelHear() {
    void Api.listenCancel();
  },
  async silence(_p, final) {
    return (await Api.callSilence(final)).text;
  },
  scenes: () => Api.scenes(),
  async sceneLine(kind) {
    return (await Api.scene(kind)).text;
  },
  async turn(text, _p, onToken) {
    let out: TurnResult = { text: "" };
    await Api.turn(text, (ev) => {
      if (ev.type === "token") onToken(String(ev.token));
      else if (ev.type === "done") out = ev as unknown as TurnResult;
      else if (ev.type === "error") throw new Error(String(ev.error));
    });
    return out;
  },
};

// ── web ───────────────────────────────────────────────────────────────────────

interface PuterAi {
  authToken?: string;
  ai: {
    chat(messages: { role: string; content: string }[], options: { model?: string; stream: true }): Promise<AsyncIterable<{ type?: string; text?: string; message?: string }>>;
  };
}

const puter = () => (window as unknown as { puter: PuterAi }).puter;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${puter()?.authToken ?? ""}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
  return res.json() as Promise<T>;
}

const mic = new WebMic();
let model = "";
let system = "";
let history: { role: string; content: string }[] = [];
let seenSilence: string[] = []; // falas de silêncio já usadas nesta ligação
let sceneData: SceneBundle | null = null;

async function chat(messages: { role: string; content: string }[], onToken: (t: string) => void, withModel: boolean) {
  const stream = await puter().ai.chat(messages, withModel && model ? { model, stream: true } : { stream: true });
  let full = "";
  for await (const part of stream) {
    if (part.type === "error") throw new Error(part.message ?? "erro no Puter AI");
    if (part.text) {
      full += part.text;
      onToken(part.text);
    }
  }
  return full;
}

const web: Backend = {
  web: true,
  async init() {
    const res = await fetch("/api/web/config");
    const cfg = (await res.json()) as { model: string; voice: string; voice_ready: boolean };
    model = cfg.model;
    return {
      voices: { [cfg.voice]: "Sergio (ElevenLabs)" },
      voice: cfg.voice,
      note: cfg.voice_ready ? "" : "A voz do Eddy está desligada neste servidor.",
    };
  },
  async setProfile() {},
  async callStart(p) {
    const r = await post<{ system: string; greeting: string; scenes: SceneBundle }>("/api/web/start", { profile: p });
    system = r.system;
    sceneData = r.scenes;
    history = [{ role: "assistant", content: r.greeting }];
    seenSilence = [];
    return { greeting: r.greeting, voice: "" };
  },
  tts: (text, _voice, lang) =>
    fetch("/api/web/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${puter()?.authToken ?? ""}` },
      body: JSON.stringify({ text, lang }),
    }),
  openMic: () => mic.open(),
  closeMic: () => mic.close(),
  async hear(o) {
    const { token } = await post<{ token: string }>("/api/web/stt-token", {});
    return mic.hear({ lang: o.lang, token, onPartial: o.onPartial, onLevel: o.onLevel });
  },
  cancelHear: () => mic.stopListening(),
  async silence(p, final) {
    const { text } = await post<{ text: string }>("/api/web/silence", { profile: p, final, seen: seenSilence });
    seenSilence.push(text);
    return text;
  },
  async turn(text, p, onToken) {
    const routed = await post<{ text: string | null; news?: NewsItem[]; event?: SceneKind }>("/api/web/route", { text, profile: p });
    let answer: string;
    if (routed.text) {
      answer = routed.text;
      onToken(answer);
    } else {
      const direction = routed.event ? sceneData?.directions[routed.event] ?? "" : "";
      const messages = [{ role: "system", content: system }, ...history.slice(-12), { role: "user", content: text + direction }];
      let got = false;
      try {
        answer = await chat(messages, (t) => ((got = true), onToken(t)), true);
      } catch (e) {
        if (got) throw e;
        try {
          answer = await chat(messages, onToken, false); // modelo indisponível: o padrão do Puter
        } catch (e2) {
          if (!routed.event) throw e2;
          answer = sceneFallback(sceneData, routed.event);
          onToken(answer);
        }
      }
    }
    history.push({ role: "user", content: text }, { role: "assistant", content: answer });
    history = history.slice(-24);
    return { text: answer, news: routed.news, event: routed.event };
  },
  async scenes() {
    return sceneData ?? { directions: {}, fallback: {} };
  },
  async sceneLine(kind) {
    if (kind === "hold" || kind === "hold_back" || !sceneData?.directions[kind]) return sceneFallback(sceneData, kind);
    const messages = [{ role: "system", content: system }, ...history.slice(-12), { role: "user", content: sceneData.directions[kind].trim() }];
    let line = "";
    try {
      line = (await chat(messages, () => {}, true)).trim();
    } catch {
      try {
        line = (await chat(messages, () => {}, false)).trim();
      } catch {
        /* reserva abaixo */
      }
    }
    line ||= sceneFallback(sceneData, kind);
    history.push({ role: "assistant", content: line });
    return line;
  },
};

export const B: Backend = WEB ? web : desktop;
