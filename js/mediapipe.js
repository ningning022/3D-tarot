const gestureStabilizer = GestureTools.createGestureStabilizer({
    windowSize: 5,
    minCount: 3,
    noneCount: 2,
    confidenceThreshold: 0.5
});
let activeCameraPipe = null;

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
        handScreenPos.x = -(lm[9].x - 0.5) * 2;
        handScreenPos.y = -(lm[9].y - 0.5) * 2;

        const rawGesture = GestureTools.classifyGesture(lm);
        currentGesture = gestureStabilizer.update(rawGesture, spreadState);

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
