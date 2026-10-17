// A cara do Eddy (Lab Rats): o "E" com rosto, desenhado em Canvas como um
// holograma. Espaço de desenho 360×340, o mesmo de scripts/gen_icons.py.
//
// A EXPRESSÃO é o rosto (olhos, sobrancelhas, boca) e dura entre as falas: só
// muda quando uma marcação de áudio pede ([sarcastic], [gasps]…). O ESTADO só
// acrescenta sinais por cima, sem trocar o rosto:
//   listen → anéis com o nível do microfone e a cabeça um pouco inclinada
//   think  → pontos em órbita e o olhar que passeia
//   speak  → a boca abre com o áudio, no formato da expressão
//   error  → vermelho e cara irritada

export type FaceState = "idle" | "listen" | "think" | "speak" | "error" | "offline";
export type Expression =
  | "happy" | "laughing" | "smug" | "neutral" | "annoyed" | "surprised"
  | "angry" | "sad" | "crying" | "wink" | "skeptical" | "proud" | "mischievous" | "disgusted";

interface ExprCfg {
  lid: [number, number]; // por olho: 1 = cúpula inteira, ~0 = linha reta
  brow?: [number, number]; // inclinação da sobrancelha (rad); + = ponta de dentro para baixo (bravo)
  mouth: number; // escala do D (negativo = virado)
  round?: number; // 1 = boca em O
  width?: number; // largura da boca (1 = normal)
  tilt?: number; // boca torta (rad) — sorriso de canto
  lift?: number; // cabeça erguida (px, negativo = para cima)
  tears?: boolean;
}

export const EXPRESSIONS: Record<Expression, ExprCfg> = {
  happy: { lid: [1, 1], mouth: 1 },
  laughing: { lid: [0.85, 0.85], mouth: 1.15, width: 1.05 },
  smug: { lid: [0.42, 0.42], mouth: 0.5 },
  neutral: { lid: [0.1, 0.1], mouth: 0.05 },
  annoyed: { lid: [0.22, 0.22], mouth: -0.32, width: 0.62 },
  surprised: { lid: [1, 1], mouth: 0.3, round: 1 },
  angry: { lid: [0.5, 0.5], brow: [0.38, -0.38], mouth: -0.42, width: 0.7 },
  sad: { lid: [0.6, 0.6], brow: [-0.32, 0.32], mouth: -0.5, width: 0.7 },
  crying: { lid: [1, 1], brow: [-0.36, 0.36], mouth: -0.5, width: 0.75, tears: true },
  wink: { lid: [1, 0.06], mouth: 0.75, tilt: 0.12 },
  skeptical: { lid: [1, 0.32], brow: [0, -0.3], mouth: 0.08, width: 0.6, tilt: -0.16 },
  proud: { lid: [1, 1], mouth: 0.85, lift: -7 },
  mischievous: { lid: [0.45, 0.45], brow: [0.3, -0.3], mouth: 0.45, width: 1.15 },
  disgusted: { lid: [0.3, 0.6], brow: [0.15, -0.05], mouth: -0.22, width: 0.55, tilt: 0.22 },
};

/** Marcação de áudio ([sighs], [laughs]…) → expressão do rosto. */
export function expressionForTag(tag: string): Expression | null {
  const t = tag.toLowerCase();
  if (/cry|sob|tearful/.test(t)) return "crying";
  if (/angry|furious|shout|yell|rage/.test(t)) return "angry";
  if (/sad|disappoint|hurt|sorrow/.test(t)) return "sad";
  if (/wink|playful|flirt/.test(t)) return "wink";
  if (/skeptic|suspicious|unimpressed|doubt/.test(t)) return "skeptical";
  if (/disgust|gross|eww/.test(t)) return "disgusted";
  if (/mischiev|evil|scheming|sly/.test(t)) return "mischievous";
  if (/proud|smug|confident|boast/.test(t)) return "proud";
  if (/laugh|chuckle|giggle|excited|happy|cheer/.test(t)) return "laughing";
  if (/sarcas|whisper|smirk|teasing/.test(t)) return "smug";
  if (/scoff|annoy|frustr|groan|irritat/.test(t)) return "annoyed";
  if (/sigh|clears throat|bored|tired|yawn/.test(t)) return "neutral";
  if (/gasp|dramatic|surpris|shock|amazed/.test(t)) return "surprised";
  return null;
}

