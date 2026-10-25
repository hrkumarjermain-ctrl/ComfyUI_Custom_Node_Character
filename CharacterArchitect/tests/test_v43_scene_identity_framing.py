import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v43", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CharacterArchitectV43Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def defaults(self):
        return {item["key"]: item.get("default", "None") for item in MODULE.SCHEMA["categories"]}

    def test_catalogue_sizes_and_new_lying_poses(self):
        self.assertEqual(len(self.by_key["setting"]["values"]), 149)
        self.assertEqual(len(self.by_key["scene_scenario"]["values"]), 43)
        self.assertEqual(len(self.by_key["pose"]["values"]), 59)
        for pose in (
            "lying on the back with the legs comfortably spread apart and the arms resting naturally",
            "lying on the side with the head supported by one hand and the legs relaxed",
            "lying on the back with one knee bent and the other leg extended",
            "lying on the stomach with the upper body gently raised on the forearms",
            "lying curled slightly on one side with the knees loosely drawn upward",
            "reclining on the back with both knees bent and the feet resting on the supporting surface",
        ):
            self.assertIn(pose, self.by_key["pose"]["values"])

        framing_switch = MODULE.CharacterArchitectNode.INPUT_TYPES()["optional"]["enforce_portrait_framing"]
        self.assertEqual(framing_switch[0], "BOOLEAN")
        self.assertFalse(framing_switch[1]["default"])

    def test_context_actions_moved_to_scenarios_with_legacy_migration(self):
        pose_values = self.by_key["pose"]["values"]
        scenario_values = self.by_key["scene_scenario"]["values"]
        for old_pose, scenario in MODULE.LEGACY_ACTION_POSE_TO_SCENARIO.items():
            self.assertNotIn(old_pose, pose_values)
            self.assertIn(scenario, scenario_values)
            resolved = self.node._resolve_values({"pose": old_pose}, seed=4)
            self.assertIsNone(resolved["pose"])
            self.assertEqual(resolved["scene_scenario"], scenario)

    def test_tattoo_scenario_is_pre_session_and_has_no_contact(self):
        scenarios = self.by_key["scene_scenario"]["values"]
        tattoo = next(value for value in scenarios if "tattoo studio" in value)
        self.assertIn("preparing to begin", tattoo)
        self.assertIn("before any tattooing has started", tattoo)
        self.assertNotIn("works nearby", tattoo)

    def test_ordinary_random_scenario_is_rare_and_subordinate(self):
        draws = 1000
        scenario_hits = sum(
            bool(self.node._resolve_values({"scene_scenario": "Random"}, seed=seed)["scene_scenario"])
            for seed in range(draws)
        )
        self.assertGreaterEqual(scenario_hits, 75)
        self.assertLessEqual(scenario_hits, 125)

        for authority in ("standing with the weight shifted softly onto one hip", "Forced Random"):
            resolved = self.node._resolve_values(
                {"scene_scenario": "Random", "pose": authority}, seed=17
            )
            self.assertIsNone(resolved["scene_scenario"])

        resolved = self.node._resolve_values(
            {"scene_scenario": "Random", "setting": "Forced Random"}, seed=17
        )
        self.assertIsNone(resolved["scene_scenario"])

    def test_vehicle_scenario_guides_only_ordinary_random_camera_geometry(self):
        resolved = self.node._resolve_values({
            "scene_scenario": MODULE.CAR_DRIVING_SCENARIO,
            "portrait_style": "Random",
            "camera_direction": "Random",
            "camera_angle": "Random",
        }, seed=27)
        self.assertIn(resolved["portrait_style"], {"three-quarter portrait", "full-body portrait"})
        self.assertIn(resolved["camera_direction"], {"front-facing view", "three-quarter view", "profile view"})
        self.assertNotIn(resolved["camera_angle"], {
            "from an extreme worm's-eye angle at ground level, with the camera looking sharply upward",
            "from an overhead bird's-eye angle, with the camera looking straight down",
        })

        manual = self.node._resolve_values({
            "scene_scenario": MODULE.CAR_DRIVING_SCENARIO,
            "portrait_style": "headshot portrait",
            "camera_direction": "rear three-quarter view",
            "camera_angle": "from an overhead bird's-eye angle, with the camera looking straight down",
        }, seed=27)
        self.assertEqual(manual["portrait_style"], "headshot portrait")
        self.assertEqual(manual["camera_direction"], "rear three-quarter view")
        self.assertEqual(
            manual["camera_angle"],
            "from an overhead bird's-eye angle, with the camera looking straight down",
        )

    def test_external_pose_setting_sources_suppress_scenario(self):
        base = self.defaults()
        base["scene_scenario"] = MODULE.CAR_DRIVING_SCENARIO
        full = self.node.build_prompt(
            seed=1,
            setting_text_override="inside a reference-guided lunar greenhouse",
            **base,
        )[0]
        self.assertIn("reference-guided lunar greenhouse", full)
        self.assertNotIn("production passenger car", full)

        full = self.node.build_prompt(
            seed=1,
            override_field="pose",
            override_text="standing motionless beside a marker",
            **base,
        )[0]
        self.assertIn("standing motionless beside a marker", full)
        self.assertNotIn("production passenger car", full)

    def test_identity_forge_context_beats_only_ordinary_random_scenario(self):
        seed = next(
            candidate for candidate in range(500)
            if self.node._resolve_values({"scene_scenario": "Random"}, seed=candidate)["scene_scenario"]
        )
        identity = json.dumps({
            "Setting & Shot": {
                "location": "inside an Identity Forge lifeguard station with rescue equipment"
            }
        })
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "scene_scenario": "Random",
        })
        full = self.node.build_prompt(identity_forge_json=identity, seed=seed, **data)[0]
        self.assertIn("Identity Forge lifeguard station", full)
        for scenario in self.by_key["scene_scenario"]["values"]:
            self.assertNotIn(scenario, full)

    def test_body_detail_bust_projection_is_manual_and_random_reachable(self):
        phrase = "very full bust with pronounced forward projection"
        for key in MODULE.BODY_DETAIL_KEYS:
            self.assertIn(phrase, self.by_key[key]["values"])
        self.assertEqual(MODULE.BODY_DETAIL_AXES[phrase], "bust_projection")
        reached = {
            self.node._resolve_values({"body_detail_1": "Random"}, seed=seed)["body_detail_1"]
            for seed in range(300)
        }
        self.assertIn(phrase, reached)

    def test_pre_gen_includes_simple_ethnicity_but_not_guidance(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "origin_age": "late twenties",
            "origin_ethnicity": "central asian",
            "eye_color": "dark brown",
        })
        full, _, _, pre_gen, _, _ = self.node.build_prompt(
            ethnicity_guidance=True, seed=3, **data
        )
        self.assertIn("strongly recognizable central asian facial features", full)
        self.assertIn("central asian woman", pre_gen)
        self.assertNotIn("strongly recognizable central asian facial features", pre_gen)
        self.assertNotIn("extremely narrow and squashed eyes", pre_gen)

    def test_enforce_portrait_framing_returns_one_minimal_sentence(self):
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "portrait_style": "headshot portrait",
            "capture_style": "glamour",
            "origin_age": "late twenties",
            "origin_ethnicity": "southeast asian",
            "gender": "woman",
            "content_rating": "glamour/sexy/explicit",
            "pose": "lying on the back with one knee bent and the other leg extended",
            "setting": "inside a spacious supermarket aisle with stocked shelves, shopping carts, overhead signs, and distant customers",
            "body_physique": "plump physique",
            "hair_color": "black",
            "dress_type": "little black dress",
        })
        pre_gen = self.node.build_prompt(
            enforce_portrait_framing=True,
            free_prompt="DO NOT KEEP THIS",
            enhance_realism=True,
            seed=5,
            **data,
        )[3]
        self.assertEqual(
            pre_gen,
            "A photograph, headshot glamour portrait of a late twenties southeast asian woman.",
        )

    def test_enforced_creature_framing_keeps_fundamental_subject_type(self):
        identity = json.dumps({
            "_meta": {"creature_of": "fox", "form": "Anthropomorphic"},
            "Species & Anatomy": {"head": "a fox head", "integument": "red fox fur"},
        })
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "portrait_style": "headshot portrait",
            "gender": "woman",
            "dress_type": "little black dress",
        })
        pre_gen = self.node.build_prompt(
            identity_forge_json=identity,
            enforce_portrait_framing=True,
            seed=2,
            **data,
        )[3]
        self.assertIn("feminine anthropomorphic fox", pre_gen)
        self.assertNotIn("little black dress", pre_gen)
        self.assertEqual(pre_gen.count("."), 1)

    def test_identity_archetype_survives_manual_clothing(self):
        identity = json.dumps({
            "_meta": {"archetype": "Lifeguard"},
            "Clothing": {"outfit_description": "red lifeguard uniform with rescue whistle"},
        })
        data = self.defaults()
        data.update({
            "media_type": "photograph",
            "gender": "woman",
            "lingerie_type": "one-piece swimsuit",
            "lingerie_color": "yellow",
        })
        full, _, _, pre_gen, _, _ = self.node.build_prompt(
            identity_forge_json=identity, seed=8, **data
        )
        for prompt in (full, pre_gen):
            self.assertIn("embodies the Lifeguard character archetype", prompt)
            self.assertIn("yellow one-piece swimsuit", prompt)
            self.assertNotIn("red lifeguard uniform", prompt)

        wildcard_full, _, _, wildcard_pre_gen, _, _ = self.node.build_prompt(
            identity_forge_json=identity,
            wildcard_subject="a custom wildcard subject",
            seed=8,
            **data,
        )
        for prompt in (wildcard_full, wildcard_pre_gen):
            self.assertNotIn("Lifeguard character archetype", prompt)

    def test_cosplayer_label_is_a_persistent_identity_anchor(self):
        identity = json.dumps({"_meta": {"cosplay_of": "Lara Croft"}})
        data = self.defaults()
        data.update({"media_type": "photograph", "gender": "woman", "dress_type": "little black dress"})
        full, _, _, pre_gen, _, _ = self.node.build_prompt(identity_forge_json=identity, seed=6, **data)
        for prompt in (full, pre_gen):
            self.assertIn("The subject is portrayed as Lara Croft.", prompt)


if __name__ == "__main__":
    unittest.main()
