// O Kit: o motorzinho de jogo que roda por baixo dos jogos que o Eddy cria.
//
// O modelo escreve só as regras — Kit.game({ title, help, setup, update, draw })
// — e o Kit cuida do resto: canvas 800×500 que se ajusta à moldura, laço com
// dt, teclado (setas/WASD/espaço) e toque (metade esquerda/direita da tela,
// toque = ação), telas de início e de fim, pontuação, as cores do visual do
// Eddy e o aviso de fim de partida para a ligação. Um modelo pequeno acerta
// muito mais escrevendo 60 linhas de regra do que um HTML inteiro.

export type KitLang = "pt" | "en" | "es";

const TEXT: Record<KitLang, { start: string; over: string; score: string; again: string; untitled: string }> = {
  pt: { start: "Toque ou aperte espaço para começar", over: "Fim de jogo", score: "Pontos", again: "Toque ou espaço para jogar de novo", untitled: "Jogo do Eddy" },
  en: { start: "Tap or press space to start", over: "Game over", score: "Score", again: "Tap or space to play again", untitled: "Eddy's game" },
  es: { start: "Toca o pulsa espacio para empezar", over: "Fin del juego", score: "Puntos", again: "Toca o espacio para jugar otra vez", untitled: "Juego de Eddy" },
};

