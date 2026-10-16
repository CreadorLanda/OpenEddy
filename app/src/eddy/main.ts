// Open Eddy — entra com Puter, conta quem você é, e liga para o Eddy.
//
// Telas: login → perfil (só na primeira vez) → início (botão de ligar) →
// chamando → em ligação (mãos livres: ouve, pensa, fala, ouve…) → encerrada.

import "../core/theme.css";
import "./eddy.css";
import { Native, subscribe, type NewsItem } from "../core/api";
import { h, externalLinks } from "../core/dom";
import type { Profile } from "../core/types";
import { EddyFace, type FaceState } from "./eddy";
import { Ringer } from "./ring";
import { B, LINKS } from "./backend";
import { caption, SpeechQueue, voiceText, splitAtTags } from "./speech";
import * as Puter from "./puter";

const root = document.getElementById("root")!;
externalLinks(root, Native.openUrl);

let username = "";
let profile: Profile | null = null;
let voice = "pm_alex";
let voices: Record<string, string> = { pm_alex: "Alex (masculina)" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lang = () => profile?.idioma ?? "pt";

const GITHUB = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.3-1.69-1.3-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>`;
const COFFEE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM7 2v2M11 2v2M15 2v2"/></svg>`;

/** Links do projeto: só nas telas de entrada, nunca na ligação. */
function projectLinks() {
  return h(
    "nav",
    { class: "links" },
    h("a", { href: LINKS.github, html: `${GITHUB}<span>GitHub</span>` }),
    h("a", { class: "kofi", href: LINKS.kofi, html: `${COFFEE}<span>Apoie no Ko-fi</span>` }),
  );
}

const PHONE = `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>`;
const MIC = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const MIC_OFF = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>`;
const KEYS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>`;

// ── rosto: um laço de desenho por tela, parado quando a tela sai ───────────────

let stopFace: (() => void) | null = null;

function faceCanvas(face: EddyFace, cls: string) {
  const canvas = h("canvas", { class: cls });
  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (face.state === "speak") face.amp = speechAmp();
    face.update(dt);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(hh * dpr)) canvas.height = Math.round(hh * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    face.draw(ctx, w, hh);
    raf = document.hidden ? 0 : requestAnimationFrame(frame);
  };
  const resume = () => {
    if (!raf && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", resume);
  stopFace?.();
  stopFace = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("visibilitychange", resume);
  };
  requestAnimationFrame(() => resume());
  return canvas;
}

function show(screen: HTMLElement) {
  root.replaceChildren(screen);
}

// ── áudio: fala do Eddy em streaming, frase a frase; nível da boca; toque ─────
//
// Cada frase vira um pedido a /api/tts/stream assim que fica pronta (a próxima
// já vai baixando enquanto a atual toca). PCM da ElevenLabs é agendado em
// blocos de ~120 ms conforme chega; o WAV do Kokoro (reserva) toca inteiro.

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let ringer: Ringer | null = null;
const active = new Set<AudioBufferSourceNode>();
let nextAt = 0;
let localAmp = 0;
let localSpeaking = false;
const ampBuf = new Float32Array(1024);

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.connect(audioCtx.destination);
    ringer = new Ringer(audioCtx);
  }
  void audioCtx.resume();
  return audioCtx;
}

function speechAmp() {
  if (localSpeaking) return localAmp;
  if (!analyser || !active.size) return 0;
  analyser.getFloatTimeDomainData(ampBuf);
  let sum = 0;
  for (const v of ampBuf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / ampBuf.length) * 5);
}

/** Agenda um bloco logo depois do anterior; resolve quando ele termina. */
function schedule(buf: AudioBuffer): Promise<void> {
  const ctx = audioCtx!;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(analyser!);
  const at = Math.max(ctx.currentTime + 0.03, nextAt);
  nextAt = at + buf.duration;
  active.add(src);
  src.start(at);
  return new Promise((resolve) => {
    src.onended = () => {
      active.delete(src);
      resolve();
    };
  });
}

async function play(res: Response, my: number) {
  const ctx = ensureAudio();
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/pcm") || !res.body) {
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    if (my === speech.current) await schedule(buf);
    return;
  }
  const rate = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
  const minBytes = Math.round(rate * 0.12) * 2;
  const reader = res.body.getReader();
  let pend = new Uint8Array(0);
  let last: Promise<void> = Promise.resolve();
  for (;;) {
    const { value, done } = await reader.read();
    if (my !== speech.current) {
      void reader.cancel();
      return;
    }
    if (value) {
      const joined = new Uint8Array(pend.length + value.length);
      joined.set(pend);
      joined.set(value, pend.length);
      pend = joined;
    }
    if (pend.length >= minBytes || (done && pend.length >= 2)) {
      const n = pend.length >> 1;
      const view = new DataView(pend.buffer, pend.byteOffset, n * 2);
      const buf = ctx.createBuffer(1, n, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
      pend = pend.slice(n * 2);
      last = schedule(buf);
    }
    if (done) break;
  }
  await last;
}

