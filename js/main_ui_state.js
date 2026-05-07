(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.MainUiState = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function getPrimaryActionState(spreadState) {
        if (spreadState === 'IDLE') {
            return {
                label: '新占卜 / New',
                disabled: false,
                intent: 'START_READING'
            };
        }
        if (spreadState === 'AWAITING') {
            return {
                label: '下一阵 / Next',
                disabled: false,
                intent: 'NEXT_SPREAD'
            };
        }
        return {
            label: '进行中 / Busy',
            disabled: true,
            intent: 'SHOW_BUSY'
        };
    }

    function canChangeSpread(spreadState) {
        return spreadState === 'IDLE';
    }

    return {
        getPrimaryActionState,
        canChangeSpread
    };
});
