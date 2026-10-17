"""O Eddy cria jogos: o pedido para o modelo escrever as regras de um jogo.

O modelo escreve só as regras para o Kit (app/src/eddy/games/kit.ts), o motor
que a tela põe por baixo: canvas, laço, controles, telas de início e de fim,
pontuação e as cores do visual do Eddy. Um modelo pequeno acerta muito mais
assim do que escrevendo um HTML inteiro, e a resposta sai bem mais curta.

A tela roda o resultado num iframe isolado (sandbox sem mesma origem, sem rede):
o jogo não vê a conta, o app nem a internet.

Se o jogo quebrar logo no começo, a tela manda o erro de volta uma vez
(`fix`) e o modelo devolve o arquivo inteiro consertado.
"""

LANG_NAME = {"pt": "português do Brasil", "en": "English", "es": "español"}

SYSTEM = """Você escreve jogos pequenos para o Kit, um motor de jogo 2D que JÁ ESTÁ na página: canvas de 800×500 que se ajusta à tela, traço de linha nas cores do Eddy, telas de início e de fim, pontuação, teclado e toque prontos. Você escreve SÓ o JavaScript das regras, chamando Kit.game({...}) uma vez.

API do Kit:
Kit.game({ title, help, setup(s), update(s, dt, k), draw(s, g) })
- title: nome do jogo. help: uma frase com os controles e o objetivo.
- s: o estado do jogo (objeto seu). s.score é a pontuação (o Kit mostra). s.t são os segundos de partida.
- setup(s): monta o estado inicial (roda no começo e a cada "jogar de novo").
- update(s, dt, k): avança dt segundos. Controles:
  k.left k.right k.up k.down k.action — true ENQUANTO apertado (setas/WASD/espaço; no celular, tocar na metade esquerda/direita da tela liga k.left/k.right, e qualquer toque liga k.action);
  k.pressed('action') — true só no quadro em que apertou (também 'left', 'right', 'up', 'down', 'tap');
  k.px, k.py — posição do mouse/dedo em coordenadas 800×500; k.pointer — dedo/botão pressionado.
- draw(s, g): desenha tudo (o fundo já está limpo). g.color('ink' | 'accent' | 'muted'), g.line(x1, y1, x2, y2, espessura?), g.rect(x, y, w, h, preenchido?), g.circle(x, y, r, preenchido?), g.poly([[x, y], ...], preenchido?), g.text(texto, x, y, tamanho?, 'left' | 'center' | 'right').
- Kit.over(): termina a partida (o Kit mostra a tela de fim e o "jogar de novo").
- Ajudas: Kit.W (800), Kit.H (500), Kit.rand(a, b), Kit.randInt(a, b), Kit.hit(a, b) (colisão de retângulos {x, y, w, h}), Kit.dist(a, b), Kit.clamp(v, a, b).

Regras:
- Só JavaScript puro usando o Kit: sem document, sem window, sem fetch, sem imagens, sem setInterval. Tudo é desenhado com g, no estilo desenho de linha (contornos); 'accent' para o que importa.
- O jogo precisa de objetivo, pontuação que sobe e um jeito de perder (chame Kit.over()). Vai ficando mais difícil com s.t.
- Desenhe as coisas de um jeito reconhecível com linhas e formas (uma torrada = retângulo com cantos e miolo, etc.).
- Textos (title, help e o que desenhar) em {lingua}.
- No máximo umas 120 linhas. Confira: toda variável usada existe em s, nada de undefined.

Exemplo completo de um jogo (desviar de blocos):
```js
Kit.game({
  title: "Desvia!",
  help: "← → (ou toque nos lados) para desviar dos blocos.",
  setup(s) { s.x = 400; s.blocks = []; s.next = 0; },
  update(s, dt, k) {
    if (k.left) s.x -= 420 * dt;
    if (k.right) s.x += 420 * dt;
    s.x = Kit.clamp(s.x, 30, Kit.W - 30);
    s.next -= dt;
    if (s.next <= 0) {
      s.blocks.push({ x: Kit.rand(0, Kit.W - 40), y: -40, w: 40, h: 40 });
      s.next = Math.max(0.25, 0.9 - s.t * 0.02);
    }
    const me = { x: s.x - 25, y: 440, w: 50, h: 30 };
    for (const b of s.blocks) {
      b.y += (220 + s.t * 8) * dt;
      if (Kit.hit(me, b)) Kit.over();
    }
    const before = s.blocks.length;
    s.blocks = s.blocks.filter((b) => b.y < Kit.H);
    s.score += before - s.blocks.length;
  },
  draw(s, g) {
    g.color("muted").line(0, 475, Kit.W, 475, 2);
    g.color("accent").rect(s.x - 25, 440, 50, 30);
    g.color("ink");
    for (const b of s.blocks) g.rect(b.x, b.y, b.w, b.h);
  },
});
```

Responda APENAS com o seu jogo, num bloco ```js."""

FIX = """O jogo que você escreveu quebrou ao rodar, com este erro:

{erro}

Devolva o código INTEIRO consertado (o da sua resposta anterior), no mesmo formato: só o bloco ```js."""


def messages(idea: str, lang: str, fix: dict | None = None) -> list[dict]:
    """As mensagens para o modelo escrever (ou consertar) o jogo `idea`."""
    idea = (" ".join(str(idea).split())[:200]
            or "um jogo original à sua escolha, no mundo do Eddy (casa inteligente, eletrodomésticos rebeldes)")
    out = [
        {"role": "system", "content": SYSTEM.replace("{lingua}", LANG_NAME.get(lang, LANG_NAME["pt"]))},
        {"role": "user", "content": f"Crie este jogo: {idea}"},
    ]
    if fix and fix.get("code"):
        out.append({"role": "assistant", "content": "```js\n" + str(fix["code"])[:40000] + "\n```"})
        out.append({"role": "user", "content": FIX.replace("{erro}", str(fix.get("error", ""))[:600])})
    return out
