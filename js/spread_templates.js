(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.SpreadTemplates = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    const TEMPLATES = [
        {
            key: 'three_timeline',
            name: '三张牌 / Past Present Future',
            fixedCount: 3,
            slots: [
                { slot: 1, label: '过去 / Past' },
                { slot: 2, label: '现在 / Present' },
                { slot: 3, label: '未来 / Future' }
            ]
        },
        {
            key: 'five_cross',
            name: '五张牌 / Five-Card Cross',
            fixedCount: 5,
            slots: [
                { slot: 1, label: '问题 / Issue' },
                { slot: 2, label: '阻碍 / Challenge' },
                { slot: 3, label: '潜意识 / Subconscious' },
                { slot: 4, label: '建议 / Advice' },
                { slot: 5, label: '结果 / Outcome' }
            ]
        },
        {
            key: 'celtic_cross',
            name: '凯尔特十字 / Celtic Cross',
            fixedCount: 10,
            slots: [
                { slot: 1, label: '现状 / Present' },
                { slot: 2, label: '交叉 / Crossing' },
                { slot: 3, label: '根源 / Foundation' },
                { slot: 4, label: '过去 / Recent Past' },
                { slot: 5, label: '显意识 / Conscious' },
                { slot: 6, label: '未来 / Near Future' },
                { slot: 7, label: '自己 / Self' },
                { slot: 8, label: '环境 / Environment' },
                { slot: 9, label: '希望恐惧 / Hopes and Fears' },
                { slot: 10, label: '结果 / Outcome' }
            ]
        },
        {
            key: 'choice_six',
            name: '二选一 / Choice Comparison',
            fixedCount: 6,
            slots: [
                { slot: 1, label: '共同核心 / Shared Need' },
                { slot: 2, label: '选项 A：潜力 / A Potential' },
                { slot: 3, label: '选项 A：代价 / A Cost' },
                { slot: 4, label: '选项 B：潜力 / B Potential' },
                { slot: 5, label: '选项 B：代价 / B Cost' },
                { slot: 6, label: '选择原则 / Decision Principle' }
            ]
        },
        {
            key: 'symbolic_message_three',
            name: '即时传讯 / Symbolic Message',
            fixedCount: 3,
            slots: [
                { slot: 1, label: '情感氛围 / Emotional Climate' },
                { slot: 2, label: '未表达主题 / Unspoken Theme' },
                { slot: 3, label: '你的边界与行动 / Your Boundary and Action' }
            ]
        },
        {
            key: 'free',
            name: '自由牌阵 / Free Spread',
            fixedCount: null,
            slots: []
        }
    ];

    let activeKey = 'three_timeline';

    function getTemplates() {
        return TEMPLATES.slice();
    }

    function filterTemplates(allowedKeys) {
        const allowed = new Set(Array.isArray(allowedKeys) ? allowedKeys : []);
        return TEMPLATES.filter(template => allowed.has(template.key));
    }

    function getTemplate(key) {
        return TEMPLATES.find(template => template.key === key) || TEMPLATES[0];
    }

    function getActiveTemplate() {
        return getTemplate(activeKey);
    }

    function setActiveTemplate(key) {
        if (TEMPLATES.some(template => template.key === key)) {
            activeKey = key;
        }
        return getActiveTemplate();
    }

    function fallbackSlotLabel(slot) {
        return `Slot ${slot}`;
    }

    function resolveSpreadPlan(template, selectedCards = [], drawFallback = () => null) {
        const currentTemplate = template || getActiveTemplate();
        const selected = (selectedCards || []).filter(Boolean);
        const fixedCount = Number.isFinite(currentTemplate.fixedCount)
            ? currentTemplate.fixedCount
            : null;
        const totalCards = fixedCount || Math.max(3, selected.length || 0);
        const cards = selected.slice(0, totalCards);

        while (cards.length < totalCards) {
            const fallback = drawFallback(cards.length + 1);
            if (!fallback) break;
            cards.push(fallback);
        }

        return {
            templateKey: currentTemplate.key,
            templateName: currentTemplate.name,
            selectedCards: cards,
            totalCards,
            slotLabels: Array.from({ length: totalCards }, (_, index) => {
                const slot = index + 1;
                const templateSlot = currentTemplate.slots[index];
                return templateSlot ? templateSlot.label : fallbackSlotLabel(slot);
            })
        };
    }

    function bindTemplateSelector(containerId = 'spread-template-ring') {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;
        const buttons = Array.from(container.querySelectorAll('[data-template]'));
        function render() {
            const active = getActiveTemplate();
            buttons.forEach(button => {
                button.classList.toggle('active', button.dataset.template === active.key);
            });
        }
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                setActiveTemplate(button.dataset.template);
                render();
            });
        });
        render();
    }

    return {
        getTemplates,
        filterTemplates,
        getTemplate,
        getActiveTemplate,
        setActiveTemplate,
        resolveSpreadPlan,
        bindTemplateSelector
    };
});
