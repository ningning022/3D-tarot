"""Authoritative registry for consultation module capabilities."""

from copy import deepcopy


MODULE_SPECS = {
    "general_reading": {
        "module_type": "general_reading",
        "display_name": "普通咨询",
        "description": "围绕一个明确问题进行非宿命、可行动的牌面反思。",
        "question_required": True,
        "input_fields": {
            "userQuery": {"required": True, "maxLength": 500},
            "userContext": {"required": False, "maxLength": 1000},
        },
        "allowed_spreads": [
            "three_timeline",
            "five_cross",
            "celtic_cross",
            "free",
        ],
        "default_spread": "three_timeline",
        "prompt_version": "general-v1",
        "prompt_overlay": "围绕用户的明确问题，提供非宿命、可行动的牌面反思。",
        "output_contract": {
            "required": ["summary", "cardInsights", "actions"],
        },
        "safety_rules": [
            "fatalism",
            "high_stakes_overreach",
            "dependency_language",
        ],
        "enabled": True,
    }
}


def require_enabled_module(module_type):
    """Return an enabled internal module spec or reject the module type."""
    spec = MODULE_SPECS.get(module_type)
    if spec is None or not spec["enabled"]:
        raise ValueError("Unsupported moduleType")
    return spec


def validate_spread(module_type, template_key):
    """Return the module spec when the requested spread is allowed."""
    spec = require_enabled_module(module_type)
    if template_key not in spec["allowed_spreads"]:
        raise ValueError("Spread is not allowed for moduleType")
    return spec


def list_public_modules():
    """Return enabled module metadata without internal prompt or safety fields."""
    modules = []
    for spec in MODULE_SPECS.values():
        if not spec["enabled"]:
            continue
        modules.append(
            {
                "moduleType": spec["module_type"],
                "displayName": spec["display_name"],
                "description": spec["description"],
                "questionRequired": spec["question_required"],
                "inputFields": deepcopy(spec["input_fields"]),
                "allowedSpreads": list(spec["allowed_spreads"]),
                "defaultSpread": spec["default_spread"],
            }
        )
    return modules
