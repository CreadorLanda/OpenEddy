// Voz do Eddy: o texto, a fila que o corta nas marcações e a leitura do áudio.
//
// O que decide o que o Eddy fala — o que é fala, o que é resposta velha e o que
// já não interessa porque a pessoa interrompeu — vive aqui, sem DOM: a rede
// entra por `fetchVoice`, o áudio por `play`. É o que dá para testar sem
// navegador e sem serviço pago.

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

/**
 * Lê o PCM do corpo da resposta em blocos de ~120 ms e entrega cada bloco a
 * `onBlock`. Devolve false se a pessoa interrompeu — nesse caso o leitor é
 * cancelado (e a leitura pendente solta-se de imediato, sem esperar o servidor
 * mandar mais áudio) e `onBlock` não é mais chamado.
 *
 * Se a sessão já estiver interrompida à entrada, nem sequer se toca no corpo da
 * resposta: o sinal abortado já não dispara eventos, portanto quem largasse a
 * leitura pendurada ficaria à espera de áudio que já não interessa, com o
 * stream trancado.
 */
export async function readPcm(
  body: ReadableStream<Uint8Array>,
  rate: number,
  signal: AbortSignal,
  onBlock: (pcm: Uint8Array) => void,
): Promise<boolean> {
  if (signal.aborted) return false;
  const reader = body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let pend = new Uint8Array(0);
  const minBytes = Math.round(rate * 0.12) * 2;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal.aborted) return false;
      if (value) {
        const joined = new Uint8Array(pend.length + value.length);
        joined.set(pend);
        joined.set(value, pend.length);
        pend = joined;
      }
      if (pend.length >= minBytes || (done && pend.length >= 2)) {
        const n = pend.length >> 1;
        onBlock(pend.subarray(0, n * 2));
        pend = pend.slice(n * 2);
      }
      if (done) break;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return true;
}

export interface SpeechPorts {
  /**
   * Voz de um pedaço: a resposta HTTP crua, ou null se não deu para pedir.
   * `signal` aborta o pedido quando a pessoa interrompe a fala.
   */
  fetchVoice(text: string, signal: AbortSignal): Promise<Response | null>;
  /** Toca a resposta e devolve quando o áudio acaba (ou quando `stop` corta). */
  play(res: Response, token: number, signal: AbortSignal): Promise<void>;
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
  /**
   * Uma sessão = uma fala que pode ser interrompida. O `stop` aborta o sinal:
   * os pedidos em voo morrem e as leituras pendentes soltam-se. O controller
   * novo é para a fala seguinte, que não pode herdar a interrupção.
   */
  private abort = new AbortController();

  constructor(private ports: SpeechPorts) {}

  /** A geração da fala em curso; muda a cada `stop` (respostas velhas são velhas). */
  get current(): number {
    return this.token;
  }

  /** O sinal da sessão: abortado assim que a pessoa interrompe. */
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Verdadeiro enquanto há alguma coisa para falar (na fila ou tocando). */
  get speaking(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Enfileira a fala inteira: um pedido de voz por pedaço, na ordem. */
  say(text: string) {
    for (const t of splitAtTags(voiceText(text))) {
      if (!caption(t)) continue;
      this.enqueue(this.voiceOff ? Promise.resolve(null) : this.ports.fetchVoice(t, this.signal), t);
    }
  }

  /** Enfileira um pedaço com a voz já pedada (o "alô", que baixa enquanto ainda toca). */
  enqueue(res: Promise<Response | null>, text: string) {
    this.queue.push({ res, expr: exprOf(text), text });
    if (!this.running) void this.drain();
  }

  /** Corta tudo: aborta os pedidos, para o áudio, joga fora a fila e invalida as respostas a caminho. */
  stop() {
    this.token++;
    this.abort.abort();
    this.abort = new AbortController();
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
    const signal = this.signal;
    while (this.queue.length && my === this.token) {
      const item = this.queue.shift()!;
      let res: Response | null;
      try {
        res = await item.res;
      } catch {
        // O pedido não deu resposta nenhuma — interrompido, rede em baixo, o
        // que for. O pedaço salta-se e a fila continua; a voz do navegador só
        // entra quando o servidor respondeu (mesmo a recusar).
        continue;
      }
      if (my !== this.token) continue; // a pessoa interrompeu enquanto o áudio chegava
      this.ports.onSpeak?.(item.expr);
      try {
        if (res && res.ok) {
          this.ports.onStatus?.("Eddy falando… (Espaço interrompe)");
          await this.ports.play(res, my, signal);
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