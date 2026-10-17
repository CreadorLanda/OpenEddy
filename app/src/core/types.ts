// Eventos que o núcleo Python publica por SSE (open-eddy/core/events.py).

export type EddyEvent =
  | { type: "hello" }
  | { type: "voice.ready" }
  | { type: "voice.error"; error: string }
  | { type: "voice.level"; level: number }
  | { type: "voice.partial"; text: string }
  | { type: "voice.listening"; on: boolean };

/** Quem está ligando — guardado na conta Puter (puter.kv). */
export interface Profile {
  nome: string;
  idade: number;
  sexo: "masculino" | "feminino" | "outro";
  /** Língua em que o Eddy fala e ouve. Português é o padrão. */
  idioma?: "pt" | "en" | "es";
  /** Visual do Eddy: holograma azul (padrão) ou o clássico, traço preto no branco. */
  tema?: "holo" | "classic";
}
