/** MediaPipe 核心逻辑 / MediaPipe core */
const gestureStabilizer = GestureTools.createGestureStabilizer({
    windowSize: 5,
    minCount: 3,
    noneCount: 2,
    confidenceThreshold: 0.5
});

async function initMediaPipe() {
    const videoElement = document.getElementById('video-input');
    const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });

    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

    hands.onResults(results => {
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

    const cameraPipe = new Camera(videoElement, {
        onFrame: async () => { await hands.send({ image: videoElement }); },
        width: 640, height: 480
    });
    cameraPipe.start().then(() => {
        document.getElementById('status').innerText = "灵力场已激活 / Field Activated";
    }).catch(e => {
        document.getElementById('status').innerText = "感应器缺失 / No Camera — 鼠标模式 / Mouse Mode";
        isGestureReady = true;
        window.addEventListener('mousemove', (e) => {
            handScreenPos.x = (e.clientX / window.innerWidth - 0.5) * 2;
            handScreenPos.y = -(e.clientY / window.innerHeight - 0.5) * 2;
        });
        window.addEventListener('mousedown', () => currentGesture = "PINCH");
        window.addEventListener('mouseup', () => currentGesture = "OPEN");
        window.addEventListener('keydown', (e) => { if (e.code === 'Space') currentGesture = "FIST"; });
    });
}
