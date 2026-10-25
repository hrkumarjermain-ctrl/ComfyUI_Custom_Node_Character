import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v4_node", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectV4Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {key: "None" for key in self.by_key}

    def test_regional_labels_expand_and_legacy_value_migrates(self):
        self.assertTrue(all(len(text.split()) <= 30 for text in MODULE.CULTURAL_GARMENT_EXPANSIONS.values()))
        data = self.defaults()
        data["dress_type"] = "embroidered anarkali dress with a long flared silhouette"
        resolved = self.node._resolve_values(data, seed=7)
        self.assertEqual(resolved["dress_type"], "Anarkali suit")
        prompt = self.node.build_prompt(seed=7, **data)[0]
        self.assertIn("fitted embroidered bodice", prompt)
        self.assertIn("slim churidar trousers", prompt)
        self.assertIn("shoulder-draped dupatta", prompt)

    def test_every_archetype_phrase_is_manually_reachable(self):
        allowed = {key: set(item["values"]) for key, item in self.by_key.items()}
        failures = []
        for archetype, config in MODULE.BODY_ARCHETYPE_CONFIG.items():
            for key, values in config.items():
                manual_key = "body_detail_1" if key == "body_details" else key
                for value in values:
                    if value is not None and value not in allowed[manual_key]:
                        failures.append((archetype, manual_key, value))
        for archetype, config in MODULE.CLOTHING_ARCHETYPE_CONFIG.items():
            for key, values in config.items():
                if key == "main_modes" or key not in allowed:
                    continue
                for value in values:
                    if value is not None and value not in allowed[key]:
                        failures.append((archetype, key, value))
        self.assertEqual(failures, [])

    def test_body_archetype_priority(self):
        archetype = "Petite Straight Slim"
        config = MODULE.BODY_ARCHETYPE_CONFIG[archetype]

        for selected in ("None", "Random"):
            data = self.defaults()
            data.update({"body_archetype": archetype, "body_type": selected})
            resolved = self.node._resolve_values(data, seed=17)
            self.assertIn(resolved["body_type"], config["body_type"])

        manual = self.defaults()
        manual.update({"body_archetype": archetype, "body_type": "very tall"})
        self.assertEqual(self.node._resolve_values(manual, seed=17)["body_type"], "very tall")

        forced_results = set()
        for seed in range(100):
            forced = self.defaults()
            forced.update({"body_archetype": archetype, "body_type": "Forced Random"})
            forced_results.add(self.node._resolve_values(forced, seed=seed)["body_type"])
        self.assertTrue(forced_results - set(config["body_type"]))

    def test_jewelry_slots_do_not_merge(self):
        data = self.defaults()
        data.update({
            "accessories_jewelry": "gold-toned jewelry",
            "accessories_necklace": "soft ribbon choker",
            "accessories_earrings": "cross earrings",
        })
        prompt = self.node.build_prompt(seed=9, **data)[0]
        self.assertIn("plain pendant-free soft ribbon choker around the neck", prompt)
        self.assertIn("small gold-toned cross-shaped earrings on the ears", prompt)
        self.assertNotIn("gold-toned jewelry, soft ribbon choker", prompt)

    def test_free_prompt_is_present_in_pre_gen_at_all_positions(self):
        for position in ("After introduction", "After makeup", "At end"):
            data = self.defaults()
            data.update({
                "media_type": "photograph",
                "gender": "woman",
                "setting": "in an art-deco ballroom with geometric ornament, open floor space, and distant guests",
                "lighting_style": "overcast daylight",
                "dress_type": "Anarkali suit",
                "origin_ethnicity": "north african",
                "face_shape": "oval face",
                "makeup_eye": "smoky eye makeup",
                "accessories_bag": "handbag",
            })
            marker = f"PREGEN MARKER {position}"
            pre_gen = self.node.build_prompt(
                free_prompt=marker,
                free_prompt_position=position,
                seed=11,
                **data,
            )[3]
            self.assertEqual(pre_gen.count(marker), 1)
            self.assertIn("north african", pre_gen)
            self.assertNotIn("oval face", pre_gen)
            self.assertNotIn("smoky eye makeup", pre_gen)
            self.assertNotIn("handbag", pre_gen)

    def test_contextual_lighting_grammar(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "setting": "in an art-deco ballroom with geometric ornament, open floor space, and distant guests",
            "lighting_style": "overcast daylight",
        })
        prompt = self.node.build_prompt(seed=13, **data)[0]
        self.assertIn("lit by soft diffuse overcast daylight", prompt)
        self.assertNotIn("under overcast daylight", prompt)

    def test_random_lighting_is_compatible_with_every_environment(self):
        for setting in self.by_key["setting"]["values"]:
            for seed in range(8):
                data = self.defaults()
                data.update({"setting": setting, "lighting_style": "Random"})
                resolved = self.node._resolve_values(data, seed=seed)
                family = MODULE.environment_family(setting=resolved.get("setting"))
                self.assertTrue(MODULE.lighting_is_compatible(family, resolved.get("lighting_style")))
        for scenario in self.by_key["scene_scenario"]["values"]:
            for seed in range(8):
                data = self.defaults()
                data.update({"scene_scenario": scenario, "lighting_style": "Random"})
                resolved = self.node._resolve_values(data, seed=seed)
                family = MODULE.environment_family(scenario=resolved.get("scene_scenario"))
                self.assertTrue(MODULE.lighting_is_compatible(family, resolved.get("lighting_style")))

    def test_manual_light_guides_random_environment(self):
        for lighting in ("window light", "overcast daylight", "golden-hour light"):
            for seed in range(100):
                data = self.defaults()
                data.update({"setting": "Random", "lighting_style": lighting})
                resolved = self.node._resolve_values(data, seed=seed)
                family = MODULE.environment_family(setting=resolved.get("setting"))
                self.assertTrue(MODULE.lighting_is_compatible(family, lighting))

    def test_full_random_smoke_and_determinism(self):
        data = {key: "Random" for key in self.by_key}
        data.update({"media_type": "photograph", "gender": "woman", "scene_scenario": "None"})
        for seed in range(300):
            first = self.node._resolve_values(data, seed=seed)
            second = self.node._resolve_values(data, seed=seed)
            self.assertEqual(first, second)
            family = MODULE.environment_family(setting=first.get("setting"))
            self.assertTrue(MODULE.lighting_is_compatible(family, first.get("lighting_style")))
            outputs = self.node.build_prompt(seed=seed, **data)
            self.assertEqual(len(outputs), 6)
            self.assertTrue(outputs[0])
            self.assertTrue(outputs[3])

    def test_frontend_global_random_protections_are_declared(self):
        source = (ROOT / "web" / "character_architect_v17.js").read_text(encoding="utf-8")
        protected_block = source.split("const RANDOM_PROTECTED_KEYS", 1)[1].split("]);", 1)[0]
        for key in (
            "head_accessory", "accessories_glasses", "armwear", "accessories_bag",
            "accessories_scarf", "outerwear", "outerwear_color", "outerwear_wearing_style",
        ):
            self.assertIn(f'"{key}"', protected_block)


if __name__ == "__main__":
    unittest.main()
