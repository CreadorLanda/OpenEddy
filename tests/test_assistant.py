"""O Eddy em persona: perfil, apelidos, o roteiro e a memória da ligação.

O modelo (Ollama) e a web (notícias, clima) são dublês: o que se testa é o que o
código decide sozinho — quem o Eddy chama de quê, que atalho responde sem gastar
CPU, o que fica na memória da ligação e o que um "alô" novo apaga.
"""

import threading
import unittest
from unittest import mock

import assistant
import eleven
import llm


class CleanProfileTest(unittest.TestCase):
    """O perfil vem do navegador: tudo o que não é conhecido é corrigido."""

    def test_a_complete_profile_is_kept(self):
        p = assistant.clean_profile({"nome": "Ana", "idade": 31, "sexo": "feminino", "idioma": "en"})
        self.assertEqual(p, {"nome": "Ana", "idade": 31, "sexo": "feminino", "idioma": "en"})

    def test_a_name_that_is_empty_or_very_long(self):
        self.assertEqual(assistant.clean_profile({"nome": "   "})["nome"], "humano")
        self.assertEqual(len(assistant.clean_profile({"nome": "x" * 500})["nome"]), 40)

    def test_an_age_that_is_not_a_number(self):
        self.assertEqual(assistant.clean_profile({"idade": "vinte"})["idade"], 25)

    def test_an_age_outside_the_human_range(self):
        self.assertEqual(assistant.clean_profile({"idade": 0})["idade"], 1)
        self.assertEqual(assistant.clean_profile({"idade": 900})["idade"], 120)

    def test_an_unknown_gender_or_language_falls_back(self):
        p = assistant.clean_profile({"sexo": "outro-conta", "idioma": "fr"})
        self.assertEqual(p["sexo"], "outro")
        self.assertEqual(p["idioma"], "pt")

    def test_nothing_at_all_is_still_a_valid_profile(self):
        self.assertEqual(assistant.clean_profile({}),
                         {"nome": "humano", "idade": 25, "sexo": "outro", "idioma": "pt"})


class NicknameTest(unittest.TestCase):
    """O apelido depende da faixa de idade — é o que faz o Eddy não chamar
    toda a gente de "senhor"."""

    def test_older_people_get_the_respected_nickname(self):
        for lang in assistant.LANGS:
            com_16 = assistant._apelidos("masculino", 16, lang)
            com_70 = assistant._apelidos("masculino", 70, lang)
            self.assertNotEqual(com_16, com_70, lang)
            self.assertEqual(com_70, assistant.LANGS[lang]["apelidos"]["masculino"][-1])

    def test_someone_who_did_not_say_has_the_neutral_nickname(self):
        for lang in assistant.LANGS:
            self.assertEqual(assistant._apelidos("outro", 30, lang),
                             assistant.LANGS[lang]["apelidos"]["outro"][0])

    def test_an_unknown_language_does_not_explode(self):
        self.assertTrue(assistant._apelidos("masculino", 30, "klingon"))

    def test_a_minor_gets_gentler_prompt(self):
        prompt = assistant.system_prompt(assistant.clean_profile({"nome": "Zeca", "idade": 12}))
        self.assertIn("menor de idade", prompt)


class SystemPromptTest(unittest.TestCase):
    def test_it_names_the_person_and_their_language(self):
        p = assistant.clean_profile({"nome": "Zeca", "idade": 30, "idioma": "en"})
        prompt = assistant.system_prompt(p)
        self.assertIn("Zeca", prompt)
        self.assertIn("inglês (English)", prompt)

    def test_it_offers_exactly_the_nicknames_of_that_person(self):
        """O prompt diz ao modelo o que chamar a pessoa — nem "senhor", nem os
        apelidos da outra faixa etária."""
        for lang in assistant.LANGS:
            for sexo, idade in (("masculino", 16), ("feminino", 70), ("outro", 30)):
                perfil = assistant.clean_profile({"nome": "Zeca", "sexo": sexo, "idade": idade, "idioma": lang})
                apelidos = ", ".join(f'"{a}"' for a in assistant._nicks(perfil))
                self.assertIn(f"apelidos como: {apelidos}", assistant.system_prompt(perfil), f"{lang}/{sexo}/{idade}")


