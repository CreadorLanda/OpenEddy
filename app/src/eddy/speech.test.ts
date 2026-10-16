import { describe, expect, it, vi } from "vitest";
import { caption, exprOf, SpeechQueue, splitAtTags, voiceText, type SpeechPorts } from "./speech";

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
    expect(fetchVoice).toHaveBeenCalledWith("segunda parte da frase");
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