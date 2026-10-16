"""O Eddy em persona: perfil, apelidos, o roteiro e a memória da ligação.

O modelo (Ollama) e a web (notícias, clima) são dublês: o que se testa é o que o
código decide sozinho — quem o Eddy chama de quê, que atalho responde sem gastar
CPU, o que fica na memória da ligação e o que um "alô" novo apaga.
"""

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