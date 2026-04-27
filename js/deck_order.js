(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.DeckOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    function normalizeCount(count) {
        const value = Number(count);
        if (!Number.isFinite(value) || value <= 0) return 0;
        return Math.floor(value);
    }

    function createSequentialDeckOrder(count) {
        const total = normalizeCount(count);
        return Array.from({ length: total }, (_, index) => index);
    }

    function createShuffledDeckOrder(count, randomFn = Math.random) {
        const order = createSequentialDeckOrder(count);
        for (let index = order.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(randomFn() * (index + 1));
            [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
        }
        return order;
    }

    return {
        createSequentialDeckOrder,
        createShuffledDeckOrder,
    };
});
