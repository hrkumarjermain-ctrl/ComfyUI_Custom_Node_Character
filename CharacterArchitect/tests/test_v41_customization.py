import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v41_node", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectV41CustomizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {key: "None" for key in self.by_key}

    def test_new_inputs_are_appended_as_optional_controls(self):
        optional = self.node.INPUT_TYPES()["optional"]
        expected = {
            "eye_focus", "mouth_expression", "setting_text_override",
            "pose_text_override", "custom_color_overrides", "wildcard_subject",
            "wildcard_clothing", "wildcard_pose", "wildcard_setting",
            "wildcard_photography",
        }
        self.assertTrue(expected.issubset(optional))

    def test_legacy_downward_head_direction_loses_camera_appendix(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "head_direction": "looking downward toward the camera",
        })
        resolved = self.node._resolve_values(data, seed=2)
        self.assertEqual(resolved["head_direction"], "looking downward")
        prompt = self.node.build_prompt(seed=2, **data)[0]
        self.assertIn("while looking downward", prompt)
        self.assertNotIn("downward toward the camera", prompt)

    def test_eye_focus_and_mouth_expression_stay_independent(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "pose": "reading a folded newspaper held naturally in both hands",
            "expression": "playful expression",
        })
        full, face, _, pre_gen, _, _ = self.node.build_prompt(
            seed=4,
            eye_focus="eyes focused on the object held in the hands",
            mouth_expression="lower lip gently caught between the teeth",
            **data,
        )
        self.assertIn("eyes focused on the object held in the hands", full)
        self.assertIn("eyes focused on the object held in the hands", face)
        self.assertIn("eyes focused on the object held in the hands", pre_gen)
        self.assertIn("lower lip gently caught between the teeth", full)
        self.assertIn("lower lip gently caught between the teeth", face)
        self.assertNotIn("lower lip gently caught between the teeth", pre_gen)

    def test_custom_colors_modify_active_slots_only(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "top_type": "blouse",
            "hosiery": "opaque tights",
            "hair_texture": "straight",
        })
        prompt = self.node.build_prompt(
            seed=5,
            custom_color_overrides="top=fuchsia; hosiery=salmon pink; hair=teal; dress=violet",
            **data,
        )[0]
        self.assertIn("fuchsia blouse", prompt)
        self.assertIn("salmon pink opaque tights", prompt)
        self.assertIn("straight teal hair", prompt)
        self.assertNotIn("violet", prompt)

    def test_reference_text_overrides_scenario_without_dependencies(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "pose": "standing with one hand in the hair",
            "setting": "outside on a beach",
            "scene_scenario": "relaxing at a rooftop gathering among companions",
        })
        prompt = self.node.build_prompt(
            seed=6,
            setting_text_override="inside a glass atrium reconstructed from the reference image",
            wildcard_setting="inside a wildcard ballroom",
            **data,
        )[0]
        self.assertIn("standing with one hand in the hair", prompt)
        self.assertIn("inside a glass atrium reconstructed from the reference image", prompt)
        self.assertNotIn("rooftop gathering", prompt)
        self.assertNotIn("wildcard ballroom", prompt)

    def test_five_wildcards_replace_only_their_named_blocks(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "origin_ethnicity": "central asian",
            "body_physique": "obese physique",
            "hair_color": "black",
            "top_type": "blouse",
            "pose": "standing still",
            "setting": "inside a diner",
            "lens_style": "85mm portrait lens look",
            "accessories_earrings": "stud earrings",
        })
        full, face, _, pre_gen, _, _ = self.node.build_prompt(
            seed=7,
            wildcard_subject="a silver-haired astronaut with a weathered face",
            wildcard_clothing="custom pressure suit with orange seams",
            wildcard_pose="floating with both hands extended",
            wildcard_setting="inside a damaged orbital station",
            wildcard_photography="grainy 35mm documentary photograph under emergency lighting",
            **data,
        )
        for prompt in (full, pre_gen):
            self.assertIn("silver-haired astronaut with a weathered face", prompt)
            self.assertIn("custom pressure suit with orange seams", prompt)
            self.assertIn("floating with both hands extended", prompt)
            self.assertIn("inside a damaged orbital station", prompt)
            self.assertIn("grainy 35mm documentary photograph under emergency lighting", prompt)
            self.assertNotIn("obese physique", prompt)
            self.assertNotIn("85mm portrait lens look", prompt)
        self.assertIn("silver-haired astronaut with a weathered face", face)
        self.assertIn("stud earrings", full)

    def test_general_override_keeps_its_historical_final_priority(self):
        data = self.defaults()
        data.update({"media_type": "photograph", "gender": "woman"})
        prompt = self.node.build_prompt(
            seed=8,
            wildcard_clothing="wildcard evening dress",
            override_field="top_type",
            override_text="custom hand-painted blouse",
            **data,
        )[0]
        self.assertIn("custom hand-painted blouse", prompt)
        self.assertNotIn("wildcard evening dress", prompt)


if __name__ == "__main__":
    unittest.main()
