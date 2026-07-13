"""Authoritative registry for consultation module capabilities."""

from copy import deepcopy


MODULE_SPECS = {
    "general_reading": {
        "module_type": "general_reading",
        "display_name": "普通咨询",
        "description": "围绕一个明确问题进行非宿命、可行动的牌面反思。",
        "question_required": True,
        "input_fields": [
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
        "allowed_spreads": [
            "three_timeline",
            "five_cross",
            "celtic_cross",
            "free",
        ],
        "default_spread": "three_timeline",
        "prompt_version": "general-v1",
        "prompt_overlay": "直接回应用户问题，综合牌位关系，给出非宿命且可行动的反思。",
        "output_contract": "回应问题、整合牌面、给出用户可控制的下一步。",
        "safety_rules": [
            "fatalism",
            "high_stakes_overreach",
            "dependency_language",
        ],
        "enabled": True,
    },
    "choice_compare": {
        "module_type": "choice_compare",
        "display_name": "二选一",
        "description": "比较两个具体选项的潜力、代价与选择原则，不替你做决定。",
        "question_required": False,
        "input_fields": [
            {
                "key": "optionA",
                "label": "选项 A",
                "type": "textarea",
                "required": True,
                "maxLength": 120,
                "placeholder": "例如：留在当前岗位",
            },
            {
                "key": "optionB",
                "label": "选项 B",
                "type": "textarea",
                "required": True,
                "maxLength": 120,
                "placeholder": "例如：接受新的工作机会",
            },
            {
                "key": "decisionPriorities",
                "label": "你最在意的判断标准",
                "type": "textarea",
                "required": False,
                "maxLength": 200,
                "placeholder": "可选：例如成长空间、稳定性、关系或生活平衡",
            },
        ],
        "allowed_spreads": ["choice_six"],
        "default_spread": "choice_six",
        "prompt_version": "choice-compare-v1",
        "prompt_overlay": (
            "这是二选一反思。分别分析两个选项的潜力与代价，再提炼选择原则；"
            "不得宣布唯一正确答案，不替用户做决定，也不使用宿命论。"
        ),
        "output_contract": (
            "依次说明共同前提、选项 A 的潜力与代价、选项 B 的潜力与代价、"
            "选择原则和用户可以验证的下一步。"
        ),
        "safety_rules": [
            "fatalism",
            "high_stakes_overreach",
            "dependency_language",
        ],
        "enabled": True,
    },
    "symbolic_message": {
        "module_type": "symbolic_message",
        "display_name": "即时传讯",
        "description": "借牌面观察关系氛围、未表达主题与你能采取的边界行动。",
        "question_required": False,
        "input_fields": [
            {
                "key": "relationshipContext",
                "label": "关系背景",
                "type": "textarea",
                "required": True,
                "maxLength": 300,
                "placeholder": "例如：近期减少联系的朋友；请避免填写真实姓名等隐私",
            },
            {
                "key": "focus",
                "label": "这次想关注什么",
                "type": "textarea",
                "required": False,
                "maxLength": 160,
                "placeholder": "可选：例如我该如何理解现在的距离",
            },
        ],
        "allowed_spreads": ["symbolic_message_three"],
        "default_spread": "symbolic_message_three",
        "prompt_version": "symbolic-message-v1",
        "prompt_overlay": (
            "这是关系主题的象征性反思，不是读取第三方真实内心。"
            "不得编造对方原话，不得断言背叛、监视、必然联系或确定未来；"
            "把重点落回用户可观察的关系动态、个人边界与行动。"
        ),
        "output_contract": (
            "先声明象征性边界，再说明情感氛围、可能未表达的主题，"
            "最后给出用户自己的边界与可行动建议。"
        ),
        "safety_rules": [
            "mind_reading",
            "fear_escalation",
            "fatalism",
            "high_stakes_overreach",
        ],
        "enabled": True,
    },
}


def require_enabled_module(module_type):
    """Return an enabled internal module spec or reject the module type."""
    normalized = str(module_type or "")
    spec = MODULE_SPECS.get(normalized)
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
