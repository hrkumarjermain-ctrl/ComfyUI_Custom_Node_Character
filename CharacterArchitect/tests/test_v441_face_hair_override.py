import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v441_node", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FaceHairOverrideV441Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {key: "None" for key in self.by_key}

    def reference_description(self):
        return (
            "face_shape=oval; jawline=delicate jawline; chin_shape=small rounded chin; "
            "eye_shape=almond-shaped; eye_color=dark brown; eyelashes=long natural lashes; "
            "eyebrows=thick softly arched brows; nose_shape=straight narrow nose; "
            "lip_shape=full softly defined lips; facial_hair=none; hair_color=blue-black; "
            "hair_texture=wavy; hair_style=center-parted loose styling; "
            "hair_cut=bob haircut; hair_length=shoulder-length hair; bangs_style=no bangs"
        )

    def test_input_is_optional_and_appended_without_changing_outputs(self):
        optional = self.node.INPUT_TYPES()["optional"]
        self.assertIn("face_hair_text_override", optional)
        self.assertEqual(self.node.RETURN_TYPES, ("STRING",) * 6)
        self.assertEqual(
            self.node.RETURN_NAMES,
            ("Prompt", "Face Prompt", "Inspected Value", "Pre-gen Text", "Identity Forge Description", "Face & Hair Description"),
        )

    def test_reference_fields_use_existing_prompt_boundaries(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "expression": "joyful expression",
            "eye_expression": "gentle",
            "makeup_eye": "graphic eyeliner",
            "body_physique": "slim physique",
        })
        full, face, _, pre_gen, _, _ = self.node.build_prompt(
            face_hair_text_override=self.reference_description(), seed=41, **data
        )
        for prompt in (full, face):
            self.assertIn("oval face", prompt)
            self.assertIn("dark brown eyes", prompt)
            self.assertIn("wavy blue-black hair", prompt)
            self.assertIn("bob haircut", prompt)
            self.assertIn("joyful expression", prompt)
            self.assertIn("gentle gaze", prompt)
            self.assertIn("graphic eyeliner", prompt)
        self.assertNotIn("oval face", pre_gen)
        self.assertNotIn("dark brown eyes", pre_gen)
        self.assertNotIn("graphic eyeliner", pre_gen)
        self.assertIn("wavy blue-black hair", pre_gen)
        self.assertIn("bob haircut", pre_gen)
        self.assertIn("slim physique", pre_gen)

    def test_manual_and_forced_random_values_stay_above_reference(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "face_shape": "square",
            "hair_color": "platinum blonde",
            "eye_color": "Forced Random",
        })
        full, _, _, _, _, _ = self.node.build_prompt(
            face_hair_text_override=(
                "face_shape=oval; hair_color=reference black; "
                "eye_color=reference violet; hair_texture=curly"
            ),
            seed=42,
            **data,
        )
        self.assertIn("square face", full)
        self.assertNotIn("oval face", full)
        self.assertIn("curly platinum blonde hair", full)
        self.assertNotIn("reference black", full)
        self.assertNotIn("reference violet", full)

    def test_universal_field_override_remains_final_authority(self):
        data = self.defaults()
        data.update({"media_type": "photograph", "gender": "woman"})
        full, _, inspected, pre_gen, _, _ = self.node.build_prompt(
            face_hair_text_override="hair_color=reference black; hair_texture=curly",
            override_field="hair_color",
            override_text="electric teal",
            inspect_property="hair_color",
            seed=43,
            **data,
        )
        self.assertEqual(inspected, "electric teal")
        self.assertIn("curly electric teal hair", full)
        self.assertIn("curly electric teal hair", pre_gen)
        self.assertNotIn("reference black", full)

    def test_reference_leads_over_identity_forge_face_and_hair(self):
        identity = json.dumps({
            "Face": {"face_shape": "round", "eye_color": "blue"},
            "Hair": {
                "hair_color": "copper red",
                "hair_texture": "straight",
                "hair_length": "short hair",
            },
        })
        data = self.defaults()
        data.update({"media_type": "photograph", "gender": "woman"})
        full = self.node.build_prompt(
            identity_forge_json=identity,
            face_hair_text_override=(
                "face_shape=diamond; eye_color=honey; hair_color=black; "
                "hair_texture=coily; hair_length=waist-length hair"
            ),
            seed=44,
            **data,
        )[0]
        self.assertIn("diamond face", full)
        self.assertIn("honey eyes", full)
        self.assertIn("coily black hair", full)
        self.assertIn("waist-length hair", full)
        self.assertNotIn("round face", full)
        self.assertNotIn("copper red", full)
        self.assertNotIn("short hair", full)

    def test_valid_reference_suspends_only_indivisible_subject_wildcard(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "body_physique": "muscular physique",
        })
        full = self.node.build_prompt(
            face_hair_text_override="face_shape=heart-shaped; hair_color=black",
            wildcard_subject="a wildcard subject with silver hair and a square face",
            wildcard_clothing="a custom emerald suit",
            seed=45,
            **data,
        )[0]
        self.assertNotIn("wildcard subject", full)
        self.assertNotIn("silver hair", full)
        self.assertIn("heart-shaped face", full)
        self.assertIn("black hair", full)
        self.assertIn("muscular physique", full)
        self.assertIn("custom emerald suit", full)

    def test_invalid_reference_does_not_disable_subject_wildcard(self):
        data = self.defaults()
        data.update({"media_type": "photograph", "gender": "woman"})
        full = self.node.build_prompt(
            face_hair_text_override="A poetic face description without structured keys.",
            wildcard_subject="a preserved wildcard subject",
            seed=46,
            **data,
        )[0]
        self.assertIn("preserved wildcard subject", full)

    def test_detailed_ethnicity_guidance_yields_but_simple_origin_remains(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "origin_ethnicity": "central asian",
        })
        full, face, _, pre_gen, _, _ = self.node.build_prompt(
            ethnicity_guidance=True,
            face_hair_text_override=(
                "face_shape=square; eye_shape=round; eye_color=green; "
                "hair_color=black; hair_texture=straight"
            ),
            seed=47,
            **data,
        )
        for prompt in (full, face):
            self.assertIn("central asian", prompt)
            self.assertNotIn("strongly recognizable central asian facial features", prompt)
            self.assertIn("square face", prompt)
            self.assertIn("green eyes", prompt)
        self.assertIn("central asian woman", pre_gen)
        self.assertNotIn("square face", pre_gen)
        self.assertIn("straight black hair", pre_gen)

    def test_missing_reference_keys_clear_lower_random_values(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "hair_color": "Random",
            "facial_hair": "Random",
        })
        full, _, inspected, pre_gen, _, _ = self.node.build_prompt(
            face_hair_text_override="face_shape=oval",
            inspect_property="hair_color",
            seed=48,
            **data,
        )
        self.assertEqual(inspected, "")
        self.assertIn("oval face", full)
        self.assertNotIn("hair", pre_gen.lower())

    def test_parser_accepts_common_labels_and_markdown_fence(self):
        parsed = self.node._parse_face_hair_text_override(
            "```text\nEye brows: softly arched brows; Hair colour = auburn; "
            "Haircut: layered cut; Facial hair: none\n```"
        )
        self.assertEqual(parsed["eyebrows"], "softly arched brows")
        self.assertEqual(parsed["hair_color"], "auburn")
        self.assertEqual(parsed["hair_cut"], "layered cut")
        self.assertIsNone(parsed["facial_hair"])


if __name__ == "__main__":
    unittest.main()
