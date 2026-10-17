// Open Eddy — entra com Puter, conta quem você é, e liga para o Eddy.
//
// Telas: login → perfil (só na primeira vez) → início (botão de ligar) →
// chamando → em ligação (mãos livres: ouve, pensa, fala, ouve…) → encerrada.

import "../core/theme.css";
import "./eddy.css";
import { Native, subscribe, type NewsItem, type SceneBundle } from "../core/api";
import { h, externalLinks } from "../core/dom";
import type { Profile } from "../core/types";
import { EddyFace, faceTheme, setFaceTheme, type FaceState, type FaceTheme } from "./eddy";
import { Ringer } from "./ring";
import { B, LINKS, sceneFallback, type Action, type SceneKind } from "./backend";
import { createGame, type GameHost, type GameKind, type GameSession } from "./games";
import { MadeGame } from "./games/maker";
import { galleryPanel, searchImages, type Pic } from "./images";
import { memoryPanel } from "./memory";
import { caption, readPcm, SpeechQueue, voiceText, splitAtTags } from "./speech";
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
const KNIGHT = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 21h11M8.5 21c0-3 1-4.5 3-6.5-1.5.3-3 .2-4.5-.6L5.5 11.5 9 7.5V4l2.5 2C16 6.5 18 10 17.5 21"/><circle cx="12" cy="9.5" r=".6" fill="currentColor"/></svg>`;
const CONTRAST = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>`;
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

// ── visual: holograma ou clássico (branco com linhas pretas) ──────────────────

function applyTheme(t: FaceTheme) {
  setFaceTheme(t);
  document.body.classList.toggle("classic", t === "classic");
}

/** Troca o visual e guarda no perfil (conta Puter), para a próxima vez. */
function setTheme(to: FaceTheme | "toggle") {
  const t: FaceTheme = to === "toggle" ? (faceTheme() === "classic" ? "holo" : "classic") : to;
  applyTheme(t);
  if (profile && profile.tema !== t) {
    profile = { ...profile, tema: t };
    void Puter.saveProfile(profile).catch(() => {});
  }
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

async function play(res: Response, my: number, signal: AbortSignal) {
  const ctx = ensureAudio();
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/pcm") || !res.body) {
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    if (my === speech.current) await schedule(buf);
    return;
  }
  const rate = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
  let last: Promise<void> = Promise.resolve();
  // A leitura solta-se no `stop`: o sinal da sessão abortado cancela o leitor,
  // mesmo que o servidor esteja calado há segundos (ver speech.readPcm).
  const inteira = await readPcm(res.body, rate, signal, (pcm) => {
    const n = pcm.byteLength >> 1;
    const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
    const buf = ctx.createBuffer(1, n, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    last = schedule(buf);
  });
  if (!inteira) return; // interrompido: o áudio que restou não toca
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
  fetchVoice: (t, signal) => B.tts(t, voice, lang(), signal).catch(() => null),
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
  let tema: FaceTheme = p.tema ?? "holo";
  const temas = (["holo", "classic"] as const).map((t) => {
    const b = h("button", { type: "button", class: `seg ${t === tema ? "on" : ""}` }, { holo: "Holograma", classic: "Clássico (branco)" }[t]);
    b.addEventListener("click", () => {
      tema = t;
      applyTheme(t); // já mostra como fica
      temas.forEach((x) => x.classList.toggle("on", x === b));
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
      const next: Profile = { nome: nome.value.trim(), idade: Number(idade.value), sexo, idioma, tema };
      if (!next.nome) return void (err.textContent = "Ele precisa saber seu nome. Senão vai te chamar de “humano” pra sempre.");
      if (!(next.idade >= 1 && next.idade <= 120)) return void (err.textContent = "Idade entre 1 e 120.");
      save.disabled = true;
      try {
        await Puter.saveProfile(next);
        profile = next;
        voice = voiceSel.value;
        await B.setProfile(next, voice, username || undefined);
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
    h("label", {}, "Visual do Eddy"), h("div", { class: "segs" }, ...temas),
    B.web ? null : h("label", {}, "Voz do Eddy"),
    B.web ? null : voiceSel,
    // A memória precisa do dono ligado no núcleo, por isso só aparece depois do
    // primeiro perfil guardado.
    first ? null : memoryPanel(!B.web, () => profileScreen(false)),
    err,
    h("div", { class: "row" }, first ? null : h("button", { type: "button", class: "ghost", onclick: () => (applyTheme(profile?.tema ?? "holo"), homeScreen()) }, "Cancelar"), save),
  );
  show(h("section", { class: "screen center" }, form));
  nome.focus();
}

// ── tela inicial: ligar ───────────────────────────────────────────────────────

let healthNote = "";
let onHome = false;
let surpriseTimer = 0;
let surpriseDone = false;

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
  onHome = true;
  scheduleSurprise();
}

/** Cena "surprise": parado na tela inicial por uns minutos, o Eddy liga sozinho (uma vez por sessão). */
function scheduleSurprise() {
  window.clearTimeout(surpriseTimer);
  if (surpriseDone || !profile) return;
  surpriseTimer = window.setTimeout(() => {
    if (!onHome || call.active || document.hidden) return scheduleSurprise();
    surpriseDone = true;
    incoming({ kind: "surprise_call", title: "Eddy está ligando…", fresh: true, after: "continue", onDecline: () =>
      window.setTimeout(() => incoming({ kind: "surprise_declined", title: "Eddy está ligando… de novo", after: "hangup" }), 2500),
    });
  }, (150 + Math.random() * 150) * 1000);
}

// ── a ligação ─────────────────────────────────────────────────────────────────

const call = {
  active: false,
  /**
   * Geração da chamada: muda ao desligar e ao ligar outra vez. `call.active` sozinho
   * não chega — depois de uma chamada nova volta a ser true, e um turno da antiga
   * que só agora acaba escreveria a resposta na legenda e na voz de Eddy.
   */
  gen: 0,
  muted: false,
  typed: "",
  started: 0,
  timer: 0,
  silences: 0,
  turns: 0,
  heldOnce: false,
  face: null as EddyFace | null,
  status: null as HTMLElement | null,
  you: null as HTMLElement | null,
  says: null as HTMLElement | null,
  clock: null as HTMLElement | null,
  news: null as HTMLElement | null,
  stage: null as HTMLElement | null, // selos das cenas (REC, gelo…)
  unmute: null as (() => void) | null,
  screen: null as HTMLElement | null,
  /** painel ao lado do rosto: o tabuleiro e/ou as imagens */
  area: null as HTMLElement | null,
  game: null as GameSession | null,
  gallery: null as HTMLElement | null,
  /** falas curtas do Eddy que chegam sem a pessoa falar (comentários do jogo…) */
  interject: [] as string[],
  listening: false,
  /** o Eddy está respondendo uma fala (pensando ou falando a resposta) */
  asking: false,
  setMuted: (_on: boolean) => {},
};
let scenes: SceneBundle | null = null;

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

function resetCall() {
  window.clearTimeout(surpriseTimer);
  onHome = false;
  ensureAudio();
  speech.stop();
  call.active = true;
  call.gen++; // a chamada nova invalida o que a anterior deixou a meio
  call.muted = false;
  call.silences = 0;
  call.typed = "";
  call.interject = [];
  call.game = null;
  call.gallery = null;
}

/** Fala inteira do Eddy (cortada nas marcações), esperando terminar. */
async function say(text: string) {
  if (!text || !call.active) return;
  call.says!.textContent = caption(text);
  speech.say(text);
  await speech.idle();
}

async function startCall() {
  resetCall();
  call.turns = 0;
  call.heldOnce = false;

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
    scenes = await B.scenes(profile!).catch(() => null);
    // o "alô" (cortado nas marcações) já começa a chegar enquanto ainda toca. Vai
    // com o sinal da sessão: se a pessoa desligar enquanto o telefone toca, o
    // pedido morre com a chamada em vez de continuar a ser sintetizado.
    hello = splitAtTags(voiceText(greeting)).map((text) => ({ text, res: B.tts(text, voice, lang(), speech.signal).catch(() => null) }));
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

interface IncomingOptions {
  kind: SceneKind;
  title: string;
  /** "hangup" = fala e desliga com raiva; "continue" = vira uma ligação normal */
  after: "hangup" | "continue";
  /** ligação nova (zera a conversa); senão continua a conversa anterior */
  fresh?: boolean;
  onDecline?: () => void;
}

/** O Eddy ligando para a pessoa: tela de chamada recebida com atender / recusar. */
function incoming(o: IncomingOptions) {
  window.clearTimeout(surpriseTimer);
  onHome = false;
  ensureAudio();
  const face = new EddyFace();
  face.state = "idle";
  face.expression = o.kind === "surprise_call" ? "proud" : "angry";
  // a fala já vai sendo preparada enquanto toca
  const line = (async () => {
    if (o.fresh) {
      await B.callStart(profile!);
      scenes = await B.scenes(profile!).catch(() => null);
    }
    return B.sceneLine(o.kind, profile!).catch(() => sceneFallback(scenes, o.kind));
  })();
  let answered = false;
  const decline = () => {
    if (answered) return;
    answered = true;
    window.clearTimeout(missed);
    ringer?.stop();
    ringer?.beep(false);
    stopFace?.();
    show(h("section", { class: "screen center ended" }, h("h2", {}, "Chamada recusada"), h("p", { class: "muted" }, "Ele vai lembrar disso.")));
    window.setTimeout(() => (o.onDecline ? o.onDecline() : homeScreen()), 1800);
  };
  const answer = async () => {
    if (answered) return;
    answered = true;
    window.clearTimeout(missed);
    ringer?.stop();
    ringer?.beep(true);
    resetCall();
    if (o.fresh) {
      call.turns = 0;
      call.heldOnce = false;
    }
    try {
      await B.openMic();
    } catch {
      /* sem microfone: ele fala mesmo assim */
    }
    inCallScreen();
    if (call.face) call.face.expression = face.expression;
    setFace("think", "Conectando…");
    await say(await line);
    if (!call.active) return;
    if (o.after === "hangup")
      hangUp({ title: o.kind === "surprise_declined" ? "O Eddy desligou. Ofendidíssimo." : "O Eddy desligou na sua cara. De novo.", slam: true });
    else void loop();
  };
  show(
    h(
      "section",
      { class: "screen ringing incoming" },
      h("div", { class: "avatar pulse" }, faceCanvas(face, "avatar-face")),
      h("h2", {}, "Eddy"),
      h("p", { class: "muted" }, o.title),
      h(
        "div",
        { class: "answer-row" },
        h("button", { class: "hangup", title: "Recusar", html: PHONE, onclick: decline }),
        h("button", { class: "call-btn ringing-btn", title: "Atender", html: PHONE, onclick: () => void answer() }),
      ),
      h("div", { class: "answer-labels" }, h("span", {}, "Recusar"), h("span", {}, "Atender")),
    ),
  );
  ringer?.start();
  // ninguém atendeu em 25 s: chamada perdida
  const missed = window.setTimeout(decline, 25_000);
}

function inCallScreen() {
  call.face = new EddyFace();
  call.face.state = "idle";
  call.status = h("div", { class: "status" }, "");
  call.you = h("p", { class: "you" });
  call.says = h("p", { class: "says" });
  call.clock = h("span", { class: "clock" }, "00:00");
  call.news = h("aside", { class: "news" });
  call.stage = h("div", { class: "stage" });
  call.started = Date.now();
  window.clearInterval(call.timer);
  call.timer = window.setInterval(() => call.clock && (call.clock.textContent = mmss(Date.now() - call.started)), 1000);

  const muteBtn = h("button", { class: "round", title: "Mudo", html: MIC });
  call.setMuted = (on: boolean) => {
    call.muted = on;
    muteBtn.innerHTML = on ? MIC_OFF : MIC;
    muteBtn.classList.toggle("on", on);
    if (on) B.cancelHear();
    else call.unmute?.();
  };
  muteBtn.addEventListener("click", () => call.setMuted(!call.muted));

  const gamesMenu = h(
    "div",
    { class: "games-menu" },
    h("button", { type: "button", onclick: () => (gamesMenu.classList.remove("open"), openGame("chess", true)) }, "♞\uFE0E Xadrez"),
    h("button", { type: "button", onclick: () => (gamesMenu.classList.remove("open"), openGame("checkers", true)) }, "⛂\uFE0E Damas"),
    h("button", { type: "button", onclick: () => (gamesMenu.classList.remove("open"), openGame("fight", true)) }, "👊 Luta"),
    h("button", { type: "button", onclick: () => (gamesMenu.classList.remove("open"), openGame("duel", true)) }, "🃏 Duelo"),
    h("button", { type: "button", title: "Ou peça: “cria um jogo de…”", onclick: () => (gamesMenu.classList.remove("open"), openMade(""), interject(sceneFallback(scenes, "a_make"))) }, "🛠 Ele cria um"),
  );
  const gamesBtn = h("button", { class: "round", title: "Jogar com o Eddy", html: KNIGHT, onclick: () => gamesMenu.classList.toggle("open") });
  const themeBtn = h("button", { class: "round", title: "Trocar o visual do Eddy", html: CONTRAST, onclick: () => {
    setTheme("toggle");
    if (!speech.speaking) interject(sceneFallback(scenes, "a_theme"));
  } });
  call.area = h("div", { class: "side-area" });

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

  call.screen = h(
    "section",
    { class: "screen incall" },
    faceEl,
    h("header", { class: "top" }, h("span", { class: "live" }), h("b", {}, "Eddy"), call.clock),
    call.area,
    call.stage,
    h("div", { class: "captions" }, call.you, call.says, call.status),
    typeBox,
    gamesMenu,
    h("div", { class: "controls" }, gamesBtn, muteBtn, h("button", { class: "hangup", title: "Desligar", html: PHONE, onclick: () => hangUp() }), keysBtn, themeBtn),
    call.news,
  );
  show(call.screen);
}

// ── o que o Eddy faz na tela: jogos, imagens, visual ──────────────────────────

/** O rosto vai para o canto enquanto há tabuleiro ou imagem na tela. */
function refreshSide() {
  call.screen?.classList.toggle("side", !!call.area?.childElementCount);
}

/**
 * Uma fala curta do Eddy sem a pessoa ter falado (comentário do jogo, fim de
 * partida). Entra na vez do laço: se ele estiver ouvindo, para de ouvir, fala e
 * volta — nunca fala por cima do microfone aberto.
 */
function interject(line: string) {
  if (!line || !call.active) return;
  call.interject.push(line);
  if (call.listening) B.cancelHear();
  call.unmute?.(); // acorda o laço parado no mudo; ele volta ao mudo depois de falar
}

const gameHost: GameHost = {
  thinking(on) {
    if (!call.face || speech.speaking) return;
    call.face.state = on ? "think" : call.listening ? "listen" : "idle";
  },
  comment(pool, important) {
    if (!important && (speech.speaking || call.interject.length)) return; // não amontoa falas
    interject(sceneFallback(scenes, pool));
  },
  sfx(kind) {
    ringer?.sfx(kind);
  },
  end(o) {
    if (call.face) {
      call.face.expression = o === "won" ? "proud" : o === "lost" ? "angry" : "skeptical";
      if (o === "lost") call.face.glitch(0.9); // péssimo perdedor
    }
    if (o === "won") ringer?.fanfare();
    const kind = `game_${o}` as SceneKind;
    const gen = call.gen;
    void B.sceneLine(kind, profile!)
      .catch(() => sceneFallback(scenes, kind))
      .then((line) => gen === call.gen && interject(line));
  },
};

const START_POOL: Record<Exclude<GameKind, "made">, string> = { chess: "g_start", checkers: "g_start", fight: "f_start", duel: "d_start" };

function openGame(kind: Exclude<GameKind, "made">, announce: boolean) {
  mountGame(createGame(kind, gameHost), announce ? START_POOL[kind] : null);
}

/** O Eddy programa um jogo na hora e ele roda no painel. */
function openMade(idea: string) {
  mountGame(makeGame(idea), null);
}

/** O jogo começa a ser programado já aqui; aparecer na tela é com `mountGame`. */
function makeGame(idea: string) {
  return new MadeGame(idea, gameHost, {
    make: (i, onToken, fix) => B.makeGame(i, profile!, onToken, fix),
    host: (html) => B.hostGame(html),
    theme: faceTheme,
    slow: !B.web,
  });
}

function mountGame(g: GameSession, pool: string | null) {
  if (!call.area) return;
  call.game?.el.remove();
  call.game?.close();
  call.game = g;
  g.el.querySelector(".panel-head")!.append(h("button", { type: "button", class: "ghost", title: "Sair do jogo", onclick: () => closeGame(true) }, "×"));
  call.area.prepend(g.el);
  refreshSide();
  // microfone pausado: ninguém fala por cima do lance, e o Scribe não fica aberto à toa
  call.setMuted(true);
  setStatus("Sua vez. Microfone pausado no jogo — toque no 🎤 para falar com ele.");
  if (pool) interject(sceneFallback(scenes, pool));
}

function closeGame(byUser: boolean) {
  const g = call.game;
  if (!g) return;
  g.close();
  g.el.remove();
  call.game = null;
  refreshSide();
  if (byUser && g.started) {
    const gen = call.gen;
    void B.sceneLine("game_quit", profile!)
      .catch(() => sceneFallback(scenes, "game_quit"))
      .then((line) => gen === call.gen && interject(line));
  }
}

function closeGallery() {
  call.gallery?.remove();
  call.gallery = null;
  refreshSide();
}

async function showImages(q: string, search: Promise<Pic[]> = searchImages(q)) {
  if (!call.area) return;
  const gen = call.gen;
  // o painel abre já procurando: a pessoa vê que o Eddy está atrás da imagem
  closeGallery();
  const g = galleryPanel(q, closeGallery);
  call.gallery = g.el;
  call.area.append(g.el);
  refreshSide();
  let pics: Pic[] = [];
  let why = "";
  try {
    pics = await search;
  } catch (e) {
    why = (e as Error).message;
  }
  if (gen !== call.gen || call.gallery !== g.el) return; // desligou ou fechou o painel
  const found = pics.length > 0 && (await g.prepare(pics));
  // a cena: ele termina o "procurando…", faz uma pausa de suspense, e só então
  // a imagem aparece (já carregada) e ele se gaba — ou admite que não achou
  while (gen === call.gen && (call.asking || speech.speaking)) await sleep(150);
  await sleep(1300);
  if (gen !== call.gen || call.gallery !== g.el) return;
  if (found) {
    g.reveal();
    interject(sceneFallback(scenes, "img_found"));
    return;
  }
  g.empty(why ? `Não deu: ${why}.` : "Nada encontrado.");
  interject(sceneFallback(scenes, "img_none"));
  window.setTimeout(() => call.gallery === g.el && closeGallery(), 4000);
}

/**
 * Uma ação pedida na fala. O trabalho pesado já começa (a busca da imagem, o
 * código do jogo), mas a tela só muda quando o Eddy TERMINA de falar: a função
 * devolvida é o que acontece nessa hora.
 */
function prepareAction(a: Action): { run: () => void; drop?: () => void } {
  if (a.kind === "image") {
    if (a.blocked) return { run: () => {} };
    const found = searchImages(a.query);
    found.catch(() => {}); // o erro aparece no painel, quando ele abrir
    return { run: () => void showImages(a.query, found) };
  }
  if (a.kind === "make") {
    const g = makeGame(a.idea);
    return { run: () => mountGame(g, null), drop: () => g.close() };
  }
  if (a.kind === "game") return { run: () => openGame(a.game, false) };
  return { run: () => setTheme(a.to) };
}

async function loop() {
  while (call.active) {
    if (call.interject.length) {
      await say(call.interject.shift()!);
      if (call.face && call.face.state === "speak") call.face.state = "idle";
      continue;
    }
    let text = call.typed;
    call.typed = "";
    if (!text) {
      if (call.muted) {
        setFace("idle", call.game ? "Sua vez. Microfone pausado no jogo — toque no 🎤 para falar." : "Microfone mudo — o Eddy está esperando (e julgando).");
        await new Promise<void>((r) => (call.unmute = r));
        call.unmute = null;
        continue;
      }
      setFace("listen", "Pode falar…");
      call.listening = true;
      try {
        text = await B.hear({
          lang: lang(),
          onPartial: (t) => call.you && call.face?.state === "listen" && (call.you.textContent = t),
          onLevel: (l) => call.face && (call.face.level = l),
        });
      } catch (e) {
        call.listening = false;
        setFace("error", "Microfone: " + (e as Error).message);
        await sleep(2000);
        continue;
      }
      call.listening = false;
      if (!call.active) break;
      if (call.typed || call.interject.length) continue; // digitou, ou o Eddy tem algo a dizer
      if (!text) {
        if (call.muted || call.game) continue; // no jogo, pensar calado não é silêncio
        call.silences++;
        if (call.silences === 2 || call.silences === 4) {
          const line = await B.silence(profile!, false);
          if (!call.active) break;
          await say(line);
        }
        if (call.silences >= 6) {
          const bye = await B.silence(profile!, true);
          if (!call.active) break;
          await say(bye);
          hangUp({ slam: true, title: "O Eddy desligou. Você demorou demais." });
        }
        continue;
      }
    }
    call.silences = 0;
    const event = await ask(text);
    if (event && call.active) await runScene(event);
  }
}

/** Mostra um selo no palco da ligação (REC, gelo…) por um tempo. */
function badge(text: string, cls: string, ms: number) {
  if (!call.stage) return;
  const el = h("div", { class: `badge ${cls}` }, text);
  call.stage.append(el);
  window.setTimeout(() => el.remove(), ms);
}

/** Depois da fala da pessoa disparar uma cena, o Eddy encena o resto. */
async function runScene(kind: SceneKind) {
  switch (kind) {
    case "bye":
      if (call.face) call.face.expression = "angry";
      await sleep(350);
      hangUp({
        slam: true,
        title: "O Eddy desligou na sua cara.",
        then: () => window.setTimeout(() => incoming({ kind: "bye_callback", title: "Eddy está ligando… de novo", after: "hangup" }), 2200),
      });
      return;
    case "insult":
      call.face?.glitch(2.6);
      ringer?.staticBurst(1800);
      setStatus("Sinal… fra… co…");
      await sleep(1900);
      hangUp({
        title: "Ligação perdida",
        quiet: true,
        then: () => window.setTimeout(() => incoming({ kind: "insult_callback", title: "Eddy está ligando…", after: "continue" }), 1200),
      });
      return;
    case "rival": {
      if (call.face) call.face.expression = "annoyed";
      setFace("idle", "");
      const silent = sceneFallback(scenes, "silent" as SceneKind) || "O Eddy não está falando com você.";
      badge(`🧊 ${silent}`, "ice", 7000);
      await sleep(7000);
      if (!call.active) return;
      setFace("think", "");
      await say(await B.sceneLine("rival_return", profile!).catch(() => sceneFallback(scenes, "rival_return")));
      return;
    }
    case "praise":
      ringer?.fanfare();
      badge("● REC — gravando para a posteridade", "rec", 4500);
      if (call.face) call.face.expression = "proud";
      await sleep(1200);
      return;
    default:
      return;
  }
}

/** Cena "hold": às vezes (depois de umas perguntas) ele põe na espera antes de responder. */
function shouldHold() {
  return call.turns >= 3 && !call.heldOnce && !call.game && Math.random() < 0.13;
}

async function ask(text: string): Promise<SceneKind | undefined> {
  call.asking = true;
  try {
    return await askInner(text);
  } finally {
    call.asking = false;
  }
}

async function askInner(text: string): Promise<SceneKind | undefined> {
  call.turns++;
  call.you!.textContent = text;
  call.says!.textContent = "";
  setFace("think", "Pensando… (ele finge que é difícil)");
  // A chamada a que este turno pertence. Se desligar ou ligar outra vez, o que
  // chegar depois é de uma chamada que já não está no ecrã: não entra na legenda,
  // não fala, não troca a voz.
  const minha = call.gen;
  let pending = "";
  let full = "";
  // em espera, as frases da resposta ficam guardadas até a musiquinha acabar
  let holding = false;
  const deferred: string[] = [];
  const speak = (s: string) => (holding ? deferred.push(s) : speech.say(s));
  let hold: Promise<void> = Promise.resolve();
  if (shouldHold()) {
    call.heldOnce = true;
    holding = true;
    hold = (async () => {
      await say(sceneFallback(scenes, "hold"));
      setFace("idle", "♪ Em espera… ♪");
      if (call.face) call.face.expression = "smug";
      ringer?.holdMusic(true);
      await sleep(5500);
      ringer?.holdMusic(false);
      if (call.gen !== minha) return;
      call.says!.textContent = "";
      speech.say(sceneFallback(scenes, "hold_back"));
      holding = false;
      for (const s of deferred.splice(0)) speech.say(s);
    })();
  }
  // as ações esperam a fala acabar (senão a tela muda no meio da frase)
  const later: { run: () => void; drop?: () => void }[] = [];
  try {
    const onAction = (a: Action) => call.gen === minha && later.push(prepareAction(a));
    const out = await B.turn(text, profile!, (tok) => {
      if (call.gen !== minha) return;
      full += tok;
      pending += tok;
      if (!holding) call.says!.textContent = caption(full);
      const m = pending.match(/^([\s\S]*?[.!?…])(\s+)([\s\S]*)$/);
      if (m && m[1].length > 12) {
        speak(m[1]);
        pending = m[3];
      }
    }, { onAction, context: call.game?.context() ?? "" });
    if (call.gen !== minha) return undefined;
    if (pending.trim()) speak(pending);
    await hold;
    if (call.gen !== minha) return undefined;
    call.says!.textContent = caption(full);
    if (out.news) renderNews(out.news);
    if (out.settings) voice = out.settings.voice;
    await speech.idle();
    if (later.length) await sleep(350); // um respiro entre a frase e a tela mudar
    if (call.gen !== minha) return undefined;
    for (const a of later.splice(0)) a.run();
    return out.event;
  } catch (e) {
    ringer?.holdMusic(false);
    setFace("error", "Erro: " + (e as Error).message);
    await sleep(2500);
    return undefined;
  } finally {
    for (const a of later) a.drop?.(); // não chegou a aparecer (desligou, erro): descarta
  }
}

interface HangUpOptions {
  title?: string;
  /** desligou com raiva: pancada no telefone */
  slam?: boolean;
  /** caiu a ligação: sem bipe */
  quiet?: boolean;
  /** o que vem depois da tela de encerrada (padrão: tela inicial) */
  then?: () => void;
}

function hangUp(o: HangUpOptions = {}) {
  if (!call.active) return;
  call.active = false;
  call.gen++; // o que ainda vier desta chamada é resposta velha
  call.game?.close();
  call.game = null;
  call.gallery = null;
  call.interject = [];
  speech.stop();
  ringer?.stop();
  ringer?.holdMusic(false);
  if (o.slam) ringer?.slam();
  else if (!o.quiet) ringer?.beep(false);
  B.cancelHear();
  B.closeMic();
  call.unmute?.();
  window.clearInterval(call.timer);
  const dur = call.started ? mmss(Date.now() - call.started) : "";
  call.started = 0;
  call.face = null;
  stopFace?.();
  show(h("section", { class: `screen center ended ${o.slam ? "slammed" : ""}` }, h("h2", {}, o.title ?? "Chamada encerrada"), dur ? h("p", { class: "muted" }, dur) : null));
  setTimeout(() => !call.active && (o.then ? o.then() : homeScreen()), 1600);
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
  applyTheme(profile?.tema ?? "holo");
  if (!profile) return profileScreen(true);
  await B.setProfile(profile, undefined, username || undefined);
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
