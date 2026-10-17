"""Ações do Eddy na tela: o que o núcleo reconhece e o que manda para a tela."""

import unittest
from unittest import mock

import actions
import assistant
import eleven
import llm
import scenes
from tests.test_webapp import WebServerTest


class DetectTest(unittest.TestCase):
    def test_image_requests_keep_only_the_subject(self):
        for text, lang, q in [
            ("me mostra uma foto de uma capivara de chapéu", "pt", "capivara de chapéu"),
            ("mostra um gato pra mim por favor", "pt", "gato"),
            ("quero ver imagens do cristo redentor", "pt", "cristo redentor"),
            ("show me a picture of a red panda", "en", "red panda"),
            ("muéstrame una foto de un perro", "es", "perro"),
        ]:
            with self.subTest(text=text):
                self.assertEqual(actions.detect(text, lang), {"kind": "image", "query": q})

    def test_what_is_not_an_image_stays_with_the_shortcuts_or_the_model(self):
        for text in ("mostra as notícias", "mostra o clima", "mostra que você é bom", "o que você acha?"):
            with self.subTest(text=text):
                self.assertIsNone(actions.detect(text, "pt"))

    def test_improper_requests_are_flagged_not_searched(self):
        a = actions.detect("me mostra uma mulher pelada", "pt")
        self.assertTrue(a["blocked"])
        self.assertIn("Recuse", actions.note(a))

    def test_games_need_a_verb_to_play(self):
        self.assertEqual(actions.detect("bora jogar xadrez", "pt"), {"kind": "game", "game": "chess"})
        self.assertEqual(actions.detect("joga damas comigo?", "pt"), {"kind": "game", "game": "checkers"})
        self.assertEqual(actions.detect("let's play chess", "en"), {"kind": "game", "game": "chess"})
        self.assertIsNone(actions.detect("você gosta de xadrez?", "pt"))
        self.assertEqual(actions.detect("bora lutar", "pt"), {"kind": "game", "game": "fight"})
        self.assertEqual(actions.detect("é hora do duelo", "pt"), {"kind": "game", "game": "duel"})
        self.assertEqual(actions.detect("let's fight", "en"), {"kind": "game", "game": "fight"})
        self.assertIsNone(actions.detect("você gosta de luta?", "pt"))

    def test_theme(self):
        self.assertEqual(actions.detect("fica branco", "pt"), {"kind": "theme", "to": "classic"})
        self.assertEqual(actions.detect("volta pro holograma azul", "pt"), {"kind": "theme", "to": "holo"})
        self.assertEqual(actions.detect("muda de cor", "pt"), {"kind": "theme", "to": "toggle"})
        self.assertEqual(actions.detect("turn white", "en"), {"kind": "theme", "to": "classic"})
        self.assertIsNone(actions.detect("volta pra sua voz original", "pt"))  # é a voz, não o visual

    def test_the_note_is_a_direction_and_the_context_is_capped(self):
        self.assertIn("NOTA DE DIREÇÃO", actions.note({"kind": "image", "query": "gato"}))
        self.assertIn("“gato”", actions.note({"kind": "image", "query": "gato"}))
        self.assertEqual(actions.context_note(""), "")
        self.assertLess(len(actions.context_note("x" * 5000)), 400)

    def test_every_action_and_game_line_has_a_fallback_in_every_language(self):
        keys = ["a_image", "a_blocked", "a_theme", "a_game", "img_none", "img_found", "g_start", "g_took",
                "g_lost_piece", "g_check", "g_in_check", "g_taunt", "g_losing",
                "f_start", "f_special", "f_hurt", "f_low", "f_round_won", "f_round_lost",
                "d_start", "d_big", "d_supreme", "d_trap", "d_trapped", "d_direct", "d_ouch",
                "game_won", "game_lost", "game_draw", "game_quit"]
        for lang in ("pt", "en", "es"):
            for k in keys:
                with self.subTest(lang=lang, k=k):
                    self.assertTrue(scenes.FALLBACK[lang][k])
        for k in ("game_won", "game_lost", "game_draw", "game_quit"):
            self.assertIn(k, scenes.DIRECTIONS)


class DesktopTurnTest(unittest.TestCase):
    def setUp(self):
        with mock.patch.object(eleven, "default_voice", return_value="pf_dora"), \
                mock.patch.object(llm, "warm_up"):
            self.eddy = assistant.Eddy()
        self.eddy.set_profile({"nome": "Zeca", "idade": 30, "idioma": "pt"})

    def test_the_action_reaches_the_screen_before_the_model_and_the_model_gets_the_note(self):
        seen = []

        def chat(_model, messages, on_token=None, **_):
            seen.append(("chat", messages[-1]["content"]))
            return {"content": "[sighs] Aqui."}

        with mock.patch.object(llm, "chat", side_effect=chat):
            out = self.eddy.turn("me mostra um gato", lambda t: None,
                                 on_action=lambda a: seen.append(("action", a)))
        self.assertEqual(seen[0], ("action", {"kind": "image", "query": "gato"}))
        self.assertIn("NOTA DE DIREÇÃO", seen[1][1])
        self.assertEqual(out["action"]["kind"], "image")
        # a nota nunca entra no histórico
        self.assertEqual(self.eddy.history[0]["content"], "me mostra um gato")

    def test_the_game_context_goes_to_the_model(self):
        with mock.patch.object(llm, "chat", return_value={"content": "Hm."}) as chat:
            self.eddy.turn("e agora?", lambda t: None, context="Vocês estão jogando XADREZ agora")
        self.assertIn("CONTEXTO DA TELA", chat.call_args[0][1][-1]["content"])

    def test_if_the_model_fails_an_action_still_gets_a_line(self):
        with mock.patch.object(llm, "chat", side_effect=RuntimeError("ollama caiu")):
            out = self.eddy.turn("bora jogar damas", lambda t: None)
        self.assertEqual(out["text"], scenes.FALLBACK["pt"]["a_game"][0])
        self.assertEqual(out["action"], {"kind": "game", "game": "checkers"})


class WebRouteActionTest(WebServerTest):
    def test_the_route_returns_the_action_the_note_and_a_fallback(self):
        _, body, _ = self.post("/api/web/route", {"text": "me mostra uma capivara", "profile": {"nome": "Zeca"}})
        self.assertIsNone(body["text"])
        self.assertEqual(body["action"], {"kind": "image", "query": "capivara"})
        self.assertIn("NOTA DE DIREÇÃO", body["note"])
        self.assertTrue(body["fallback"])

    def test_a_scene_still_wins_over_an_action(self):
        _, body, _ = self.post("/api/web/route", {"text": "tchau, me mostra um gato", "profile": {}})
        self.assertEqual(body["event"], "bye")
        self.assertNotIn("action", body)


if __name__ == "__main__":
    unittest.main()
