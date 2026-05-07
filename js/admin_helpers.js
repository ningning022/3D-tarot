(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.AdminHelpers = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function createNotesKey(readingId) {
        return `akashic-admin-note-${readingId}`;
    }

    function normalizeSearch(value) {
        return String(value || '').trim().toLowerCase();
    }

    function readingSearchText(reading) {
        const cards = Array.isArray(reading.cards) ? reading.cards : [];
        return [
            reading.id,
            reading.kind,
            reading.templateName,
            reading.createdAt,
            ...cards.flatMap(card => [card.en, card.zh, card.slotLabel, card.imageFile])
        ].filter(value => value !== null && value !== undefined).join(' ').toLowerCase();
    }

    function filterReadings(readings, query) {
        const list = Array.isArray(readings) ? readings : [];
        const needle = normalizeSearch(query);
        if (!needle) return list.slice();
        return list.filter(reading => readingSearchText(reading).includes(needle));
    }

    function getDashboardStats(readings) {
        const list = Array.isArray(readings) ? readings : [];
        const totalCards = list.reduce((sum, reading) => sum + ((reading.cards || []).length), 0);
        const spreadReadings = list.filter(reading => reading.kind !== 'daily').length;
        const dailyReadings = list.filter(reading => reading.kind === 'daily').length;
        const latest = list
            .map(reading => reading.createdAt)
            .filter(Boolean)
            .sort()
            .reverse()[0] || null;
        return {
            totalReadings: list.length,
            totalCards,
            spreadReadings,
            dailyReadings,
            latestCreatedAt: latest
        };
    }

    function serializeReadingExport(reading, notes = '') {
        return {
            ...(reading || {}),
            exportedBy: 'Akashic Tarot',
            exportedAt: new Date().toISOString(),
            notes
        };
    }

    return {
        createNotesKey,
        filterReadings,
        getDashboardStats,
        serializeReadingExport
    };
});
