const AdminChronicle = (() => {
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
            const button = document.createElement('button');
            button.type = 'button';
            button.className = reading.id === state.selectedId ? 'reading-row active' : 'reading-row';
            button.dataset.id = reading.id;
            button.innerHTML = `
                <span class="reading-row-title">第${reading.spreadNumber}阵 / Spread ${reading.spreadNumber}</span>
                <span class="reading-row-meta">${formatTime(reading.createdAt)} · ${(reading.cards || []).length} cards</span>
            `;
            button.addEventListener('click', () => selectReading(reading.id));
            list.appendChild(button);
        });
    }

    function renderDetail(reading) {
        const detail = el('reading-detail');
        if (!detail) return;
        if (!reading) {
            detail.innerHTML = '<div class="empty-state">选择一条记录查看详情 / Select a reading</div>';
            return;
        }

        const cards = (reading.cards || [])
            .slice()
            .sort((left, right) => left.slot - right.slot)
            .map(card => {
                const orient = card.isReversed ? '逆位 / Reversed' : '正位 / Upright';
                const imageClass = card.isReversed ? 'admin-card-image reversed' : 'admin-card-image upright';
                return `
                    <article class="admin-card">
                        <img class="${imageClass}" src="image2/${card.imageFile}" alt="${card.en} ${orient}">
                        <div>
                            <div class="admin-card-slot">Slot ${card.slot}</div>
                            <h3>${zhWithRoman(card.zh)}</h3>
                            <p>${card.en}</p>
                            <span>${orient}</span>
                        </div>
                    </article>
                `;
            })
            .join('');

        detail.innerHTML = `
            <div class="reading-detail-head">
                <p>Reading #${reading.id}</p>
                <h2>第${reading.spreadNumber}阵 / Spread ${reading.spreadNumber}</h2>
                <span>${formatTime(reading.createdAt)}</span>
            </div>
            <div class="admin-card-grid">${cards}</div>
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
            }
        } catch (error) {
            console.warn(error);
            setStatus('无法连接本地后端 / Local API unavailable');
            renderList();
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
