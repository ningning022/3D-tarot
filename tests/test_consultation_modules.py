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
            [
                {
                    "key": "userQuery",
                    "label": "你的问题",
                    "type": "textarea",
                    "required": True,
                    "maxLength": 500,
                    "placeholder": "例如：我该如何面对最近的工作变化？",
                },
                {
                    "key": "userContext",
                    "label": "补充背景",
                    "type": "textarea",
                    "required": False,
                    "maxLength": 1000,
                    "placeholder": "可选：只填写会影响解读的必要背景。",
                },
            ],
        )
        self.assertEqual(
            spec["allowed_spreads"],
            ["three_timeline", "five_cross", "celtic_cross", "free"],
        )
        self.assertEqual(spec["default_spread"], "three_timeline")
        self.assertEqual(spec["prompt_version"], "general-v1")
        self.assertEqual(
            spec["prompt_overlay"],
            "直接回应用户问题，综合牌位关系，给出非宿命且可行动的反思。",
        )
        self.assertIsInstance(spec["prompt_overlay"], str)
        self.assertEqual(
            spec["output_contract"],
            "回应问题、整合牌面、给出用户可控制的下一步。",
        )
        self.assertIsInstance(spec["output_contract"], str)
        self.assertEqual(
            spec["safety_rules"],
            ["fatalism", "high_stakes_overreach", "dependency_language"],
        )
        self.assertTrue(spec["enabled"])

    def test_lists_all_enabled_modules_without_internal_prompts(self):
        modules = list_public_modules()

        self.assertEqual(
            [module["moduleType"] for module in modules],
            ["general_reading", "choice_compare", "symbolic_message"],
        )
        self.assertEqual(
            modules[0],
            {
                "moduleType": "general_reading",
                "displayName": "普通咨询",
                "description": "围绕一个明确问题进行非宿命、可行动的牌面反思。",
                "questionRequired": True,
                "inputFields": [
                    {
                        "key": "userQuery",
                        "label": "你的问题",
                        "type": "textarea",
                        "required": True,
                        "maxLength": 500,
                        "placeholder": "例如：我该如何面对最近的工作变化？",
                    },
                    {
                        "key": "userContext",
                        "label": "补充背景",
                        "type": "textarea",
                        "required": False,
                        "maxLength": 1000,
                        "placeholder": "可选：只填写会影响解读的必要背景。",
                    },
                ],
                "allowedSpreads": [
                    "three_timeline",
                    "five_cross",
                    "celtic_cross",
                    "free",
                ],
                "defaultSpread": "three_timeline",
            },
        )
        choice = modules[1]
        self.assertEqual(choice["displayName"], "二选一")
        self.assertFalse(choice["questionRequired"])
        self.assertEqual(
            [field["key"] for field in choice["inputFields"]],
            ["optionA", "optionB", "decisionPriorities"],
        )
        self.assertEqual(
            [field["required"] for field in choice["inputFields"]],
            [True, True, False],
        )
        self.assertEqual(choice["allowedSpreads"], ["choice_six"])
        self.assertEqual(choice["defaultSpread"], "choice_six")

        message = modules[2]
        self.assertEqual(message["displayName"], "即时传讯")
        self.assertFalse(message["questionRequired"])
        self.assertEqual(
            [field["key"] for field in message["inputFields"]],
            ["relationshipContext", "focus"],
        )
        self.assertEqual(
            [field["required"] for field in message["inputFields"]],
            [True, False],
        )
        self.assertEqual(message["allowedSpreads"], ["symbolic_message_three"])
        self.assertEqual(message["defaultSpread"], "symbolic_message_three")

        for module in modules:
            self.assertNotIn("promptOverlay", module)
            self.assertNotIn("outputContract", module)
            self.assertNotIn("safetyRules", module)
            self.assertNotIn("promptVersion", module)

    def test_rejects_an_unsupported_module(self):
        with self.assertRaisesRegex(ValueError, "Unsupported moduleType"):
            require_enabled_module("not_a_real_module")

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
            public_module_types = {
                module["moduleType"] for module in list_public_modules()
            }
            self.assertNotIn(disabled_module_type, public_module_types)
        finally:
            MODULE_SPECS.pop(disabled_module_type, None)

    def test_rejects_non_hashable_or_empty_module_types(self):
        for module_type in (None, [], {}):
            with self.subTest(module_type=module_type):
                with self.assertRaisesRegex(ValueError, "^Unsupported moduleType$"):
                    require_enabled_module(module_type)

    def test_returns_the_internal_spec_for_an_allowed_spread(self):
        spec = validate_spread("general_reading", "free")

        self.assertIs(spec, MODULE_SPECS["general_reading"])

        self.assertIs(
            validate_spread("choice_compare", "choice_six"),
            MODULE_SPECS["choice_compare"],
        )
        self.assertIs(
            validate_spread("symbolic_message", "symbolic_message_three"),
            MODULE_SPECS["symbolic_message"],
        )

    def test_rejects_a_spread_not_allowed_by_the_module(self):
        with self.assertRaisesRegex(ValueError, "Spread is not allowed"):
            validate_spread("general_reading", "choice_six")

    def test_public_module_fields_are_defensive_copies(self):
        first = list_public_modules()[0]
        first["inputFields"][0]["required"] = False
        first["inputFields"].reverse()
        first["allowedSpreads"].append("choice_six")

        fresh = list_public_modules()[0]

        self.assertTrue(
            MODULE_SPECS["general_reading"]["input_fields"][0]["required"]
        )
        self.assertEqual(
            [
                field["key"]
                for field in MODULE_SPECS["general_reading"]["input_fields"]
            ],
            ["userQuery", "userContext"],
        )
        self.assertNotIn(
            "choice_six", MODULE_SPECS["general_reading"]["allowed_spreads"]
        )
        self.assertTrue(fresh["inputFields"][0]["required"])
        self.assertEqual(
            [field["key"] for field in fresh["inputFields"]],
            ["userQuery", "userContext"],
        )
        self.assertEqual(
            [field["label"] for field in fresh["inputFields"]],
            ["你的问题", "补充背景"],
        )
        self.assertNotIn("choice_six", fresh["allowedSpreads"])


if __name__ == "__main__":
    unittest.main()
