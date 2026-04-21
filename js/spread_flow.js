(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.SpreadFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function shouldBeginEntering(spreadState, currentGesture, now, gestureDebounce) {
        return spreadState === 'IDLE' && currentGesture === 'OPEN' && now > gestureDebounce;
    }

    function createEnteringSnapshot(cards) {
        const unique = [];
        (cards || []).forEach(card => {
            if (card && !unique.includes(card)) {
                unique.push(card);
            }
        });
        return unique;
    }

    function resolveSelectedOrientation(card, randomFn = Math.random) {
        if (card && card.userData && Object.prototype.hasOwnProperty.call(card.userData, 'isReversed')) {
            return Boolean(card.userData.isReversed);
        }
        return randomFn() < 0.5;
    }

    return {
        shouldBeginEntering,
        createEnteringSnapshot,
        resolveSelectedOrientation
    };
});
