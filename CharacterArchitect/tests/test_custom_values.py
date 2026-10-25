import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_custom_values_node", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectCustomValuesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        data = {key: "None" for key in self.by_key}
        data.update({"media_type": "photograph", "gender": "woman"})
        return data

    def first_value(self, key):
        return MODULE.canonical_display_value(self.by_key[key]["values"][0])

    def prompt(self, data, **inputs):
        return self.node.build_prompt(seed=7, **inputs, **data)[0]

    def test_custom_values_is_an_optional_multiline_input(self):
        spec = self.node.INPUT_TYPES()["optional"]["custom_values"]
        self.assertEqual(spec[0], "STRING")
        self.assertTrue(spec[1]["multiline"])
        self.assertEqual(spec[1]["default"], "")

    def test_empty_custom_values_change_nothing(self):
        data = self.defaults()
        data["origin_age"] = self.by_key["origin_age"]["values"][0]
        self.assertEqual(self.prompt(data), self.prompt(data, custom_values=""))

    def test_each_line_replaces_its_field_exactly(self):
        data = self.defaults()
        data["origin_age"] = self.by_key["origin_age"]["values"][0]
        data["body_type"] = self.by_key["body_type"]["values"][0]
        prompt = self.prompt(data, custom_values="origin_age=24 to 26 years old\nbody_type=1.80 m tall")
        self.assertIn("24 to 26 years old", prompt)
        self.assertIn("1.80 m tall", prompt)
        self.assertNotIn(self.first_value("origin_age"), prompt)

    def test_parsing_rules(self):
        parsed = self.node._parse_custom_values(
            "# a note=ignored\n"
            "Body Type = 1.80 m\n"
            "hair_color=copper; with highlights\r\n"
            "hair_color=silver\n"
            "not_a_field=ignored\n"
            "eye_focus=eyes on the horizon\n"
            "origin_age=\n"
        )
        self.assertEqual(parsed, {
            "body_type": "1.80 m",
            "hair_color": "silver",
            "eye_focus": "eyes on the horizon",
        })

    def test_override_text_keeps_the_final_word(self):
        data = self.defaults()
        prompt = self.prompt(
            data,
            custom_values="origin_age=24 to 26 years old",
            override_field="origin_age",
            override_text="exactly 40 years old",
        )
        self.assertIn("exactly 40 years old", prompt)
        self.assertNotIn("24 to 26 years old", prompt)

    def test_custom_ethnicity_with_guidance_keeps_text_and_eye_color(self):
        data = self.defaults()
        data["origin_ethnicity"] = self.by_key["origin_ethnicity"]["values"][0]
        data["eye_color"] = self.by_key["eye_color"]["values"][0]
        prompt = self.prompt(
            data,
            ethnicity_guidance=True,
            custom_values="origin_ethnicity=Ethiopian Amhara {heritage}",
        )
        self.assertIn("Ethiopian Amhara {heritage}", prompt)
        self.assertIn(self.first_value("eye_color"), prompt)

    def test_custom_main_garment_clears_competing_families(self):
        self.assertIn("top_type", MODULE.MAIN_CLOTHING_OVERRIDE_CONFLICTS["dress_type"])
        data = self.defaults()
        data["top_type"] = self.by_key["top_type"]["values"][0]
        prompt = self.prompt(data, custom_values="dress_type=a hand-knitted emerald wool dress")
        self.assertIn("a hand-knitted emerald wool dress", prompt)
        self.assertNotIn(self.first_value("top_type"), prompt)

    def test_custom_pose_replaces_a_scenario(self):
        data = self.defaults()
        data["scene_scenario"] = self.by_key["scene_scenario"]["values"][0]
        prompt = self.prompt(data, custom_values="pose=balancing on one foot on a low wall")
        self.assertIn("balancing on one foot on a low wall", prompt)
        self.assertNotIn(self.first_value("scene_scenario"), prompt)


if __name__ == "__main__":
    unittest.main()
