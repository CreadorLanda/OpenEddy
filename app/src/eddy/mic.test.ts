import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebMic } from "./mic";

// Ouvido na web: microfone do navegador → Scribe da ElevenLabs. Aqui o
// WebSocket, o AudioContext e o relógio são dublês — o teste é sobre as decisões
// do código (o que mandar, quando desistir, quando cancelar), não sobre o áudio.

class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;

  readyState = 1;
  sent: string[] = [];
  closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed++;
  }

  /** O servidor do Scribe fala. */
  reply(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
}

class FakeNode {
  onaudioprocess: ((ev: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null = null;
  connected: unknown[] = [];
  connect(to: unknown) {
    this.connected.push(to);
  }
  disconnect() {
    this.connected = [];
  }
  feed(samples: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  }
}

let node: FakeNode;
let asked = 0;
let closedCtx = 0;

beforeEach(() => {
  node = new FakeNode();
  asked = 0;
  closedCtx = 0;
  FakeSocket.last = null;
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).WebSocket = FakeSocket;
  (globalThis as Record<string, unknown>).AudioContext = class {
    sampleRate = 48000;
    destination = {};
    createMediaStreamSource = () => ({ connect() {} });
    createScriptProcessor = () => node;
    close = () => void closedCtx++;
  };
  // navigator é só leitura no Node: define de propósito.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          asked++;
          return { getTracks: () => [{ stop() {} }] };
        },
      },
    },
  });
});

const socket = () => FakeSocket.last!;
const params = () => new URL(socket().url).searchParams;

describe("opening the microphone", () => {
  it("asks the browser once per call, however many turns there are", async () => {
    const mic = new WebMic();
    await mic.open();
    await mic.open();
    expect(asked).toBe(1);
  });

  it("releases the microphone on close", async () => {
    const mic = new WebMic();
    await mic.open();
    mic.close();
    expect(node.connected).toHaveLength(0);
    expect(closedCtx).toBe(1);
  });
});

describe("one turn of listening", () => {
  it("sends the single-use token to the Scribe, in the language of the profile", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "en", token: "tok-123" });
    const p = params();
    expect(p.get("token")).toBe("tok-123");
    expect(p.get("language_code")).toBe("en");
    expect(p.get("audio_format")).toBe("pcm_16000");
    expect(p.get("vad_silence_threshold_secs")).toBe("0.7");
    socket().reply({ message_type: "committed_transcript", text: " hello there " });
    expect(await heard).toBe("hello there");
  });

  it("shows the partial text while the person is still speaking", async () => {
    const mic = new WebMic();
    const seen: string[] = [];
    const heard = mic.hear({ lang: "pt", token: "t", onPartial: (t) => seen.push(t) });
    socket().reply({ message_type: "partial_transcript", text: "olá" });
    socket().reply({ message_type: "partial_transcript", text: "olá, Eddy" });
    socket().reply({ message_type: "committed_transcript", text: "olá, Eddy" });
    expect(await heard).toBe("olá, Eddy");
    expect(seen).toEqual(["olá", "olá, Eddy"]);
  });

  it("resolves with the partial text when the socket closes before the VAD closes the line", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "pt", token: "t" });
    socket().reply({ message_type: "partial_transcript", text: "meia frase" });
    socket().onclose?.();
    expect(await heard).toBe("meia frase");
  });

  it("ignores a message it cannot read", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "pt", token: "t" });
    socket().reply("isto não é json");
    socket().reply({ message_type: "partial_transcript", text: "ainda aqui" });
    socket().reply({ message_type: "committed_transcript", text: "ainda aqui" });
    expect(await heard).toBe("ainda aqui");
  });

  it("gives up on the error the Scribe sends", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "pt", token: "t" });
    socket().reply({ message_type: "session_error", error: "token expirado" });
    await expect(heard).rejects.toThrow("token expirado");
  });

  it("gives up when the WebSocket itself fails", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "pt", token: "t" });
    socket().onerror?.();
    await expect(heard).rejects.toThrow(/Scribe/);
  });

  it("returns empty and closes the socket when the person cancels the listening", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "pt", token: "t" });
    mic.stopListening();
    expect(await heard).toBe("");
    expect(socket().closed).toBe(1);
  });

  it("a cancellation after the text arrived does not take the answer away", async () => {
    const mic = new WebMic();
    const heard = mic.hear({ lang: "pt", token: "t" });
    socket().reply({ message_type: "committed_transcript", text: "concluído" });
    mic.stopListening();
    expect(await heard).toBe("concluído");
  });

  it("does not stay listening after being cancelled: no more audio goes to the wire", async () => {
    const mic = new WebMic();
    void mic.hear({ lang: "pt", token: "t" });
    socket().onopen?.();
    node.feed(new Float32Array(480));
    const before = socket().sent.length;
    mic.stopListening();
    node.feed(new Float32Array(480));
    expect(socket().sent).toHaveLength(before);
  });
});

