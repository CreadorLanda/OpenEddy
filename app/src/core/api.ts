// Ponte com o núcleo Python do Eddy: descobre URL + token pelo Tauri e fala HTTP/SSE.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EddyEvent, Profile } from "./types";

export const IS_TAURI = isTauri();

interface BackendInfo {
  url: string;
  token: string;
}

let info: BackendInfo | null = null;
let infoPromise: Promise<BackendInfo> | null = null;

/**
 * No app, o Rust conhece a porta e o token. No navegador (`npm run dev` sem
 * Tauri) use `?api=http://127.0.0.1:8765&token=...` com o núcleo rodando à parte.
 */
function backendInfo(): Promise<BackendInfo> {
  if (info) return Promise.resolve(info);
  if (infoPromise) return infoPromise;
  infoPromise = (async () => {
    if (!IS_TAURI) {
      const q = new URLSearchParams(location.search);
      return (info = {
        url: q.get("api") ?? "http://127.0.0.1:8765",
        token: q.get("token") ?? localStorage.getItem("eddy-token") ?? "",
      });
    }
    const ready = await invoke<BackendInfo | null>("backend");
    if (ready) return (info = ready);
    return new Promise<BackendInfo>((resolve) => {
      void listen<BackendInfo>("backend-ready", (e) => resolve((info = e.payload)));
    });
  })();
  return infoPromise;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const b = await backendInfo();
  const res = await fetch(b.url + path, {
    method,
    headers: { "X-Eddy-Token": b.token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* corpo vazio */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Lê um POST que responde em SSE (o turno do Eddy). */
async function stream(path: string, body: unknown, onEvent: (ev: Record<string, unknown>) => void) {
  const b = await backendInfo();
  const res = await fetch(b.url + path, {
    method: "POST",
    headers: { "X-Eddy-Token": b.token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(res.statusText);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
}

export const Api = {
  health: () => call<{ ollama: boolean; models: string[]; model: string; model_ready: boolean; voice: boolean }>("GET", "/api/health"),
  meta: () => call<{ voices: Record<string, string>; eddy: { voice: string } }>("GET", "/api/meta"),
  config: (c: { voice?: string }) => call("POST", "/api/eddy/config", c),
  profile: (p: Profile, owner?: string) => call("POST", "/api/eddy/profile", owner ? { ...p, owner } : p),
  callStart: () => call<{ text: string; voice: string }>("POST", "/api/eddy/call/start"),
  scene: (kind: string) => call<{ text: string }>("POST", "/api/eddy/scene", { kind }),
  scenes: () => call<SceneBundle>("GET", "/api/eddy/scenes"),
  callSilence: (final = false) => call<{ text: string }>("POST", "/api/eddy/call/silence", { final }),
  listenCancel: () => call("POST", "/api/eddy/listen/cancel"),
  listen: (maxSeconds = 15) => call<{ text: string }>("POST", "/api/eddy/listen", { max_seconds: maxSeconds }),
  turn: (text: string, onEvent: (ev: Record<string, unknown>) => void) => stream("/api/eddy/turn", { text }, onEvent),
  news: () => call<{ items: NewsItem[] }>("GET", "/api/news"),
  /** Fala em streaming: devolve a resposta crua (PCM da ElevenLabs ou WAV do Kokoro). */
  async ttsStream(text: string, voice?: string, signal?: AbortSignal): Promise<Response> {
    const b = await backendInfo();
    return fetch(b.url + "/api/tts/stream", {
      method: "POST",
      headers: { "X-Eddy-Token": b.token, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal,
    });
  },
  async tts(text: string, voice?: string): Promise<ArrayBuffer> {
    const b = await backendInfo();
    const res = await fetch(b.url + "/api/tts", {
      method: "POST",
      headers: { "X-Eddy-Token": b.token, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
    return res.arrayBuffer();
  },

  // ── memória entre chamadas (issue #1) ──────────────────────────────────────
  memory: () => call<MemoryStatus>("GET", "/api/eddy/memory"),
  memoryToggle: (enabled: boolean) => call<{ enabled: boolean }>("POST", "/api/eddy/memory", { enabled }),
  memoryAdd: (text: string) => call<{ id: number; text: string }>("POST", "/api/eddy/memory/add", { text }),
  memoryDelete: (id: number) => call<{ deleted: boolean }>("DELETE", `/api/eddy/memory/${id}`),
  memoryClear: () => call<{ removed: number }>("POST", "/api/eddy/memory/clear"),
};

/** Cenas do Eddy (core/scenes.py): notas de direção para o modelo e falas de reserva. */
export interface SceneBundle {
  directions: Record<string, string>;
  fallback: Record<string, string[] | string>;
}

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  summary: string;
  image: string | null;
}

/** Um facto guardado. O âmbito é decidido pelo núcleo: estas rotas não levam dono. */
export interface MemoryEntry {
  id: number;
  text: string;
  created: number;
}

export interface MemoryStatus {
  enabled: boolean;
  entries: MemoryEntry[];
}

/** Assina o barramento de eventos do núcleo, reconectando sozinho. */
export async function subscribe(handler: (ev: EddyEvent) => void, onStatus?: (up: boolean) => void) {
  const b = await backendInfo();
  let es: EventSource | null = null;
  const connect = () => {
    es = new EventSource(`${b.url}/api/events?token=${encodeURIComponent(b.token)}`);
    es.onopen = () => onStatus?.(true);
    es.onmessage = (m) => {
      try {
        handler(JSON.parse(m.data) as EddyEvent);
      } catch {
        /* evento malformado não derruba a janela */
      }
    };
    es.onerror = () => {
      onStatus?.(false);
      es?.close();
      window.setTimeout(connect, 2000);
    };
  };
  connect();
}

export const Native = {
  openUrl: (url: string) => (IS_TAURI ? invoke("open_url", { url }) : (window.open(url, "_blank"), Promise.resolve())),
};
