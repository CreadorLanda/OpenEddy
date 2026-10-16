// Open Eddy — entra com Puter, conta quem você é, e liga para o Eddy.
//
// Telas: login → perfil (só na primeira vez) → início (botão de ligar) →
// chamando → em ligação (mãos livres: ouve, pensa, fala, ouve…) → encerrada.

import "../core/theme.css";
import "./eddy.css";
import { Api, Native, subscribe, type NewsItem } from "../core/api";
import { h, externalLinks } from "../core/dom";
import type { Profile } from "../core/types";
import { EddyFace, expressionForTag, type Expression, type FaceState } from "./eddy";
import { Ringer } from "./ring";
import * as Puter from "./puter";

const root = document.getElementById("root")!;
externalLinks(root, Native.openUrl);

let username = "";
let profile: Profile | null = null;
let voice = "pm_alex";
let voices: Record<string, string> = { pm_alex: "Alex (masculina)" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
let queue: { res: Promise<Response | null>; expr: Expression | null }[] = [];
let running = false;
let token = 0;
let idleWaiters: (() => void)[] = [];
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
  if (!analyser || !active.size) return 0;
  analyser.getFloatTimeDomainData(ampBuf);
  let sum = 0;
  for (const v of ampBuf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / ampBuf.length) * 5);
}

/** Texto para a legenda: sem [sighs], markdown nem links. */
function caption(text: string) {
  return voiceText(text).replace(/\[[^\]]{1,30}\]/g, "").replace(/\s+/g, " ").trim();
}

/** Texto para a voz: mantém as marcações [sighs]/[laughs], que a ElevenLabs interpreta. */
function voiceText(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\*[^*]+\*/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A primeira marcação da frase ([sarcastic], [gasps]…) decide a cara do Eddy. */
function exprOf(text: string): Expression | null {
  for (const m of text.matchAll(/\[([^\]]{1,30})\]/g)) {
    const e = expressionForTag(m[1]);
    if (e) return e;
  }
  return null;
}

function enqueue(res: Promise<Response | null>, text: string) {
  queue.push({ res, expr: exprOf(text) });
  if (!running) void drain();
}