class SilenceLineTest(unittest.TestCase):
    """O Eddy não repete a mesma piada de silêncio na mesma ligação."""

    def test_a_line_already_used_is_not_used_again(self):
        p = assistant.clean_profile({})
        primeira = assistant.silence_line(p, False, [])
        with mock.patch.object(assistant.random, "choice", side_effect=lambda seq: seq[0]):
            self.assertNotEqual(assistant.silence_line(p, False, [primeira]), primeira)

    def test_the_farewell_comes_from_the_bye_pool(self):
        p = assistant.clean_profile({})
        falas = assistant.LANGS["pt"]["bye"]
        for _ in range(30):
            self.assertIn(assistant.silence_line(p, True), falas)

    def test_when_everything_was_already_used_it_repeats_rather_than_going_silent(self):
        p = assistant.clean_profile({})
        todas = assistant.LANGS["pt"]["silence"]
        self.assertIn(assistant.silence_line(p, False, todas), todas)


class RouteTest(unittest.TestCase):
    """Atalhos que respondem sem o modelo — cada segundo de CPU conta na CPU."""

    def setUp(self):
        self.p = assistant.clean_profile({"nome": "Zeca"})

    def test_something_unknown_goes_to_the_model(self):
        self.assertIsNone(assistant.route("me explica a teoria da relatividade", self.p))

    def test_the_news_shortcut_reads_the_headlines(self):
        with mock.patch.object(assistant.web, "headlines", return_value=[
                {"source": "G1", "title": "Cãogresso vota o orçamento", "link": "u"}]) as headlines:
            texto, extra = assistant.route("me dá as notícias", self.p)
        headlines.assert_called_once()
        self.assertIn("Cãogresso vota o orçamento", texto)
        self.assertEqual(extra["news"], [{"source": "G1", "title": "Cãogresso vota o orçamento", "link": "u"}])

    def test_no_headlines_means_the_eddy_jokes_instead_of_saying_nothing(self):
        with mock.patch.object(assistant.web, "headlines", return_value=[]):
            texto, extra = assistant.route("notícias", self.p)
        self.assertTrue(texto)
        self.assertEqual(extra, {})

    def test_the_weather_shortcut(self):
        with mock.patch.object(assistant.web, "weather", return_value="Luanda: 24°C") as weather:
            texto, _ = assistant.route("como está o clima em Luanda", self.p)
        # a frase é procurada em minúsculas, e é assim que o nome segue para o geocoding
        weather.assert_called_once_with("luanda")
        self.assertIn("24°C", texto)

    def test_a_question_about_life_expectancy_is_not_the_weather(self):
        with mock.patch.object(assistant.web, "weather", side_effect=AssertionError("não é o clima")), \
                mock.patch.object(assistant.web, "now_text", side_effect=AssertionError("também não")):
            self.assertIsNone(assistant.route("quanto tempo eu tenho de vida", self.p))

    def test_the_clock(self):
        with mock.patch.object(assistant.web, "now_text", return_value="17 de outubro"):
            texto, _ = assistant.route("que dia é hoje", self.p)
        self.assertIn("17 de outubro", texto)

    def test_in_english_the_shortcuts_do_not_fire(self):
        p = assistant.clean_profile({"nome": "Zeca", "idioma": "en"})
        with mock.patch.object(assistant.web, "headlines", side_effect=AssertionError("não deve buscar")):
            self.assertIsNone(assistant.route("what are the headlines", p))


class LockQueAgeAoSerAdquirido:
    """O lock do Eddy, mas que dispara um callback no instante em que o turno o
    adquire. É assim que se reproduz uma troca a meio da espera — sem sleeps nem
    threads, e sem depender da ordem em que duas threads acordam."""

    def __init__(self, ao_adquirir):
        self._interno = threading.Lock()
        self.ao_adquirir = ao_adquirir

    def __enter__(self):
        self._interno.acquire()
        self.ao_adquirir()
        return self

    def __exit__(self, *_):
        self._interno.release()


