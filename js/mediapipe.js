const gestureStabilizer = GestureTools.createGestureStabilizer({
    windowSize: 5,
    minCount: 3,
    noneCount: 2,
    confidenceThreshold: 0.5
});
let activeCameraPipe = null;

// ── Palm tracking state ──────────────────────────────────────
// Five palm-anchor indices: wrist + 4 MCP joints form a stable pentagon
const PALM_IDX = [0, 5, 9, 13, 17];
// Deadzone radius (normalized screen units). Movements smaller than this
// are ignored so a stationary hand doesn't cause held cards to jitter.
const POSITION_DEADZONE = 0.018;
// Pinch anchor: locked at the moment PINCH begins, cleared on release.
// Cards then follow *relative* delta rather than jumping to absolute position.
let _pinchAnchorRaw = null;    // {x,y} palm coords in landmark space at pinch start
let _pinchAnchorScreen = null; // {x,y} handScreenPos at pinch start
let _prevStableGesture = 'NONE';

function stopMediaPipeCamera() {
    if (activeCameraPipe && typeof activeCameraPipe.stop === 'function') {
        activeCameraPipe.stop();
    }
    activeCameraPipe = null;
    const videoElement = document.getElementById('video-input');
    if (videoElement && videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
}

async function initMediaPipe() {
    const videoElement = document.getElementById('video-input');
    const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(results => {
        if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'camera') {
            return;
        }
        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            currentGesture = gestureStabilizer.update({ gesture: "NONE", confidence: 1 }, spreadState);
            document.getElementById('gesture-active').innerText = `当前姿态 / Gesture: ${currentGesture}`;
            return;
        }
        const lm = results.multiHandLandmarks[0];

        // 1. Five-point palm center — average wrist + 4 MCP joints.
        //    More stable than single lm[9]; resistant to finger-splay noise.
        const palmCx = PALM_IDX.reduce((s, i) => s + lm[i].x, 0) / PALM_IDX.length;
        const palmCy = PALM_IDX.reduce((s, i) => s + lm[i].y, 0) / PALM_IDX.length;
        const rawX = -(palmCx - 0.5) * 2;
        const rawY = -(palmCy - 0.5) * 2;

        const rawGesture = GestureTools.classifyGesture(lm);
        currentGesture = gestureStabilizer.update(rawGesture, spreadState);

        if (currentGesture === 'PINCH') {
            if (_prevStableGesture !== 'PINCH') {
                // 2. Pinch just began — lock anchor so card doesn't teleport.
                _pinchAnchorRaw = { x: palmCx, y: palmCy };
                _pinchAnchorScreen = { x: rawX, y: rawY };
            }
            // Relative delta from anchor, same mirror/scale as raw mapping.
            handScreenPos.x = _pinchAnchorScreen.x - (palmCx - _pinchAnchorRaw.x) * 2;
            handScreenPos.y = _pinchAnchorScreen.y - (palmCy - _pinchAnchorRaw.y) * 2;
        } else {
            _pinchAnchorRaw = null;
            _pinchAnchorScreen = null;
            // 3. Deadzone — ignore sub-threshold jitter when hand is stationary.
            const dx = rawX - handScreenPos.x;
            const dy = rawY - handScreenPos.y;
            if (Math.hypot(dx, dy) > POSITION_DEADZONE) {
                handScreenPos.x = rawX;
                handScreenPos.y = rawY;
            }
        }
        _prevStableGesture = currentGesture;

        document.getElementById('gesture-active').innerText = `当前姿态 / Gesture: ${currentGesture}`;
        isGestureReady = true;
    });

    stopMediaPipeCamera();
    const cameraPipe = new Camera(videoElement, {
        onFrame: async () => { await hands.send({ image: videoElement }); },
        width: 640,
        height: 480
    });
    activeCameraPipe = cameraPipe;
    cameraPipe.start().then(() => {
        document.getElementById('status').innerText = "Camera Mode / 摄像头手势";
    }).catch(() => {
        document.getElementById('status').innerText =
            "摄像头不可用 / Camera unavailable - switch to Mouse Mode";
        document.getElementById('gesture-active').innerText =
            "请选择鼠标模式 / Choose Mouse Mode";
        const chooser = document.getElementById('control-chooser');
        if (chooser) chooser.style.display = 'block';
    });
}
