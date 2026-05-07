const AdminChronicle = (() => {
    const REPLAY_VIEWPORT = { viewportWidth: 16, viewportHeight: 9 };
    const helpers = window.AdminHelpers;
    const state = {
        readings: [],
        selectedId: null,
        selectedReading: null,
        query: '',
        view: 'readings',
        systemHealth: null
    };

    function el(id) {
        return document.getElementById(id);
    }

    function formatTime(value) {
        if (!value) return 'Unknown time';
        return new Date(value).toLocaleString();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatZhName(value) {
        const safe = escapeHtml(value || 'Unknown card');
        return typeof zhWithRoman === 'function' ? zhWithRoman(safe) : safe;
    }

    function imageSrc(imageFile) {
        return `image2/${encodeURIComponent(imageFile || '')}`;
    }

    function readingTitle(reading) {
        return reading.templateName || `Spread ${reading.spreadNumber || reading.id}`;
    }

    function readingKind(reading) {
        return reading.kind === 'daily' ? 'Daily' : 'Spread';
    }

    function cardImageClass(card) {
        return card.isReversed ? 'admin-card-image reversed' : 'admin-card-image upright';
    }

    function setStatus(text) {
        const status = el('admin-status');
        if (status) status.innerText = text;
    }

    function getFilteredReadings() {
        return helpers.filterReadings(state.readings, state.query);
    }

    function isSelectedReadingVisible() {
        if (!state.selectedId) return false;
        return getFilteredReadings().some(reading => reading.id === state.selectedId);
    }

    function setView(view) {
        state.view = view;
        document.querySelectorAll('[data-admin-view]').forEach(button => {
            button.classList.toggle('active', button.dataset.adminView === view);
        });
        renderList();
        renderCurrentView();
        if (view === 'system') refreshSystemHealth();
    }

    function renderList() {
        const list = el('reading-list');
        if (!list) return;
        const readings = getFilteredReadings();
        list.innerHTML = '';

        if (readings.length === 0) {
            list.innerHTML = '<div class="empty-state">没有匹配记录 / No matching readings</div>';
            return;
        }

        readings.forEach(reading => {
            const cardCount = (reading.cards || []).length;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = reading.id === state.selectedId ? 'reading-row active' : 'reading-row';
            button.dataset.id = reading.id;
            button.innerHTML = `
                <span class="reading-row-index">#${reading.id}</span>
                <span class="reading-row-content">
                    <span class="reading-row-topline">
                        <span class="reading-row-title">${escapeHtml(readingTitle(reading))}</span>
                        <span class="reading-row-kind">${readingKind(reading)}</span>
                    </span>
                    <span class="reading-row-meta">${formatTime(reading.createdAt)} - ${cardCount} cards</span>
                </span>
            `;
            button.addEventListener('click', () => selectReading(reading.id));
            list.appendChild(button);
        });
    }

    function renderReplayBoard(replayCards) {
        if (replayCards.length === 0) {
            return '<div class="replay-empty">No cards saved</div>';
        }

        return replayCards.map(card => {
            const alt = `${card.en || card.zh} ${card.orientationLabel}`;
            return `
                <article class="replay-card ${card.orientationClass}" style="left:${card.leftPercent}%;top:${card.topPercent}%;width:${card.widthPercent}%;">
                    <div class="replay-slot">${escapeHtml(card.slotLabel || `Slot ${card.slot}`)}</div>
                    <img class="${cardImageClass(card)}" src="${imageSrc(card.imageFile)}" alt="${escapeHtml(alt)}">
                </article>
            `;
        }).join('');
    }

    function renderCardDetails(replayCards) {
        if (replayCards.length === 0) {
            return '<div class="empty-state">No cards saved</div>';
        }

        return replayCards.map(card => `
            <article class="admin-card">
                <img class="${cardImageClass(card)}" src="${imageSrc(card.imageFile)}" alt="${escapeHtml(card.en)}">
                <div>
                    <div class="admin-card-slot">${escapeHtml(card.slotLabel || `Slot ${card.slot}`)}</div>
                    <h3>${formatZhName(card.zh)}</h3>
                    <p>${escapeHtml(card.en)}</p>
                    <span class="orientation-pill ${card.orientationClass}">${card.orientationLabel}</span>
                </div>
            </article>
        `).join('');
    }

    function getReadingNotes(readingId) {
        try {
            return localStorage.getItem(helpers.createNotesKey(readingId)) || '';
        } catch (error) {
            return '';
        }
    }

    function setReadingNotes(readingId, notes) {
        try {
            localStorage.setItem(helpers.createNotesKey(readingId), notes);
        } catch (error) {
            console.warn(error);
        }
    }

    function renderInsightCards(reading, replayCards) {
        const notes = getReadingNotes(reading.id);
        const firstCard = replayCards[0] || {};
        const deckName = firstCard.imageFile ? 'Rider-Waite deck' : 'Local tarot deck';
        return `
            <div class="admin-insight-grid">
                <article class="insight-card notes-card">
                    <h3>笔记 / Notes</h3>
                    <textarea id="reading-notes" rows="5" placeholder="本地笔记 / Local notes...">${escapeHtml(notes)}</textarea>
                    <button class="detail-action" data-detail-action="save-note" type="button">保存 / Save</button>
                </article>
                <article class="insight-card">
                    <h3>牌库 / Deck</h3>
                    <strong>${deckName}</strong>
                    <span>${replayCards.length} saved ${replayCards.length === 1 ? 'card' : 'cards'}</span>
                </article>
                <article class="insight-card">
                    <h3>牌阵 / Spread</h3>
                    <strong>${escapeHtml(readingTitle(reading))}</strong>
                    <span>${escapeHtml((replayCards[0] && replayCards[0].slotLabel) || 'Past - Present - Future')}</span>
                </article>
            </div>
        `;
    }

    function renderReadingDetail(reading) {
        const detail = el('reading-detail');
        if (!detail) return;
        if (!reading) {
            detail.innerHTML = '<div class="empty-state">请选择记录 / Select a reading</div>';
            return;
        }

        const replayCards = ReadingReplay.computeReplayCards(reading, REPLAY_VIEWPORT);
        const cardWord = replayCards.length === 1 ? 'card' : 'cards';

        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>${readingKind(reading)} #${reading.id}</p>
                    <h2>${escapeHtml(readingTitle(reading))}</h2>
                    <span>${formatTime(reading.createdAt)}</span>
                </div>
                <div class="reading-detail-actions">
                    <button class="detail-action" data-detail-action="focus-note" type="button">编辑 / Edit</button>
                    <button class="detail-action" data-detail-action="export" type="button">导出 / Export</button>
                    <strong>${replayCards.length} ${cardWord}</strong>
                </div>
            </div>
            <section class="replay-board" aria-label="Reading replay">
                ${renderReplayBoard(replayCards)}
            </section>
            ${renderInsightCards(reading, replayCards)}
            <div class="admin-card-grid">${renderCardDetails(replayCards)}</div>
        `;
    }

    function renderDashboard() {
        const detail = el('reading-detail');
        if (!detail) return;
        const stats = helpers.getDashboardStats(state.readings);
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>Dashboard</p>
                    <h2>Chronicle Overview</h2>
                    <span>${stats.latestCreatedAt ? `Latest: ${formatTime(stats.latestCreatedAt)}` : 'No readings yet'}</span>
                </div>
            </div>
            <div class="admin-summary-grid">
                <article><strong>${stats.totalReadings}</strong><span>Total readings</span></article>
                <article><strong>${stats.totalCards}</strong><span>Cards saved</span></article>
                <article><strong>${stats.spreadReadings}</strong><span>Spread readings</span></article>
                <article><strong>${stats.dailyReadings}</strong><span>Daily draws</span></article>
            </div>
            <section class="admin-mini-panel">
                <h3>Latest Records</h3>
                ${state.readings.slice(0, 5).map(reading => `<p>${escapeHtml(readingTitle(reading))} - ${formatTime(reading.createdAt)}</p>`).join('') || '<p>No local readings saved.</p>'}
            </section>
        `;
    }

    function renderDecks() {
        const detail = el('reading-detail');
        if (!detail) return;
        const cardFiles = new Set(state.readings.flatMap(reading => (reading.cards || []).map(card => card.imageFile).filter(Boolean)));
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>Decks</p>
                    <h2>Local Tarot Deck</h2>
                    <span>Rider-Waite imagery from image2/</span>
                </div>
            </div>
            <div class="admin-summary-grid">
                <article><strong>78</strong><span>Cards available</span></article>
                <article><strong>${cardFiles.size}</strong><span>Seen in records</span></article>
                <article><strong>Local</strong><span>Asset mode</span></article>
            </div>
        `;
    }

    function renderSettings() {
        const detail = el('reading-detail');
        if (!detail) return;
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>Settings</p>
                    <h2>Local Controls</h2>
                    <span>Data is stored in the local SQLite database.</span>
                </div>
            </div>
            <div class="admin-settings-actions">
                <button class="admin-link danger-button" data-detail-action="clear" type="button">Clear Database</button>
                <a class="admin-link" href="Three.html">Back to Tarot</a>
            </div>
        `;
    }

    function renderSystem() {
        const detail = el('reading-detail');
        if (!detail) return;
        const health = state.systemHealth;
        const status = health ? `${health.ok ? 'Ready' : 'Unavailable'} - database ${health.database || 'unknown'}` : 'Checking...';
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>System</p>
                    <h2>Runtime Health</h2>
                    <span>${escapeHtml(status)}</span>
                </div>
                <button class="detail-action" data-detail-action="refresh-system" type="button">Refresh</button>
            </div>
            <section class="admin-mini-panel">
                <h3>Backend</h3>
                <p>${escapeHtml(status)}</p>
            </section>
        `;
    }

    function renderCurrentView() {
        if (state.view === 'dashboard') renderDashboard();
        if (state.view === 'readings') {
            if (state.query && state.selectedId && !isSelectedReadingVisible()) {
                const detail = el('reading-detail');
                if (detail) {
                    detail.innerHTML = '<div class="empty-state">请选择搜索结果中的记录 / Select a reading from the filtered results</div>';
                }
            } else {
                renderReadingDetail(state.selectedReading);
            }
        }
        if (state.view === 'decks') renderDecks();
        if (state.view === 'settings') renderSettings();
        if (state.view === 'system') renderSystem();
    }

    async function clearAllReadings() {
        const typed = window.prompt('Type CLEAR to clear database');
        if (typed !== 'CLEAR') {
            setStatus('Clear canceled');
            return;
        }

        const result = await TarotAPI.clearReadings();
        if (!result || result.ok !== true) {
            setStatus('Clear failed');
            return;
        }

        state.readings = [];
        state.selectedId = null;
        state.selectedReading = null;
        renderList();
        renderCurrentView();
        setStatus('Database cleared');
        await init();
    }

    async function refreshSystemHealth() {
        state.systemHealth = await TarotAPI.health();
        renderSystem();
    }

    async function selectReading(readingId) {
        state.selectedId = readingId;
        state.view = 'readings';
        document.querySelectorAll('[data-admin-view]').forEach(button => {
            button.classList.toggle('active', button.dataset.adminView === 'readings');
        });
        renderList();
        try {
            const reading = await TarotAPI.loadReading(readingId);
            if (!reading) throw new Error('Reading not found');
            state.selectedReading = reading;
            renderReadingDetail(reading);
        } catch (error) {
            console.warn(error);
            state.selectedReading = null;
            renderReadingDetail(null);
            setStatus('Failed to load detail');
        }
    }

    function saveCurrentNote() {
        if (!state.selectedReading) return;
        const textarea = el('reading-notes');
        setReadingNotes(state.selectedReading.id, textarea ? textarea.value : '');
        setStatus('Note saved locally');
    }

    function exportCurrentReading() {
        if (!state.selectedReading) return;
        const payload = helpers.serializeReadingExport(
            state.selectedReading,
            getReadingNotes(state.selectedReading.id)
        );
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `akashic-reading-${state.selectedReading.id}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setStatus('Reading exported');
    }

    async function init() {
        try {
            state.readings = await TarotAPI.loadReadings(100);
            setStatus(`${state.readings.length} readings loaded`);
            state.selectedId = state.readings[0] ? state.readings[0].id : null;
            renderList();
            if (state.selectedId) {
                await selectReading(state.selectedId);
            } else {
                renderCurrentView();
            }
        } catch (error) {
            console.warn(error);
            setStatus('Local API unavailable');
            renderList();
            renderCurrentView();
        }
    }

    function bindEvents() {
        const clearButton = el('clear-readings');
        if (clearButton) clearButton.addEventListener('click', clearAllReadings);

        const search = el('reading-search');
        if (search) {
            search.addEventListener('input', event => {
                state.query = event.target.value;
                renderList();
                if (state.view === 'readings') renderCurrentView();
            });
        }

        document.querySelectorAll('[data-admin-view]').forEach(button => {
            button.addEventListener('click', () => setView(button.dataset.adminView));
        });

        const detail = el('reading-detail');
        if (detail) {
            detail.addEventListener('click', event => {
                const action = event.target && event.target.dataset && event.target.dataset.detailAction;
                if (!action) return;
                if (action === 'focus-note') {
                    const textarea = el('reading-notes');
                    if (textarea) textarea.focus();
                }
                if (action === 'save-note') saveCurrentNote();
                if (action === 'export') exportCurrentReading();
                if (action === 'clear') clearAllReadings();
                if (action === 'refresh-system') refreshSystemHealth();
            });
        }
    }

    function start() {
        bindEvents();
        init();
    }

    return { init, start };
})();

window.addEventListener('DOMContentLoaded', AdminChronicle.start);