/** Voz do próprio navegador (Web Speech): grátis e local, mas sem o Sergio. */
function speakLocal(text: string, my: number): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth || !text || my !== speech.current) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = { pt: "pt-BR", en: "en-US", es: "es-ES" }[lang()];
    const v = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith(u.lang.slice(0, 2).toLowerCase()));
    if (v) u.voice = v;
    u.rate = 1.05;
    u.pitch = 0.85;
    const mouth = window.setInterval(() => (localAmp = 0.25 + Math.random() * 0.55), 90);
    const end = () => {
      window.clearInterval(mouth);
      localAmp = 0;
      localSpeaking = false;
      resolve();
    };
    u.onend = end;
    u.onerror = end;
    localSpeaking = true;
    synth.speak(u);
  });
}

// A fila (cortar nas marcações, descartar resposta velha, cair na voz do
// navegador quando o servidor recusa) mora em speech.ts; aqui só o Web Audio.
const speech = new SpeechQueue({
  fetchVoice: (t) => B.tts(t, voice, lang()).catch(() => null),
  play,
  speakLocal,
  stopAll() {
    for (const src of active) {
      try {
        src.stop();
      } catch {
        /* já parou */
      }
    }
    active.clear();
    nextAt = 0;
    if (localSpeaking) window.speechSynthesis?.cancel();
  },
  onStatus: (t) => setStatus(t),
  onSpeak: (expr) => {
    if (!call.face) return;
    call.face.state = "speak";
    if (expr) call.face.expression = expr;
  },
});

// ── telas: login e perfil ─────────────────────────────────────────────────────

function brand() {
  const face = new EddyFace();
  face.state = "idle";
  return h("div", { class: "brand" }, faceCanvas(face, "logo-face"), h("h1", {}, "Open ", h("span", {}, "Eddy")));
}

function loginScreen(error = "") {
  const btn = h("button", { class: "primary big" }, "Entrar com Puter") as HTMLButtonElement;
  const err = h("p", { class: "error" }, error);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Abrindo o Puter…";
    err.textContent = "";
    try {
      const u = await Puter.signIn();
      username = u.username;
      await afterLogin();
    } catch (e) {
      err.textContent = (e as Error).message;
      btn.disabled = false;
      btn.textContent = "Entrar com Puter";
    }
  });
  show(
    h(
      "section",
      { class: "screen center login" },
      brand(),
      h("p", { class: "tagline" }, "Ligue para o Eddy de Lab Rats. Egocêntrico, sarcástico e (às vezes) útil."),
      btn,
      err,
      h(
        "p",
        { class: "fine" },
        B.web
          ? "Sua conta Puter guarda seu perfil e move o cérebro do Eddy (Puter AI). Quer tudo rodando no seu PC? O app para Linux está no GitHub."
          : "Sua conta Puter guarda seu perfil. A conversa, a voz e o cérebro do Eddy rodam no seu PC.",
      ),
      projectLinks(),
    ),
  );
}

