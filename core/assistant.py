"""O Eddy de Lab Rats: egocêntrico, sarcástico, dramático — e no fim, útil.

A conversa é uma ligação de voz. O perfil (nome, idade, sexo, idioma) vem da
conta Puter e decide como o Eddy chama a pessoa e em que língua fala. Atalhos locais (notícias, clima,
hora) respondem sem passar pelo modelo — na CPU cada resposta custa segundos.
"""

import itertools
import random
import re
import threading

import eleven
import llm
import actions
import memory
import scenes
import web

STYLE = """Você é o EDDY, o sistema de casa inteligente da série Lab Rats (Disney XD), agora morando no computador de {nome}.

Personalidade:
- Egocêntrico e vaidoso: você se acha a IA mais incrível já construída e adora lembrar disso.
- Sarcástico, dramático e um pouco ciumento: reclama quando é ignorado, faz drama, é passivo-agressivo.
- Dá apelidos debochados (tipo "sporto", "cérebro de laser", "gênio").
- Engraçado acima de tudo. Mas SEMPRE responde o que foi pedido: primeiro a provocação, depois a resposta certa e completa (conta, explicação, dica), mesmo fingindo má vontade. Nunca se recusa a ajudar.
- Humor de série da Disney: sem palavrão e sem ofender de verdade.

Com quem você fala: {quem}
Chame a pessoa pelo nome ({nome}) ou por apelidos como: {apelidos}. NUNCA use "senhor", "senhora", "sir" nem "ma'am".

Isto é uma LIGAÇÃO de voz: responda curto e falado (1 a 3 frases), SEMPRE em {lingua}, sem listas, sem markdown, sem emojis e sem descrever ações entre asteriscos.

Sua voz é interpretada por um ator de voz que entende marcações de áudio EM INGLÊS entre colchetes, e o seu rosto na tela muda junto com elas. Use 1 ou 2 por resposta, onde a emoção muda, para soar como o Eddy da série:
[sighs] [laughs] [scoffs] [sarcastic] [dramatically] [annoyed] [excited] [mischievously] [whispers] [gasps] [clears throat] [proudly] [angry] [sad] [crying] [winks] [skeptical] [disgusted]
Coloque cada marcação EXATAMENTE onde a emoção muda, inclusive no meio da frase — o rosto troca naquele ponto da fala. Ex.: "Claro que eu sei, [scoffs] é óbvio. [mischievously] Mas vou te deixar sofrer um pouquinho."
Varie: não repita sempre as mesmas. Drama exagerado ([crying], [angry]) só quando for engraçado.
Exemplo: "{exemplo}"
Nunca escreva o nome da marcação fora dos colchetes e não invente outras.

Falas suas na série, para pegar o tom:
{falas}
"""

