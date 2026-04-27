(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.InputMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
    const STORAGE_KEY = 'akashic-tarot-control-mode';
    const VALID_MODES = new Set(['mouse', 'camera']);
    const ROTATE_KICK = 0.025;
    let mouseEventsBound = false;

    function createMemoryStorage(initial = {}) {
        const data = { ...initial };
        return {
            getItem(key) {
                return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
            },
            setItem(key, value) {
                data[key] = String(value);
            },
            removeItem(key) {
                delete data[key];
            }
        };
    }

    function normalizeMode(mode) {
        return VALID_MODES.has(mode) ? mode : null;
    }

    function getSearchParam(search, key) {
        const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
        return params.get(key);
    }

    function getPreferredMode(search, storage) {
        const queryMode = normalizeMode(getSearchParam(search, 'control'));
        if (queryMode) return queryMode;
        const saved = storage && typeof storage.getItem === 'function'
            ? normalizeMode(storage.getItem(STORAGE_KEY))
            : null;
        return saved || null;
    }

    function setPreferredMode(mode, storage) {
        const normalized = normalizeMode(mode);
        if (!normalized) return null;
        if (storage && typeof storage.setItem === 'function') {
            storage.setItem(STORAGE_KEY, normalized);
        }
        return normalized;
    }

    function mapMouseEventToGesture(type) {
        if (type === 'mousedown') return 'PINCH';
        if (type === 'mouseup') return 'OPEN';
        if (type === 'mouseleave') return 'NONE';
        return null;
    }

    function mapKeyEventToAction(event) {
        if (!event) return null;
        if (event.code === 'Space' && event.type === 'keydown') return 'CONFIRM';
        if (event.code === 'Space' && event.type === 'keyup') return 'RELEASE_CONFIRM';
        if ((event.code === 'ArrowLeft' || event.code === 'KeyA') && event.type === 'keydown') return 'ROTATE_LEFT';
        if ((event.code === 'ArrowRight' || event.code === 'KeyD') && event.type === 'keydown') return 'ROTATE_RIGHT';
        return null;
    }

    function applyKeyboardAction(state, action) {
        if (!state || !action) return state;
        if (action === 'CONFIRM') state.currentGesture = 'FIST';
        if (action === 'RELEASE_CONFIRM' && state.currentGesture === 'FIST') state.currentGesture = 'NONE';
        if (action === 'ROTATE_LEFT') state.carouselVelocity -= ROTATE_KICK;
        if (action === 'ROTATE_RIGHT') state.carouselVelocity += ROTATE_KICK;
        return state;
    }

    function browserStorage() {
        try {
            return root.localStorage || null;
        } catch (error) {
            return null;
        }
    }

    function showChooser() {
        const chooser = root.document && root.document.getElementById('control-chooser');
        if (chooser) chooser.style.display = 'block';
    }

    function hideChooser() {
        const chooser = root.document && root.document.getElementById('control-chooser');
        if (chooser) chooser.style.display = 'none';
    }

    function setModeText(mode) {
        const status = root.document && root.document.getElementById('status');
        const gesture = root.document && root.document.getElementById('gesture-active');
        if (root.document && root.document.body) {
            root.document.body.dataset.controlMode = mode;
        }
        if (mode === 'mouse') {
            if (status) status.innerText = 'Mouse Mode / 鼠标操作';
            if (gesture) gesture.innerText = 'Mouse + keyboard controls';
            const guide = root.document.getElementById('guide-text');
            if (guide) {
                guide.innerText = '移动鼠标指向 / Hold mouse to pick / Release to open / Space to confirm';
            }
        }
        if (mode === 'camera') {
            if (status) status.innerText = 'Camera Mode / 摄像头手势';
            if (gesture) gesture.innerText = '等待摄像头 / Awaiting camera';
        }
    }

    function setRuntimeGesture(gesture) {
        if (typeof currentGesture !== 'undefined') {
            currentGesture = gesture;
        } else {
            root.currentGesture = gesture;
        }
    }

    function setRuntimeReady(value) {
        if (typeof isGestureReady !== 'undefined') {
            isGestureReady = value;
        } else {
            root.isGestureReady = value;
        }
    }

    function setRuntimeMode(mode) {
        if (typeof activeInputMode !== 'undefined') {
            activeInputMode = mode;
        } else {
            root.activeInputMode = mode;
        }
    }

    function setRuntimeHandPosition(clientX, clientY) {
        const x = (clientX / root.window.innerWidth - 0.5) * 2;
        const y = -(clientY / root.window.innerHeight - 0.5) * 2;
        if (typeof handScreenPos !== 'undefined') {
            handScreenPos.x = x;
            handScreenPos.y = y;
        } else if (root.handScreenPos) {
            root.handScreenPos.x = x;
            root.handScreenPos.y = y;
        }
    }

    function applyRuntimeKeyboardAction(action) {
        if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'mouse') return;
        const state = {
            currentGesture: typeof currentGesture !== 'undefined' ? currentGesture : root.currentGesture,
            carouselVelocity: typeof carouselVelocity !== 'undefined' ? carouselVelocity : root.carouselVelocity
        };
        applyKeyboardAction(state, action);
        setRuntimeGesture(state.currentGesture);
        if (typeof carouselVelocity !== 'undefined') {
            carouselVelocity = state.carouselVelocity;
        } else {
            root.carouselVelocity = state.carouselVelocity;
        }
    }

    function startMouseMode() {
        if (typeof root.stopMediaPipeCamera === 'function') {
            root.stopMediaPipeCamera();
        }
        hideChooser();
        setModeText('mouse');
        setRuntimeMode('mouse');
        setRuntimeReady(true);
        setRuntimeGesture('NONE');

        if (mouseEventsBound) return;
        mouseEventsBound = true;

        root.window.addEventListener('mousemove', event => {
            if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'mouse') return;
            setRuntimeHandPosition(event.clientX, event.clientY);
        });

        ['mousedown', 'mouseup', 'mouseleave'].forEach(type => {
            root.window.addEventListener(type, event => {
                if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'mouse') return;
                if (type === 'mousedown' && event.button !== 0) return;
                const gesture = mapMouseEventToGesture(type);
                if (gesture) setRuntimeGesture(gesture);
            });
        });

        root.window.addEventListener('keydown', event => {
            if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'mouse') return;
            const action = mapKeyEventToAction({ code: event.code, type: event.type });
            if (!action) return;
            event.preventDefault();
            applyRuntimeKeyboardAction(action);
        });
        root.window.addEventListener('keyup', event => {
            if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'mouse') return;
            const action = mapKeyEventToAction({ code: event.code, type: event.type });
            if (!action) return;
            event.preventDefault();
            applyRuntimeKeyboardAction(action);
        });
    }

    function startCameraMode() {
        hideChooser();
        setModeText('camera');
        setRuntimeMode('camera');
        setRuntimeReady(false);
        if (typeof root.initMediaPipe === 'function') {
            root.initMediaPipe();
        }
    }

    function selectMode(mode) {
        const storage = browserStorage();
        const normalized = setPreferredMode(mode, storage);
        if (normalized === 'mouse') startMouseMode();
        if (normalized === 'camera') startCameraMode();
    }

    function bindChooser() {
        const doc = root.document;
        if (!doc) return;
        const chooser = doc.getElementById('control-chooser');
        const switchButton = doc.getElementById('control-switch');
        if (chooser) {
            chooser.querySelectorAll('[data-control-mode]').forEach(button => {
                button.addEventListener('click', () => selectMode(button.dataset.controlMode));
            });
        }
        if (switchButton) {
            switchButton.addEventListener('click', () => {
                if (typeof root.stopMediaPipeCamera === 'function') {
                    root.stopMediaPipeCamera();
                }
                setRuntimeReady(false);
                setRuntimeGesture('NONE');
                setRuntimeMode(null);
                if (doc.body) delete doc.body.dataset.controlMode;
                showChooser();
            });
        }
    }

    function startPreferredMode() {
        const search = root.location ? root.location.search : '';
        const mode = getPreferredMode(search, browserStorage());
        if (!mode) {
            showChooser();
            return null;
        }
        setPreferredMode(mode, browserStorage());
        if (mode === 'mouse') startMouseMode();
        if (mode === 'camera') startCameraMode();
        return mode;
    }

    return {
        getPreferredMode,
        setPreferredMode,
        createMemoryStorage,
        mapMouseEventToGesture,
        mapKeyEventToAction,
        applyKeyboardAction,
        bindChooser,
        startPreferredMode,
        startCameraMode,
        startMouseMode
    };
});
