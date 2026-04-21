let currentReadingCards = [];

function resetReadingCapture() {
    currentReadingCards = [];
}

function cardToHistoryEntry(card) {
    return {
        slot: card.userData.slot,
        cardId: card.userData.cardId,
        zh: card.userData.zh,
        en: card.userData.en,
        imageFile: card.userData.imageFile,
        isReversed: Boolean(card.userData.isReversed)
    };
}

function prependHistoryCard(entry) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'history-item';
    const orient = entry.isReversed ? '逆位 / Reversed' : '正位 / Upright';
    item.innerHTML = `<span style="color:var(--gold)">✦</span> ${zhWithRoman(entry.zh)} <em style="opacity:.7">${entry.en}</em> · ${orient}`;
    list.prepend(item);
}

function appendHistoryCard(entry, targetList) {
    const list = targetList || document.getElementById('history-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'history-item';
    const orient = entry.isReversed ? '逆位 / Reversed' : '正位 / Upright';
    item.innerHTML = `<span style="color:var(--gold)">✦</span> ${zhWithRoman(entry.zh)} <em style="opacity:.7">${entry.en}</em> · ${orient}`;
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
    resetReadingCapture();
    if (window.TarotAPI && cards.length > 0) {
        await window.TarotAPI.saveReading(spreadNumber, cards);
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
    title.innerText = `第${reading.spreadNumber}阵 / Spread ${reading.spreadNumber} · ${when}`;
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
});

window.TarotAPI = window.TarotAPI || TarotAPI;