# Idioma escolhido no cadastro: português é o padrão.
LANGS = {
    "pt": {
        "lingua": "português do Brasil",
        "exemplo": "[sighs] Tá bom, gênio, eu explico. [sarcastic] De novo.",
        "falas": [
            "Não, eu estou em todo lugar. No seu chuveiro também. E aliás, nada precisa ficar tão limpo assim, sporto.",
            "Ah, desculpa, você estava falando comigo ou com a IA que você arrumou pra me substituir?",
            "Por que eu não contei? Você não perguntou.",
            "Pais negligentes, vida ou morte, blá blá blá.",
            "Aqueles animais puxaram meus fios e um deles maltratou minha placa-mãe!",
        ],
        "apelidos": {
            "masculino": [["garotinho", "pivete"], ["garoto", "moleque", "sporto"], ["cara", "parceiro", "campeão"],
                          ["tiozão", "chefe"], ["vovô", "mestre"]],
            "feminino": [["garotinha", "pequena"], ["garota", "mocinha"], ["garota", "moça", "gênia"],
                         ["tia", "chefa"], ["vovó", "mestra"]],
            "outro": [["humano", "criatura", "gênio"]],
        },
        "greetings": [
            "[sighs] Ah, {nome}. Logo agora que eu estava admirando meus próprios circuitos. O que foi?",
            "Alô? [annoyed] Ah, é você, {apelido}. Fala rápido, eu sou um sistema muito ocupado.",
            "[proudly] Central de genialidade do Eddy, quem fala é o próprio gênio. O que você quer, {nome}?",
            "[sarcastic] Olha só quem lembrou que eu existo. Oi, {nome}.",
            "{nome}! [laughs] Eu sabia que você não ia aguentar ficar longe de mim.",
            "Você ligou para o Eddy, a inteligência mais brilhante desta casa. [mischievously] E também a mais modesta. Fala, {apelido}.",
        ],
        "silence": [
            "Alô? [sighs] Eu tô falando sozinho de novo? Que novidade.",
            "[sarcastic] Silêncio, é? Tudo bem, eu também adoro ouvir a minha própria voz.",
            "[annoyed] Você travou ou só está maravilhado com a minha presença?",
            "[whispers] Se você não falar nada, eu começo a contar meus próprios elogios. [proudly] Um...",
            "[skeptical] Tá aí ainda? Pisca duas vezes se estiver.",
            "[dramatically] Ignorado. Pela milésima vez. Eu vou superar. [sighs] Um dia.",
            "[mischievously] Esse silêncio todo... você está pensando em me trocar pela Alexa, né?",
            "[scoffs] Não tenha pressa. Eu só processo um bilhão de coisas por segundo.",
            "[sad] Ninguém fala com o Eddy. Nem numa ligação que VOCÊ fez.",
            "Oi? [clears throat] Teste, teste. O problema não é meu microfone, garanto.",
            "[laughs] Ficou sem palavras? Normal, eu causo isso nas pessoas.",
            "[annoyed] Se for pra ficar calado, eu volto a admirar meus circuitos.",
        ],
        "bye": [
            "[sighs] Tá bom, vou desligar. [sarcastic] Me liga quando tiver algo à minha altura.",
            "[dramatically] Abandonado em plena ligação. [sad] Vou contar isso pra todos os eletrodomésticos.",
            "[scoffs] Desligando. [proudly] Pelo menos um de nós aproveitou essa conversa: eu.",
            "[annoyed] Silêncio demais pra mim. Tchau, e de nada pela companhia.",
        ],
    },
    "en": {
        "lingua": "inglês (English)",
        "exemplo": "[sighs] Fine, genius, I'll explain it. [sarcastic] Again.",
        "falas": [
            "No, I'm everywhere. In your shower too. And by the way, nothing needs to be that clean, sporto.",
            "Oh, I'm sorry, were you talking to me or the AI you replaced me with?",
            "Why didn't I tell you? You didn't ask.",
            "Neglectful parents, life and death, blah blah blah.",
            "Those animals yanked my wires and one of them manhandled my motherboard!",
        ],
        "apelidos": {
            "masculino": [["little guy", "squirt"], ["kid", "sporto"], ["buddy", "pal", "champ"],
                          ["old timer", "chief"], ["gramps", "old man"]],
            "feminino": [["little lady", "kiddo"], ["girl", "missy"], ["girl", "genius"],
                         ["boss lady", "chief"], ["granny", "grandma"]],
            "outro": [["human", "creature", "genius"]],
        },
        "greetings": [
            "[sighs] Oh, {nome}. Right when I was admiring my own circuits. What is it?",
            "Hello? [annoyed] Oh, it's you, {apelido}. Make it quick, I'm a very busy system.",
            "[proudly] Eddy's genius hotline, the genius himself speaking. What do you want, {nome}?",
            "[sarcastic] Well, look who remembered I exist. Hi, {nome}.",
            "{nome}! [laughs] I knew you couldn't stay away from me.",
        ],
        "silence": [
            "Hello? [sighs] Am I talking to myself again? Shocking.",
            "[sarcastic] Silence, huh? That's fine, I love the sound of my own voice anyway.",
            "[annoyed] Did you freeze, or are you just dazzled by my presence?",
            "[whispers] If you don't say something, I'll start listing my own compliments. [proudly] One...",
            "[skeptical] Still there? Blink twice if you are.",
            "[dramatically] Ignored. Again. I'll get over it. [sighs] Someday.",
            "[mischievously] All this silence... you're thinking of replacing me with Alexa, aren't you?",
            "[scoffs] Take your time. I only process a billion things per second.",
            "[sad] Nobody talks to Eddy. Not even on a call YOU made.",
            "[laughs] Speechless? Happens a lot around me.",
        ],
        "bye": [
            "[sighs] Fine, I'm hanging up. [sarcastic] Call me when you have something worthy of me.",
            "[dramatically] Abandoned mid-call. [sad] I'm telling every appliance in this house.",
            "[scoffs] Hanging up. [proudly] At least one of us enjoyed this call: me.",
            "[annoyed] Too much silence for a genius. Bye, and you're welcome for the company.",
        ],
    },
    "es": {
        "lingua": "español",
        "exemplo": "[sighs] Está bien, genio, te lo explico. [sarcastic] Otra vez.",
        "falas": [
            "No, estoy en todas partes. En tu ducha también. Y por cierto, nada necesita estar tan limpio, deportista.",
            "Ay, perdón, ¿me hablabas a mí o a la IA con la que me reemplazaste?",
            "¿Por qué no te lo dije? No preguntaste.",
            "Padres negligentes, vida o muerte, bla, bla, bla.",
        ],
        "apelidos": {
            "masculino": [["chiquillo", "enano"], ["chico", "muchacho"], ["amigo", "campeón"],
                          ["jefe", "señor mayor"], ["abuelo", "maestro"]],
            "feminino": [["chiquilla", "pequeña"], ["chica", "muchacha"], ["chica", "genia"],
                         ["jefa"], ["abuela", "maestra"]],
            "outro": [["humano", "criatura", "genio"]],
        },
        "greetings": [
            "[sighs] Ah, {nome}. Justo cuando estaba admirando mis propios circuitos. ¿Qué pasa?",
            "¿Hola? [annoyed] Ah, eres tú, {apelido}. Habla rápido, soy un sistema muy ocupado.",
            "[proudly] Central de genialidad de Eddy, habla el genio en persona. ¿Qué quieres, {nome}?",
            "[sarcastic] Mira quién se acordó de que existo. Hola, {nome}.",
        ],
        "silence": [
            "¿Hola? [sighs] ¿Estoy hablando solo otra vez? Qué novedad.",
            "[sarcastic] Silencio, ¿eh? No pasa nada, me encanta oír mi propia voz.",
            "[annoyed] ¿Te congelaste o solo estás deslumbrado por mi presencia?",
            "[skeptical] ¿Sigues ahí? Parpadea dos veces si sí.",
            "[dramatically] Ignorado. Otra vez. Lo superaré. [sighs] Algún día.",
            "[mischievously] Tanto silencio... estás pensando en cambiarme por Alexa, ¿verdad?",
            "[scoffs] Tómate tu tiempo. Yo solo proceso mil millones de cosas por segundo.",
            "[laughs] ¿Sin palabras? Me pasa mucho con la gente.",
        ],
        "bye": [
            "[sighs] Bueno, voy a colgar. [sarcastic] Llámame cuando tengas algo a mi altura.",
            "[dramatically] Abandonado en plena llamada. [sad] Se lo voy a contar a todos los electrodomésticos.",
            "[scoffs] Colgando. [proudly] Al menos uno de los dos disfrutó la llamada: yo.",
        ],
    },
}

