const TarotAPI = (() => {
    let warnedOffline = false;

    async function requestJson(path, options = {}) {
        const response = await fetch(path, {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });
        if (!response.ok) {
            throw new Error(`API ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }

    function warnOffline(error) {
        if (warnedOffline) return;
        warnedOffline = true;
        console.warn('Tarot API unavailable; using in-page history only.', error);
    }

    async function health() {
        try {
            return await requestJson('/api/health');
        } catch (error) {
            warnOffline(error);
            return null;
        }
    }

    async function saveReading(spreadNumber, cards) {
        const payload = Array.isArray(cards)
            ? { spreadNumber, cards }
            : { ...(cards || {}), spreadNumber: cards && cards.spreadNumber !== undefined ? cards.spreadNumber : spreadNumber };
        if (!Array.isArray(payload.cards) || payload.cards.length === 0) return null;
        try {
            return await requestJson('/api/readings', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        } catch (error) {
            warnOffline(error);
            return null;
        }
    }

    async function loadReadings(limit = 20) {
        try {
            return await requestJson(`/api/readings?limit=${encodeURIComponent(limit)}`);
        } catch (error) {
            warnOffline(error);
            return [];
        }
    }

    async function loadReading(id) {
        try {
            return await requestJson(`/api/readings/${encodeURIComponent(id)}`);
        } catch (error) {
            warnOffline(error);
            return null;
        }
    }

    async function clearReadings() {
        try {
            return await requestJson('/api/readings', { method: 'DELETE' });
        } catch (error) {
            warnOffline(error);
            return null;
        }
    }

    async function loadDailyDraw(date) {
        try {
            const response = await fetch(`/api/daily-draw?date=${encodeURIComponent(date)}`);
            if (response.status === 404) return null;
            if (!response.ok) {
                throw new Error(`API ${response.status}: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            warnOffline(error);
            return null;
        }
    }

    async function saveDailyDraw(payload) {
        try {
            return await requestJson('/api/daily-draw', {
                method: 'POST',
                body: JSON.stringify({
                    readingDate: payload.readingDate,
                    card: payload.cards && payload.cards[0]
                })
            });
        } catch (error) {
            warnOffline(error);
            return null;
        }
    }

    return {
        health,
        saveReading,
        loadReadings,
        loadReading,
        clearReadings,
        loadDailyDraw,
        saveDailyDraw
    };
})();

window.TarotAPI = TarotAPI;
