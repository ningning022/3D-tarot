import unittest

from consultation_modules import (
    list_public_modules,
    require_enabled_module,
    validate_spread,
)


class TestConsultationModules(unittest.TestCase):
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

    def test_rejects_a_spread_not_allowed_by_the_module(self):
        with self.assertRaisesRegex(ValueError, "Spread is not allowed"):
            validate_spread("general_reading", "choice_six")


if __name__ == "__main__":
    unittest.main()