class EddyCallTest(unittest.TestCase):
    """Uma ligação: o que fica na memória e o que um "alô" novo apaga."""

    def setUp(self):
        with mock.patch.object(eleven, "default_voice", return_value="pf_dora"), \
                mock.patch.object(llm, "warm_up"):
            self.eddy = assistant.Eddy()
        self.eddy.set_profile({"nome": "Zeca", "idade": 30, "idioma": "pt"})

    def ask(self, text="oi Eddy", content="[sighs] Oi, garoto."):
        with mock.patch.object(llm, "chat", return_value={"content": content}) as chat:
            return self.eddy.turn(text, lambda t: None), chat

    def test_the_answer_goes_to_the_token_callback_and_to_the_memory(self):
        resposta, _ = self.ask()
        self.assertEqual(resposta["text"], "[sighs] Oi, garoto.")
        self.assertEqual(len(self.eddy.history), 2)
        self.assertEqual([m["role"] for m in self.eddy.history], ["user", "assistant"])

    def test_the_thinking_block_is_never_said_out_loud(self):
        resposta, _ = self.ask(content="<think>ele está a pensar</think>[Sighs] Oi.")
        self.assertEqual(resposta["text"], "[Sighs] Oi.")

    def test_a_turn_that_survives_a_new_call_does_not_write_to_the_history(self):
        """O turno velho ainda pensa quando a pessoa desliga e liga outra vez: quando
        ele acabar, a resposta é da chamada que já não existe."""
        entrou = threading.Event()
        largado = threading.Event()

        def chat_lento(_model, _messages, on_token=None, **_):
            entrou.set()
            largado.wait(2)
            on_token("[sighs] resposta da chamada velha")
            return {"content": "[sighs] resposta da chamada velha"}

        with mock.patch.object(llm, "chat", side_effect=chat_lento):
            resposta = {}
            velho = threading.Thread(target=lambda: resposta.update(self.eddy.turn("pergunta velha", lambda t: None)))
            velho.start()
            self.assertTrue(entrou.wait(2), "o turno velho nunca chegou ao modelo")
            with mock.patch.object(llm, "warm_up"):
                self.eddy.start_call()  # chamada nova: zera o historial
            largado.set()
            velho.join(2)

        self.assertFalse(velho.is_alive())
        self.assertEqual(self.eddy.history, [])
        self.assertTrue(resposta.get("stale"), resposta)

    def test_a_turn_queued_behind_the_lock_still_belongs_to_its_own_call(self):
        """O turno foi pedido na chamada velha mas só consegue o lock depois de a
        pessoa já ter ligado outra vez: pertence à chamada do pedido, não à que o
        lock encontrou."""
        trocou = threading.Event()

        def nova_chamada():
            if not trocou.is_set():
                trocou.set()
                with mock.patch.object(llm, "warm_up"):
                    self.eddy.start_call()

        self.eddy.lock = LockQueAgeAoSerAdquirido(nova_chamada)
        with mock.patch.object(llm, "chat", return_value={"content": "resposta da chamada velha"}):
            resposta = self.eddy.turn("pergunta da chamada velha", lambda t: None)

        self.assertTrue(trocou.is_set(), "a troca de chamada não aconteceu: o teste não provaria nada")
        self.assertTrue(resposta.get("stale"), resposta)
        self.assertEqual(self.eddy.history, [])

    def test_a_turn_that_was_thinking_cannot_restore_the_conversation_after_a_reset(self):
        """Limpar a conversa tem de invalidar o turno que ficou a pensar, senão ele
        volta a escrever o que o reset acabou de apagar."""
        limpou = threading.Event()

        def limpar():
            if not limpou.is_set():
                limpou.set()
                self.eddy.reset()

        self.eddy.history.append({"role": "user", "content": "pergunta já apagada"})
        self.eddy.lock = LockQueAgeAoSerAdquirido(limpar)
        with mock.patch.object(llm, "chat", return_value={"content": "resposta do turno em curso"}):
            resposta = self.eddy.turn("pergunta que ficou no ar", lambda t: None)

        self.assertTrue(limpou.is_set(), "o reset não aconteceu: o teste não provaria nada")
        self.assertTrue(resposta.get("stale"), resposta)
        self.assertEqual(self.eddy.history, [])

    def test_a_superseded_turn_stops_reading_from_the_model(self):
        """`llm.chat` já sabia parar de ler; agora recebe o should_stop da chamada."""
        parados = []
        entrou = threading.Event()
        largado = threading.Event()

        def chat_lento(_model, _messages, should_stop=None, **_):
            parados.append(should_stop)
            entrou.set()
            largado.wait(2)
            return {"content": "resposta velha"}

        with mock.patch.object(llm, "chat", side_effect=chat_lento):
            velho = threading.Thread(target=lambda: self.eddy.turn("pergunta velha", lambda t: None))
            velho.start()
            self.assertTrue(entrou.wait(2))
            self.assertFalse(parados[0](), "com a chamada a valer, o turno não pára")
            with mock.patch.object(llm, "warm_up"):
                self.eddy.start_call()
            self.assertTrue(parados[0](), "a chamada mudou: o turno tem de se despachar")
            largado.set()
            velho.join(2)
            self.assertFalse(velho.is_alive())

    def test_a_new_call_only_keeps_its_own_turn(self):
        with mock.patch.object(llm, "chat", return_value={"content": "resposta nova"}):
            with mock.patch.object(llm, "warm_up"):
                self.eddy.start_call()
            self.eddy.turn("pergunta nova", lambda t: None)
        self.assertEqual([m["content"] for m in self.eddy.history], ["pergunta nova", "resposta nova"])

    def test_a_failing_model_does_not_break_the_next_turn(self):
        with mock.patch.object(llm, "chat", side_effect=RuntimeError("ollama: modelo não encontrado")):
            with self.assertRaises(RuntimeError):
                self.eddy.turn("pergunta", lambda t: None)
        # a geração tem de continuar a servir: o turno que vem a seguir é válido
        with mock.patch.object(llm, "chat", return_value={"content": "resposta"}):
            resposta = self.eddy.turn("outra pergunta", lambda t: None)
        self.assertEqual(resposta["text"], "resposta")
        self.assertEqual(len(self.eddy.history), 2)

    def test_a_shortcut_does_not_wake_the_model(self):
        with mock.patch.object(assistant.web, "now_text", return_value="17 de outubro"):
            resposta = self.eddy.turn("que dia é hoje", lambda t: None)
        self.assertIn("17 de outubro", resposta["text"])

    def test_asking_for_another_voice_changes_it(self):
        with mock.patch.object(eleven, "default_voice", return_value="eleven:SERGIO"):
            resposta = self.eddy.turn("põe uma voz feminina", lambda t: None)
        self.assertEqual(self.eddy.voice, "pf_dora")
        self.assertEqual(resposta["settings"]["voice"], "pf_dora")

    def test_asking_for_the_original_voice_brings_it_back(self):
        self.eddy.voice = "eleven:SERGIO"
        with mock.patch.object(eleven, "default_voice", return_value="eleven:SERGIO"):
            self.eddy.turn("volta pra voz normal", lambda t: None)
        self.assertEqual(self.eddy.voice, "eleven:SERGIO")

    def test_the_memory_is_bounded(self):
        for i in range(30):
            self.ask(text=f"fala {i}")
        self.assertLessEqual(len(self.eddy.history), 24)

    def test_the_silence_lines_are_never_repeated_in_the_same_call(self):
        primeira = self.eddy.silence_line()
        with mock.patch.object(assistant.random, "choice", side_effect=lambda seq: seq[0]):
            self.assertNotEqual(self.eddy.silence_line(), primeira)

    def test_a_new_call_forgets_everything(self):
        """`start_call` é o reset da ligação: nova memória, falas de silêncio
        novas e o "alô" de sempre."""
        self.ask()
        self.eddy.silence_line()
        with mock.patch.object(llm, "warm_up"):
            greeting = self.eddy.start_call()
        self.assertEqual(self.eddy.history, [])
        self.assertEqual(self.eddy.seen, [])
        renderizadas = {t.format(nome="Zeca", apelido=a)
                        for t in assistant.LANGS["pt"]["greetings"]
                        for a in assistant._nicks(self.eddy.profile)}
        self.assertIn(greeting, renderizadas)

    def test_a_new_profile_also_forgets_the_conversation(self):
        self.ask()
        self.eddy.set_profile({"nome": "Ana", "idade": 22, "sexo": "feminino"})
        self.assertEqual(self.eddy.history, [])
        self.assertEqual(self.eddy.profile["nome"], "Ana")


if __name__ == "__main__":
    unittest.main()