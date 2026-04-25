function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020205);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.9));
    const frontLight = new THREE.DirectionalLight(0xffffff, 2.0);
    frontLight.position.set(0, 0, 10);
    frontLight.castShadow = true;
    frontLight.shadow.mapSize.set(1024, 1024);
    scene.add(frontLight);

    const topLight = new THREE.PointLight(0xffd88a, 1.5, 40);
    topLight.position.set(0, 8, 5);
    scene.add(topLight);

    createTableSpace();

    raycaster = new THREE.Raycaster();

    document.getElementById('guide-text').innerText =
        '张手(OPEN): 开始占卜 / Open hand to begin';
    if (window.SpreadTemplates) SpreadTemplates.bindTemplateSelector();
    if (window.DailyDraw) DailyDraw.mountDailyDraw();
    createIdleFan();

    window.addEventListener('resize', onResize);
    initMediaPipe();
    animate();
}

function createTableSpace() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#070708';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i += 1) {
        const alpha = 0.04 + Math.random() * 0.08;
        ctx.fillStyle = `rgba(255, 220, 130, ${alpha})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(12, 8);

    const table = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 15),
        new THREE.MeshStandardMaterial({
            map: texture,
            color: 0x111111,
            roughness: 0.95,
            metalness: 0.02
        })
    );
    table.position.set(0, -0.15, -0.15);
    table.receiveShadow = true;
    scene.add(table);

    const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(26, 15)),
        new THREE.LineBasicMaterial({ color: 0x6f5418, transparent: true, opacity: 0.32 })
    );
    border.position.copy(table.position);
    scene.add(border);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateInteractiveGlow() {
    const pulse = (Math.sin(Date.now() * 0.004) + 1) * 0.5;
    activeCards.forEach(card => {
        if (!Array.isArray(card.material)) return;
        const active = card.userData.state === 'HELD' || card.userData.state === 'IDLE';
        const target = new THREE.Color(active ? 0x5a3f08 : 0x111111);
        for (let index = 0; index < 4; index += 1) {
            if (card.material[index] && card.material[index].color) {
                card.material[index].color.lerp(target, active ? 0.04 + pulse * 0.02 : 0.04);
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (isGestureReady) handleGestures();
    updateIdleFan();
    updateParticles();
    updateInteractiveGlow();

    let labelShown = false;

    if (spreadState === 'IDLE' && idleHeldCard) {
        _showLabelForCard(idleHeldCard, 1.0);
        labelShown = true;
    } else if (spreadState === 'ACTIVE') {
        const held = activeCards.find(c => c.userData.state === 'HELD');
        if (held) {
            _showLabelForCard(held, 3.7);
            labelShown = true;
        }
    }

    if (!labelShown) hideIdleLabel();

    renderer.render(scene, camera);
}

init();
