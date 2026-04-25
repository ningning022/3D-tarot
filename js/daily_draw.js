(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.DailyDraw = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function getLocalDateString(date = new Date()) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function buildDailyReadingPayload({ date, cardId, card, isReversed }) {
        return {
            kind: 'daily',
            templateKey: 'daily_draw',
            templateName: '每日一牌 / Daily Draw',
            readingDate: date,
            spreadNumber: 0,
            cards: [
                {
                    slot: 1,
                    slotLabel: '今日牌 / Daily Card',
                    cardId,
                    zh: card.zh,
                    en: card.en,
                    imageFile: card.file || card.imageFile,
                    isReversed: Boolean(isReversed)
                }
            ]
        };
    }

    function pickDailyCard(deck, randomFn = Math.random) {
        const cards = Array.isArray(deck) ? deck : [];
        if (cards.length === 0) return null;
        const cardId = Math.floor(randomFn() * cards.length);
        return {
            cardId,
            card: cards[cardId],
            isReversed: randomFn() < 0.5
        };
    }

    async function loadOrCreateToday(options = {}) {
        const api = options.api || (typeof window !== 'undefined' ? window.TarotAPI : null);
        const browserDeck = typeof FULL_DECK !== 'undefined' ? FULL_DECK : null;
        const deck = options.deck || browserDeck;
        const date = options.date || getLocalDateString();
        const randomFn = options.randomFn || Math.random;
        if (!api) return null;

        const existing = await api.loadDailyDraw(date);
        if (existing) return existing;

        const picked = pickDailyCard(deck, randomFn);
        if (!picked) return null;
        const payload = buildDailyReadingPayload({ date, ...picked });
        return api.saveDailyDraw(payload);
    }

    function cardFromReading(reading) {
        if (!reading || !Array.isArray(reading.cards)) return null;
        return reading.cards[0] || null;
    }

    function renderDailyDraw(container, reading) {
        if (!container) return;
        const card = cardFromReading(reading);
        if (!card) {
            container.innerHTML = '<div class="daily-title">今日牌 / Daily Draw</div><div class="daily-empty">等待本地数据库 / Awaiting local record</div>';
            return;
        }
        const orient = card.isReversed ? '逆位 / Reversed' : '正位 / Upright';
        const imageClass = card.isReversed ? 'daily-card-image reversed' : 'daily-card-image upright';
        container.innerHTML = `
            <div class="daily-title">今日牌 / Daily Draw</div>
            <div class="daily-date">${reading.readingDate || getLocalDateString()}</div>
            <div class="daily-card">
                <img class="${imageClass}" src="image2/${card.imageFile}" alt="${card.en} ${orient}">
                <div>
                    <strong>${typeof zhWithRoman === 'function' ? zhWithRoman(card.zh) : card.zh}</strong>
                    <span>${card.en}</span>
                    <em>${orient}</em>
                </div>
            </div>
        `;
    }

    async function mountDailyDraw(containerId = 'daily-draw') {
        const container = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
        if (!container) return null;
        const date = getLocalDateString();
        let reading = await loadOrCreateToday({ date });
        if (!reading) {
            const picked = pickDailyCard(typeof FULL_DECK !== 'undefined' ? FULL_DECK : []);
            if (picked) {
                const payload = buildDailyReadingPayload({ date, ...picked });
                reading = {
                    id: null,
                    kind: payload.kind,
                    templateKey: payload.templateKey,
                    templateName: payload.templateName,
                    readingDate: payload.readingDate,
                    cards: payload.cards
                };
            }
        }
        renderDailyDraw(container, reading);
        return reading;
    }

    return {
        getLocalDateString,
        buildDailyReadingPayload,
        pickDailyCard,
        loadOrCreateToday,
        renderDailyDraw,
        mountDailyDraw
    };
});