describe("the microphone level", () => {
  it("resamples the browser audio to 16 kHz and reports the level", async () => {
    const mic = new WebMic();
    await mic.open(); // sampleRate 48000 do dublê → 3 amostras por amostra de saída
    const levels: number[] = [];
    void mic.hear({ lang: "pt", token: "t", onLevel: (l) => levels.push(l) });
    socket().onopen?.();
    node.feed(new Float32Array(48).fill(0.5));
    const sent = socket().sent.map((s) => JSON.parse(s));
    expect(sent).toHaveLength(1);
    expect(sent[0].message_type).toBe("input_audio_chunk");
    expect(sent[0].sample_rate).toBe(16000);
    expect(sent[0].commit).toBe(false);
    expect([...atob(sent[0].audio_base_64)].map((c) => c.charCodeAt(0))).toHaveLength(16 * 2);
    expect(levels[0]).toBeCloseTo(Math.min(1, 0.5 * 12), 5);
  });

  it("reports silence as no level, so the rings do not grow", async () => {
    const mic = new WebMic();
    await mic.open();
    const levels: number[] = [];
    void mic.hear({ lang: "pt", token: "t", onLevel: (l) => levels.push(l) });
    socket().onopen?.();
    node.feed(new Float32Array(48));
    expect(levels[0]).toBe(0);
  });

  it("does not send audio before the socket is open", async () => {
    const mic = new WebMic();
    await mic.open();
    void mic.hear({ lang: "pt", token: "t" });
    node.feed(new Float32Array(48));
    expect(socket().sent).toHaveLength(0);
  });
});

describe("giving up on the silence", () => {
  it("returns empty when nobody speaks until the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date", "performance"] });
    try {
      const mic = new WebMic();
      const heard = mic.hear({ lang: "pt", token: "t", startTimeout: 2 });
      await vi.advanceTimersByTimeAsync(2500);
      expect(await heard).toBe("");
      expect(socket().closed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the VAD to close the line when the turn runs long", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date", "performance"] });
    try {
      const mic = new WebMic();
      const heard = mic.hear({ lang: "pt", token: "t", maxSeconds: 3 });
      socket().onopen?.();
      await vi.advanceTimersByTimeAsync(3400); // um tique do relógio (250 ms) depois dos 3 s
      const commits = socket().sent.filter((s) => JSON.parse(s).commit === true);
      expect(commits).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(3000); // passa do startTimeout: desiste
      expect(await heard).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last partial text when the turn runs long", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date", "performance"] });
    try {
      const mic = new WebMic();
      const heard = mic.hear({ lang: "pt", token: "t", maxSeconds: 2 });
      socket().reply({ message_type: "partial_transcript", text: "falei correndo" });
      await vi.advanceTimersByTimeAsync(5500);
      expect(await heard).toBe("falei correndo");
    } finally {
      vi.useRealTimers();
    }
  });
});