function profileScreen(first: boolean) {
  const p: Profile = profile ?? { nome: username, idade: 18, sexo: "outro", idioma: "pt" };
  const nome = h("input", { value: p.nome, maxlength: 40, placeholder: "Como o Eddy deve te chamar" }) as HTMLInputElement;
  const idade = h("input", { type: "number", min: 1, max: 120, value: p.idade }) as HTMLInputElement;
  let sexo: Profile["sexo"] = p.sexo;
  const segs = (["masculino", "feminino", "outro"] as const).map((s) => {
    const b = h("button", { type: "button", class: `seg ${s === sexo ? "on" : ""}` }, { masculino: "Masculino", feminino: "Feminino", outro: "Prefiro não dizer" }[s]);
    b.addEventListener("click", () => {
      sexo = s;
      segs.forEach((x) => x.classList.toggle("on", x === b));
    });
    return b;
  });
  let idioma: NonNullable<Profile["idioma"]> = p.idioma ?? "pt";
  const langs = (["pt", "en", "es"] as const).map((l) => {
    const b = h("button", { type: "button", class: `seg ${l === idioma ? "on" : ""}` }, { pt: "Português", en: "English", es: "Español" }[l]);
    b.addEventListener("click", () => {
      idioma = l;
      langs.forEach((x) => x.classList.toggle("on", x === b));
    });
    return b;
  });
  const voiceSel = h("select", {}, ...Object.entries(voices).map(([id, label]) => h("option", { value: id, selected: id === voice }, label))) as HTMLSelectElement;
  const err = h("p", { class: "error" });
  const save = h("button", { class: "primary big", type: "submit" }, first ? "Salvar e continuar" : "Salvar") as HTMLButtonElement;

  const form = h(
    "form",
    { class: "card form", onsubmit: async (ev: Event) => {
      ev.preventDefault();
      const next: Profile = { nome: nome.value.trim(), idade: Number(idade.value), sexo, idioma };
      if (!next.nome) return void (err.textContent = "Ele precisa saber seu nome. Senão vai te chamar de “humano” pra sempre.");
      if (!(next.idade >= 1 && next.idade <= 120)) return void (err.textContent = "Idade entre 1 e 120.");
      save.disabled = true;
      try {
        await Puter.saveProfile(next);
        profile = next;
        voice = voiceSel.value;
        await B.setProfile(next, voice);
        homeScreen();
      } catch (e) {
        err.textContent = (e as Error).message;
        save.disabled = false;
      }
    } },
    h("h2", {}, first ? "Antes de ligar…" : "Seu perfil"),
    h("p", { class: "muted" }, "O Eddy precisa saber com quem vai implicar. É assim que ele decide se te chama de garoto, garota, tiozão…"),
    h("label", {}, "Nome"), nome,
    h("label", {}, "Idade"), idade,
    h("label", {}, "Sexo"), h("div", { class: "segs" }, ...segs),
    h("label", {}, "Idioma do Eddy"), h("div", { class: "segs" }, ...langs),
    B.web ? null : h("label", {}, "Voz do Eddy"),
    B.web ? null : voiceSel,
    err,
    h("div", { class: "row" }, first ? null : h("button", { type: "button", class: "ghost", onclick: () => homeScreen() }, "Cancelar"), save),
  );
  show(h("section", { class: "screen center" }, form));
  nome.focus();
}

// ── tela inicial: ligar ───────────────────────────────────────────────────────

let healthNote = "";

function homeScreen(note = "") {
  const face = new EddyFace();
  face.state = "idle";
  const menu = h("div", { class: "menu" },
    h("button", { class: "ghost", onclick: () => profileScreen(false) }, "Editar perfil"),
    h("button", { class: "ghost", onclick: async () => {
      await Puter.signOut();
      profile = null;
      loginScreen();
    } }, "Sair do Puter"),
  );
  const callBtn = h("button", { class: "call-btn", title: "Ligar para o Eddy", html: PHONE, onclick: () => void startCall() });
  show(
    h(
      "section",
      { class: "screen home" },
      h("header", { class: "top" },
        h("span", { class: "hello" }, `Oi, ${profile?.nome ?? username}`),
        h("div", { class: "grow" }),
        h("details", { class: "account" }, h("summary", {}, (profile?.nome ?? "?").slice(0, 1).toUpperCase()), menu),
      ),
      h(
        "div",
        { class: "contact" },
        h("div", { class: "avatar" }, faceCanvas(face, "avatar-face")),
        h("h2", {}, "Eddy"),
        h("p", { class: "muted" }, "Sistema de casa inteligente · Lab Rats"),
        callBtn,
        h("p", { class: "fine" }, "Ligar"),
        note || healthNote ? h("p", { class: "error" }, note || healthNote) : null,
      ),
      h("footer", { class: "home-foot" }, projectLinks()),
    ),
  );
  callBtn.focus();
}

// ── a ligação ─────────────────────────────────────────────────────────────────

const call = {
  active: false,
  muted: false,
  typed: "",
  started: 0,
  timer: 0,
  silences: 0,
  face: null as EddyFace | null,
  status: null as HTMLElement | null,
  you: null as HTMLElement | null,
  says: null as HTMLElement | null,
  clock: null as HTMLElement | null,
  news: null as HTMLElement | null,
  unmute: null as (() => void) | null,
};

function setStatus(text: string) {
  if (call.status) call.status.textContent = text;
}

