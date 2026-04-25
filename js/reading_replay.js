(function (root, factory) {
    let spreadLayout = root.SpreadLayout;
    if (!spreadLayout && typeof require === 'function') {
        spreadLayout = require('./spread_layout.js');
    }

    const api = factory(spreadLayout);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.ReadingReplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (SpreadLayout) {
    const CARD_WIDTH = 2.1;
    const CARD_HEIGHT = 3.7;
    const DEFAULT_VIEWPORT_WIDTH = 16;
    const DEFAULT_VIEWPORT_HEIGHT = 9;

    function numeric(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeReadingCards(reading) {
        if (!reading || !Array.isArray(reading.cards)) return [];
        return reading.cards
            .slice()
            .sort((left, right) => numeric(left.slot) - numeric(right.slot))
            .map(card => ({
                slot: numeric(card.slot),
                cardId: card.cardId,
                slotLabel: card.slotLabel || `Slot ${numeric(card.slot)}`,
                zh: card.zh || '',
                en: card.en || '',
                imageFile: card.imageFile || '',
                isReversed: Boolean(card.isReversed)
            }));
    }

    function computeReplayCards(reading, options = {}) {
        const cards = normalizeReadingCards(reading);
        if (cards.length === 0) return [];

        const layoutApi = options.layoutApi || SpreadLayout;
        if (!layoutApi || typeof layoutApi.computeSpreadLayout !== 'function') {
            throw new Error('SpreadLayout.computeSpreadLayout is required for reading replay');
        }

        const viewportWidth = numeric(options.viewportWidth, DEFAULT_VIEWPORT_WIDTH);
        const viewportHeight = numeric(options.viewportHeight, DEFAULT_VIEWPORT_HEIGHT);
        const cardWidth = numeric(options.cardWidth, CARD_WIDTH);
        const cardHeight = numeric(options.cardHeight, CARD_HEIGHT);
        const layout = layoutApi.computeSpreadLayout(cards.length, {
            ...options,
            viewportWidth,
            viewportHeight,
            cardWidth,
            cardHeight
        });

        return cards.map((card, index) => {
            const item = layout[index] || { x: 0, y: 0, scale: 1 };
            const scale = numeric(item.scale, 1);
            const x = numeric(item.x);
            const y = numeric(item.y);
            return {
                ...card,
                x,
                y,
                scale,
                leftPercent: ((x + viewportWidth / 2) / viewportWidth) * 100,
                topPercent: ((viewportHeight / 2 - y) / viewportHeight) * 100,
                widthPercent: ((cardWidth * scale) / viewportWidth) * 100,
                heightPercent: ((cardHeight * scale) / viewportHeight) * 100,
                orientationLabel: card.isReversed ? '逆位 / Reversed' : '正位 / Upright',
                orientationClass: card.isReversed ? 'reversed' : 'upright'
            };
        });
    }

    return {
        normalizeReadingCards,
        computeReplayCards
    };
});
