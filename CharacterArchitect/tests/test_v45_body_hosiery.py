import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v45", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectV45Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {item["key"]: item.get("default", "None") for item in MODULE.SCHEMA["categories"]}

    def test_girl_next_door_is_complete_and_manually_reachable(self):
        self.assertEqual(len(MODULE.BODY_ARCHETYPE_VALUES), 39)
        self.assertIn("Girl Next Door", MODULE.BODY_ARCHETYPE_VALUES)
        config = MODULE.BODY_ARCHETYPE_CONFIG["Girl Next Door"]
        self.assertEqual(set(config), MODULE.BODY_ARCHETYPE_CONTROL_FIELDS - set(MODULE.BODY_DETAIL_KEYS) | {"body_details"})

        allowed = {key: set(item["values"]) for key, item in self.by_key.items()}
        for key, values in config.items():
            manual_key = "body_detail_1" if key == "body_details" else key
            self.assertTrue(set(values).issubset(allowed[manual_key]))

        self.assertIn("full rounded bust with natural forward projection", allowed["bust"])
        self.assertIn("prominent rounded glutes", allowed["butt_shape"])
        self.assertIn("slender neck and delicate shoulder line", allowed["body_detail_1"])

    def test_girl_next_door_resolves_as_slim_localized_hourglass(self):
        config = MODULE.BODY_ARCHETYPE_CONFIG["Girl Next Door"]
        for seed in range(50):
            data = self.defaults()
            data["body_archetype"] = "Girl Next Door"
            resolved = self.node._resolve_values(data, seed=seed)
            for key in (
                "body_type", "body_physique", "body_feminine_curves", "bust",
                "butt_shape", "thigh_shape",
            ):
                self.assertIn(resolved[key], config[key])
            self.assertEqual(
                {resolved[key] for key in MODULE.BODY_DETAIL_KEYS},
                set(config["body_details"]),
            )

    def test_long_trousers_locate_hosiery_between_hems_and_footwear(self):
        data = self.defaults()
        data.update({
            "bottom_type": "skinny jeans",
            "bottom_length": "long",
            "bottom_color": "red",
            "hosiery": "opaque tights",
            "hosiery_color": "camel",
            "footwear": "extreme platform stiletto heels with very tall heels and thick platform soles, Pleaser-style",
            "footwear_color": "olive",
        })
        prompt, _, _, pre_gen, _, _ = self.node.build_prompt(seed=4, **data)
        expected = (
            "camel opaque tights worn fully underneath the trousers and visible only in the narrow gap "
            "between the trouser hems and olive extreme platform stiletto heels with very tall heels and "
            "thick platform soles, Pleaser-style"
        )
        for text in (prompt, pre_gen):
            self.assertIn(expected, text)
            self.assertNotIn("underneath only on ankles", text)
            self.assertEqual(text.count("camel opaque tights"), 1)
            self.assertEqual(text.count("olive extreme platform stiletto heels"), 1)

    def test_naturally_long_trousers_are_protected_without_length_widget(self):
        data = self.defaults()
        data.update({
            "bottom_type": "skinny jeans",
            "hosiery": "opaque tights",
            "footwear": "platform shoes",
        })
        prompt, _, _, pre_gen, _, _ = self.node.build_prompt(seed=4, **data)
        expected = (
            "opaque tights worn fully underneath the trousers and visible only in the narrow gap "
            "between the trouser hems and platform shoes"
        )
        for text in (prompt, pre_gen):
            self.assertIn(expected, text)
            self.assertNotIn("wearing skinny jeans, platform shoes, and opaque tights", text)

    def test_full_leg_complete_outfits_use_trouser_layering(self):
        for field, garment in (
            ("dress_type", "utility boiler suit"),
            ("dress_type", "denim overalls"),
            ("bottom_type", "sleek figure-hugging flared jumpsuit"),
        ):
            with self.subTest(garment=garment):
                data = self.defaults()
                data.update({
                    field: garment,
                    "hosiery": "opaque tights",
                    "hosiery_color": "camel",
                    "footwear": "platform shoes",
                    "footwear_color": "olive",
                })
                prompt, _, _, pre_gen, _, _ = self.node.build_prompt(seed=5, **data)
                expected = (
                    "camel opaque tights worn fully underneath its trouser legs and visible only "
                    "in the narrow gap between the cuffs and olive platform shoes"
                )
                for text in (prompt, pre_gen):
                    self.assertIn(expected, text)
                    self.assertEqual(text.count("camel opaque tights"), 1)
                    self.assertEqual(text.count("olive platform shoes"), 1)

    def test_equivalent_hair_length_descriptors_are_not_repeated(self):
        data = self.defaults()
        data.update({
            "hair_color": "light brown",
            "hair_texture": "curly",
            "hair_style": "loose",
            "hair_cut": "shoulder-length",
            "hair_length": "shoulder-length hair",
            "bangs_style": "no bangs",
        })
        prompt, _, _, pre_gen, _, _ = self.node.build_prompt(seed=6, **data)
        for text in (prompt, pre_gen):
            self.assertEqual(text.count("shoulder-length"), 1)


if __name__ == "__main__":
    unittest.main()