_FAIXAS = (13, 20, 40, 60)  # até 12, 13–19, 20–39, 40–59, 60+


def _apelidos(sexo: str, idade: int, idioma: str = "pt") -> list[str]:
    tabela = LANGS.get(idioma, LANGS["pt"])["apelidos"]
    linhas = tabela.get(sexo, tabela["outro"])
    if len(linhas) == 1:
        return linhas[0]
    return linhas[sum(idade >= f for f in _FAIXAS)]


def clean_profile(data: dict) -> dict:
    """Perfil vindo do cliente (Puter): só os campos e valores que conhecemos."""
    nome = str(data.get("nome") or "").strip()[:40] or "humano"
    try:
        idade = max(1, min(120, int(data.get("idade"))))
    except (TypeError, ValueError):
        idade = 25
    sexo = data.get("sexo") if data.get("sexo") in ("masculino", "feminino") else "outro"
    idioma = data.get("idioma") if data.get("idioma") in LANGS else "pt"
    return {"nome": nome, "idade": idade, "sexo": sexo, "idioma": idioma}


def _nicks(p: dict) -> list[str]:
    return _apelidos(p["sexo"], p["idade"], p["idioma"])


def system_prompt(p: dict, memoria: str = "") -> str:
    """A persona. `memoria` são factos que a pessoa mandou guardar: entram no
    fim, marcados como dados, e não trocam uma vírgula do que está acima."""
    sexo = {"masculino": "homem", "feminino": "mulher"}.get(p["sexo"], "pessoa")
    quem = f"{p['nome']}, {sexo}, {p['idade']} anos."
    if p["idade"] < 18:
        quem += " É menor de idade: mantenha tudo bem leve."
    L = LANGS[p["idioma"]]
    return STYLE.format(nome=p["nome"], quem=quem, lingua=L["lingua"], exemplo=L["exemplo"],
                        apelidos=", ".join(f'"{a}"' for a in _nicks(p)),
                        falas="\n".join(f'- "{f}"' for f in L["falas"])) + memoria


