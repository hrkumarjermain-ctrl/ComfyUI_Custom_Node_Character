import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v50", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectV50Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {item["key"]: item.get("default", "None") for item in MODULE.SCHEMA["categories"]}

    def test_six_outputs_have_public_names(self):
        self.assertEqual(MODULE.CharacterArchitectNode.RETURN_TYPES, ("STRING",) * 6)
        self.assertEqual(
            MODULE.CharacterArchitectNode.RETURN_NAMES,
            ("Prompt", "Face Prompt", "Inspected Value", "Pre-gen Text",
             "Identity Forge Description", "Face & Hair Description"),
        )

    def test_gender_labels_are_grouped_and_are_not_prompt_text(self):
        item = self.by_key["bust"]
        displayed = MODULE.display_options_for_item(item)
        tags = [value.split(")", 1)[0] + ")" for value in displayed]
        order = {"(female)": 0, "(unisex)": 1, "(male)": 2}
        self.assertEqual([order[tag] for tag in tags], sorted(order[tag] for tag in tags))

        data = self.defaults()
        data.update({
            "gender": "(male) man",
            "body_type": "(unisex) average height",
            "body_physique": "(unisex) very slim physique",
            "bust": "(male) flat masculine pectoral chest",
            "top_type": "(male) tailored Oxford shirt",
        })
        prompt = self.node.build_prompt(seed=3, **data)[0]
        self.assertIn("flat masculine pectoral chest", prompt)
        self.assertIn("tailored Oxford shirt", prompt)
        self.assertNotIn("(male)", prompt)
        self.assertNotIn("(unisex)", prompt)

    def test_ordinary_male_random_uses_masculine_body_archetypes(self):
        female_archetypes = set(MODULE.FEMALE_BODY_ARCHETYPE_VALUES)
        for seed in range(40):
            data = self.defaults()
            data.update({
                "gender": "man",
                "body_archetype": "Random",
                "body_type": "Random",
                "body_physique": "Random",
                "body_feminine_curves": "Random",
                "bust": "Random",
                "butt_shape": "Random",
                "thigh_shape": "Random",
            })
            resolved = self.node._resolve_values(data, seed=seed)
            self.assertIn(resolved["body_archetype"], MODULE.MALE_BODY_ARCHETYPE_VALUES)
            self.assertNotIn(resolved["body_archetype"], female_archetypes)
            self.assertIn(resolved["bust"], MODULE.MALE_BODY_VALUES_BY_FIELD["bust"])

    def test_male_long_length_coherence_cannot_reintroduce_long_skirt(self):
        expected_bottoms = set(
            MODULE.CLOTHING_ARCHETYPE_CONFIG["Classic Menswear"]["bottom_type"]
        )
        for seed in range(100):
            data = self.defaults()
            data.update({
                "gender": "man",
                "clothing_archetype": "Classic Menswear",
                "top_type": "tailored dress shirt",
                "bottom_type": "Random",
                "bottom_length": "long",
            })
            resolved = self.node._resolve_values(data, seed=seed)
            self.assertNotEqual(resolved["bottom_type"], "long skirt")
            self.assertNotEqual(resolved["bottom_type"], "mini skirt")
            self.assertIn(
                MODULE._gender_tag_for_value("bottom_type", resolved["bottom_type"]),
                {"male", "unisex"},
            )
            self.assertIn(resolved["bottom_type"], expected_bottoms)

    def test_every_bottom_vocabulary_value_has_a_length_profile(self):
        bottom_values = next(
            item["values"] for item in MODULE.SCHEMA["categories"]
            if item["key"] == "bottom_type"
        )
        self.assertEqual(set(bottom_values), set(MODULE.BOTTOM_LENGTH_POOLS))

    def test_directed_archetype_randoms_are_available_and_gender_independent(self):
        for selection, allowed_tags, field, values in (
            ("Female Random", {"female", "unisex"}, "body_archetype", MODULE.BODY_ARCHETYPE_VALUES),
            ("Male Random", {"male", "unisex"}, "body_archetype", MODULE.BODY_ARCHETYPE_VALUES),
            ("Female Random", {"female", "unisex"}, "clothing_archetype", list(MODULE.CLOTHING_ARCHETYPE_CONFIG)),
            ("Male Random", {"male", "unisex"}, "clothing_archetype", list(MODULE.CLOTHING_ARCHETYPE_CONFIG)),
        ):
            with self.subTest(selection=selection, field=field):
                data = self.defaults()
                data.update({"gender": "woman", field: selection})
                resolved = self.node._resolve_values(data, seed=12)
                self.assertIn(
                    MODULE._gender_tag_for_value(field, resolved[field]),
                    allowed_tags,
                )
                self.assertIn(resolved[field], values)

    def test_manual_cross_gender_choice_remains_available(self):
        data = self.defaults()
        data.update({"gender": "man", "bust": "very full projected bust"})
        resolved = self.node._resolve_values(data, seed=2)
        self.assertEqual(resolved["bust"], "very full projected bust")

    def test_femboy_feminine_garment_is_tailored_to_masculine_chest(self):
        data = self.defaults()
        data.update({
            "gender": "androgynous femboy",
            "bust": "flat masculine pectoral chest",
            "dress_type": "gothic dress",
            "dress_color": "black",
            "neckline": "high crew neckline",
        })
        prompt = self.node.build_prompt(seed=4, **data)[0]
        self.assertIn("black gothic dress with high crew neckline", prompt)
        self.assertIn("tailored over the flat masculine pectoral chest", prompt)

    def test_identity_forge_male_creature_keeps_the_same_tailoring_rule(self):
        identity = json.dumps({
            "_meta": {"creature_of": "rabbit", "form": "Anthropomorphic"},
            "Species & Anatomy": {"head": "a rabbit head", "integument": "white rabbit fur"},
        })
        data = self.defaults()
        data.update({
            "gender": "androgynous femboy",
            "bust": "flat masculine pectoral chest",
            "dress_type": "gothic dress",
            "dress_color": "black",
        })
        prompt = self.node.build_prompt(identity_forge_json=identity, seed=4, **data)[0]
        self.assertIn("anthropomorphic rabbit", prompt)
        self.assertNotIn(" hybrid", prompt)
        self.assertIn("tailored over a flat masculine pectoral chest", prompt)

    def test_legacy_neckline_conflict_becomes_one_atomic_geometry(self):
        data = self.defaults()
        data.update({
            "top_type": "t-shirt",
            "cleavage_depth": "deep neckline",
            "cleavage_type": "crew neck",
        })
        prompt = self.node.build_prompt(seed=8, **data)[0]
        self.assertIn("t-shirt with high crew neckline", prompt)
        self.assertNotIn("deep neckline", prompt)

    def test_authored_collar_suppresses_only_random_neckline(self):
        data = self.defaults()
        data.update({"dress_type": "qipao dress with a high mandarin collar", "neckline": "Random"})
        prompt = self.node.build_prompt(seed=9, **data)[0]
        self.assertIn("qipao dress with a high mandarin collar", prompt)
        self.assertNotIn(" with high crew neckline", prompt)
        self.assertNotIn(" with low V-neckline", prompt)

    def test_source_only_description_outputs(self):
        data = self.defaults()
        data.update({
            "face_shape": "oval",
            "eye_color": "green",
            "hair_color": "black",
            "hair_texture": "curly",
            "hair_length": "long hair",
            "setting": "forest trail",
            "top_type": "t-shirt",
        })
        outputs = self.node.build_prompt(
            seed=10,
            face_hair_text_override=(
                "face_shape=oval; eye_color=green; hair_color=black; "
                "hair_texture=curly; hair_length=long hair"
            ),
            **data,
        )
        face_hair = outputs[5]
        self.assertIn("oval face", face_hair)
        self.assertIn("green eyes", face_hair)
        self.assertIn("curly black hair", face_hair)
        self.assertNotIn("forest", face_hair)
        self.assertNotIn("t-shirt", face_hair)

    def test_all_archetype_phrases_exist_in_manual_vocabularies(self):
        allowed = {key: set(item["values"]) for key, item in self.by_key.items()}
        for config in MODULE.BODY_ARCHETYPE_CONFIG.values():
            for key, values in config.items():
                manual_key = "body_detail_1" if key == "body_details" else key
                self.assertTrue(set(values).issubset(allowed[manual_key]), (manual_key, values))
        for config in MODULE.CLOTHING_ARCHETYPE_CONFIG.values():
            for mode in config.get("modes", []):
                for key, values in mode.get("fields", {}).items():
                    self.assertTrue(
                        set(values).issubset(allowed[key] | {"None"}),
                        (config.get("label"), key, values),
                    )


if __name__ == "__main__":
    unittest.main()
