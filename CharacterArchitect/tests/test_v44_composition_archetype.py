import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("character_architect_v50_composition", ROOT / "node.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompositionArchetypeV44Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = MODULE.CharacterArchitectNode()
        cls.by_key = {item["key"]: item for item in MODULE.SCHEMA["categories"]}

    def test_catalogue_has_fifty_complete_manual_vocabulary_recipes(self):
        self.assertEqual(len(MODULE.COMPOSITION_ARCHETYPE_VALUES), 50)
        self.assertEqual(
            set(MODULE.COMPOSITION_ARCHETYPE_VALUES),
            set(MODULE.COMPOSITION_ARCHETYPE_CONFIG),
        )
        composition_index = next(
            index
            for index, item in enumerate(MODULE.SCHEMA["categories"])
            if item["key"] == "composition_archetype"
        )
        portrait_index = next(
            index
            for index, item in enumerate(MODULE.SCHEMA["categories"])
            if item["key"] == "portrait_style"
        )
        self.assertEqual(composition_index + 1, portrait_index)

        allowed = {
            field: set(self.by_key[field]["values"])
            for field in MODULE.COMPOSITION_ARCHETYPE_CONTROL_FIELDS
            if field != "eye_focus"
        }
        allowed["eye_focus"] = set(MODULE.EYE_FOCUS_VALUES)
        allowed["pose"].add(None)
        covered_poses = set()
        for config in MODULE.COMPOSITION_ARCHETYPE_CONFIG.values():
            self.assertEqual(set(config), MODULE.COMPOSITION_ARCHETYPE_CONTROL_FIELDS)
            for field, values in config.items():
                self.assertTrue(values)
                self.assertFalse(set(values) - allowed[field])
            covered_poses.update(value for value in config["pose"] if value)
        self.assertEqual(covered_poses, set(self.by_key["pose"]["values"]))

    def test_every_archetype_resolves_deterministically(self):
        for archetype in MODULE.COMPOSITION_ARCHETYPE_VALUES:
            with self.subTest(archetype=archetype):
                first = self.node._resolve_values(
                    {"composition_archetype": archetype}, seed=718, eye_focus="Random"
                )
                second = self.node._resolve_values(
                    {"composition_archetype": archetype}, seed=718, eye_focus="Random"
                )
                self.assertEqual(first, second)
                self.assertEqual(first["composition_archetype"], archetype)
                for field in MODULE.COMPOSITION_ARCHETYPE_CONTROL_FIELDS:
                    if field == "pose" and first[field] is None:
                        continue
                    allowed = (
                        MODULE.EYE_FOCUS_VALUES
                        if field == "eye_focus"
                        else self.by_key[field]["values"]
                    )
                    self.assertIn(first[field], allowed)

    def test_every_archetype_builds_full_and_pregen_prompts(self):
        for index, archetype in enumerate(MODULE.COMPOSITION_ARCHETYPE_VALUES):
            with self.subTest(archetype=archetype):
                prompt, face, inspected, pregen, _, _ = self.node.build_prompt(
                    composition_archetype=archetype,
                    media_type="photograph",
                    gender="woman",
                    origin_age="late twenties",
                    setting="in a working professional photo studio with neutral backdrops and subtle production activity",
                    inspect_property="composition_archetype",
                    seed=index + 100,
                )
                self.assertTrue(prompt.startswith("A photograph"))
                self.assertTrue(face.startswith("A photograph"))
                self.assertTrue(pregen.startswith("A photograph"))
                self.assertEqual(inspected, archetype)
                self.assertNotIn(archetype, prompt)
                self.assertNotIn(archetype, pregen)

    def test_manual_and_forced_random_fields_outrank_archetype(self):
        manual_pose = "standing naturally with both arms folded across the chest"
        resolved = self.node._resolve_values(
            {
                "composition_archetype": "Open Supine",
                "pose": manual_pose,
                "camera_direction": "profile view",
            },
            seed=44,
        )
        self.assertEqual(resolved["pose"], manual_pose)
        self.assertEqual(resolved["camera_direction"], "profile view")

        without_archetype = self.node._resolve_values(
            {"camera_angle": "Forced Random"}, seed=44
        )
        with_archetype = self.node._resolve_values(
            {
                "composition_archetype": "High-Angle Intimate Portrait",
                "camera_angle": "Forced Random",
            },
            seed=44,
        )
        self.assertEqual(with_archetype["camera_angle"], without_archetype["camera_angle"])

        prompt, _, _, _, _, _ = self.node.build_prompt(
            composition_archetype="Focused Handheld Object",
            eye_focus=MODULE.DIRECT_EYE_FOCUS,
            media_type="photograph",
            gender="woman",
            seed=44,
        )
        self.assertIn(MODULE.DIRECT_EYE_FOCUS, prompt)
        self.assertNotIn(MODULE.HELD_OBJECT_FOCUS, prompt)

        explicit_conflict = self.node._resolve_values(
            {
                "composition_archetype": "Direct Headshot",
                "camera_angle": MODULE.HIGH_ANGLE,
                "shot_composition": MODULE.HIGH_FRAME_PLACEMENT,
            },
            seed=44,
        )
        self.assertEqual(explicit_conflict["camera_angle"], MODULE.HIGH_ANGLE)
        self.assertEqual(
            explicit_conflict["shot_composition"], MODULE.HIGH_FRAME_PLACEMENT
        )

    def test_close_manual_framing_suppresses_invisible_archetype_pose(self):
        resolved = self.node._resolve_values(
            {
                "composition_archetype": "Grounded Crouch",
                "portrait_style": "headshot portrait",
            },
            seed=12,
        )
        self.assertEqual(resolved["portrait_style"], "headshot portrait")
        self.assertIsNone(resolved["pose"])

    def test_random_scenario_branch_is_ten_percent_and_mutually_exclusive(self):
        scenario_hits = 0
        archetypes_seen = set()
        for seed in range(1000):
            resolved = self.node._resolve_values(
                {"composition_archetype": "Random", "scene_scenario": "Random"},
                seed=seed,
            )
            if resolved["scene_scenario"]:
                scenario_hits += 1
                self.assertIsNone(resolved["composition_archetype"])
                self.assertIsNone(resolved["pose"])
                self.assertIsNone(resolved["setting"])
            else:
                archetypes_seen.add(resolved["composition_archetype"])
                self.assertIn(
                    resolved["composition_archetype"],
                    MODULE.COMPOSITION_ARCHETYPE_VALUES,
                )
        self.assertEqual(scenario_hits, 99)
        self.assertGreaterEqual(len(archetypes_seen), 45)

    def test_manual_archetype_suppresses_only_ordinary_random_scenario(self):
        for seed in range(100):
            resolved = self.node._resolve_values(
                {
                    "composition_archetype": "Direct Headshot",
                    "scene_scenario": "Random",
                },
                seed=seed,
            )
            self.assertIsNone(resolved["scene_scenario"])
            self.assertEqual(
                resolved["composition_archetype"],
                MODULE.LEGACY_COMPOSITION_ARCHETYPE_LABELS["Direct Headshot"],
            )

        for scenario in (MODULE.CAR_DRIVING_SCENARIO, "Forced Random"):
            resolved = self.node._resolve_values(
                {
                    "composition_archetype": "Direct Headshot",
                    "scene_scenario": scenario,
                },
                seed=31,
            )
            self.assertTrue(resolved["scene_scenario"])
            self.assertIsNone(resolved["composition_archetype"])
            self.assertIsNone(resolved["pose"])
            self.assertIsNone(resolved["setting"])

    def test_external_pose_and_photography_suspend_but_setting_keeps_archetype(self):
        base = {
            "composition_archetype": "Rear Look-Back Portrait",
            "media_type": "photograph",
            "gender": "woman",
            "inspect_property": "composition_archetype",
            "seed": 9,
        }
        _, _, inspected, _, _, _ = self.node.build_prompt(
            **base, pose_text_override="standing in a custom unclassified pose"
        )
        self.assertEqual(inspected, "")

        _, _, inspected, _, _, _ = self.node.build_prompt(
            **base, wildcard_photography="a custom cyanotype close framing"
        )
        self.assertEqual(inspected, "")

        _, _, inspected, _, _, _ = self.node.build_prompt(
            **base,
            override_field="camera_direction",
            override_text="custom camera orbit supplied as free text",
        )
        self.assertEqual(inspected, "")

        prompt, _, inspected, _, _, _ = self.node.build_prompt(
            **base, setting_text_override="inside a custom greenhouse"
        )
        self.assertEqual(
            inspected,
            MODULE.LEGACY_COMPOSITION_ARCHETYPE_LABELS["Rear Look-Back Portrait"],
        )
        self.assertIn("inside a custom greenhouse", prompt)
        self.assertIn("looking back over one shoulder", prompt)

    def test_camera_focus_is_majority_without_breaking_contextual_actions(self):
        direct = 0
        near_camera = 0
        total = 0
        for archetype in MODULE.COMPOSITION_ARCHETYPE_VALUES:
            for seed in range(100):
                resolved = self.node._resolve_values(
                    {"composition_archetype": archetype},
                    seed=seed,
                    eye_focus="Random",
                )
                focus = resolved.get("eye_focus")
                total += 1
                direct += focus == MODULE.DIRECT_EYE_FOCUS
                near_camera += focus in {
                    MODULE.DIRECT_EYE_FOCUS,
                    MODULE.PAST_CAMERA_FOCUS,
                }
        self.assertGreaterEqual(direct / total, 0.58)
        self.assertGreaterEqual(near_camera / total, 0.75)

        object_focuses = {
            self.node._resolve_values(
                {"composition_archetype": "Focused Handheld Object"},
                seed=seed,
                eye_focus="Random",
            )["eye_focus"]
            for seed in range(100)
        }
        self.assertIn(MODULE.HELD_OBJECT_FOCUS, object_focuses)

    def test_resolved_relations_have_no_known_hard_geometry_conflicts(self):
        for archetype in MODULE.COMPOSITION_ARCHETYPE_VALUES:
            for seed in range(100):
                resolved = self.node._resolve_values(
                    {"composition_archetype": archetype},
                    seed=seed,
                    eye_focus="Random",
                )
                angle = resolved["camera_angle"]
                placement = resolved["shot_composition"]
                self.assertFalse(
                    angle in MODULE.HIGH_CAMERA_ANGLES
                    and placement == MODULE.HIGH_FRAME_PLACEMENT
                )
                self.assertFalse(
                    angle in MODULE.LOW_CAMERA_ANGLES
                    and placement == MODULE.LOW_FRAME_PLACEMENT
                )
                if (
                    resolved["camera_direction"] == "rear three-quarter view"
                    and resolved["eye_focus"] in {
                        MODULE.DIRECT_EYE_FOCUS,
                        MODULE.PAST_CAMERA_FOCUS,
                    }
                ):
                    self.assertEqual(
                        resolved["head_direction"],
                        "looking back over one shoulder",
                    )

    def test_archetype_label_is_inspectable_but_not_written_into_prompt(self):
        prompt, _, inspected, pregen, _, _ = self.node.build_prompt(
            composition_archetype="Balanced Low Squat",
            media_type="photograph",
            gender="woman",
            inspect_property="composition_archetype",
            seed=19,
        )
        new_label = MODULE.LEGACY_COMPOSITION_ARCHETYPE_LABELS["Balanced Low Squat"]
        self.assertEqual(inspected, new_label)
        self.assertNotIn("Balanced Low Squat", prompt)
        self.assertNotIn("Balanced Low Squat", pregen)
        self.assertNotIn(new_label, prompt)
        self.assertNotIn(new_label, pregen)
        self.assertIn("low squat", prompt)
        self.assertIn("low squat", pregen)


if __name__ == "__main__":
    unittest.main()
