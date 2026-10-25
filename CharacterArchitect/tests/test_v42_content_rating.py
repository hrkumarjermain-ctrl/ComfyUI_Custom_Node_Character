import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v42_node", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectV42Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {key: "None" for key in self.by_key}

    def test_content_rating_has_only_two_concrete_values(self):
        item = self.by_key["content_rating"]
        self.assertEqual(item["default"], "normal")
        self.assertEqual(item["values"], ["normal", "glamour/sexy/explicit"])
        widget_values = self.node.INPUT_TYPES()["required"]["content_rating"][0]
        self.assertEqual(
            widget_values,
            ["None", "Random", "Forced Random", "normal", "glamour/sexy/explicit"],
        )
        lock = self.node.INPUT_TYPES()["optional"]["lock_content_rating"]
        self.assertTrue(lock[1]["default"])

    def test_both_ratings_are_in_full_and_pre_gen_but_not_face(self):
        expected = {
            "normal": "The subject is presented with a neutral, non-sexualized, non-explicit treatment.",
            "glamour/sexy/explicit": "The subject is presented with a glamorous, sexualized, explicit treatment.",
        }
        for rating, sentence in expected.items():
            with self.subTest(rating=rating):
                data = self.defaults()
                data.update({
                    "media_type": "photograph",
                    "gender": "woman",
                    "content_rating": rating,
                })
                full, face, _, pre_gen, _, _ = self.node.build_prompt(seed=42, **data)
                self.assertIn(sentence, full)
                self.assertIn(sentence, pre_gen)
                self.assertNotIn(sentence, face)

    def test_none_omits_content_rating_sentence(self):
        data = self.defaults()
        data.update({"media_type": "photograph", "gender": "woman"})
        full, _, _, pre_gen, _, _ = self.node.build_prompt(seed=3, **data)
        for prompt in (full, pre_gen):
            self.assertNotIn("non-sexualized", prompt)
            self.assertNotIn("sexualized, explicit treatment", prompt)

    def test_random_content_rating_is_deterministic_and_reachable(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "content_rating": "Random",
        })
        first = self.node._resolve_values(data, seed=17)["content_rating"]
        second = self.node._resolve_values(data, seed=17)["content_rating"]
        self.assertEqual(first, second)
        draws = {
            self.node._resolve_values(data, seed=seed)["content_rating"]
            for seed in range(100)
        }
        self.assertEqual(draws, {"normal", "glamour/sexy/explicit"})

    def test_legacy_ratings_merge_into_the_new_stronger_value(self):
        for legacy_value in ("glamour", "sexy", "explicit", "glamour / sexy / explicit"):
            with self.subTest(legacy_value=legacy_value):
                data = self.defaults()
                data["content_rating"] = legacy_value
                resolved = self.node._resolve_values(data, seed=1)
                self.assertEqual(resolved["content_rating"], "glamour/sexy/explicit")

    def test_pajama_short_sets_keep_their_short_cut(self):
        for garment in ("cute cotton pajama short set", "kawaii print pajama short set"):
            with self.subTest(garment=garment):
                data = self.defaults()
                data.update({
                    "media_type": "photograph",
                    "gender": "woman",
                    "sleepwear_type": garment,
                    "sleepwear_color": "brown",
                })
                full, _, _, pre_gen, _, _ = self.node.build_prompt(seed=9, **data)
                expected = garment.replace(
                    "pajama short set",
                    "pajama set with short pajama shorts",
                )
                for prompt in (full, pre_gen):
                    self.assertIn(f"brown {expected}", prompt)
                    self.assertNotIn(f"brown {garment}", prompt)

    def test_frontend_places_media_and_rating_in_global_rows(self):
        frontend = (ROOT / "web" / "character_architect_v17.js").read_text(encoding="utf-8")
        self.assertIn(
            '"media_type", "lock_media_type", "gender", "lock_gender", "content_rating", "lock_content_rating"',
            frontend,
        )
        composition_line = next(
            line for line in frontend.splitlines()
            if 'keys: ["composition_archetype", "portrait_style", "enforce_portrait_framing", "capture_style"' in line
        )
        self.assertNotIn("media_type", composition_line)
        self.assertNotIn("lock_media_type", composition_line)
        for uppercase_label in (
            "MEDIA TYPE", "EYE FOCUS / LOOKING AT", "MOUTH EXPRESSION",
            "SETTING TEXT OVERRIDE (IMAGE CAPTION READY)",
        ):
            self.assertNotIn(f'"{uppercase_label}"', frontend)


if __name__ == "__main__":
    unittest.main()
