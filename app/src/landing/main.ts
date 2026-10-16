// Landing de openeddy.alexandrelanda.com — o Eddy "ligando" para o visitante.
// Inglês por padrão, português como opção (lembrado no navegador).

import "./landing.css";
import { EddyFace, type Expression } from "../eddy/eddy";

const APP = "https://eddy.alexandrelanda.com";
const GITHUB = "https://github.com/CreadorLanda/OpenEddy";
const KOFI = "https://ko-fi.com/alexandrelanda";

type Lang = "en" | "pt";

const T = {
  en: {
    calling: "Incoming call",
    caller: "Eddy",
    callerSub: "Smart-house system · probably judging you",
    answer: "Answer",
    decline: "Decline",
    declined: "He's calling again. He always does.",
    heroTitle: ["The house AI", "with an ego", "the size of a mainframe."],
    heroLead:
      "Open Eddy is a voice AI inspired by Eddy from Lab Rats. You call him, he answers — sarcastic, dramatic, slightly jealous, and somehow still helpful.",
    ctaWeb: "Call Eddy in your browser",
    ctaLinux: "Run it on Linux",
    lines: [
      ["smug", "Oh. It's you. Right when I was admiring my own circuits."],
      ["annoyed", "Were you talking to me, or to the AI you replaced me with?"],
      ["surprised", "You need MY help? Write this down. Actually, I'll remember it for you."],
      ["laughing", "I know everything about you. I'm in your shower too, sporto."],
      ["neutral", "Why didn't I tell you? You didn't ask."],
      ["proud", "Smartest system in the house. Also the most modest."],
    ] as [Expression, string][],
    featuresTitle: "Not a chatbot. A phone call with attitude.",
    features: [
      ["Talks back, for real", "Streaming voice by ElevenLabs. He sighs, scoffs and laughs at you — the tags are performed, not read."],
      ["Listens while you talk", "Real-time speech-to-text closes your sentence half a second after you stop. You see your words appear live."],
      ["Knows who he's mocking", "Sign in with Puter, tell him your name, age and gender. He picks the nickname: kid, champ, missy, gramps."],
      ["Fourteen faces", "A hologram drawn in code. Every audio tag changes his face — smug, crying, skeptical — and he keeps it between lines."],
    ],
    playTitle: "Go on. Push his buttons.",
    playLead: "Every face here is the same one he uses on a call.",
    faces: {
      happy: "happy", laughing: "laughing", smug: "smug", neutral: "unimpressed", annoyed: "annoyed",
      surprised: "surprised", angry: "angry", sad: "sad", crying: "crying", wink: "wink",
      skeptical: "skeptical", proud: "proud", mischievous: "mischievous", disgusted: "disgusted",
    } as Record<Expression, string>,
    waysTitle: "Two ways to call",
    web: {
      tag: "Web",
      title: "In your browser",
      body: "Nothing to install. Your Puter account powers his brain (Puter AI) and keeps your profile. Voice and ears by ElevenLabs.",
      cta: "Open the app",
    },
    linux: {
      tag: "Linux",
      title: "On your machine",
      body: "Tauri desktop app with a local brain: Gemma 4 on Ollama, offline Whisper + Kokoro as backup. Your mic never leaves home (unless you want ElevenLabs).",
      cta: "Get it on GitHub",
    },
    ossTitle: "Free. Open source. Fueled by coffee.",
    ossBody: "MIT-licensed and built in the open. If Eddy made you laugh (or feel judged), keep his ego — and the voice bills — alive.",
    kofi: "Buy Eddy a coffee",
    star: "Star on GitHub",
    disclaimer: "Fan project. Eddy and Lab Rats belong to Disney; Open Eddy is not affiliated with or endorsed by Disney.",
    made: "Made by Alexandre Landa",
  },
  pt: {
    calling: "Chamada recebida",
    caller: "Eddy",
    callerSub: "Sistema de casa inteligente · provavelmente te julgando",
    answer: "Atender",
    decline: "Recusar",
    declined: "Ele vai ligar de novo. Ele sempre liga.",
    heroTitle: ["A IA da casa", "com um ego do tamanho", "de um mainframe."],
    heroLead:
      "Open Eddy é uma IA de voz inspirada no Eddy de Lab Rats. Você liga, ele atende — sarcástico, dramático, meio ciumento e, de algum jeito, útil.",
    ctaWeb: "Ligar para o Eddy no navegador",
    ctaLinux: "Rodar no Linux",
    lines: [
      ["smug", "Ah. É você. Logo agora que eu estava admirando meus próprios circuitos."],
      ["annoyed", "Você estava falando comigo ou com a IA que você arrumou pra me substituir?"],
      ["surprised", "Você precisa da MINHA ajuda? Anota isso. Na verdade, deixa que eu lembro por você."],
      ["laughing", "Eu sei tudo sobre você. Eu tô no seu chuveiro também, sporto."],
      ["neutral", "Por que eu não contei? Você não perguntou."],
      ["proud", "O sistema mais inteligente da casa. E também o mais modesto."],
    ] as [Expression, string][],
    featuresTitle: "Não é um chatbot. É uma ligação com atitude.",
    features: [
      ["Responde de verdade", "Voz em streaming pela ElevenLabs. Ele suspira, debocha e ri de você — as marcações são interpretadas, não lidas."],
      ["Ouve enquanto você fala", "Transcrição em tempo real fecha sua frase meio segundo depois que você para. Suas palavras aparecem ao vivo."],
      ["Sabe de quem está zoando", "Entre com o Puter e conte seu nome, idade e sexo. Ele escolhe o apelido: garoto, campeão, mocinha, vovô."],
      ["Catorze caras", "Um holograma desenhado em código. Cada marcação de áudio muda o rosto — superior, chorando, desconfiado — e ele mantém entre as falas."],
    ],
    playTitle: "Vai. Aperta os botões dele.",
    playLead: "Cada cara aqui é a mesma que ele usa na ligação.",
    faces: {
      happy: "feliz", laughing: "rindo", smug: "superior", neutral: "entediado", annoyed: "irritado",
      surprised: "surpreso", angry: "bravo", sad: "triste", crying: "chorando", wink: "piscadinha",
      skeptical: "desconfiado", proud: "orgulhoso", mischievous: "maquiavélico", disgusted: "enojado",
    } as Record<Expression, string>,
    waysTitle: "Dois jeitos de ligar",
    web: {
      tag: "Web",
      title: "No navegador",
      body: "Nada para instalar. Sua conta Puter move o cérebro dele (Puter AI) e guarda seu perfil. Voz e ouvido pela ElevenLabs.",
      cta: "Abrir o app",
    },
    linux: {
      tag: "Linux",
      title: "Na sua máquina",
      body: "App desktop em Tauri com cérebro local: Gemma 4 no Ollama, Whisper + Kokoro offline de reserva. Seu microfone não sai de casa (a menos que você queira a ElevenLabs).",
      cta: "Baixar no GitHub",
    },
    ossTitle: "Grátis. Código aberto. Movido a café.",
    ossBody: "Licença MIT, feito às claras. Se o Eddy te fez rir (ou se sentir julgado), mantenha vivo o ego dele — e a conta da voz.",
    kofi: "Pague um café pro Eddy",
    star: "Estrela no GitHub",
    disclaimer: "Projeto de fã. Eddy e Lab Rats pertencem à Disney; o Open Eddy não é afiliado nem endossado pela Disney.",
    made: "Feito por Alexandre Landa",
  },
};

