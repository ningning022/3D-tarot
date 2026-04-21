(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.SpreadLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    const CARD_WIDTH = 2.1;
    const CARD_HEIGHT = 3.7;
    const TARGET_WIDTH_RATIO = 0.86;
    const TARGET_HEIGHT_RATIO = 0.76;
    const DEFAULT_MIN_SCALE = 0.42;
    const GAP_RATIO_X = 0.08;
    const GAP_RATIO_Y = 0.07;

    function inferViewport(options = {}) {
        if (Number.isFinite(options.viewportWidth) && Number.isFinite(options.viewportHeight)) {
            return {
                width: Math.max(0.1, options.viewportWidth),
                height: Math.max(0.1, options.viewportHeight)
            };
        }

        const aspect = Number.isFinite(options.aspect) ? options.aspect : (
            typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9
        );
        const fov = Number.isFinite(options.fov) ? options.fov : 50;
        const cameraZ = Number.isFinite(options.cameraZ) ? options.cameraZ : 10;
        const targetZ = Number.isFinite(options.targetZ) ? options.targetZ : 0;
        const distance = Math.max(0.1, Math.abs(cameraZ - targetZ));
        const height = 2 * Math.tan((fov * Math.PI / 180) / 2) * distance;
        return { width: height * aspect, height };
    }

    function layoutBounds(columns, rows, scale, cardWidth, cardHeight) {
        const stepX = cardWidth * scale * (1 + GAP_RATIO_X);
        const stepY = cardHeight * scale * (1 + GAP_RATIO_Y);
        return {
            width: columns * cardWidth * scale + Math.max(0, columns - 1) * (stepX - cardWidth * scale),
            height: rows * cardHeight * scale + Math.max(0, rows - 1) * (stepY - cardHeight * scale),
            stepX,
            stepY
        };
    }

    function computeSpreadLayout(count, options = {}) {
        const total = Math.max(0, Math.floor(count || 0));
        if (total === 0) return [];

        const cardWidth = options.cardWidth || CARD_WIDTH;
        const cardHeight = options.cardHeight || CARD_HEIGHT;
        const viewport = inferViewport(options);
        const usableWidth = viewport.width * TARGET_WIDTH_RATIO;
        const usableHeight = viewport.height * TARGET_HEIGHT_RATIO;
        const preferredScale = total <= 3 ? 1 : Math.min(1, Math.max(DEFAULT_MIN_SCALE, 6 / total));

        let best = null;
        for (let columns = 1; columns <= total; columns += 1) {
            const rows = Math.ceil(total / columns);
            const widthScale = usableWidth / (columns * cardWidth + Math.max(0, columns - 1) * cardWidth * GAP_RATIO_X);
            const heightScale = usableHeight / (rows * cardHeight + Math.max(0, rows - 1) * cardHeight * GAP_RATIO_Y);
            const fitScale = Math.min(preferredScale, widthScale, heightScale);
            const penalty = Math.abs(columns - Math.ceil(Math.sqrt(total * cardHeight / cardWidth))) * 0.02;
            const score = fitScale - penalty;
            if (!best || score > best.score) {
                best = { columns, rows, scale: fitScale, score };
            }
        }

        const scale = Math.max(0.05, best.scale);
        const bounds = layoutBounds(best.columns, best.rows, scale, cardWidth, cardHeight);
        const layout = [];
        for (let index = 0; index < total; index += 1) {
            const row = Math.floor(index / best.columns);
            const col = index % best.columns;
            const rowCount = row === best.rows - 1 ? total - row * best.columns : best.columns;
            const rowWidth = rowCount * cardWidth * scale + Math.max(0, rowCount - 1) * (bounds.stepX - cardWidth * scale);
            layout.push({
                x: -rowWidth / 2 + cardWidth * scale / 2 + col * bounds.stepX,
                y: bounds.height / 2 - cardHeight * scale / 2 - row * bounds.stepY,
                scale
            });
        }
        return layout;
    }

    function computeBrowserSpreadLayout(count) {
        const aspect = typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9;
        return computeSpreadLayout(count, { aspect, fov: 50, cameraZ: 10, targetZ: 0 });
    }

    return {
        computeSpreadLayout,
        computeBrowserSpreadLayout
    };
});