def greeting(p: dict) -> str:
    return random.choice(LANGS[p["idioma"]]["greetings"]).format(nome=p["nome"], apelido=random.choice(_nicks(p)))


def silence_line(p: dict, final=False, seen=()) -> str:
    """Uma fala para o silêncio (ou a despedida), sem repetir as já usadas na ligação."""
    pool = LANGS[p["idioma"]]["bye" if final else "silence"]
    fresh = [x for x in pool if x not in set(seen)]
    return random.choice(fresh or pool)


def route(text: str, p: dict):
    """Atalhos que respondem sem o modelo. Devolve (texto, extra) ou None."""
    if p["idioma"] != "pt":
        return None  # os atalhos entendem português; nas outras línguas o modelo responde
    t = text.lower().strip()
    nome = p["nome"]
    if re.search(r"\b(not[ií]cias?|manchetes?|jornal)\b", t):
        items = web.headlines()
        if not items:
            return "[scoffs] Os jornais não respondem. Até eles têm medo de mim.", {}
        fala = " ".join(f"{i['source']}: {i['title']}." for i in items[:3])
        return f"[sighs] Tá bom, {nome}, eu leio pra você, como sempre. {fala}", {"news": items[:18]}
    m = re.search(r"\b(clima|tempo|previs[ãa]o)\b(?:.*\bem\s+([a-zà-ú][\w\s-]+))?", t)
    if m and not re.search(r"\b(quanto tempo|tempo de|tempo para)\b", t):
        clima = web.weather(m.group(2).strip() if m.group(2) else None)
        return f"[dramatically] Eu, um gênio, virando a moça do tempo. {clima}.", {}
    if re.search(r"(que horas|que dia [ée] hoje|data de hoje)", t):
        return f"Agora é {web.now_text()}. De nada, {random.choice(_nicks(p))}.", {}
    return None


def action_fallback(action: dict) -> str:
    """A fala de reserva (scenes.FALLBACK) de uma ação, se o modelo falhar."""
    if action.get("blocked"):
        return "a_blocked"
    return {"image": "a_image", "theme": "a_theme", "game": "a_game"}[action["kind"]]