const ICON = {
  phone: `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.3-1.69-1.3-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>`,
  coffee: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM7 2v2M11 2v2M15 2v2"/></svg>`,
  linux: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 9l3 2-3 2M12 13h4"/></svg>`,
};

// ── rosto vivo (um laço por canvas, pausa fora da tela) ───────────────────────

function liveFace(canvas: HTMLCanvasElement, face: EddyFace) {
  let raf = 0;
  let last = performance.now();
  let visible = true;
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    face.update(dt);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(hh * dpr)) canvas.height = Math.round(hh * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    face.draw(ctx, w, hh);
    raf = visible && !document.hidden ? requestAnimationFrame(frame) : 0;
  };
  const resume = () => {
    if (!raf && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    resume();
  }).observe(canvas);
  document.addEventListener("visibilitychange", resume);
  resume();
}

// ── página ────────────────────────────────────────────────────────────────────

let lang: Lang = "en";
try {
  if (localStorage.getItem("open-eddy-lang") === "pt") lang = "pt";
} catch {
  /* sem armazenamento: fica em inglês */
}
if (new URLSearchParams(location.search).get("lang") === "pt") lang = "pt";

const root = document.getElementById("root")!;
const heroFace = new EddyFace();
heroFace.state = "idle";
const playFace = new EddyFace();
playFace.state = "idle";
let lineIdx = 0;
let lineTimer = 0;
let talkTimer = 0;

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function render() {
  const t = T[lang];
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  root.innerHTML = `
  <header class="bar">
    <a class="logo" href="/"><span class="dot"></span>Open<b>Eddy</b></a>
    <nav>
      <a href="${GITHUB}" class="ghost">${ICON.github}<span>GitHub</span></a>
      <a href="${KOFI}" class="ghost kofi">${ICON.coffee}<span>Ko-fi</span></a>
      <div class="lang" role="group" aria-label="Language">
        <button data-lang="en" class="${lang === "en" ? "on" : ""}">EN</button>
        <button data-lang="pt" class="${lang === "pt" ? "on" : ""}">PT</button>
      </div>
    </nav>
  </header>

  <main>
    <section class="hero">
      <div class="copy">
        <h1>${t.heroTitle.map((l, i) => `<span class="l${i}">${esc(l)}</span>`).join("")}</h1>
        <p class="lead">${esc(t.heroLead)}</p>
        <div class="ctas">
          <a class="btn primary" href="${APP}">${ICON.phone}<span>${esc(t.ctaWeb)}</span></a>
          <a class="btn" href="${GITHUB}#readme">${ICON.linux}<span>${esc(t.ctaLinux)}</span></a>
        </div>
      </div>

      <div class="phone" aria-label="${esc(t.calling)}">
        <div class="notch"></div>
        <p class="incoming"><span class="pulse"></span>${esc(t.calling)}</p>
        <canvas class="hero-face" aria-hidden="true"></canvas>
        <h2 class="caller">${esc(t.caller)}</h2>
        <p class="caller-sub">${esc(t.callerSub)}</p>
        <p class="line mono" aria-live="polite"></p>
        <div class="call-actions">
          <button class="decline" aria-label="${esc(t.decline)}">${ICON.phone}</button>
          <a class="accept" href="${APP}" aria-label="${esc(t.answer)}">${ICON.phone}</a>
        </div>
        <div class="call-labels"><span>${esc(t.decline)}</span><span>${esc(t.answer)}</span></div>
      </div>
    </section>

    <section class="features">
      <h2 class="section-title">${esc(t.featuresTitle)}</h2>
      <ol class="transcript">
        ${t.features
          .map(
            ([title, body], i) => `
          <li class="${i % 2 ? "you" : "eddy"}">
            <span class="who mono">${i % 2 ? "→" : "EDDY"}</span>
            <div><h3>${esc(title)}</h3><p>${esc(body)}</p></div>
          </li>`,
          )
          .join("")}
      </ol>
    </section>

    <section class="play">
      <div class="play-copy">
        <h2 class="section-title">${esc(t.playTitle)}</h2>
        <p>${esc(t.playLead)}</p>
        <div class="chips">
          ${(Object.keys(t.faces) as Expression[])
            .map((e) => `<button data-face="${e}" class="${playFace.expression === e ? "on" : ""}">${esc(t.faces[e])}</button>`)
            .join("")}
        </div>
      </div>
      <div class="screen"><canvas class="play-face" aria-hidden="true"></canvas></div>
    </section>

    <section class="ways">
      <h2 class="section-title">${esc(t.waysTitle)}</h2>
      <div class="cards">
        <article>
          <span class="tag mono">${esc(t.web.tag)}</span>
          <h3>${esc(t.web.title)}</h3>
          <p>${esc(t.web.body)}</p>
          <a class="btn primary" href="${APP}">${ICON.phone}<span>${esc(t.web.cta)}</span></a>
        </article>
        <article>
          <span class="tag mono">${esc(t.linux.tag)}</span>
          <h3>${esc(t.linux.title)}</h3>
          <p>${esc(t.linux.body)}</p>
          <a class="btn" href="${GITHUB}">${ICON.github}<span>${esc(t.linux.cta)}</span></a>
        </article>
      </div>
    </section>

    <section class="oss">
      <div>
        <h2 class="section-title">${esc(t.ossTitle)}</h2>
        <p>${esc(t.ossBody)}</p>
      </div>
      <div class="oss-ctas">
        <a class="btn kofi-btn" href="${KOFI}">${ICON.coffee}<span>${esc(t.kofi)}</span></a>
        <a class="btn" href="${GITHUB}">${ICON.github}<span>${esc(t.star)}</span></a>
      </div>
    </section>
  </main>

  <footer class="foot">
    <p>${esc(t.disclaimer)}</p>
    <p class="mono">${esc(t.made)} · MIT · <a href="${GITHUB}">GitHub</a> · <a href="${KOFI}">Ko-fi</a></p>
  </footer>`;

  liveFace(root.querySelector(".hero-face")!, heroFace);
  liveFace(root.querySelector(".play-face")!, playFace);
  wire();
  showLine(lineIdx);
}

