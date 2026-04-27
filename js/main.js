function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020205);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xf5efe6, 1.15));
    const frontLight = new THREE.DirectionalLight(0xfff2d2, 1.45);
    frontLight.position.set(-2, 3, 10);
    frontLight.castShadow = true;
    frontLight.shadow.mapSize.set(2048, 2048);
    scene.add(frontLight);

    const topLight = new THREE.PointLight(0xd9ae61, 1.15, 40);
    topLight.position.set(0, 7, 5);
    scene.add(topLight);

    const rimLight = new THREE.PointLight(0x8d6426, 0.9, 34);
    rimLight.position.set(5.5, -4.5, 5);
    scene.add(rimLight);

    createTableSpace();

    raycaster = new THREE.Raycaster();

    document.getElementById('guide-text').innerText =
        '张手 OPEN：开始占卜 / Open hand to begin';
    if (window.SpreadTemplates) SpreadTemplates.bindTemplateSelector();
    if (window.DailyDraw) DailyDraw.mountDailyDraw();
    createIdleFan();

    window.addEventListener('resize', onResize);
    if (window.InputMode) {
        InputMode.bindChooser();
        InputMode.startPreferredMode();
    }
    animate();
}

function createTableSpace() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 512, 512);
    base.addColorStop(0, '#120809');
    base.addColorStop(0.5, '#080708');
    base.addColorStop(1, '#160b0c');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1600; i += 1) {
        const alpha = 0.025 + Math.random() * 0.055;
        ctx.fillStyle = `rgba(218, 186, 112, ${alpha})`;
        ctx.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
    }
    ctx.globalAlpha = 0.1;
    for (let y = -512; y < 512; y += 18) {
        ctx.strokeStyle = '#6d2429';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y + 512);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    const table = new THREE.Mesh(
        new THREE.PlaneGeometry(28, 16),
        new THREE.MeshStandardMaterial({
            map: texture,
            color: 0x2c1416,
            roughness: 0.98,
            metalness: 0.0
        })
    );
    table.position.set(0, -0.25, -0.22);
    table.receiveShadow = true;
    scene.add(table);

    const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(28, 16)),
        new THREE.LineBasicMaterial({ color: 0xb58a35, transparent: true, opacity: 0.45 })
    );
    border.position.copy(table.position);
    scene.add(border);

    [3.2, 5.2, 7.2].forEach((radius, index) => {
        const curve = new THREE.EllipseCurve(0, 0, radius, radius * 0.58, 0, Math.PI * 2);
        const points = curve.getPoints(160).map(point => new THREE.Vector3(point.x, point.y, -0.19 + index * 0.002));
        const line = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
                color: 0xc09b4b,
                transparent: true,
                opacity: 0.08 - index * 0.015
            })
        );
        scene.add(line);
    });
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
                if (card.material[index].emissive) {
                    card.material[index].emissive.lerp(
                        new THREE.Color(active ? 0x2a1b05 : 0x000000),
                        active ? 0.035 + pulse * 0.018 : 0.05
                    );
                }
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
