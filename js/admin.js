const AdminChronicle = (() => {
    const REPLAY_VIEWPORT = { viewportWidth: 16, viewportHeight: 9 };
    const state = {
        readings: [],
        selectedId: null
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
        const safe = escapeHtml(value || '未知牌面');
        return typeof zhWithRoman === 'function' ? zhWithRoman(safe) : safe;
    }

    function imageSrc(imageFile) {
        return `image2/${encodeURIComponent(imageFile || '')}`;
    }

    function readingTitle(reading) {
        return reading.templateName || `第${reading.spreadNumber}阵 / Spread ${reading.spreadNumber}`;
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

    function renderList() {
        const list = el('reading-list');
        if (!list) return;
        list.innerHTML = '';

        if (state.readings.length === 0) {
            list.innerHTML = '<div class="empty-state">暂无记录 / No saved readings</div>';
            return;
        }

        state.readings.forEach(reading => {
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
                    <span class="reading-row-meta">${formatTime(reading.createdAt)} · ${cardCount} cards</span>
                </span>
            `;
            button.addEventListener('click', () => selectReading(reading.id));
            list.appendChild(button);
        });
    }

    function renderReplayBoard(replayCards) {
        if (replayCards.length === 0) {
            return '<div class="replay-empty">暂无牌面 / No cards saved</div>';
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
            return '<div class="empty-state">暂无牌面 / No cards saved</div>';
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

    function renderDetail(reading) {
        const detail = el('reading-detail');
        if (!detail) return;
        if (!reading) {
            detail.innerHTML = '<div class="empty-state">选择一条记录查看详情 / Select a reading</div>';
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
                <strong>${replayCards.length} ${cardWord}</strong>
            </div>
            <section class="replay-board" aria-label="Reading replay">
                ${renderReplayBoard(replayCards)}
            </section>
            <div class="admin-card-grid">${renderCardDetails(replayCards)}</div>
        `;
    }

    function renderEmptyDetail() {
        renderDetail(null);
    }

    async function clearAllReadings() {
        const typed = window.prompt('输入 CLEAR 确认清空数据库 / Type CLEAR to clear database');
        if (typed !== 'CLEAR') {
            setStatus('已取消清空 / Clear canceled');
            return;
        }

        const result = await TarotAPI.clearReadings();
        if (!result || result.ok !== true) {
            setStatus('清空失败 / Clear failed');
            return;
        }

        state.readings = [];
        state.selectedId = null;
        renderList();
        renderEmptyDetail();
        setStatus('数据库已清空 / Database cleared');
        await init();
    }

    async function selectReading(readingId) {
        state.selectedId = readingId;
        renderList();
        try {
            const reading = await TarotAPI.loadReading(readingId);
            if (!reading) throw new Error('Reading not found');
            renderDetail(reading);
        } catch (error) {
            console.warn(error);
            renderDetail(null);
            setStatus('读取详情失败 / Failed to load detail');
        }
    }

    async function init() {
        try {
            state.readings = await TarotAPI.loadReadings(100);
            setStatus(`已载入 ${state.readings.length} 条记录 / ${state.readings.length} readings loaded`);
            state.selectedId = state.readings[0] ? state.readings[0].id : null;
            renderList();
            if (state.selectedId) {
                await selectReading(state.selectedId);
            } else {
                renderEmptyDetail();
            }
        } catch (error) {
            console.warn(error);
            setStatus('无法连接本地后端 / Local API unavailable');
            renderList();
            renderEmptyDetail();
        }
    }

    function bindEvents() {
        const clearButton = el('clear-readings');
        if (clearButton) clearButton.addEventListener('click', clearAllReadings);
    }

    function start() {
        bindEvents();
        init();
    }

    return { init, start };
})();

window.addEventListener('DOMContentLoaded', AdminChronicle.start);
