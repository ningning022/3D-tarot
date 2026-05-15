/**
 * Frontend bridge for the tarot interpretation agent.
 *
 * Knows nothing about which page it's running on; admin.html and
 * Three.html both call into the same exported surface:
 *
 *   AkashicInterpret.streamInterpretation(readingId, opts) — async iter of {chunk}|{done}|{error}
 *   AkashicInterpret.mountPanel(container, readingId, opts) — full panel UX
 *   AkashicInterpret.fetchHistory(readingId)              — GET /api/interpret/<id>?all=1
 *   AkashicInterpret.fetchHealth()                        — GET /api/interpret/health
 *
 * The panel does its own status / error / streaming render. It is fully
 * theme-aware via CSS custom properties from theme.css.
 */
(function (root) {
    const STORAGE_LANG_KEY = 'akashic-interpret-language';
    const STORAGE_STYLE_KEY = 'akashic-interpret-style';

    // ── Network helpers ────────────────────────────────────────

    async function fetchHealth() {
        try {
            const r = await fetch('/api/interpret/health', { cache: 'no-store' });
            if (!r.ok) return { ollama: 'down', backend: 'ollama', fallback_available: false };
            return await r.json();
        } catch (_err) {
            return { ollama: 'down', backend: 'ollama', fallback_available: false };
        }
    }

    async function fetchHistory(readingId) {
        const r = await fetch(`/api/interpret/${readingId}?all=1`, { cache: 'no-store' });
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(`history fetch failed: ${r.status}`);
        return await r.json();
    }

    /**
     * Drive a streaming POST to /api/interpret/<id>. Yields parsed SSE
     * events one by one. Each event is one of:
     *   { chunk: string }   — append text
     *   { done: true }      — stream ended cleanly
     *   { error: string, message: string } — backend reported an error
     *
     * The optional AbortSignal lets the caller cancel the stream early.
     */
    async function* streamInterpretation(readingId, opts = {}) {
        const { style, language, signal } = opts;
        const resp = await fetch(`/api/interpret/${readingId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ style, language }),
            signal
        });

        if (resp.status === 409) {
            yield { error: 'concurrent', message: 'Another interpretation is already running for this reading.' };
            return;
        }
        if (resp.status === 404) {
            yield { error: 'not_found', message: 'Reading not found.' };
            return;
        }
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            yield { error: 'http_error', message: `HTTP ${resp.status}: ${text}` };
            return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                // SSE frames are separated by blank lines
                let idx;
                while ((idx = buffer.indexOf('\n\n')) !== -1) {
                    const frame = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);
                    const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
                    if (!dataLine) continue;
                    const payload = dataLine.slice(5).trim();
                    if (!payload) continue;
                    try {
                        yield JSON.parse(payload);
                    } catch (_err) { /* ignore malformed frame */ }
                }
            }
        } finally {
            try { reader.releaseLock(); } catch (_) { /* ignore */ }
        }
    }

    // ── Storage helpers ─────────────────────────────────────────

    function getStoredLanguage() {
        try {
            const v = localStorage.getItem(STORAGE_LANG_KEY);
            if (v === 'zh' || v === 'en') return v;
        } catch (_) { /* ignore */ }
        return null;
    }

    function getStoredStyle() {
        try {
            const v = localStorage.getItem(STORAGE_STYLE_KEY);
            if (v === 'traditional' || v === 'intuitive' || v === 'psychological') return v;
        } catch (_) { /* ignore */ }
        return null;
    }

    function persistLanguage(v) { try { localStorage.setItem(STORAGE_LANG_KEY, v); } catch (_) {} }
    function persistStyle(v)    { try { localStorage.setItem(STORAGE_STYLE_KEY, v); } catch (_) {} }

    function inferLanguage() {
        if (typeof document !== 'undefined' && document.documentElement) {
            const lang = (document.documentElement.lang || '').toLowerCase();
            if (lang.startsWith('en')) return 'en';
        }
        return 'zh';
    }

    // ── DOM helpers ─────────────────────────────────────────────

    const STYLES = [
        { key: 'traditional',   label: '经典 / Traditional' },
        { key: 'intuitive',     label: '直觉 / Intuitive' },
        { key: 'psychological', label: '心理 / Psychological' }
    ];

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') node.className = v;
            else if (k === 'dataset') Object.assign(node.dataset, v);
            else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v);
        }
        for (const child of children) {
            if (child == null) continue;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return node;
    }

    function renderErrorBanner(payload) {
        const code = payload.error || 'unknown';
        const msgs = {
            ollama_down: {
                title: 'Ollama 未运行 / Ollama not running',
                hint: '请确认 Ollama 服务已启动，或在管理设置里改用云端 OpenRouter。',
                cmd:  'D:\\Programs\\Ollama\\ollama.exe serve'
            },
            model_missing: {
                title: '模型未下载 / Model not pulled',
                hint: '运行下面命令拉取默认模型：',
                cmd:  'ollama pull qwen2.5:7b'
            },
            openrouter_no_key: {
                title: '缺少 OpenRouter API Key',
                hint: '请在 Admin 设置面板配置 OpenRouter API key，或切回 Ollama 后端。',
                cmd:  ''
            },
            concurrent: {
                title: '已有解读正在进行 / Already running',
                hint: '同一记录的另一次解读正在进行，请稍候再试。',
                cmd: ''
            },
            not_found: {
                title: '记录不存在 / Reading missing',
                hint: '该记录已被删除或 id 错误。',
                cmd: ''
            }
        };
        const spec = msgs[code] || {
            title: '解读失败 / Interpretation failed',
            hint: payload.message || code,
            cmd: ''
        };
        return el('div', { class: 'interpret-error' }, [
            el('strong', {}, [spec.title]),
            el('div', { class: 'interpret-error-hint' }, [spec.hint]),
            spec.cmd
                ? el('pre', { class: 'interpret-error-cmd', onclick: ev => copyToClipboard(spec.cmd, ev.currentTarget) }, [spec.cmd])
                : null
        ]);
    }

    function copyToClipboard(text, source) {
        try {
            navigator.clipboard.writeText(text).then(() => {
                if (source) {
                    const prev = source.dataset.label || source.textContent;
                    source.textContent = '已复制 / Copied';
                    setTimeout(() => { source.textContent = prev; }, 1400);
                }
            });
        } catch (_) { /* clipboard blocked; user can still select manually */ }
    }

    /**
     * Mount the full interpretation panel inside `container`.
     * - Renders the latest existing interpretation (if any) when called
     * - Shows controls: style dropdown, language dropdown, [Generate] [Regenerate] buttons
     * - On generate, streams chunks into the result area
     * - On error, swaps result area for an error banner
     */
    async function mountPanel(container, readingId, opts = {}) {
        if (!container) return null;
        container.classList.add('interpretation-panel');
        container.innerHTML = '';

        const langInitial   = opts.language || getStoredLanguage() || inferLanguage();
        const styleInitial  = opts.style    || getStoredStyle()    || 'traditional';

        const styleSelect = el('select', { class: 'interpret-style-select' },
            STYLES.map(s => el('option', { value: s.key }, [s.label]))
        );
        styleSelect.value = styleInitial;
        styleSelect.addEventListener('change', () => persistStyle(styleSelect.value));

        const langSelect = el('select', { class: 'interpret-lang-select' }, [
            el('option', { value: 'zh' }, ['中文 / Chinese']),
            el('option', { value: 'en' }, ['English'])
        ]);
        langSelect.value = langInitial;
        langSelect.addEventListener('change', () => persistLanguage(langSelect.value));

        const genBtn = el('button', { type: 'button', class: 'interpret-btn interpret-generate' },
            ['生成解读 / Interpret']);
        const cancelBtn = el('button', { type: 'button', class: 'interpret-btn interpret-cancel', hidden: '' },
            ['取消 / Cancel']);

        const status = el('div', { class: 'interpret-status' }, []);
        const healthBanner = el('div', { class: 'interpret-health-slot' }, []);
        const cardStrip = el('div', { class: 'interpret-cards' }, []);
        const result = el('div', { class: 'interpret-result' }, []);
        const historyList = el('div', { class: 'interpret-history' }, []);

        container.appendChild(el('div', { class: 'interpret-toolbar' }, [
            styleSelect,
            langSelect,
            genBtn,
            cancelBtn,
            status
        ]));
        // Card preview strip — populated by loadReadingCards() below.
        // Empty selector hides it via :empty in CSS.
        container.appendChild(cardStrip);
        // Health banner sits between toolbar and result so it persists
        // even when loadHistory rewrites the result body.
        container.appendChild(healthBanner);
        container.appendChild(result);
        container.appendChild(historyList);

        // ── Populate the card preview strip from the saved reading.
        // This runs in parallel with loadHistory; both are non-blocking.
        async function loadReadingCards() {
            try {
                const r = await fetch(`/api/readings/${readingId}`, { cache: 'no-store' });
                if (!r.ok) return;
                const reading = await r.json();
                const cards = (reading && reading.cards) || [];
                cardStrip.innerHTML = '';
                for (const c of cards) {
                    const reversed = !!c.isReversed;
                    cardStrip.appendChild(el('div', { class: 'interpret-card' }, [
                        c.slotLabel ? el('div', { class: 'interpret-card-slot' }, [c.slotLabel]) : null,
                        el('img', {
                            class: 'interpret-card-img' + (reversed ? ' reversed' : ''),
                            src: `image2/${encodeURIComponent(c.imageFile || '')}`,
                            alt: `${c.zh || c.en || ''} ${reversed ? '逆位' : '正位'}`,
                            loading: 'lazy'
                        }, []),
                        el('div', { class: 'interpret-card-name' }, [c.zh || c.en || '?']),
                        c.en ? el('div', { class: 'interpret-card-en' }, [c.en]) : null,
                        el('span', {
                            class: 'interpret-card-orient' + (reversed ? ' reversed' : '')
                        }, [reversed ? '逆位' : '正位'])
                    ]));
                }
            } catch (_) { /* non-fatal; panel still works without strip */ }
        }

        async function loadHistory() {
            try {
                const rows = await fetchHistory(readingId);
                if (!rows.length) {
                    historyList.innerHTML = '';
                    genBtn.textContent = '生成解读 / Interpret';
                    return;
                }
                // Once history exists, the action is regeneration, not first-time generation.
                genBtn.textContent = '重新生成 / Regenerate';
                // First row = latest. Render it inline. Older entries become collapsed chips.
                const latest = rows[0];
                result.dataset.fromHistory = '1';
                result.textContent = latest.content;
                status.textContent = `上次：${formatTime(latest.created_at)} · ${latest.model} · ${latest.style}`;

                historyList.innerHTML = '';
                if (rows.length > 1) {
                    historyList.appendChild(el('div', { class: 'interpret-history-title' },
                        [`历史 ${rows.length - 1} 条 / ${rows.length - 1} prior interpretations`]));
                    for (const row of rows.slice(1)) {
                        historyList.appendChild(el('button', {
                            type: 'button',
                            class: 'interpret-history-item',
                            onclick: () => {
                                result.dataset.fromHistory = '1';
                                result.textContent = row.content;
                                status.textContent = `${formatTime(row.created_at)} · ${row.model} · ${row.style}`;
                            }
                        }, [`${formatTime(row.created_at)} · ${row.style}`]));
                    }
                }
            } catch (err) {
                /* silent — fresh panel without history is fine */
            }
        }

        async function runStream() {
            const style = styleSelect.value;
            const language = langSelect.value;
            persistStyle(style); persistLanguage(language);

            result.innerHTML = '';
            result.dataset.fromHistory = '';
            result.classList.add('interpret-result-streaming');
            status.textContent = '正在唤醒模型，可能需要 5–30 秒 / Warming up model…';
            genBtn.disabled = true;
            genBtn.classList.add('is-loading');
            cancelBtn.hidden = false;

            const controller = new AbortController();
            cancelBtn.onclick = () => {
                controller.abort();
                cancelBtn.hidden = true;
            };

            const started = performance.now();
            let totalChars = 0;
            let sawError = false;

            try {
                for await (const event of streamInterpretation(readingId, {
                    style, language, signal: controller.signal
                })) {
                    if (event.error) {
                        sawError = true;
                        result.innerHTML = '';
                        result.appendChild(renderErrorBanner(event));
                        break;
                    }
                    if (event.done) break;
                    if (event.chunk) {
                        result.append(event.chunk);
                        totalChars += event.chunk.length;
                        if (totalChars > 4) status.textContent = '生成中 / Streaming…';
                    }
                }
                if (!sawError) {
                    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
                    status.textContent = `完成 / Done · ${elapsed}s · ${totalChars} chars`;
                    await loadHistory(); // refresh history list with the new row
                }
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    status.textContent = '已取消 / Cancelled';
                } else {
                    result.innerHTML = '';
                    result.appendChild(renderErrorBanner({
                        error: 'http_error',
                        message: err && err.message ? err.message : String(err)
                    }));
                }
            } finally {
                result.classList.remove('interpret-result-streaming');
                genBtn.disabled = false;
                genBtn.classList.remove('is-loading');
                cancelBtn.hidden = true;
            }
        }

        genBtn.addEventListener('click', runStream);

        // Kick both off in parallel — they touch different DOM areas.
        await Promise.all([loadHistory(), loadReadingCards()]);

        // Pre-flight health banner — rendered in its own slot above the
        // result body so loadHistory can't overwrite it.
        const health = await fetchHealth();
        if (health.ollama !== 'ready' && health.backend === 'ollama' && !health.fallback_available) {
            healthBanner.innerHTML = '';
            healthBanner.appendChild(renderErrorBanner({
                error: health.ollama === 'model_missing' ? 'model_missing' : 'ollama_down',
                message: health.ollama_message || ''
            }));
        }
        return { runStream, loadHistory, container };
    }

    function formatTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString();
    }

    // ── Three.html spread-prompt integration ────────────────────
    // The spread-prompt modal exposes a "解读 / Interpret" button. When
    // clicked it opens #interpret-overlay and mounts the panel against
    // window.lastSavedReadingId (set by history.js once the spread save
    // completes). If the save hasn't fired yet, the button shows a
    // tooltip and refuses to open.

    function openOverlayForLastReading() {
        const overlay = document.getElementById('interpret-overlay');
        const mount = document.getElementById('interpret-overlay-mount');
        if (!overlay || !mount) return;
        const readingId = root.lastSavedReadingId;
        if (!readingId) {
            const btn = document.getElementById('prompt-interpret');
            if (btn) {
                const original = btn.textContent;
                btn.textContent = '保存中… / Saving';
                btn.disabled = true;
                setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
            }
            return;
        }
        overlay.hidden = false;
        mountPanel(mount, readingId);
    }

    function closeOverlay() {
        const overlay = document.getElementById('interpret-overlay');
        if (overlay) overlay.hidden = true;
    }

    function bindThreePromptInterpret() {
        const open = document.getElementById('prompt-interpret');
        if (open) open.addEventListener('click', openOverlayForLastReading);
        const close = document.getElementById('interpret-overlay-close');
        if (close) close.addEventListener('click', closeOverlay);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeOverlay();
        });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bindThreePromptInterpret);
        } else {
            bindThreePromptInterpret();
        }
    }

    // ── Public surface ──────────────────────────────────────────

    const api = {
        streamInterpretation,
        fetchHistory,
        fetchHealth,
        mountPanel,
        openOverlayForLastReading,
        closeOverlay
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.AkashicInterpret = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
