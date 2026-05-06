function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x240a0f);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffead4, 1.38));
    const frontLight = new THREE.DirectionalLight(0xffddb0, 1.82);
    frontLight.position.set(-4.2, 5.1, 10);
    frontLight.castShadow = true;
    frontLight.shadow.mapSize.set(2048, 2048);
    frontLight.shadow.camera.left = -14;
    frontLight.shadow.camera.right = 14;
    frontLight.shadow.camera.top = 8;
    frontLight.shadow.camera.bottom = -8;
    frontLight.shadow.camera.near = 0.5;
    frontLight.shadow.camera.far = 30;
    frontLight.shadow.bias = -0.0005;
    scene.add(frontLight);

    const topLight = new THREE.PointLight(0xffb45d, 1.75, 46);
    topLight.position.set(0, 6.9, 5.8);
    scene.add(topLight);

    const rimLight = new THREE.PointLight(0xd49842, 1.28, 36);
    rimLight.position.set(5.8, -4.5, 5.2);
    scene.add(rimLight);

    const tableGlow = new THREE.PointLight(0xa53635, 1.28, 28);
    tableGlow.position.set(0, -2.7, 4.5);
    scene.add(tableGlow);

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
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const base = ctx.createRadialGradient(512, 430, 80, 512, 520, 720);
    base.addColorStop(0, '#92303a');
    base.addColorStop(0.44, '#621923');
    base.addColorStop(1, '#21050a');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1024, 1024);

    for (let y = 0; y < 1024; y += 3) {
        ctx.strokeStyle = y % 18 === 0 ? 'rgba(255, 205, 152, 0.12)' : 'rgba(255, 178, 156, 0.05)';
        ctx.beginPath();
        ctx.moveTo(0, y + Math.sin(y * 0.035) * 8);
        ctx.lineTo(1024, y + Math.cos(y * 0.031) * 8);
        ctx.stroke();
    }
    for (let x = 0; x < 1024; x += 7) {
        ctx.strokeStyle = x % 35 === 0 ? 'rgba(34, 2, 8, 0.28)' : 'rgba(255, 220, 170, 0.034)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(x * 0.03) * 16, 1024);
        ctx.stroke();
    }

    for (let i = 0; i < 14000; i += 1) {
        const alpha = 0.026 + Math.random() * 0.078;
        const warm = Math.random() > 0.55;
        ctx.fillStyle = warm
            ? `rgba(255, 213, 145, ${alpha})`
            : `rgba(36, 0, 8, ${alpha})`;
        ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 1, 1);
    }

    ctx.globalAlpha = 0.2;
    for (let y = -1024; y < 1024; y += 34) {
        ctx.strokeStyle = '#ba514c';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1024, y + 1024);
        ctx.stroke();
    }
    ctx.globalAlpha = 0.12;
    for (let y = 0; y < 2048; y += 50) {
        ctx.strokeStyle = '#ffd39a';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1024, y - 1024);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5.2, 3.2);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    const tableMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.86,
        metalness: 0.0,
        emissive: 0x1b0307,
        emissiveIntensity: 0.34
    });

    const table = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 17.2),
        tableMaterial
    );
    table.position.set(0, -0.42, -0.34);
    table.receiveShadow = true;
    scene.add(table);

    new THREE.TextureLoader().load('assets/textures/velvet-table-soft.png', loadedTexture => {
        loadedTexture.wrapS = THREE.RepeatWrapping;
        loadedTexture.wrapT = THREE.RepeatWrapping;
        loadedTexture.repeat.set(1, 1);
        loadedTexture.anisotropy = 1;
        loadedTexture.generateMipmaps = true;
        loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
        loadedTexture.magFilter = THREE.LinearFilter;
        if (THREE.SRGBColorSpace) loadedTexture.colorSpace = THREE.SRGBColorSpace;
        tableMaterial.map = loadedTexture;
        tableMaterial.needsUpdate = true;
    });

    const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(30, 17.2)),
        new THREE.LineBasicMaterial({ color: 0xd4a85a, transparent: true, opacity: 0.72 })
    );
    border.position.copy(table.position);
    scene.add(border);

    [3.8, 5.8, 7.4].forEach((radius, index) => {
        const curve = new THREE.EllipseCurve(0, 0, radius, radius * 0.58, 0, Math.PI * 2);
        const points = curve.getPoints(180).map(point => new THREE.Vector3(point.x, point.y - 0.2, -0.21 + index * 0.002));
        const line = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
                color: 0xd8ae56,
                transparent: true,
                opacity: 0.065 - index * 0.014
            })
        );
        scene.add(line);
    });

    const axisMaterial = new THREE.LineBasicMaterial({ color: 0xd8ae56, transparent: true, opacity: 0.035 });
    [[-7.6, 0, 7.6, 0], [0, -4.4, 0, 4.4], [-5.4, -3.1, 5.4, 3.1], [-5.4, 3.1, 5.4, -3.1]].forEach((coords, index) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(coords[0], coords[1] - 0.2, -0.2 - index * 0.001),
            new THREE.Vector3(coords[2], coords[3] - 0.2, -0.2 - index * 0.001)
        ]);
        scene.add(new THREE.Line(geometry, axisMaterial));
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
