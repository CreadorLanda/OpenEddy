import { describe, expect, it, vi } from "vitest";
import { caption, exprOf, readPcm, SpeechQueue, splitAtTags, voiceText, type SpeechPorts } from "./speech";

describe("legend and voice text", () => {
  it("takes the tags out of the caption but keeps them for the voice", () => {
    const line = "[sighs] Tá bom, [laughs] eu explico.";
    expect(caption(line)).toBe("Tá bom, eu explico.");
    expect(voiceText(line)).toBe(line);
  });

  it("drops the thinking block, the emphasis and the links", () => {
    expect(voiceText("<think>hm</think> *olá* https://exemplo.com/x Ei, garoto.")).toBe("Ei, garoto.");
  });
});

describe("face of a piece of speech", () => {
  it("the audio tag wins", () => {
    expect(exprOf("[gasps] Você me ignorou")).toBe("surprised");
    expect(exprOf("Obviamente. [winks]")).toBe("wink");
  });

  it("without a tag, the text itself reacts", () => {
    expect(exprOf("hahaha foi bom")).toBe("laughing");
    expect(exprOf("Você está me achando bonito?")).toBe("skeptical");
    expect(exprOf("Uau!")).toBe("surprised");
    expect(exprOf("Of course, eu sei.")).toBe("proud");
  });

  it("stays neutral when there is no clue", () => {
    expect(exprOf("Vamos falar de outra coisa")).toBeNull();
  });
});

describe("splitting at the audio tags", () => {
  it("cuts mid-sentence, so the face changes mid-sentence too", () => {
    expect(splitAtTags("Claro que eu sei, [scoffs] é óbvio. [mischievously] Mas vou te deixar sofrer.")).toEqual([
      "Claro que eu sei,",
      "[scoffs] é óbvio.",
      "[mischievously] Mas vou te deixar sofrer.",
    ]);
  });

  it("a piece with nothing to say goes with the one next to it", () => {
    expect(splitAtTags("[sighs] [laughs] Bom dia, garoto.")).toEqual(["[sighs] [laughs] Bom dia, garoto."]);
    expect(splitAtTags("Oi. [sighs] Bom dia, garoto.")).toEqual(["Oi. [sighs] Bom dia, garoto."]);
    expect(splitAtTags("Bom dia, garoto. [sighs] Tudo bem?")).toEqual(["Bom dia, garoto.", "[sighs] Tudo bem?"]);
  });
});

/** Fala com as portas dublês: sem navegador, sem áudio, sem rede. */
function fakeQueue(over: Partial<SpeechPorts> = {}) {
  const ports = {
    fetchVoice: vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200 })),
    play: vi.fn(async () => {}),
    speakLocal: vi.fn(async () => {}),
    stopAll: vi.fn(),
    onStatus: vi.fn(),
    onSpeak: vi.fn(),
    ...over,
  } as SpeechPorts;
  const queue = new SpeechQueue(ports);
  return {
    queue,
    fetchVoice: ports.fetchVoice as ReturnType<typeof vi.fn>,
    play: ports.play as ReturnType<typeof vi.fn>,
    speakLocal: ports.speakLocal as ReturnType<typeof vi.fn>,
    stopAll: ports.stopAll as ReturnType<typeof vi.fn>,
    onStatus: ports.onStatus as ReturnType<typeof vi.fn>,
    onSpeak: ports.onSpeak as ReturnType<typeof vi.fn>,
  };
}

