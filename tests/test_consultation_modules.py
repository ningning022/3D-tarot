import unittest

from consultation_modules import (
    MODULE_SPECS,
    list_public_modules,
    require_enabled_module,
    validate_spread,
)


class TestConsultationModules(unittest.TestCase):
    def test_returns_the_enabled_general_reading_internal_spec(self):
        spec = require_enabled_module("general_reading")

        self.assertIs(spec, MODULE_SPECS["general_reading"])
        self.assertEqual(spec["module_type"], "general_reading")
        self.assertEqual(spec["display_name"], "普通咨询")
        self.assertEqual(
            spec["description"],
            "围绕一个明确问题进行非宿命、可行动的牌面反思。",
        )
        self.assertTrue(spec["question_required"])
        self.assertEqual(
            spec["input_fields"],
            {
                "userQuery": {"required": True, "maxLength": 500},
                "userContext": {"required": False, "maxLength": 1000},
            },
        )
        self.assertEqual(
            spec["allowed_spreads"],
            ["three_timeline", "five_cross", "celtic_cross", "free"],
        )
        self.assertEqual(spec["default_spread"], "three_timeline")
        self.assertEqual(spec["prompt_version"], "general-v1")
        self.assertTrue(spec["prompt_overlay"])
        self.assertTrue(spec["output_contract"])
        self.assertEqual(
            spec["safety_rules"],
            ["fatalism", "high_stakes_overreach", "dependency_language"],
        )
        self.assertTrue(spec["enabled"])

    def test_lists_the_enabled_general_reading_module(self):
        modules = list_public_modules()

        self.assertEqual(len(modules), 1)
        self.assertEqual(
            modules[0],
            {
                "moduleType": "general_reading",
                "displayName": "普通咨询",
                "description": "围绕一个明确问题进行非宿命、可行动的牌面反思。",
                "questionRequired": True,
                "inputFields": {
                    "userQuery": {"required": True, "maxLength": 500},
                    "userContext": {"required": False, "maxLength": 1000},
                },
                "allowedSpreads": [
                    "three_timeline",
                    "five_cross",
                    "celtic_cross",
                    "free",
                ],
                "defaultSpread": "three_timeline",
            },
        )
        self.assertNotIn("promptOverlay", modules[0])
        self.assertNotIn("safetyRules", modules[0])

    def test_rejects_an_unsupported_module(self):
        with self.assertRaisesRegex(ValueError, "Unsupported moduleType"):
            require_enabled_module("choice_compare")

    def test_rejects_a_disabled_module(self):
        disabled_module_type = "disabled_test_module"
        MODULE_SPECS[disabled_module_type] = {
            **MODULE_SPECS["general_reading"],
            "module_type": disabled_module_type,
            "enabled": False,
        }
        try:
            with self.assertRaisesRegex(ValueError, "^Unsupported moduleType$"):
                require_enabled_module(disabled_module_type)
        finally:
            MODULE_SPECS.pop(disabled_module_type, None)

    def test_returns_the_internal_spec_for_an_allowed_spread(self):
        spec = validate_spread("general_reading", "free")

        self.assertIs(spec, MODULE_SPECS["general_reading"])

    def test_rejects_a_spread_not_allowed_by_the_module(self):
        with self.assertRaisesRegex(ValueError, "Spread is not allowed"):
            validate_spread("general_reading", "choice_six")

    def test_public_module_fields_are_defensive_copies(self):
        first = list_public_modules()[0]
        first["inputFields"]["userQuery"]["required"] = False
        first["allowedSpreads"].append("choice_six")

        fresh = list_public_modules()[0]

        self.assertTrue(
            MODULE_SPECS["general_reading"]["input_fields"]["userQuery"][
                "required"
            ]
        )
        self.assertNotIn(
            "choice_six", MODULE_SPECS["general_reading"]["allowed_spreads"]
        )
        self.assertTrue(fresh["inputFields"]["userQuery"]["required"])
        self.assertNotIn("choice_six", fresh["allowedSpreads"])


if __name__ == "__main__":
    unittest.main()
