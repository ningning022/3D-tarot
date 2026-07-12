const TarotAPI = (() => {
    let warnedOffline = false;

    async function readError(response) {
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            // The fallback below handles non-JSON error responses.
        }

        const message = (payload && (payload.error || payload.message))
            || `API ${response.status}: ${response.statusText || 'Request failed'}`;
        const error = new Error(message);
        error.status = response.status;
        error.payload = payload;
        return error;
    }

    async function requestJson(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            throw await readError(response);
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

    async function loadConsultationModules() {
        return requestJson('/api/consultation-modules', { cache: 'no-store' });
    }

    async function createReading(payload) {
        return requestJson('/api/readings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async function createConsultation(payload) {
        return requestJson('/api/consultations', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async function loadConsultation(id) {
        return requestJson(`/api/consultations/${encodeURIComponent(id)}`, { cache: 'no-store' });
    }

    async function reviewInterpretation(id, payload) {
        return requestJson(`/api/interpretations/${encodeURIComponent(id)}/review`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    async function saveReading(spreadNumber, cards) {
        const payload = Array.isArray(cards)
            ? { spreadNumber, cards }
            : { ...(cards || {}), spreadNumber: cards && cards.spreadNumber !== undefined ? cards.spreadNumber : spreadNumber };
        if (!Array.isArray(payload.cards) || payload.cards.length === 0) return null;
        try {
            return await createReading(payload);
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
        loadConsultationModules,
        createReading,
        createConsultation,
        loadConsultation,
        reviewInterpretation,
        saveReading,
        loadReadings,
        loadReading,
        clearReadings,
        loadDailyDraw,
        saveDailyDraw
    };
})();

if (typeof module === 'object' && module.exports) module.exports = TarotAPI;
if (typeof window !== 'undefined') window.TarotAPI = TarotAPI;
