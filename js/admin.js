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

    /**
     * Summarise a reading's cards as a list of <span> chips, one per card,
     * each tagged with the upright/reversed orientation.
     * Example output: "圣杯III · 正  ｜  月亮 · 逆  ｜  星币国王 · 正"
     */
    function renderCardChips(cards) {
        if (!Array.isArray(cards) || cards.length === 0) {
            return '<span class="reading-row-card empty">无卡牌 / No cards</span>';
        }
        return cards.map(card => {
            const name = formatZhName(card.zh || card.en || '?');
            const orientCls = card.isReversed ? 'reversed' : 'upright';
            const orientLabel = card.isReversed ? '逆' : '正';
            const enHint = card.en ? ` title="${escapeHtml(card.en)}"` : '';
            return `<span class="reading-row-card ${orientCls}"${enHint}>`
                + `<span class="reading-row-card-name">${name}</span>`
                + `<span class="reading-row-card-orient">${orientLabel}</span>`
                + `</span>`;
        }).join('');
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
            const cards = reading.cards || [];
            const cardCount = cards.length;
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
                    <span class="reading-row-meta">${formatTime(reading.createdAt)} · ${cardCount} ${cardCount === 1 ? 'card' : 'cards'}</span>
                    <span class="reading-row-cards">${renderCardChips(cards)}</span>
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
            const orientShort = card.isReversed ? '逆' : '正';
            return `
                <article class="replay-card ${card.orientationClass}" style="left:${card.leftPercent}%;top:${card.topPercent}%;width:${card.widthPercent}%;">
                    <div class="replay-slot">${escapeHtml(card.slotLabel || `Slot ${card.slot}`)}</div>
                    <img class="${cardImageClass(card)}" src="${imageSrc(card.imageFile)}" alt="${escapeHtml(alt)}">
                    <div class="replay-name">
                        <span class="replay-name-zh">${formatZhName(card.zh || card.en || '?')}</span>
                        <span class="replay-name-en">${escapeHtml(card.en || '')}</span>
                        <span class="replay-name-orient ${card.orientationClass}">${orientShort} / ${card.orientationLabel}</span>
                    </div>
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
            <div id="interpretation-mount" class="interpretation-mount"></div>
            <div class="admin-card-grid">${renderCardDetails(replayCards)}</div>
        `;

        // Mount the interpretation panel. Done after innerHTML so the
        // container exists. Module is loaded via <script> tag above this.
        const mount = el('interpretation-mount');
        if (mount && window.AkashicInterpret) {
            window.AkashicInterpret.mountPanel(mount, reading.id).catch(() => {
                /* mount failure is non-fatal */
            });
        }
    }

    function renderDashboard() {
        const detail = el('reading-detail');
        if (!detail) return;
        const stats = helpers.getDashboardStats(state.readings);
        const apiAvail = state.systemHealth && state.systemHealth.ok;
        const recent5 = state.readings.slice(0, 5);
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>总览 / Dashboard</p>
                    <h2>Chronicle Overview</h2>
                    <span>${stats.latestCreatedAt ? `最近记录 / Latest: ${formatTime(stats.latestCreatedAt)}` : '暂无记录 / No readings yet'}</span>
                </div>
                <button class="detail-action" data-detail-action="refresh-system" type="button">刷新 / Refresh</button>
            </div>
            <div class="admin-summary-grid">
                <article><strong>${stats.totalReadings}</strong><span>总记录 / Readings</span></article>
                <article><strong>${stats.totalCards}</strong><span>总牌数 / Cards</span></article>
                <article><strong>${stats.spreadReadings}</strong><span>牌阵 / Spreads</span></article>
                <article><strong>${stats.dailyReadings}</strong><span>每日一牌 / Daily</span></article>
            </div>
            <div class="admin-info-grid">
                <article class="admin-mini-panel">
                    <h3>API 状态 / Backend</h3>
                    <strong style="color:${apiAvail ? '#6fdf7a' : '#ff9090'}">${apiAvail ? '在线 / Online' : '离线 / Offline'}</strong>
                    <span>${apiAvail ? '本地服务运行中 / Local server running' : '请运行 server.py / Run server.py'}</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>牌库 / Deck</h3>
                    <strong>The Gilded Reverie</strong>
                    <span>Rider-Waite · 78 张 / cards</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>数据源 / Storage</h3>
                    <strong>SQLite</strong>
                    <span>本地优先 / Local-first · 不联网 / Offline</span>
                </article>
            </div>
            <section class="admin-mini-panel" style="margin-top:14px">
                <h3>最近5条 / Latest 5</h3>
                ${recent5.length ? recent5.map(r => `<p style="margin:4px 0"><span style="color:var(--stage-gold-bright)">#${r.id}</span> ${escapeHtml(readingTitle(r))} <span style="opacity:.6;font-size:.8em">— ${formatTime(r.createdAt)}</span></p>`).join('') : '<p style="opacity:.6">暂无本地记录 / No local readings saved.</p>'}
            </section>
        `;
    }

    function renderDecks() {
        const detail = el('reading-detail');
        if (!detail) return;
        const cardFiles = new Set(state.readings.flatMap(r => (r.cards || []).map(c => c.imageFile).filter(Boolean)));
        const majors = 22, minors = 56;
        const suits = ['权杖 / Wands', '圣杯 / Cups', '宝剑 / Swords', '星币 / Pentacles'];
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>牌库 / Decks</p>
                    <h2>The Gilded Reverie</h2>
                    <span>Rider-Waite · 本地图库 image2/ / Local image2/ folder</span>
                </div>
            </div>
            <div class="admin-summary-grid">
                <article><strong>78</strong><span>全部牌 / Total cards</span></article>
                <article><strong>${majors}</strong><span>大阿卡纳 / Major Arcana</span></article>
                <article><strong>${minors}</strong><span>小阿卡纳 / Minor Arcana</span></article>
                <article><strong>${cardFiles.size}</strong><span>记录中出现 / Seen in records</span></article>
            </div>
            <div class="admin-info-grid">
                ${suits.map(s => `<article class="admin-mini-panel"><h3>${s}</h3><span>14 张 / cards（Ace–King）</span></article>`).join('')}
                <article class="admin-mini-panel">
                    <h3>图片格式 / Format</h3>
                    <span>JPG · 本地路径 / Local path · 兼容 file:// 协议</span>
                </article>
            </div>
            <section class="admin-mini-panel" style="margin-top:14px">
                <h3>使用说明 / Notes</h3>
                <p style="margin:4px 0;opacity:.8">所有牌面图片存放在 <code style="color:var(--stage-gold-bright)">image2/</code> 目录下，格式为 <code style="color:var(--stage-gold-bright)">00.jpg</code>（背面）、<code style="color:var(--stage-gold-bright)">01.jpg</code>~<code style="color:var(--stage-gold-bright)">78.jpg</code>（牌面）。</p>
                <p style="margin:4px 0;opacity:.8">牌库可通过替换图片文件更换主题，文件名需保持一致。</p>
            </section>
        `;
    }

    function renderSettings() {
        const detail = el('reading-detail');
        if (!detail) return;
        const savedMode = (() => { try { return localStorage.getItem('akashic-tarot-control-mode') || '未设置 / Not set'; } catch(e) { return 'N/A'; } })();
        const noteCount = (() => { try { let n=0; for(let i=0;i<localStorage.length;i++){if(localStorage.key(i).startsWith('akashic-admin-note-'))n++;} return n; } catch(e){return 0;} })();
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>设置 / Settings</p>
                    <h2>本地控制台 / Local Controls</h2>
                    <span>数据存储在本地 SQLite 数据库 / Data stored in local SQLite database</span>
                </div>
            </div>
            <div class="admin-info-grid">
                <article class="admin-mini-panel">
                    <h3>控制模式 / Control Mode</h3>
                    <strong>${escapeHtml(savedMode)}</strong>
                    <span>存储在 localStorage / Stored in localStorage</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>本地笔记 / Local Notes</h3>
                    <strong>${noteCount} 条 / notes</strong>
                    <span>仅存于此浏览器 / This browser only</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>数据库 / Database</h3>
                    <strong>SQLite</strong>
                    <span>需运行 server.py / Requires server.py</span>
                </article>
            </div>
            <div class="admin-settings-actions" style="margin-top:18px">
                <button class="admin-link danger-button" data-detail-action="clear" type="button">🗑 清空数据库 / Clear Database</button>
                <button class="admin-link" data-detail-action="clear-notes" type="button">清空笔记 / Clear Notes</button>
                <a class="admin-link" href="Three.html">← 返回占卜 / Back to Tarot</a>
            </div>
            <div id="settings-confirm" style="display:none;margin-top:14px;padding:14px;border:1px solid rgba(255,100,90,0.6);border-radius:6px;background:rgba(80,10,10,0.6)">
                <p style="margin:0 0 10px;color:#ffb0a8">⚠ 此操作不可撤销！将删除所有占卜记录。<br>This action cannot be undone! All reading records will be deleted.</p>
                <div style="display:flex;gap:8px">
                    <button class="admin-link danger-button" data-detail-action="confirm-clear" type="button">确认删除 / Confirm Delete</button>
                    <button class="admin-link" data-detail-action="cancel-clear" type="button">取消 / Cancel</button>
                </div>
            </div>
            <div id="interpret-settings-mount" class="interpretation-panel" style="margin-top:24px"></div>
        `;
        mountInterpretSettings();
    }

    /**
     * Render the interpretation engine settings card (backend toggle +
     * model fields + OpenRouter API key). The card is itself rendered
     * inside #interpret-settings-mount so it picks up the panel-aware
     * theme styling shared with the live interpret panel.
     */
    async function mountInterpretSettings() {
        const root = el('interpret-settings-mount');
        if (!root) return;
        root.innerHTML = '<div class="empty-state">加载设置 / Loading settings…</div>';
        let settings;
        let health;
        try {
            [settings, health] = await Promise.all([
                fetch('/api/interpret/settings', { cache: 'no-store' }).then(r => r.json()),
                fetch('/api/interpret/health', { cache: 'no-store' }).then(r => r.json())
            ]);
        } catch (err) {
            root.innerHTML = '<div class="empty-state">设置加载失败 / Failed to load settings</div>';
            return;
        }
        const statusLabel = (() => {
            if (health.ollama === 'ready') return '✓ Ollama 已就绪 / Ready · ' + escapeHtml(health.model || '');
            if (health.ollama === 'model_missing') return '⚠ 模型未下载 / Model missing · 运行 `ollama pull qwen2.5:7b`';
            return '✗ Ollama 未运行 / Down · ' + escapeHtml(health.ollama_message || '');
        })();
        root.innerHTML = `
            <div class="reading-detail-head" style="border:0;padding:0">
                <div>
                    <p>AI 解读引擎 / Interpretation Engine</p>
                    <h2 style="font-size:1.2rem">${statusLabel}</h2>
                </div>
            </div>
            <div class="admin-info-grid" style="margin-top:8px">
                <article class="admin-mini-panel">
                    <h3>后端 / Backend</h3>
                    <select id="settings-backend" class="interpret-style-select" style="width:100%">
                        <option value="ollama">Ollama (本地 / Local)</option>
                        <option value="openrouter">OpenRouter (云 / Cloud)</option>
                    </select>
                </article>
                <article class="admin-mini-panel">
                    <h3>Ollama Model</h3>
                    <input id="settings-ollama-model" type="text" class="admin-search input" style="width:100%;min-height:34px;padding:6px 10px;border-radius:5px;border:1px solid var(--panel-line);background:color-mix(in oklch, var(--accent) 5%, transparent);color:var(--ink-text)" />
                </article>
                <article class="admin-mini-panel">
                    <h3>OpenRouter Model</h3>
                    <input id="settings-openrouter-model" type="text" style="width:100%;min-height:34px;padding:6px 10px;border-radius:5px;border:1px solid var(--panel-line);background:color-mix(in oklch, var(--accent) 5%, transparent);color:var(--ink-text)" />
                </article>
                <article class="admin-mini-panel" style="grid-column: 1 / -1">
                    <h3>OpenRouter API Key</h3>
                    <input id="settings-openrouter-key" type="password" placeholder="${settings.openrouter_api_key_set ? '已配置 / Configured (留空保持不变)' : 'sk-or-…'}" style="width:100%;min-height:34px;padding:6px 10px;border-radius:5px;border:1px solid var(--panel-line);background:color-mix(in oklch, var(--accent) 5%, transparent);color:var(--ink-text)" />
                    <span style="font-size:0.74rem;color:color-mix(in oklch, var(--ink-text) 60%, transparent)">本地存储，不上传 / Stored locally, never transmitted</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>默认风格 / Default Style</h3>
                    <select id="settings-default-style" class="interpret-style-select" style="width:100%">
                        <option value="traditional">经典 / Traditional</option>
                        <option value="intuitive">直觉 / Intuitive</option>
                        <option value="psychological">心理 / Psychological</option>
                    </select>
                </article>
                <article class="admin-mini-panel">
                    <h3>默认语言 / Default Language</h3>
                    <select id="settings-default-language" class="interpret-style-select" style="width:100%">
                        <option value="zh">中文 / Chinese</option>
                        <option value="en">English</option>
                    </select>
                </article>
            </div>
            <div style="margin-top:14px;display:flex;gap:8px">
                <button id="settings-save" class="interpret-btn">保存 / Save</button>
                <span id="settings-save-status" class="interpret-status" style="margin-left:6px"></span>
            </div>
        `;
        // Prime current values
        el('settings-backend').value = settings.backend || 'ollama';
        el('settings-ollama-model').value = settings.ollama_model || 'qwen2.5:7b';
        el('settings-openrouter-model').value = settings.openrouter_model || 'qwen/qwen-2.5-72b-instruct';
        el('settings-default-style').value = settings.default_style || 'traditional';
        el('settings-default-language').value = settings.default_language || 'zh';

        el('settings-save').addEventListener('click', async () => {
            const payload = {
                backend: el('settings-backend').value,
                ollama_model: el('settings-ollama-model').value.trim(),
                openrouter_model: el('settings-openrouter-model').value.trim(),
                default_style: el('settings-default-style').value,
                default_language: el('settings-default-language').value
            };
            const newKey = el('settings-openrouter-key').value;
            if (newKey) payload.openrouter_api_key = newKey;
            el('settings-save').disabled = true;
            el('settings-save-status').textContent = '保存中… / Saving…';
            try {
                const r = await fetch('/api/interpret/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify(payload)
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                el('settings-save-status').textContent = '✓ 已保存 / Saved';
            } catch (err) {
                el('settings-save-status').textContent = '✗ 保存失败 / Save failed';
            } finally {
                el('settings-save').disabled = false;
            }
        });
    }

    function renderSystem() {
        const detail = el('reading-detail');
        if (!detail) return;
        const health = state.systemHealth;
        const isOnline = health && health.ok;
        const status = health
            ? `${isOnline ? '✅ 在线 / Online' : '❌ 离线 / Offline'} — database: ${health.database || 'unknown'}`
            : '⏳ 检测中 / Checking...';
        detail.innerHTML = `
            <div class="reading-detail-head">
                <div>
                    <p>系统 / System</p>
                    <h2>运行状态 / Runtime Health</h2>
                    <span>${escapeHtml(status)}</span>
                </div>
                <button class="detail-action" data-detail-action="refresh-system" type="button">刷新 / Refresh</button>
            </div>
            <div class="admin-info-grid">
                <article class="admin-mini-panel">
                    <h3>后端服务 / Backend</h3>
                    <strong style="color:${isOnline ? '#6fdf7a' : '#ff9090'}">${isOnline ? '运行中 / Running' : '未启动 / Stopped'}</strong>
                    <span>${isOnline ? `server.py 正在监听 / Listening on port ${health.port || 5000}` : '请在项目目录运行 python server.py / Run python server.py in project dir'}</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>数据库 / Database</h3>
                    <strong>${health ? escapeHtml(health.database || 'N/A') : '未知 / Unknown'}</strong>
                    <span>SQLite · 本地文件 / Local file</span>
                </article>
                <article class="admin-mini-panel">
                    <h3>前端模式 / Frontend</h3>
                    <strong>Local-First</strong>
                    <span>Three.js · MediaPipe · 离线可用 / Works offline</span>
                </article>
            </div>
            <section class="admin-mini-panel" style="margin-top:14px">
                <h3>如何启动 / How to start server</h3>
                <p style="margin:4px 0;opacity:.8">在项目根目录打开终端，运行：</p>
                <code style="display:block;margin:6px 0;padding:8px 12px;background:rgba(0,0,0,0.4);border-radius:4px;color:var(--stage-gold-bright)">python server.py</code>
                <p style="margin:4px 0;opacity:.8">默认端口 5000。启动后刷新此页即可看到记录。</p>
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
        setStatus('Clear canceled — use Settings page confirm button');
    }

    async function clearAllReadingsConfirmed() {
        const result = await TarotAPI.clearReadings();
        if (!result || result.ok !== true) {
            setStatus('清空失败 / Clear failed — API may be offline');
            return;
        }
        state.readings = [];
        state.selectedId = null;
        state.selectedReading = null;
        renderList();
        renderCurrentView();
        setStatus('数据库已清空 / Database cleared');
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
        if (clearButton) clearButton.addEventListener('click', () => {
            setView('settings');
            // Render settings first, then reveal the confirm panel
            setTimeout(() => {
                const confirmPanel = el('settings-confirm');
                if (confirmPanel) confirmPanel.style.display = 'block';
            }, 50);
        });

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
                if (action === 'clear') {
                    // Show inline confirm panel instead of window.prompt
                    const confirmPanel = el('settings-confirm');
                    if (confirmPanel) confirmPanel.style.display = 'block';
                }
                if (action === 'confirm-clear') clearAllReadingsConfirmed();
                if (action === 'cancel-clear') {
                    const confirmPanel = el('settings-confirm');
                    if (confirmPanel) confirmPanel.style.display = 'none';
                }
                if (action === 'clear-notes') {
                    try {
                        const keys = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            if (localStorage.key(i).startsWith('akashic-admin-note-')) keys.push(localStorage.key(i));
                        }
                        keys.forEach(k => localStorage.removeItem(k));
                        setStatus(`已清空 ${keys.length} 条笔记 / Cleared ${keys.length} notes`);
                        renderSettings();
                    } catch(e) { setStatus('清空笔记失败 / Failed to clear notes'); }
                }
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

