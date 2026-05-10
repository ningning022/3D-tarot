(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.MouseInteraction = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function resolveMouseCardAction(state, clickedId) {
        const phase = state && state.phase;
        if (!clickedId) return 'IGNORE';

        if (phase === 'idle') {
            const selectedIds = new Set((state && state.selectedIdleIds) || []);
            return selectedIds.has(clickedId) ? 'UNSELECT_IDLE_CARD' : 'SELECT_IDLE_CARD';
        }

        if (phase === 'active') {
            const previewedSet = new Set((state && state.previewedIds) || []);
            return previewedSet.has(clickedId) ? 'UNPREVIEW_CARD' : 'PREVIEW_CARD';
        }

        if (phase === 'awaiting') {
            return 'NEXT_SPREAD';
        }

        return 'IGNORE';
    }

    return { resolveMouseCardAction };
});
