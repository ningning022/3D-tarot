let currentReadingCards = [];
let currentReadingMeta = {};

function resetReadingCapture(meta = {}) {
    currentReadingCards = [];
    currentReadingMeta = {
        kind: meta.kind || 'spread',
        templateKey: meta.templateKey || 'free',
        templateName: meta.templateName || '自由牌阵 / Free Spread',
        readingDate: meta.readingDate || null
    };
}

function cardToHistoryEntry(card) {
    return {
        slot: card.userData.slot,
        slotLabel: card.userData.slotLabel || `Slot ${card.userData.slot}`,
        cardId: card.userData.cardId,
        zh: card.userData.zh,
        en: card.userData.en,
        imageFile: card.userData.imageFile,
        isReversed: Boolean(card.userData.isReversed)
    };
}

function renderHistoryCardHtml(entry) {
    const orient = entry.isReversed ? '逆位 / Reversed' : '正位 / Upright';
    return `<span style="color:var(--gold)">✓</span> <strong>${entry.slotLabel || `Slot ${entry.slot}`}</strong> · ${zhWithRoman(entry.zh)} <em style="opacity:.7">${entry.en}</em> · ${orient}`;
}

function prependHistoryCard(entry) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = renderHistoryCardHtml(entry);
    list.prepend(item);
}

function appendHistoryCard(entry, targetList) {
    const list = targetList || document.getElementById('history-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = renderHistoryCardHtml(entry);
    list.appendChild(item);
}

function prependHistorySeparator(spreadNumber) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const sep = document.createElement('div');
    sep.className = 'history-separator';
    sep.innerText = `── 第${spreadNumber}阵 / Spread ${spreadNumber} ──`;
    list.prepend(sep);
}

function prependHistoryNote(text) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const note = document.createElement('div');
    note.className = 'history-note';
    note.innerText = text;
    list.prepend(note);
}

function appendHistoryNote(text) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const note = document.createElement('div');
    note.className = 'history-note';
    note.innerText = text;
    list.appendChild(note);
}

function recordConfirmedCard(card) {
    const entry = cardToHistoryEntry(card);
    currentReadingCards.push(entry);
    prependHistoryCard(entry);
    return entry;
}

async function completeReadingHistory(spreadNumber) {
    prependHistorySeparator(spreadNumber);
    const cards = currentReadingCards
        .slice()
        .sort((left, right) => left.slot - right.slot);
    const meta = { ...currentReadingMeta };
    resetReadingCapture();
    if (window.TarotAPI && cards.length > 0) {
        await window.TarotAPI.saveReading(spreadNumber, {
            ...meta,
            spreadNumber,
            cards
        });
    }
}

function renderSavedReadingSummary(reading) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const wrap = document.createElement('div');
    wrap.className = 'saved-reading';
    const when = reading.createdAt ? new Date(reading.createdAt).toLocaleString() : 'Unknown time';
    const title = document.createElement('div');
    title.className = 'saved-reading-title';
    title.innerText = `${reading.templateName || `Spread ${reading.spreadNumber}`} · ${when}`;
    wrap.appendChild(title);
    (reading.cards || []).forEach(card => appendHistoryCard(card, wrap));
    list.appendChild(wrap);
}

async function loadSavedHistory(limit = 10) {
    if (!window.TarotAPI) return;
    const readings = await window.TarotAPI.loadReadings(limit);
    const list = document.getElementById('history-list');
    if (!list || !Array.isArray(readings) || readings.length === 0) return;
    appendHistoryNote(`数据库最近记录 / Latest ${readings.length} saved readings`);
    readings.forEach(renderSavedReadingSummary);
}

window.addEventListener('DOMContentLoaded', () => {
    loadSavedHistory(10);
    const toggle = document.getElementById('history-toggle');
    const historyPanel = document.getElementById('history');
    if (toggle && historyPanel) {
        toggle.addEventListener('click', () => {
            historyPanel.classList.toggle('collapsed');
        });
    }
});

window.TarotAPI = window.TarotAPI || TarotAPI;