function setFace(s: FaceState, status?: string) {
  if (call.face) call.face.state = s;
  if (status !== undefined) setStatus(status);
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

async function startCall() {
  ensureAudio();
  speech.stop();
  call.active = true;
  call.muted = false;
  call.silences = 0;
  call.typed = "";

  // chamando…
  const face = new EddyFace();
  face.state = "idle";
  show(
    h(
      "section",
      { class: "screen ringing" },
      h("div", { class: "avatar pulse" }, faceCanvas(face, "avatar-face")),
      h("h2", {}, "Eddy"),
      h("p", { class: "muted" }, "Chamando…"),
      h("button", { class: "hangup", title: "Desligar", html: PHONE, onclick: () => hangUp() }),
    ),
  );
  ringer!.start();
  const t0 = performance.now();

  let greeting = "";
  let hello: { res: Promise<Response | null>; text: string }[] = [];
  try {
    // na web o navegador pede o microfone agora, durante o toque
    const [r] = await Promise.all([B.callStart(profile!), B.openMic()]);
    greeting = r.greeting;
    if (r.voice) voice = r.voice;
    // o "alô" (cortado nas marcações) já começa a chegar enquanto ainda toca
    hello = splitAtTags(voiceText(greeting)).map((text) => ({ text, res: B.tts(text, voice, lang()).catch(() => null) }));
    await Promise.all([hello[0]?.res, sleep(Math.max(0, 3300 - (performance.now() - t0)))]);
  } catch (e) {
    ringer!.stop();
    call.active = false;
    B.closeMic();
    const msg = (e as Error).message;
    homeScreen(/permission|denied|NotAllowed/i.test(msg) ? "O Eddy precisa do seu microfone para a ligação." : "Ninguém atendeu: " + msg);
    return;
  }
  if (!call.active) return;
  ringer!.stop();
  ringer!.beep(true);

  inCallScreen();
  call.says!.textContent = caption(greeting);
  for (const piece of hello) speech.enqueue(piece.res, piece.text);
  await speech.idle();
  void loop();
}

function inCallScreen() {
  call.face = new EddyFace();
  call.face.state = "idle";
  call.status = h("div", { class: "status" }, "");
  call.you = h("p", { class: "you" });
  call.says = h("p", { class: "says" });
  call.clock = h("span", { class: "clock" }, "00:00");
  call.news = h("aside", { class: "news" });
  call.started = Date.now();
  window.clearInterval(call.timer);
  call.timer = window.setInterval(() => call.clock && (call.clock.textContent = mmss(Date.now() - call.started)), 1000);

  const muteBtn = h("button", { class: "round", title: "Mudo", html: MIC });
  muteBtn.addEventListener("click", () => {
    call.muted = !call.muted;
    muteBtn.innerHTML = call.muted ? MIC_OFF : MIC;
    muteBtn.classList.toggle("on", call.muted);
    if (call.muted) B.cancelHear();
    else call.unmute?.();
  });

  const input = h("input", { placeholder: "Digite e aperte Enter…" }) as HTMLInputElement;
  const typeBox = h("form", { class: "typebox", onsubmit: (ev: Event) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    call.typed = text;
    B.cancelHear(); // solta o microfone; o laço pega o texto digitado
    call.unmute?.();
  } }, input);
  const keysBtn = h("button", { class: "round", title: "Digitar", html: KEYS });
  keysBtn.addEventListener("click", () => {
    const open = typeBox.classList.toggle("open");
    keysBtn.classList.toggle("on", open);
    if (open) input.focus();
  });

  const faceEl = faceCanvas(call.face, "face");
  faceEl.addEventListener("click", () => {
    if (speech.speaking) speech.stop();
  });

  show(
    h(
      "section",
      { class: "screen incall" },
      faceEl,
      h("header", { class: "top" }, h("span", { class: "live" }), h("b", {}, "Eddy"), call.clock),
      h("div", { class: "captions" }, call.you, call.says, call.status),
      typeBox,
      h("div", { class: "controls" }, muteBtn, h("button", { class: "hangup", title: "Desligar", html: PHONE, onclick: () => hangUp() }), keysBtn),
      call.news,
    ),
  );
}

async function loop() {
  while (call.active) {
    let text = call.typed;
    call.typed = "";
    if (!text) {
      if (call.muted) {
        setFace("idle", "Microfone mudo — o Eddy está esperando (e julgando).");
        await new Promise<void>((r) => (call.unmute = r));
        call.unmute = null;
        continue;
      }
      setFace("listen", "Pode falar…");
      try {
        text = await B.hear({
          lang: lang(),
          onPartial: (t) => call.you && call.face?.state === "listen" && (call.you.textContent = t),
          onLevel: (l) => call.face && (call.face.level = l),
        });
      } catch (e) {
        setFace("error", "Microfone: " + (e as Error).message);
        await sleep(2000);
        continue;
      }
      if (!call.active) break;
      if (call.typed) continue; // digitou enquanto ouvia
      if (!text) {
        if (call.muted) continue;
        call.silences++;
        if (call.silences === 2 || call.silences === 4) {
          const line = await B.silence(profile!, false);
          if (!call.active) break;
          call.says!.textContent = caption(line);
          speech.say(line);
          await speech.idle();
        }
        if (call.silences >= 6) {
          const bye = await B.silence(profile!, true);
          if (!call.active) break;
          call.says!.textContent = caption(bye);
          speech.say(bye);
          await speech.idle();
          hangUp();
        }
        continue;
      }
    }
    call.silences = 0;
    await ask(text);
  }
}

