// Ouvido na web: microfone do navegador → Scribe v2 Realtime da ElevenLabs.
// O servidor só emite um token de uso único por escuta; o áudio vai direto
// do navegador para a ElevenLabs (PCM 16 kHz em blocos de ~85 ms).

const SCRIBE = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export interface HearOptions {
  lang: string;
  token: string;
  maxSeconds?: number;
  startTimeout?: number;
  silence?: number;
  onPartial?: (text: string) => void;
  onLevel?: (level: number) => void;
}

export class WebMic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private sink: ((pcm16: Int16Array, level: number) => void) | null = null;
  private cancel: (() => void) | null = null;

  /** Pede o microfone uma vez por ligação (o navegador pergunta na primeira). */
  async open() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const ratio = this.ctx.sampleRate / 16000;
    this.node.onaudioprocess = (ev) => {
      if (!this.sink) return;
      const input = ev.inputBuffer.getChannelData(0);
      const n = Math.floor(input.length / ratio);
      const out = new Int16Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        // média do trecho: reamostra para 16 kHz sem serrilhado grosseiro
        const a = Math.floor(i * ratio);
        const b = Math.min(input.length, Math.floor((i + 1) * ratio));
        let acc = 0;
        for (let j = a; j < b; j++) acc += input[j];
        const v = acc / Math.max(1, b - a);
        sum += v * v;
        out[i] = Math.max(-1, Math.min(1, v)) * 32767;
      }
      this.sink(out, Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 12));
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination); // o ScriptProcessor só roda conectado
  }

  close() {
    this.stopListening();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }

  stopListening() {
    this.cancel?.();
  }

  /** Uma fala: resolve com o texto fechado pelo VAD do Scribe ("" se ninguém falou). */
  hear(o: HearOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        model_id: "scribe_v2_realtime",
        language_code: o.lang,
        audio_format: "pcm_16000",
        commit_strategy: "vad",
        vad_silence_threshold_secs: String(o.silence ?? 0.7),
        token: o.token,
      });
      const ws = new WebSocket(`${SCRIBE}?${params}`);
      const t0 = performance.now();
      let heard = "";
      let done = false;
      let timer = 0;

      const finish = (text: string, err?: Error) => {
        if (done) return;
        done = true;
        this.sink = null;
        this.cancel = null;
        window.clearInterval(timer);
        try {
          ws.close();
        } catch {
          /* já fechado */
        }
        if (err) reject(err);
        else resolve(text);
      };
      this.cancel = () => finish("");

      ws.onopen = () => {
        this.sink = (pcm, level) => {
          o.onLevel?.(level);
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ message_type: "input_audio_chunk", sample_rate: 16000, commit: false, audio_base_64: b64(pcm) }));
        };
      };
      ws.onmessage = (m) => {
        let msg: { message_type?: string; text?: string; error?: string };
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        const kind = msg.message_type ?? "";
        if (kind === "partial_transcript" && msg.text) {
          heard = msg.text;
          o.onPartial?.(heard);
        } else if (kind === "committed_transcript" && msg.text?.trim()) {
          finish(msg.text.trim());
        } else if (kind.endsWith("error")) {
          finish("", new Error(msg.error ?? kind));
        }
      };
      ws.onerror = () => finish("", new Error("não consegui falar com o Scribe"));
      ws.onclose = () => finish(heard);

      timer = window.setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        if (!heard && s > (o.startTimeout ?? 6)) finish("");
        else if (s > (o.maxSeconds ?? 15) + 3) finish(heard);
        else if (s > (o.maxSeconds ?? 15) && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ message_type: "input_audio_chunk", sample_rate: 16000, commit: true, audio_base_64: "" }));
        }
      }, 250);
    });
  }
}

function b64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