describe("the speech queue", () => {
  it("asks for one voice per piece and plays them in order", async () => {
    const { queue, fetchVoice, play } = fakeQueue();
    queue.say("[sighs] Bom dia, garoto. [laughs] Que susto bom.");
    await queue.idle();
    expect(fetchVoice.mock.calls.map((c) => c[0])).toEqual(["[sighs] Bom dia, garoto.", "[laughs] Que susto bom."]);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("tells the face which expression goes with the piece that starts now", async () => {
    const { queue, onSpeak } = fakeQueue();
    queue.say("[gasps] Você me ouviu agora?");
    await queue.idle();
    expect(onSpeak).toHaveBeenCalledWith("surprised");
  });

  it("waits for each audio to end before the next one", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { queue, play } = fakeQueue({ play: vi.fn(() => gate) });
    queue.enqueue(Promise.resolve(new Response("a", { status: 200 })), "primeiro");
    queue.enqueue(Promise.resolve(new Response("b", { status: 200 })), "segundo");
    await new Promise((r) => setTimeout(r, 0));
    expect(play).toHaveBeenCalledTimes(1);
    release();
    await queue.idle();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("throws away the answer that arrives after the interruption", async () => {
    let deliver = (_r: Response) => {};
    const late = new Promise<Response>((r) => (deliver = r));
    const { queue, play, stopAll } = fakeQueue();
    queue.enqueue(late, "resposta velha");
    expect(queue.speaking).toBe(true);
    queue.stop(); // a pessoa interrompeu no meio
    deliver(new Response("velha", { status: 200 }));
    await queue.idle();
    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    expect(queue.speaking).toBe(false);
  });

  it("does not ask nor play the rest of the line that was cut", async () => {
    let deliver = (_r: Response) => {};
    const late = new Promise<Response>((r) => (deliver = r));
    const { queue, fetchVoice, play } = fakeQueue();
    queue.enqueue(late, "resposta antiga");
    queue.say("segunda parte da frase");
    expect(fetchVoice.mock.calls[0][0]).toBe("segunda parte da frase");
    expect(fetchVoice.mock.calls[0][1].aborted).toBe(false); // o pedido nasce vivo
    queue.stop();
    deliver(new Response("antiga", { status: 200 }));
    await queue.idle();
    expect(play).not.toHaveBeenCalled();
  });

  it("stops the audio that is playing and drops what was next in the line", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { queue, play, stopAll } = fakeQueue({ play: vi.fn(() => gate) });
    queue.enqueue(Promise.resolve(new Response("a", { status: 200 })), "primeira parte da frase");
    queue.enqueue(Promise.resolve(new Response("b", { status: 200 })), "segunda parte da frase");
    await new Promise((r) => setTimeout(r, 0));
    expect(play).toHaveBeenCalledTimes(1);
    queue.stop();
    release();
    await queue.idle();
    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("keeps talking after a piece fails to play", async () => {
    const { queue, play, speakLocal } = fakeQueue({
      play: vi.fn(async () => {
        throw new Error("áudio corrompido");
      }),
    });
    queue.say("[sighs] Primeira parte inteira. [laughs] Segunda parte inteira.");
    await queue.idle();
    expect(play).toHaveBeenCalledTimes(2);
    expect(speakLocal).not.toHaveBeenCalled();
    expect(queue.speaking).toBe(false);
  });
});

// Issue #4: interromper a fala tem de matar o pedido em voo, não só o áudio.
describe("cancelling the requests in flight", () => {
  /** Um fetch que só acaba quando o sinal aborta, como um pedido real. */
  function pendingFetch(cancelled: () => void) {
    return (_text: string, signal: AbortSignal) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          cancelled();
          reject(new DOMException("The user aborted a request.", "AbortError"));
        });
      });
  }

  it("aborts the request that was still waiting for the response headers", async () => {
    let cancelled = 0;
    const { queue, play, speakLocal } = fakeQueue({
      fetchVoice: vi.fn(pendingFetch(() => void cancelled++)),
    });
    queue.say("[sighs] Bom dia, garoto.");
    await new Promise((r) => setTimeout(r, 0));
    queue.stop();
    await queue.idle();
    expect(cancelled).toBe(1);
    expect(play).not.toHaveBeenCalled();
    // a voz do navegador não fala a frase que a pessoa acabou de interromper
    expect(speakLocal).not.toHaveBeenCalled();
  });

  it("gives every request the signal of its own session", async () => {
    const sinais: AbortSignal[] = [];
    const { queue } = fakeQueue({
      fetchVoice: vi.fn((_t: string, signal: AbortSignal) => {
        sinais.push(signal);
        return new Promise<Response>(() => {});
      }),
    });
    queue.say("primeira frase da ligação");
    const antes = queue.signal;
    queue.stop();
    queue.say("segunda frase da ligação");
    await new Promise((r) => setTimeout(r, 0));
    expect(sinais).toHaveLength(2);
    expect(sinais[0]).toBe(antes);
    expect(sinais[0].aborted).toBe(true); // a primeira fala foi interrompida
    expect(sinais[1].aborted).toBe(false); // a segunda não herdou a interrupção
  });

  it("keeps talking after a stop when the next request is asked for again", async () => {
    let pedir = 0;
    const { queue, play } = fakeQueue({
      fetchVoice: vi.fn((_t: string, signal: AbortSignal) => {
        if (pedir++ === 0) return pendingFetch(() => {})(_t, signal);
        return Promise.resolve(new Response("áudio novo", { status: 200 }));
      }),
    });
    queue.say("[sighs] frase interrompida");
    await new Promise((r) => setTimeout(r, 0));
    queue.stop();
    queue.say("[laughs] frase nova depois da interrupção");
    await queue.idle();
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0].status).toBe(200);
    expect(queue.speaking).toBe(false);
  });

  it("survives a stop on top of another stop", async () => {
    const { queue, play, stopAll } = fakeQueue();
    queue.say("primeira frase");
    queue.stop();
    queue.stop();
    expect(stopAll).toHaveBeenCalledTimes(2);
    queue.say("[laughs] e depois desta");
    await queue.idle();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not let an aborted request raise the voice error", async () => {
    // O fetch rejeita com AbortError quando se interrompe: isso não é uma falha
    // de voz, não é para sair nada na legenda nem cair na voz do navegador.
    const { queue, play, speakLocal, onStatus } = fakeQueue({
      fetchVoice: vi.fn((_t: string, signal: AbortSignal) => pendingFetch(() => {})(_t, signal)),
    });
    queue.say("[sighs] a interromper");
    await new Promise((r) => setTimeout(r, 0));
    queue.stop();
    await queue.idle();
    expect(play).not.toHaveBeenCalled();
    expect(speakLocal).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe("when the server voice is gone", () => {
  it("speaks with the browser when the request itself failed", async () => {
    const { queue, play, speakLocal, onStatus } = fakeQueue({ fetchVoice: vi.fn(async () => null) });
    queue.say("[sighs] Eu continuo aqui.");
    await queue.idle();
    expect(play).not.toHaveBeenCalled();
    expect(speakLocal).toHaveBeenCalledWith("Eu continuo aqui.", 0);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("says why, in the status line, and uses the browser voice", async () => {
    const res = new Response(JSON.stringify({ error: "voz indisponível" }), { status: 503 });
    const { queue, speakLocal, onStatus } = fakeQueue({ fetchVoice: vi.fn(async () => res) });
    queue.say("Alguém ainda me ouviu?");
    await queue.idle();
    expect(onStatus).toHaveBeenCalledWith("voz indisponível — usando a voz do navegador.");
    expect(speakLocal).toHaveBeenCalledWith("Alguém ainda me ouviu?", 0);
  });

  it("stops asking after the daily limit (429) — no point in insisting", async () => {
    const limited = new Response(JSON.stringify({ error: "esgotou por hoje" }), { status: 429 });
    const fetchVoice = vi.fn(async () => limited);
    const { queue, speakLocal } = fakeQueue({ fetchVoice });
    queue.say("primeira frase da ligação");
    await queue.idle();
    expect(fetchVoice).toHaveBeenCalledTimes(1);
    queue.say("segunda frase da ligação");
    await queue.idle();
    expect(fetchVoice).toHaveBeenCalledTimes(1);
    expect(speakLocal).toHaveBeenCalledTimes(2);
  });
});
// Issue #4, metade do servidor: a leitura do corpo da resposta tem de se soltar
// quando a pessoa interrompe, mesmo com o servidor calado.
describe("reading the PCM that is still coming", () => {
  const RATE = 24000;

  /** Corpo que entrega o que lhe mandam e fica à espera quando acaba. */
  function body(...partes: Uint8Array[]) {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (i < partes.length) ctrl.enqueue(partes[i++]);
        else ctrl.close();
      },
    });
  }

  const pcm = (n: number, byte = 1) => new Uint8Array(n).fill(byte);

  it("hands over blocks of about 120 ms and finishes at the end of the stream", async () => {
    const ctrl = new AbortController();
    const blocos: number[] = [];
    // 4800 amostras = 9600 bytes = 200 ms: dá um bloco inteiro e sobras
    const inteira = await readPcm(body(pcm(9600), pcm(9600), pcm(4)), RATE, ctrl.signal, (b) => blocos.push(b.byteLength));
    expect(inteira).toBe(true);
    expect(blocos).toEqual([9600, 9600, 4]);
  });

  it("keeps the leftovers for the next block", async () => {
    const ctrl = new AbortController();
    const blocos: number[] = [];
    await readPcm(body(pcm(10), pcm(9590), pcm(10)), RATE, ctrl.signal, (b) => blocos.push(b.byteLength));
    expect(blocos).toEqual([9600, 10]);
  });

  it("releases the pending read when the session is aborted mid-stream", async () => {
    // o servidor já mandou um bloco e depois cala-se: sem isto, a leitura ficava
    // pendurada até o servidor decidir mandar mais áudio (ou a ligação cair)
    let fechado = false;
    let libertado = () => {};
    const preso = new Promise<void>((r) => (libertado = r));
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(pcm(9600));
      },
      pull() {
        return preso;
      },
      cancel() {
        fechado = true;
        libertado();
      },
    });
    const ctrl = new AbortController();
    const blocos: number[] = [];
    const leitura = readPcm(stream, RATE, ctrl.signal, (b) => blocos.push(b.byteLength));
    await new Promise((r) => setTimeout(r, 0));
    expect(blocos).toHaveLength(1);

    ctrl.abort();
    expect(await leitura).toBe(false);
    expect(fechado).toBe(true); // o leitor foi cancelado, não ficou à espera
  });

  it("gives up without touching the stream when it is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const blocos: number[] = [];
    expect(await readPcm(body(pcm(9600)), RATE, ctrl.signal, (b) => blocos.push(b.byteLength))).toBe(false);
    expect(blocos).toEqual([]);
  });

  it("never starts reading from a stream that would keep it waiting", async () => {
    // Sinal já abortado + servidor calado: quem entrasse na leitura ficava
    // pendurado para sempre (o abort não volta a disparar) e o stream ficava
    // trancado. Tem de desistir antes de pedir o primeiro bloco.
    const ctrl = new AbortController();
    ctrl.abort();
    const calado = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }); // calado para sempre
    const leitor = vi.spyOn(calado, "getReader");
    const blocos: number[] = [];
    const leitura = readPcm(calado, RATE, ctrl.signal, (b) => blocos.push(b.byteLength));
    expect(await Promise.race([leitura, new Promise((r) => setTimeout(() => r("pendurada"), 250))])).toBe(false);
    expect(leitor).not.toHaveBeenCalled(); // nem sequer pegou no corpo da resposta
    expect(calado.locked).toBe(false);
    expect(blocos).toEqual([]);
  });

  it("drops the abort listener when the stream ends", async () => {
    const ctrl = new AbortController();
    const add = vi.spyOn(ctrl.signal, "addEventListener");
    const remove = vi.spyOn(ctrl.signal, "removeEventListener");
    await readPcm(body(pcm(10)), RATE, ctrl.signal, () => {});
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    // sem isto, cada fala deixava um listener pendurado no sinal da sessão
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });
});