async function ask(text: string) {
  call.you!.textContent = text;
  call.says!.textContent = "";
  setFace("think", "Pensando… (ele finge que é difícil)");
  let pending = "";
  let full = "";
  try {
    const out = await B.turn(text, profile!, (tok) => {
      if (!call.active) return;
      full += tok;
      pending += tok;
      call.says!.textContent = caption(full);
      const m = pending.match(/^([\s\S]*?[.!?…])(\s+)([\s\S]*)$/);
      if (m && m[1].length > 12) {
        speech.say(m[1]);
        pending = m[3];
      }
    });
    if (call.active && pending.trim()) speech.say(pending);
    if (out.news) renderNews(out.news);
    if (out.settings) voice = out.settings.voice;
    await speech.idle();
  } catch (e) {
    setFace("error", "Erro: " + (e as Error).message);
    await sleep(2500);
  }
}

function hangUp() {
  if (!call.active) return;
  call.active = false;
  speech.stop();
  ringer?.stop();
  ringer?.beep(false);
  B.cancelHear();
  B.closeMic();
  call.unmute?.();
  window.clearInterval(call.timer);
  const dur = call.started ? mmss(Date.now() - call.started) : "";
  call.started = 0;
  call.face = null;
  stopFace?.();
  show(h("section", { class: "screen center ended" }, h("h2", {}, "Chamada encerrada"), dur ? h("p", { class: "muted" }, dur) : null));
  setTimeout(() => !call.active && homeScreen(), 1600);
}

function renderNews(items: NewsItem[]) {
  if (!call.news) return;
  call.news.replaceChildren(
    h("header", {}, h("b", {}, "Manchetes"), h("button", { class: "ghost", onclick: () => call.news?.classList.remove("open") }, "×")),
    h("div", { class: "list" }, ...items.map((n) =>
      h("a", { class: "item", href: n.link }, n.image ? h("img", { src: n.image, loading: "lazy", alt: "" }) : null, h("span", {}, h("small", {}, n.source), h("b", {}, n.title))),
    )),
  );
  call.news.classList.add("open");
}

document.addEventListener("keydown", (ev) => {
  if (!call.active) return;
  const typing = document.activeElement instanceof HTMLInputElement;
  if ((ev.code === "Space" && !typing) || ev.key === "Escape") {
    if (speech.speaking) {
      ev.preventDefault();
      speech.stop();
    } else if (ev.key === "Escape") {
      call.news?.classList.remove("open");
    }
  }
});

// ── início ────────────────────────────────────────────────────────────────────

/** Vozes e estado do núcleo — o perfil espera por isso para listar as vozes. */
let ready: Promise<void> = Promise.resolve();

async function afterLogin() {
  show(h("section", { class: "screen center" }, brand(), h("p", { class: "muted" }, "Carregando seu perfil…")));
  await ready;
  profile = await Puter.loadProfile();
  if (!profile) return profileScreen(true);
  await B.setProfile(profile);
  homeScreen();
}

async function boot() {
  show(h("section", { class: "screen center" }, brand(), h("p", { class: "muted" }, "Ligando os circuitos…")));
  if (!B.web) {
    // no PC o microfone e a voz moram no núcleo; os eventos vêm por SSE
    void subscribe((ev) => {
      if (ev.type === "voice.level" && call.face) call.face.level = ev.level;
      if (ev.type === "voice.partial" && call.you && call.face?.state === "listen") call.you.textContent = ev.text;
      if (ev.type === "voice.error") setStatus("Voz da ElevenLabs falhou — usando a voz local. (" + ev.error.slice(0, 80) + ")");
    });
  }
  ready = B.init()
    .then((r) => {
      voices = r.voices;
      voice = r.voice;
      healthNote = r.note;
    })
    .catch((e) => {
      healthNote = "Núcleo indisponível: " + (e as Error).message;
    });
  try {
    const u = await Puter.currentUser();
    if (!u) return loginScreen();
    username = u.username;
    await afterLogin();
  } catch (e) {
    loginScreen((e as Error).message);
  }
}

void boot();
