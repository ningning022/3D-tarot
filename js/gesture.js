(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.GestureTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    const NONE = 'NONE';
    const STATE_ALLOWED = {
        IDLE: new Set(['OPEN', 'POINT', 'PINCH', 'TWO_FINGER', NONE]),
        ACTIVE: new Set(['PINCH', 'FIST', 'OPEN', NONE]),
        AWAITING: new Set(['OPEN', 'FIST', NONE]),
        ENDED: new Set([NONE])
    };

    function dist(p1, p2) {
        if (!p1 || !p2) return 999;
        return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    function palmWidth(lm) {
        return Math.max(dist(lm[5], lm[17]), dist(lm[0], lm[9]) * 0.8, 0.08);
    }

    function normDist(lm, a, b) {
        return dist(lm[a], lm[b]) / palmWidth(lm);
    }

    function isExtended(lm, tip, pip) {
        return lm[tip].y < lm[pip].y - 0.03;
    }

    function isFolded(lm, tip, pip) {
        return lm[tip].y > lm[pip].y + 0.02;
    }

    function scoreFromMargin(value, threshold) {
        return Math.max(0.5, Math.min(0.98, 0.5 + Math.abs(value - threshold)));
    }

    function classifyGesture(lm) {
        if (!Array.isArray(lm) || lm.length < 21) {
            return { gesture: NONE, confidence: 1 };
        }

        const pinchDistance = normDist(lm, 4, 8);
        const twoFingerDistance = normDist(lm, 8, 12);
        const indexExtended = isExtended(lm, 8, 6);
        const middleExtended = isExtended(lm, 12, 10);
        const ringExtended = isExtended(lm, 16, 14);
        const pinkyExtended = isExtended(lm, 20, 18);
        const indexFolded = isFolded(lm, 8, 6);
        const middleFolded = isFolded(lm, 12, 10);
        const ringFolded = isFolded(lm, 16, 14);
        const pinkyFolded = isFolded(lm, 20, 18);

        const isPinch = pinchDistance < 0.34;
        const isFist = !isPinch && indexFolded && middleFolded && ringFolded && pinkyFolded;
        const isOpen = indexExtended && middleExtended && ringExtended && pinkyExtended && pinchDistance > 0.46;
        const isTwoFinger = indexExtended && middleExtended && ringFolded && pinkyFolded
            && twoFingerDistance < 0.55 && pinchDistance > 0.42;
        const isPoint = indexExtended && middleFolded && ringFolded && pinkyFolded && pinchDistance > 0.42;

        if (isPinch) return { gesture: 'PINCH', confidence: scoreFromMargin(pinchDistance, 0.34) };
        if (isFist) return { gesture: 'FIST', confidence: 0.86 };
        if (isOpen) return { gesture: 'OPEN', confidence: 0.82 };
        if (isTwoFinger) return { gesture: 'TWO_FINGER', confidence: scoreFromMargin(twoFingerDistance, 0.55) };
        if (isPoint) return { gesture: 'POINT', confidence: 0.78 };
        return { gesture: NONE, confidence: 1 };
    }

    function gateGestureForState(gesture, state) {
        const normalized = gesture || NONE;
        const allowed = STATE_ALLOWED[state] || STATE_ALLOWED.IDLE;
        return allowed.has(normalized) ? normalized : NONE;
    }

    function createGestureStabilizer(options = {}) {
        const windowSize = options.windowSize || 5;
        const minCount = options.minCount || 3;
        const noneCount = options.noneCount || 2;
        const confidenceThreshold = options.confidenceThreshold || 0.5;
        let history = [];
        let stableGesture = NONE;

        function reset(nextGesture = NONE) {
            history = [];
            stableGesture = nextGesture;
            return stableGesture;
        }

        function update(raw, state) {
            const rawGesture = raw && raw.confidence >= confidenceThreshold ? raw.gesture : NONE;
            const gated = gateGestureForState(rawGesture, state);

            history.push(gated);
            if (history.length > windowSize) history.shift();

            const recentNone = history.slice(-noneCount).every(gesture => gesture === NONE);
            if (recentNone) {
                stableGesture = NONE;
                return stableGesture;
            }

            const counts = history.reduce((acc, gesture) => {
                acc[gesture] = (acc[gesture] || 0) + 1;
                return acc;
            }, {});

            Object.keys(counts).forEach(gesture => {
                if (gesture !== NONE && counts[gesture] >= minCount) {
                    stableGesture = gesture;
                }
            });

            return stableGesture;
        }

        return {
            update,
            reset,
            get current() {
                return stableGesture;
            }
        };
    }

    return {
        classifyGesture,
        createGestureStabilizer,
        gateGestureForState
    };
});