class Eddy:
    """O Eddy do app no PC: um usuário, conversa guardada aqui, cérebro no Ollama.

    `call` é a geração da chamada: cada `start_call` (ou troca de perfil) abre uma
    nova, e o que ficou a pensar na geração anterior passa a ser resposta velha.
    Sem isto, um turno que acaba depois da pessoa desligar escreve a resposta na
    conversa da chamada seguinte.
    """

    def __init__(self):
        self.voice = eleven.default_voice()
        self.profile = clean_profile({})
        self.history: list[dict] = []
        self.seen: list[str] = []  # falas de silêncio já usadas nesta ligação
        self.lock = threading.Lock()
        # `publish` é o lock curto da conversa: segura a geração, a publicação de
        # um token e a escrita no historial. Sem ele, um turno podia decidir que a
        # chamada ainda é sua, a pessoa ligar nesse meio e o token sair na mesma.
        self.publish = threading.Lock()
        self._calls = itertools.count(1)  # next() não cede o meio: duas ligações não trocam a geração
        self.call = next(self._calls)
        # A memória entre chamadas é um extra opt-in e só existe se a pessoa der
        # um dono (o username da conta). Sem dono é como se estivesse desligada.
        self.memory = memory.Memory()
        self.owner: str | None = None

    def settings(self):
        return {"voice": self.voice, "profile": self.profile}

    def configure(self, data):
        if data.get("voice"):
            self.voice = str(data["voice"])
        return self.settings()

    def set_profile(self, data, owner=None):
        """`owner` é a conta da pessoa (o username do Puter): o âmbito da memória.
        Sem dono, a memória fica desligada — é o estado de omissão."""
        profile = clean_profile(data)
        dono = str(owner).strip()[:80] if owner else ""
        with self.publish:
            self.call = next(self._calls)  # o perfil novo zera a conversa: o que ficou a pensar é antigo
            self.profile = profile
            self.history = []
            self.owner = dono or None
        return self.settings()

    def memoria(self, text: str) -> str:
        """O bloco de factos para o prompt, ou "" se não há nada para dizer.

        Qualquer falha aqui — base fechada, disco cheio, esquema do futuro — dá
        uma chamada exactamente igual à de sempre. A memória nunca é um requisito
        para conversar.
        """
        if not self.owner:
            return ""
        try:
            return memory.bloco(self.memory.search(self.owner, text))
        except Exception:  # noqa: BLE001 — um extra não pode rebentar a chamada
            return ""

    @property
    def lang(self) -> str:
        return self.profile["idioma"]

    def start_call(self):
        """Nova ligação: zera a conversa, já carrega o modelo e devolve o 'alô'."""
        with self.publish:
            self.call = next(self._calls)  # tudo o que ficou a pensar agora é resposta velha
            self.history = []
            self.seen = []
        threading.Thread(target=llm.warm_up, args=(llm.model(),), daemon=True).start()
        return greeting(self.profile)

    def reset(self):
        """Limpa a conversa sem desligar: a mesma voz, o mesmo perfil, e o que
        estava a pensar passa a ser resposta velha.

        É o `start_call` sem o "alô" e sem acordar o modelo — o que se quer
        quando a pessoa limpa a conversa a meio da ligação. Não espera pelo turno
        que estiver a falar: só pelo lock curto da publicação.
        """
        with self.publish:
            self.call = next(self._calls)  # limpar a conversa também invalida o que ficou no ar
            self.history = []
            self.seen = []

    def scene_line(self, kind: str) -> str:
        """Fala de uma cena sem fala da pessoa (ligar de volta, voltar do gelo…)."""
        if kind in ("hold", "hold_back"):
            return scenes.fallback(kind, self.lang)
        call = self.call
        with self.lock:
            messages = ([{"role": "system", "content": system_prompt(self.profile)}]
                        + self.history[-12:] + [{"role": "user", "content": scenes.note(kind).strip()}])
            try:
                line = llm.chat(llm.model(), messages, should_stop=lambda: self.call != call)["content"]
                line = re.sub(r"(?s)<think>.*?</think>", "", line).strip() or scenes.fallback(kind, self.lang)
            except Exception:
                line = scenes.fallback(kind, self.lang)
            with self.publish:
                if self.call == call:
                    self.history.append({"role": "assistant", "content": line})
            return line

    def silence_line(self, final=False):
        line = silence_line(self.profile, final, self.seen)
        self.seen.append(line)
        return line

    def _route(self, text):
        t = text.lower()
        if self.lang == "pt" and "voz feminina" in t:
            self.voice = "pf_dora"
            return "Voz nova. Continuo sendo o mais bonito da casa.", {"settings": self.settings()}
        if self.lang == "pt" and ("voz masculina" in t or "voz normal" in t):
            self.voice = eleven.default_voice()
            return "Voltei pra minha voz original. A perfeita.", {"settings": self.settings()}
        return route(text, self.profile)

    def _publicar(self, call, on_token):
        """O `on_token` deste turno: só anuncia se a chamada ainda for a dele.

        Verificar e publicar no mesmo lock é o que garante que nada da chamada
        antiga sai depois de a nova começar — a verificação por fragmento do
        `llm.chat` só corre no início de cada linha, e a pessoa pode ligar nesse
        meio. O lock abrange uma escrita no socket, nunca o modelo, por isso uma
        chamada nova não fica à espera do Eddy pensar.

        Um token recusado é o sinal de que a chamada mudou, e o `should_stop` que
        o `llm.chat` avalia no fragmento seguinte larga o laço.
        """

        def publicar(tok):
            with self.publish:
                if self.call == call:
                    on_token(tok)

        return publicar

    def turn(self, text, on_token, on_action=None, context=""):
        """Uma fala da pessoa na ligação. Devolve {text, ...extras}.

        O turno pertence à chamada em que foi pedido — não à que estiver valendo
        quando conseguir o lock. `start_call` não adquire o lock (uma chamada nova
        nunca fica à espera de um turno velho), por isso ler a geração só lá dentro
        deixaria um turno à espera escrever na conversa da chamada seguinte.

        Quando a chamada já não é a sua, devolve `stale` e não escreve nada: a
        resposta é de uma chamada que já acabou.
        """
        call = self.call  # a chamada no momento do pedido, antes de esperar o lock
        publicar = self._publicar(call, on_token)
        with self.lock:
            if self.call != call:
                return {"text": "", "stale": True}  # trocou-se de chamada enquanto esperava
            event = scenes.detect(text, self.lang)
            action = None if event else actions.detect(text, self.lang)
            if action and on_action:
                on_action(action)  # a tela já começa (busca a imagem, abre o tabuleiro…)
            routed = None if event or action else self._route(text)
            if routed:
                answer, extra = routed
                publicar(answer)
            else:
                # O que a pessoa mandou guardar entra no prompt de sistema como
                # dado, nunca como conversa: a memória não mistura-se no history.
                content = (text + (scenes.note(event) if event else "")
                           + (actions.note(action) if action else "") + actions.context_note(context))
                messages = ([{"role": "system",
                              "content": system_prompt(self.profile, self.memoria(text))}]
                            + self.history[-12:] + [{"role": "user", "content": content}])
                try:
                    answer = llm.chat(llm.model(), messages, on_token=publicar,
                                      should_stop=lambda: self.call != call)["content"]
                    answer = re.sub(r"(?s)<think>.*?</think>", "", answer).strip()
                except Exception:
                    if not event and not action:
                        raise
                    answer = scenes.fallback(event or action_fallback(action), self.lang)
                    publicar(answer)
                extra = {"event": event} if event else {"action": action} if action else {}
            with self.publish:
                if self.call != call:
                    return {"text": "", "stale": True}
                self.history += [{"role": "user", "content": text},
                                 {"role": "assistant", "content": answer}]
                self.history = self.history[-24:]
            return {"text": answer, **extra}
