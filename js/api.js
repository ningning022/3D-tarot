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
        if (!Array.isArray(cards) || cards.length === 0) return null;
        try {
            return await requestJson('/api/readings', {
                method: 'POST',
                body: JSON.stringify({ spreadNumber, cards })
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

    return {
        health,
        saveReading,
        loadReadings,
        loadReading,
        clearReadings
    };
})();

window.TarotAPI = TarotAPI;
