// A fala do Eddy: a fila que corta a resposta nas marcações, pede a voz de cada
// pedaço e deixa de falar quando a pessoa interrompe.
//
// Não há DOM aqui dentro de propósito: a fila é testável sozinha, com as portas
// (voz, áudio, legenda) injetadas por quem chama — o app passa o Web Audio, os
// testes passam dublês. É a parte que decide o que é fala, o que é resposta velha
// e quando o Eddy cala a boca.

import { expressionForTag, type Expression } from "./eddy";

/** Texto para a legenda: sem [sighs], markdown nem links. */
export function caption(text: string): string {
  return voiceText(text).replace(/\[[^\]]{1,30}\]/g, "").replace(/\s+/g, " ").trim();
}

/** Texto para a voz: mantém as marcações [sighs]/[laughs], que a ElevenLabs interpreta. */
export function voiceText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\*[^*]+\*/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A cara de um pedaço da fala: a marcação dele manda; sem marcação, o próprio
 * texto dá a reação (risada, pergunta, exclamação). Sem pista, mantém a atual.
 */
export function exprOf(text: string): Expression | null {
  for (const m of text.matchAll(/\[([^\]]{1,30})\]/g)) {
    const e = expressionForTag(m[1]);
    if (e) return e;
  }
  const t = caption(text).toLowerCase();
  if (/\b(ha){2,}|\b(he){2,}|kkk|rsrs|haha|jaja/.test(t)) return "laughing";
  if (/\?\s*$/.test(t)) return "skeptical";
  if (/!\s*$/.test(t) && t.length < 90) return "surprised";
  if (/\b(óbvio|obvio|claro que|genial|gênio|perfeito|obviously|of course|brilliant)\b/.test(t)) return "proud";
  return null;
}

/**
 * Corta a fala onde há marcação ([sarcastic], [gasps]…), inclusive no meio da
 * frase: cada pedaço vira um pedido de voz próprio, e o rosto troca no instante
 * em que aquele pedaço começa a tocar. A marcação fica no começo do pedaço.
 */
export function splitAtTags(text: string): string[] {
  const parts = text.split(/(?=\[[^\]]{1,30}\])/);
  const out: string[] = [];
  for (const part of parts) {
    // pedaço curto demais (só a marcação, ou uma palavra) gruda no próximo/anterior
    if (out.length && caption(out[out.length - 1]).length < 8) out[out.length - 1] += part;
    else out.push(part);
  }
  if (out.length > 1 && caption(out[out.length - 1]).length < 8) out[out.length - 2] += out.pop()!;
  return out.map((p) => p.trim()).filter(Boolean);
}

export interface SpeechPorts {
  /** Voz de um pedaço: a resposta HTTP crua, ou null se não deu para pedir. */
  fetchVoice(text: string): Promise<Response | null>;
  /** Toca a resposta e devolve quando o áudio acaba (ou quando `stop` corta). */
  play(res: Response, token: number): Promise<void>;
  /** Voz de reserva: a do próprio navegador. */
  speakLocal(text: string, token: number): Promise<void>;
  /** Corta o áudio que estiver tocando agora. */
  stopAll(): void;
  onStatus?(text: string): void;
  /** O Eddy entrou em "falando", com a expressão do pedaço (null = a atual fica). */
  onSpeak?(expr: Expression | null): void;
}

export class SpeechQueue {
  private queue: { res: Promise<Response | null>; expr: Expression | null; text: string }[] = [];
  private running = false;
  private token = 0;
  private waiters: (() => void)[] = [];
  /** O servidor recusou a voz (limite do dia): daí em diante é a do navegador. */
  private voiceOff = false;

  constructor(private ports: SpeechPorts) {}

  /** A geração da fala em curso; muda a cada `stop` (respostas velhas são velhas). */
  get current(): number {
    return this.token;
  }

  /** Verdadeiro enquanto há alguma coisa para falar (na fila ou tocando). */
  get speaking(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Enfileira a fala inteira: um pedido de voz por pedaço, na ordem. */
  say(text: string) {
    for (const t of splitAtTags(voiceText(text))) {
      if (!caption(t)) continue;
      this.enqueue(this.voiceOff ? Promise.resolve(null) : this.ports.fetchVoice(t), t);
    }
  }

  /** Enfileira um pedaço com a voz já pedada (o "alô", que baixa enquanto ainda toca). */
  enqueue(res: Promise<Response | null>, text: string) {
    this.queue.push({ res, expr: exprOf(text), text });
    if (!this.running) void this.drain();
  }

  /** Corta tudo: para o áudio, joga fora a fila e invalida as respostas a caminho. */
  stop() {
    this.token++;
    this.queue = [];
    this.ports.stopAll();
    this.running = false;
    for (const w of this.waiters.splice(0)) w();
  }

  /** Resolve quando o Eddy terminar de falar tudo o que está na fila. */
  idle(): Promise<void> {
    if (!this.speaking) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private async drain() {
    this.running = true;
    const my = this.token;
    while (this.queue.length && my === this.token) {
      const item = this.queue.shift()!;
      const res = await item.res;
      if (my !== this.token) continue; // a pessoa interrompeu enquanto o áudio chegava
      this.ports.onSpeak?.(item.expr);
      try {
        if (res && res.ok) {
          this.ports.onStatus?.("Eddy falando… (Espaço interrompe)");
          await this.ports.play(res, my);
        } else {
          if (res) {
            const why = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText;
            if (res.status === 429) this.voiceOff = true; // não adianta insistir hoje
            this.ports.onStatus?.(`${why} — usando a voz do navegador.`);
          }
          await this.ports.speakLocal(caption(item.text), my);
        }
      } catch {
        /* uma frase perdida não derruba a ligação */
      }
    }
    if (my === this.token) this.running = false;
    if (!this.running) for (const w of this.waiters.splice(0)) w();
  }
}