function queueSpeech(text: string) {
  const t = voiceText(text);
  if (caption(t)) enqueue(Api.ttsStream(t, voice).catch(() => null), t);
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
    if (my === token) await schedule(buf);
    return;
  }
  const rate = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
  const minBytes = Math.round(rate * 0.12) * 2;
  const reader = res.body.getReader();
  let pend = new Uint8Array(0);
  let last: Promise<void> = Promise.resolve();
  for (;;) {
    const { value, done } = await reader.read();
    if (my !== token) {
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

async function drain() {
  running = true;
  const my = token;
  while (queue.length && my === token) {
    const item = queue.shift()!;
    const res = await item.res;
    if (!res || !res.ok || my !== token) continue;
    if (call.face) {
      call.face.state = "speak";
      if (item.expr) call.face.expression = item.expr;
    }
    setStatus("Eddy falando… (Espaço interrompe)");
    try {
      await play(res, my);
    } catch {
      /* uma frase perdida não derruba a ligação */
    }
  }
  if (my === token) running = false;
  if (!running) for (const w of idleWaiters.splice(0)) w();
}

/** Resolve quando o Eddy termina de falar tudo o que está na fila. */
function speechIdle(): Promise<void> {
  if (!running && !queue.length) return Promise.resolve();
  return new Promise((r) => idleWaiters.push(r));
}

function stopSpeech() {
  token++;
  queue = [];
  for (const src of active) {
    try {
      src.stop();
    } catch {
      /* já parou */
    }
  }
  active.clear();
  nextAt = 0;
  running = false;
  for (const w of idleWaiters.splice(0)) w();
}

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
      h("p", { class: "tagline" }, "O Eddy de Lab Rats no seu computador. Egocêntrico, sarcástico e (às vezes) útil."),
      btn,
      err,
      h("p", { class: "fine" }, "Sua conta Puter guarda seu perfil. A conversa, a voz e o cérebro do Eddy rodam no seu PC."),
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
        await Promise.all([Api.profile(next), Api.config({ voice })]);
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
    h("label", {}, "Voz do Eddy"), voiceSel,
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
  stopSpeech();
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
  let hello: Promise<Response | null> = Promise.resolve(null);
  try {
    const r = await Api.callStart();
    greeting = r.text;
    voice = r.voice;
    // o "alô" já começa a chegar enquanto ainda toca
    hello = Api.ttsStream(voiceText(greeting), voice).catch(() => null);
    await Promise.all([hello, sleep(Math.max(0, 3300 - (performance.now() - t0)))]);
  } catch (e) {
    ringer!.stop();
    call.active = false;
    homeScreen("Ninguém atendeu: " + (e as Error).message);
    return;
  }
  if (!call.active) return;
  ringer!.stop();
  ringer!.beep(true);

  inCallScreen();
  call.says!.textContent = caption(greeting);
  enqueue(hello, greeting);
  await speechIdle();
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
    if (call.muted) void Api.listenCancel();
    else call.unmute?.();
  });

  const input = h("input", { placeholder: "Digite e aperte Enter…" }) as HTMLInputElement;
  const typeBox = h("form", { class: "typebox", onsubmit: (ev: Event) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    call.typed = text;
    void Api.listenCancel(); // solta o microfone; o laço pega o texto digitado
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
    if (running) stopSpeech();
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
        text = (await Api.listen(15)).text;
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
          const { text: line } = await Api.callSilence();
          if (!call.active) break;
          call.says!.textContent = caption(line);
          queueSpeech(line);
          await speechIdle();
        }
        if (call.silences >= 6) {
          const { text: bye } = await Api.callSilence(true);
          if (!call.active) break;
          call.says!.textContent = caption(bye);
          queueSpeech(bye);
          await speechIdle();
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
    await Api.turn(text, (ev) => {
      if (!call.active) return;
      if (ev.type === "token") {
        const tok = String(ev.token);
        full += tok;
        pending += tok;
        call.says!.textContent = caption(full);
        const m = pending.match(/^([\s\S]*?[.!?…])(\s+)([\s\S]*)$/);
        if (m && m[1].length > 12) {
          queueSpeech(m[1]);
          pending = m[3];
        }
      } else if (ev.type === "done") {
        if (pending.trim()) queueSpeech(pending);
        pending = "";
        const extra = ev as { news?: NewsItem[]; settings?: { voice: string } };
        if (extra.news) renderNews(extra.news);
        if (extra.settings) voice = extra.settings.voice;
      } else if (ev.type === "error") {
        throw new Error(String(ev.error));
      }
    });
    await speechIdle();
  } catch (e) {
    setFace("error", "Erro: " + (e as Error).message);
    await sleep(2500);
  }
}

function hangUp() {
  if (!call.active) return;
  call.active = false;
  stopSpeech();
  ringer?.stop();
  ringer?.beep(false);
  void Api.listenCancel();
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
    if (running) {
      ev.preventDefault();
      stopSpeech();
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
  await Api.profile(profile);
  homeScreen();
}

async function boot() {
  show(h("section", { class: "screen center" }, brand(), h("p", { class: "muted" }, "Ligando os circuitos…")));
  void subscribe((ev) => {
    if (ev.type === "voice.level" && call.face) call.face.level = ev.level;
    if (ev.type === "voice.partial" && call.you && call.face?.state === "listen") call.you.textContent = ev.text;
    if (ev.type === "voice.error") setStatus("Voz da ElevenLabs falhou — usando a voz local. (" + ev.error.slice(0, 80) + ")");
  });
  ready = Promise.all([Api.meta(), Api.health()])
    .then(([meta, health]) => {
      voices = meta.voices;
      voice = meta.eddy.voice;
      if (!health.ollama) healthNote = "O Ollama não está rodando — o núcleo está tentando subir o bin/ollama.";
      else if (!health.model_ready) healthNote = `Modelo ${health.model} não instalado: ./bin/ollama pull ${health.model}`;
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
