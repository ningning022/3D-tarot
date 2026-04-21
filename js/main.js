function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020205);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 2.5));       // 强环境光，卡面无死角
    const frontLight = new THREE.DirectionalLight(0xffffff, 2.0); // 正面平行光
    frontLight.position.set(0, 0, 10);
    scene.add(frontLight);
    const topLight = new THREE.PointLight(0xffd88a, 1.5, 40);    // 顶部暖光
    topLight.position.set(0, 8, 5);
    scene.add(topLight);

    raycaster = new THREE.Raycaster();

    // 待机状态——展示层叠扇 / Idle state — show fan
    document.getElementById('guide-text').innerText =
        '张手(OPEN): 开始占卜 / Open hand to begin';
    createIdleFan();

    window.addEventListener('resize', onResize);
    initMediaPipe();
    animate();
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    if (isGestureReady) handleGestures();
    updateIdleFan();
    updateParticles();

    // 实时更新悬空牌的屏幕标签（待机 IDLE 或牌阵 ACTIVE 均适用）
    let labelShown = false;

    if (spreadState === 'IDLE' && idleHeldCard) {
        // 轮盘小牌高度 1.0
        _showLabelForCard(idleHeldCard, 1.0);
        labelShown = true;
    } else if (spreadState === 'ACTIVE') {
        const held = activeCards.find(c => c.userData.state === 'HELD');
        if (held) {
            // 牌阵大牌高度 3.7
            _showLabelForCard(held, 3.7);
            labelShown = true;
        }
    }

    if (!labelShown) hideIdleLabel();

    renderer.render(scene, camera);
}

init();