// O motor, como texto: vai dentro da página do jogo (que não carrega nada de fora).
const RUNTIME = String.raw`(function(){
var T=window.__KIT_T,cv=document.getElementById('kit'),c=cv.getContext('2d'),W=800,H=500,sc=1,ox=0,oy=0,COL={};
function css(n){return getComputedStyle(document.documentElement).getPropertyValue('--'+n).trim()||'#888'}
function fit(){var d=Math.min(2,devicePixelRatio||1);cv.width=innerWidth*d;cv.height=innerHeight*d;sc=Math.min(innerWidth/W,innerHeight/H);ox=(innerWidth-W*sc)/2;oy=(innerHeight-H*sc)/2;c.setTransform(d*sc,0,0,d*sc,d*ox,d*oy);c.lineCap='round';c.lineJoin='round';COL={bg:css('bg'),ink:css('ink'),accent:css('accent'),muted:css('muted')}}
addEventListener('resize',fit);fit();
var k={left:false,right:false,up:false,down:false,action:false,px:W/2,py:H/2,pointer:false},now={},was={},side=null;
k.pressed=function(n){return !!was[n]};
var MAP={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',' ':'action',Enter:'action'};
addEventListener('keydown',function(e){var n=MAP[e.key];if(!n)return;e.preventDefault();if(!k[n])now[n]=1;k[n]=true});
addEventListener('keyup',function(e){var n=MAP[e.key];if(n)k[n]=false});
function lp(e){return{x:(e.clientX-ox)/sc,y:(e.clientY-oy)/sc}}
cv.addEventListener('pointerdown',function(e){try{cv.setPointerCapture(e.pointerId)}catch(_){}var p=lp(e);k.px=p.x;k.py=p.y;k.pointer=true;k.action=true;now.action=1;now.tap=1;if(e.pointerType!=='mouse'){side=p.x<W/2?'left':'right';k[side]=true}focus()});
cv.addEventListener('pointermove',function(e){var p=lp(e);k.px=p.x;k.py=p.y});
function up(){k.pointer=false;k.action=false;if(side){k[side]=false;side=null}}
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
var g={W:W,H:H,
color:function(n){var v=COL[n]||n;c.strokeStyle=v;c.fillStyle=v;return g},
line:function(a,b,x,y,w){c.lineWidth=w||3;c.beginPath();c.moveTo(a,b);c.lineTo(x,y);c.stroke();return g},
rect:function(x,y,w,h,f){c.lineWidth=3;if(f)c.fillRect(x,y,w,h);else c.strokeRect(x,y,w,h);return g},
circle:function(x,y,r,f){c.lineWidth=3;c.beginPath();c.arc(x,y,Math.max(0,r),0,Math.PI*2);if(f)c.fill();else c.stroke();return g},
poly:function(p,f){if(!p||p.length<2)return g;c.lineWidth=3;c.beginPath();c.moveTo(p[0][0],p[0][1]);for(var i=1;i<p.length;i++)c.lineTo(p[i][0],p[i][1]);c.closePath();if(f)c.fill();else c.stroke();return g},
text:function(s,x,y,z,a){c.font='600 '+(z||20)+'px system-ui,sans-serif';c.textAlign=a||'left';c.textBaseline='middle';c.fillText(String(s),x,y);return g}};
var spec=null,s=null,mode='start',last=0,dead=false;
function boom(e){if(dead)return;dead=true;setTimeout(function(){throw e})}
function reset(){s={score:0,t:0};if(spec.setup)spec.setup(s)}
function clear(){c.fillStyle=COL.bg;c.fillRect(-ox/sc-2,-oy/sc-2,innerWidth/sc+4,innerHeight/sc+4)}
function overlay(){c.globalAlpha=.85;c.fillStyle=COL.bg;c.fillRect(0,0,W,H);c.globalAlpha=1;g.color('ink');
if(mode==='start'){g.text(spec.title||T.untitled,W/2,H/2-60,44,'center');g.color('muted').text(spec.help||'',W/2,H/2,20,'center');g.color('accent').text(T.start,W/2,H/2+60,20,'center')}
else{g.text(T.over,W/2,H/2-55,44,'center');g.text(T.score+': '+(s.score|0),W/2,H/2+2,28,'center');g.color('accent').text(T.again,W/2,H/2+60,20,'center')}}
function frame(ts){var dt=last?Math.min(.05,(ts-last)/1000):0;last=ts;was=now;now={};
if(!dead){try{
if(mode!=='play'&&was.action){if(mode==='over')reset();mode='play';was={}}
if(mode==='play'){s.t+=dt;spec.update&&spec.update(s,dt,k)}
clear();g.color('ink');spec.draw&&spec.draw(s,g);g.color('ink').text(T.score+': '+(s.score|0),16,22,20);
if(mode!=='play')overlay()}catch(e){boom(e)}}
else{clear();g.color('accent').text('bug :(',W/2,H/2,40,'center')}
requestAnimationFrame(frame)}
window.Kit={W:W,H:H,
game:function(o){spec=o||{};try{reset()}catch(e){return boom(e)}requestAnimationFrame(frame)},
over:function(){if(mode!=='play')return;mode='over';try{parent.postMessage({eddyGame:'over',score:s.score|0},'*')}catch(e){}},
rand:function(a,b){return a+Math.random()*(b-a)},
randInt:function(a,b){return Math.floor(a+Math.random()*(b-a+1))},
hit:function(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y},
dist:function(a,b){return Math.hypot(a.x-b.x,a.y-b.y)},
clamp:function(v,a,b){return Math.max(a,Math.min(b,v))}};
setTimeout(function(){if(!spec&&!dead)boom(new Error('o jogo não chamou Kit.game({...})'))},1500);
})();`;

/** A página completa do jogo: o Kit e, depois, as regras que o modelo escreveu. */
export function kitPage(code: string, lang: string): string {
  const t = TEXT[(lang as KitLang) in TEXT ? (lang as KitLang) : "pt"];
  // "</script" dentro do código fecharia a tag antes da hora
  const safe = code.replace(/<\/script/gi, "<\\/script");
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Jogo do Eddy</title>" +
    "<style>html,body{margin:0;height:100%;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%;outline:none}</style>" +
    "</head><body><canvas id=\"kit\" tabindex=\"0\"></canvas>" +
    `<script>window.__KIT_T=${JSON.stringify(t)};${RUNTIME}</script>` +
    `<script>\n${safe}\n</script></body></html>`
  );
}
