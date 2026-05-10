/**
 * Theme controller.
 *
 * Reads the persisted preference from localStorage("akashic-theme") and
 * falls back to the OS color-scheme. Writes <html data-theme="dark|light">
 * and broadcasts a "theme-change" CustomEvent so other modules (Three.js
 * lighting) can react.
 *
 * The anti-flicker inline script in Three.html sets the initial value
 * before stylesheets load — this module owns the toggle and persistence.
 */
(function () {
    const STORAGE_KEY = 'akashic-theme';
    const root = document.documentElement;

    function readPreferred() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored === 'dark' || stored === 'light') return stored;
        } catch (_) { /* private mode / SSR — fall through */ }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        return 'light';
    }

    function persist(theme) {
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) { /* ignore */ }
    }

    function applyTheme(theme, persistChoice) {
        root.dataset.theme = theme;
        if (persistChoice) persist(theme);
        const evt = new CustomEvent('theme-change', { detail: { theme } });
        window.dispatchEvent(evt);
    }

    function currentTheme() {
        return root.dataset.theme === 'light' ? 'light' : 'dark';
    }

    function toggle() {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    }

    function bindButton() {
        const btn = document.getElementById('theme-toggle');
        if (btn) btn.addEventListener('click', toggle);
    }

    function bindShortcut() {
        window.addEventListener('keydown', event => {
            if (event.key === 't' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                const tag = event.target && event.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                toggle();
            }
        });
    }

    function bindSystemSync() {
        if (!window.matchMedia) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = e => {
            try {
                if (localStorage.getItem(STORAGE_KEY)) return;
            } catch (_) { /* ignore */ }
            applyTheme(e.matches ? 'dark' : 'light', false);
        };
        if (mq.addEventListener) mq.addEventListener('change', listener);
        else if (mq.addListener) mq.addListener(listener);
    }

    // Reconcile data-theme set by the inline anti-flicker script. If the
    // attribute is missing (e.g. the inline script was bypassed), apply now.
    if (!root.dataset.theme) applyTheme(readPreferred(), false);
    else window.dispatchEvent(new CustomEvent('theme-change', { detail: { theme: currentTheme() } }));

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { bindButton(); bindShortcut(); bindSystemSync(); });
    } else {
        bindButton();
        bindShortcut();
        bindSystemSync();
    }

    window.AkashicTheme = { current: currentTheme, toggle, set: t => applyTheme(t, true) };
})();