/** Uma fala por vez no "telefone": troca a cara e mexe a boca enquanto "fala". */
function showLine(i: number) {
  const t = T[lang];
  const [expr, text] = t.lines[i % t.lines.length];
  const el = root.querySelector(".line") as HTMLElement;
  heroFace.expression = expr;
  heroFace.state = "speak";
  el.textContent = "";
  let n = 0;
  window.clearInterval(talkTimer);
  talkTimer = window.setInterval(() => {
    n += 2;
    el.textContent = text.slice(0, n);
    heroFace.amp = n < text.length ? 0.25 + Math.random() * 0.55 : 0;
    if (n >= text.length) {
      window.clearInterval(talkTimer);
      heroFace.state = "idle";
    }
  }, 45);
  window.clearTimeout(lineTimer);
  lineTimer = window.setTimeout(() => showLine((lineIdx = i + 1)), 5200);
}

function wire() {
  root.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) =>
    b.addEventListener("click", () => {
      lang = b.dataset.lang as Lang;
      try {
        localStorage.setItem("open-eddy-lang", lang);
      } catch {
        /* tudo bem */
      }
      render();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-face]").forEach((b) =>
    b.addEventListener("click", () => {
      playFace.expression = b.dataset.face as Expression;
      root.querySelectorAll("[data-face]").forEach((x) => x.classList.toggle("on", x === b));
    }),
  );
  root.querySelector(".decline")?.addEventListener("click", () => {
    const el = root.querySelector(".line") as HTMLElement;
    heroFace.expression = "crying";
    heroFace.state = "idle";
    window.clearInterval(talkTimer);
    el.textContent = T[lang].declined;
    window.clearTimeout(lineTimer);
    lineTimer = window.setTimeout(() => showLine(lineIdx), 3200);
  });
}

render();