type RGB = [number, number, number];

/**
 * Visual: "holo" = o holograma azul brilhando no escuro; "classic" = o Eddy da
 * série, traço preto sobre branco, sem brilho. Vale para todos os rostos da tela.
 */
export type FaceTheme = "holo" | "classic";
let theme: FaceTheme = "holo";
export const setFaceTheme = (t: FaceTheme) => void (theme = t);
export const faceTheme = () => theme;

const COLORS: Record<FaceTheme, Record<FaceState, RGB>> = {
  holo: {
    idle: [110, 228, 255],
    listen: [120, 240, 230],
    think: [160, 170, 255],
    speak: [140, 236, 255],
    error: [255, 93, 108],
    offline: [90, 110, 130],
  },
  classic: {
    idle: [17, 17, 17],
    listen: [10, 70, 66],
    think: [40, 44, 120],
    speak: [17, 17, 17],
    error: [190, 28, 44],
    offline: [150, 150, 150],
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (cur: number, target: number, rate: number, dt: number) => lerp(cur, target, 1 - Math.exp(-rate * dt));

export class EddyFace {
  state: FaceState = "offline";
  /** Nível do microfone 0…1 (listen). */
  level = 0;
  /** Amplitude da fala 0…1 (speak). */
  amp = 0;
  /** O rosto atual; fica até outra marcação trocar. */
  expression: Expression = "happy";

  private t = 0;
  private col: RGB = [...COLORS[theme].offline];
  // valores animados (aproximam-se do alvo da expressão)
  private lidL = 1;
  private lidR = 1;
  private browL = 0;
  private browR = 0;
  private browA = 0; // opacidade das sobrancelhas
  private mouth = 1;
  private round = 0;
  private width = 1;
  private mtilt = 0;
  private lift = 0;
  private tearA = 0;
  private headTilt = 0;
  private glance = 0;
  private blink = 1;
  private nextBlink = 2;
  private glitchUntil = 0;
  private nextGlitch = 5;
  private rings: { r: number; a: number }[] = [];
  private ringClock = 0;
  private smoothLevel = 0;

  /** Sinal ruim: o holograma treme e pisca por alguns segundos. */
  glitch(seconds: number) {
    this.glitchUntil = this.t + seconds;
    this.nextGlitch = this.t + seconds + 3;
  }

  update(dt: number) {
    this.t += dt;
    const s = this.state;
    const target = COLORS[theme][s];
    for (let i = 0; i < 3; i++) this.col[i] = approach(this.col[i], target[i], 6, dt);

    const ex = EXPRESSIONS[s === "error" ? "annoyed" : this.expression];
    const talk = Math.min(1, this.amp * 1.6);

    // rosto: sempre o da expressão
    let mouthT = ex.mouth;
    let roundT = ex.round ?? 0;
    if (s === "speak") {
      // a boca abre com o áudio, no sentido da expressão
      mouthT = ex.mouth >= 0 ? Math.max(0.15, ex.mouth * 0.35) + talk * 0.9 : -(0.15 + talk * 0.55);
      roundT = roundT * (0.55 + talk * 0.6);
    } else if (s === "offline") {
      mouthT = 0.1;
    }
    this.mouth = approach(this.mouth, mouthT, s === "speak" ? 22 : 7, dt);
    this.round = approach(this.round, roundT, s === "speak" ? 20 : 7, dt);
    this.lidL = approach(this.lidL, ex.lid[0], 9, dt);
    this.lidR = approach(this.lidR, ex.lid[1], 9, dt);
    this.browL = approach(this.browL, ex.brow?.[0] ?? 0, 8, dt);
    this.browR = approach(this.browR, ex.brow?.[1] ?? 0, 8, dt);
    this.browA = approach(this.browA, ex.brow ? 1 : 0, 8, dt);
    this.width = approach(this.width, ex.width ?? 1, 8, dt);
    this.mtilt = approach(this.mtilt, ex.tilt ?? 0, 8, dt);
    this.lift = approach(this.lift, ex.lift ?? 0, 6, dt);
    this.tearA = approach(this.tearA, ex.tears ? 1 : 0, 4, dt);

    // sinais do estado, por cima do rosto
    this.headTilt = approach(this.headTilt, s === "listen" ? 0.018 + this.smoothLevel * 0.02 : 0, 5, dt);
    const glanceT = s === "think" ? Math.sin(this.t * 0.9) * 7 : this.expression === "laughing" && s === "speak" ? Math.sin(this.t * 18) * 1.5 : 0;
    this.glance = approach(this.glance, glanceT, 5, dt);

    // piscadas (menos durante a escuta: está prestando atenção)
    if (this.t > this.nextBlink) {
      this.blink = 0.06;
      this.nextBlink = this.t + (s === "listen" ? 4.5 : 2.2) + Math.random() * 3.8;
    }
    this.blink = approach(this.blink, 1, 14, dt);

    if (this.t > this.nextGlitch) {
      this.glitchUntil = this.t + 0.08 + Math.random() * 0.08;
      this.nextGlitch = this.t + 4 + Math.random() * 7;
    }

    this.smoothLevel = approach(this.smoothLevel, this.level, 12, dt);
    if (s === "listen") {
      this.ringClock += dt * (0.8 + this.smoothLevel * 3);
      if (this.ringClock > 0.45) {
        this.ringClock = 0;
        this.rings.push({ r: 150, a: 0.3 + this.smoothLevel * 0.5 });
      }
    }
    for (const r of this.rings) {
      r.r += dt * 120;
      r.a -= dt * 0.45;
    }
    this.rings = this.rings.filter((r) => r.a > 0);
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
    ctx.clearRect(0, 0, W, H);
    const scale = Math.min(W / 420, H / 400);
    const bob = Math.sin(this.t * 1.4) * 3;
    const [r, g, b] = this.col.map(Math.round);
    const classic = theme === "classic";
    const flicker = this.t < this.glitchUntil ? 0.55 : classic ? 1 : 0.94 + Math.sin(this.t * 31) * 0.03;
    const color = (a: number) => `rgba(${r},${g},${b},${a})`;

    ctx.save();
    ctx.translate(W / 2, H / 2 + bob * scale);
    ctx.scale(scale, scale);
    ctx.translate(-190, -170);

    // anéis da escuta
    for (const ring of this.rings) {
      ctx.beginPath();
      ctx.arc(190, 175, ring.r, 0, Math.PI * 2);
      ctx.strokeStyle = color(ring.a * 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // órbita do "pensando"
    if (this.state === "think") {
      for (let i = 0; i < 3; i++) {
        const a = this.t * 2.2 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(190 + Math.cos(a) * 168, 175 + Math.sin(a) * 158, 5 - i, 0, Math.PI * 2);
        ctx.fillStyle = color(0.8 - i * 0.2);
        ctx.shadowColor = color(1);
        ctx.shadowBlur = classic ? 0 : 14;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    // inclinação da cabeça (escuta) em torno da base
    if (this.headTilt) {
      ctx.translate(190, 300);
      ctx.rotate(this.headTilt);
      ctx.translate(-190, -300);
    }

    const glitchX = this.t < this.glitchUntil ? (Math.random() - 0.5) * 10 : 0;
    const passes: [number, string, number][] = classic
      ? [[0.82, color(flicker), 0]] // traço de caneta, sem brilho
      : [
          [1, color(0.35 * flicker), 26], // brilho largo
          [1, color(0.95 * flicker), 0], // traço
          [0.32, `rgba(255,255,255,${0.55 * flicker})`, 0], // núcleo claro
        ];

    for (const [widthK, style, blur] of passes) {
      ctx.strokeStyle = style;
      ctx.shadowColor = color(0.9);
      ctx.shadowBlur = blur;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // cabeça: o "E" com o arco por cima
      ctx.lineWidth = 26 * widthK;
      ctx.beginPath();
      ctx.moveTo(268 + glitchX, 300);
      ctx.lineTo(112 + glitchX, 300);
      ctx.lineTo(112, 118);
      ctx.arc(192, 118, 80, Math.PI, 0);
      ctx.stroke();

      // barra do meio pulsa com a fala
      ctx.lineWidth = (24 + (this.state === "speak" ? this.amp * 8 : 0)) * widthK;
      ctx.beginPath();
      ctx.moveTo(112, 212);
      ctx.lineTo(248 - glitchX, 212);
      ctx.stroke();

      // o "Y" (pescoço / gravata)
      ctx.lineWidth = 8 * widthK;
      ctx.beginPath();
      ctx.moveTo(150, 222);
      ctx.lineTo(190, 262);
      ctx.lineTo(230, 222);
      ctx.moveTo(190, 262);
      ctx.lineTo(190, 300);
      ctx.stroke();

      // olhos e sobrancelhas
      const ey = 112 + this.lift * 0.6;
      ctx.lineWidth = 7 * widthK;
      this.eye(ctx, 160 + this.glance, ey, this.lidL);
      this.eye(ctx, 220 + this.glance, ey, this.lidR);
      if (this.browA > 0.03) {
        ctx.save();
        ctx.globalAlpha *= this.browA;
        ctx.lineWidth = 6 * widthK;
        this.brow(ctx, 160 + this.glance, ey - 30, this.browL);
        this.brow(ctx, 220 + this.glance, ey - 30, this.browR);
        ctx.restore();
      }

      // boca
      ctx.lineWidth = 7 * widthK;
      this.mouthPath(ctx);
      ctx.stroke();
    }

    if (this.tearA > 0.03) this.tears(ctx, color);
    ctx.restore();
  }

  private eye(ctx: CanvasRenderingContext2D, cx: number, base: number, lid: number) {
    const R = 21;
    ctx.save();
    ctx.translate(cx, base);
    ctx.scale(1, this.blink);
    ctx.beginPath();
    // cúpula de cima; a pálpebra achata até virar linha
    ctx.moveTo(-R, 0);
    ctx.save();
    ctx.scale(1, Math.max(0.06, lid));
    ctx.arc(0, 0, R, Math.PI, 0);
    ctx.restore();
    ctx.closePath();
    ctx.restore();
    ctx.stroke();
  }

  /** Sobrancelha: um traço curto, inclinado pelo ângulo (espelhado no olho direito pelo sinal). */
  private brow(ctx: CanvasRenderingContext2D, cx: number, y: number, angle: number) {
    const L = 20;
    const dx = Math.cos(angle) * L;
    const dy = Math.sin(angle) * L;
    ctx.beginPath();
    ctx.moveTo(cx - dx, y - dy);
    ctx.lineTo(cx + dx, y + dy);
    ctx.stroke();
  }

  private mouthPath(ctx: CanvasRenderingContext2D) {
    const m = this.mouth;
    const d = 1 - this.round; // quanto do "D" ainda aparece
    const cx = 191;
    ctx.beginPath();
    if (d > 0.04) {
      const R = 41 * this.width * (0.4 + 0.6 * d);
      const top = 146 + (m < 0 ? 24 : 0);
      ctx.save();
      ctx.translate(cx, top);
      ctx.rotate(this.mtilt);
      ctx.moveTo(-R, 0);
      ctx.lineTo(R, 0);
      ctx.scale(1, Math.abs(m) < 0.04 ? 0.04 * Math.sign(m || 1) : m);
      ctx.arc(0, 0, R, 0, Math.PI);
      ctx.restore();
      ctx.closePath();
    }
    if (this.round > 0.04) {
      // boca em O (surpreso)
      const k = this.round;
      ctx.moveTo(cx + 15 * k, 166);
      ctx.ellipse(cx, 166, 15 * k, 19 * k, 0, 0, Math.PI * 2);
    }
  }

  /** Lágrimas escorrendo dos dois olhos (chorando). */
  private tears(ctx: CanvasRenderingContext2D, color: (a: number) => string) {
    ctx.save();
    ctx.shadowBlur = theme === "classic" ? 0 : 10;
    ctx.shadowColor = color(0.9);
    for (const [i, cx] of [148, 232].entries()) {
      const p = (this.t * 0.8 + i * 0.45) % 1;
      const y = 122 + p * 70;
      ctx.globalAlpha = this.tearA * Math.min(1, (1 - p) * 1.6);
      ctx.beginPath();
      ctx.moveTo(cx, y - 11);
      ctx.quadraticCurveTo(cx + 8, y + 3, cx, y + 8);
      ctx.quadraticCurveTo(cx - 8, y + 3, cx, y - 11);
      ctx.fillStyle = color(0.9);
      ctx.fill();
    }
    ctx.restore();
  }
}
