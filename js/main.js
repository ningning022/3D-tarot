function init() {
    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, -1.7, 11.2);
    camera.lookAt(0, -0.55, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffd7aa, 0.42));
    const frontLight = new THREE.DirectionalLight(0xffc57d, 1.52);
    frontLight.position.set(-3.8, 6.2, 9.2);
    frontLight.castShadow = true;
    frontLight.shadow.mapSize.set(3072, 3072);
    frontLight.shadow.camera.left = -14;
    frontLight.shadow.camera.right = 14;
    frontLight.shadow.camera.top = 8;
    frontLight.shadow.camera.bottom = -8;
    frontLight.shadow.camera.near = 0.5;
    frontLight.shadow.camera.far = 32;
    frontLight.shadow.bias = -0.00018;
    frontLight.shadow.normalBias = 0.035;
    scene.add(frontLight);

    const topLight = new THREE.PointLight(0xffb45d, 1.1, 42);
    topLight.position.set(0, 5.2, 5.8);
    scene.add(topLight);

    const rimLight = new THREE.PointLight(0xd49842, 1.28, 34);
    rimLight.position.set(5.8, -4.2, 5.4);
    scene.add(rimLight);

    const candleGlow = new THREE.PointLight(0xffa24d, 1.55, 16);
    candleGlow.position.set(4.7, 3.2, 3.6);
    scene.add(candleGlow);

    const tableGlow = new THREE.PointLight(0xb22a24, 0.82, 26);
    tableGlow.position.set(0, -2.8, 4.2);
    scene.add(tableGlow);

    createTableSpace();

    raycaster = new THREE.Raycaster();

    document.getElementById('guide-text').innerText =
        '点击选牌 / Click a card, then 新占卜 / New.';
    if (window.SpreadTemplates) {
        SpreadTemplates.bindTemplateSelector();
        bindStageControls();
        updateCurrentSpreadPanel();
    }
    if (window.DailyDraw) DailyDraw.mountDailyDraw();
    bindTopbarActions();
    bindMouseStageActions();
    bindPromptActions();
    updatePrimaryActionButton();
    createIdleFan();

    window.addEventListener('resize', onResize);
    if (window.InputMode) {
        InputMode.bindChooser();
        InputMode.startPreferredMode();
    }
    animate();
}

function bindTopbarActions() {
    const newReadingButton = document.getElementById('new-reading-button');
    if (newReadingButton) {
        newReadingButton.addEventListener('click', () => {
            const action = window.MainUiState
                ? MainUiState.getPrimaryActionState(spreadState).intent
                : (spreadState === 'AWAITING' ? 'NEXT_SPREAD' : 'START_READING');
            if (action === 'START_READING') {
                startSpread(idlePinchedCards.slice());
            } else if (action === 'NEXT_SPREAD') {
                hideSpreadPrompt();
                dealNextSpread();
            } else {
                showGuideMessage('请先完成当前牌阵 / Finish the current spread first.');
            }
            updatePrimaryActionButton();
        });
    }

    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            const hidden = document.body.classList.toggle('stage-controls-hidden');
            menuToggle.setAttribute('aria-expanded', String(!hidden));
        });
    }
}

function bindStageControls() {
    const changeSpreadButton = document.getElementById('change-spread-button');
    const spreadRing = document.getElementById('spread-template-ring');
    if (changeSpreadButton && spreadRing) {
        changeSpreadButton.addEventListener('click', () => {
            if (window.MainUiState && !MainUiState.canChangeSpread(spreadState)) {
                showGuideMessage('当前牌阵进行中，不能更换 / Finish this spread before changing.');
                return;
            }
            spreadRing.classList.remove('hidden');
            spreadRing.classList.add('focus-pulse');
            spreadRing.scrollIntoView({ block: 'nearest', inline: 'center' });
            window.setTimeout(() => spreadRing.classList.remove('focus-pulse'), 900);
        });
    }
    document.querySelectorAll('[data-template]').forEach(button => {
        button.addEventListener('click', updateCurrentSpreadPanel);
    });
}

function bindMouseStageActions() {
    window.handleMouseCardClick = function handleMouseCardClick(clientX, clientY) {
        if (typeof activeInputMode !== 'undefined' && activeInputMode !== 'mouse') return false;
        handScreenPos.x = (clientX / window.innerWidth - 0.5) * 2;
        handScreenPos.y = -(clientY / window.innerHeight - 0.5) * 2;
        if (typeof handleMouseCardSelection === 'function') {
            const handled = handleMouseCardSelection();
            updatePrimaryActionButton();
            return handled;
        }
        return false;
    };
    window.handleMouseKeyboardAction = function handleMouseKeyboardActionBridge(action) {
        if (typeof handleMouseSpreadKeyboardAction === 'function') {
            const handled = handleMouseSpreadKeyboardAction(action);
            updatePrimaryActionButton();
            return handled;
        }
        return false;
    };
}

function bindPromptActions() {
    const next = document.getElementById('prompt-next');
    const back = document.getElementById('prompt-return');
    if (next) {
        next.addEventListener('click', () => {
            hideSpreadPrompt();
            dealNextSpread();
            updatePrimaryActionButton();
        });
    }
    if (back) {
        back.addEventListener('click', () => {
            if (typeof returnToIdleFromSpread === 'function') {
                returnToIdleFromSpread();
                updatePrimaryActionButton();
            }
        });
    }
}

function updatePrimaryActionButton() {
    if (!window.MainUiState) return;
    const button = document.getElementById('new-reading-button');
    if (!button) return;
    const state = MainUiState.getPrimaryActionState(spreadState);
    button.innerText = state.label;
    button.disabled = state.disabled;
    button.dataset.intent = state.intent;
}

function updateCurrentSpreadPanel() {
    if (!window.SpreadTemplates) return;
    const template = SpreadTemplates.getActiveTemplate();
    const title = document.getElementById('current-spread-title');
    const sub = document.getElementById('current-spread-sub');
    if (title) title.innerText = template.name.split('/').pop().trim() || template.name;
    if (sub) {
        const labels = (template.slots || [])
            .map(slot => slot.label.split('/').pop().trim())
            .slice(0, 4);
        sub.innerText = labels.length > 0 ? labels.join(' - ') : 'Free placement';
    }
}

function showGuideMessage(message) {
    const guide = document.getElementById('guide-text');
    if (!guide) return;
    guide.innerText = message;
    guide.classList.add('guide-flash');
    window.setTimeout(() => guide.classList.remove('guide-flash'), 900);
}

function createTableSpace() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const base = ctx.createRadialGradient(512, 430, 80, 512, 520, 720);
    base.addColorStop(0, '#78212a');
    base.addColorStop(0.48, '#4d1119');
    base.addColorStop(1, '#160305');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1024, 1024);

    for (let y = 0; y < 1024; y += 5) {
        ctx.strokeStyle = y % 30 === 0 ? 'rgba(255, 205, 152, 0.055)' : 'rgba(255, 178, 156, 0.026)';
        ctx.beginPath();
        ctx.moveTo(0, y + Math.sin(y * 0.03) * 5);
        ctx.lineTo(1024, y + Math.cos(y * 0.027) * 5);
        ctx.stroke();
    }
    for (let x = 0; x < 1024; x += 11) {
        ctx.strokeStyle = x % 44 === 0 ? 'rgba(20, 0, 5, 0.2)' : 'rgba(255, 220, 170, 0.02)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(x * 0.025) * 10, 1024);
        ctx.stroke();
    }

    for (let i = 0; i < 9000; i += 1) {
        const alpha = 0.018 + Math.random() * 0.045;
        const warm = Math.random() > 0.58;
        ctx.fillStyle = warm
            ? `rgba(255, 210, 142, ${alpha})`
            : `rgba(24, 0, 6, ${alpha})`;
        ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.4, 2.3);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    const tableMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.96,
        metalness: 0.0,
        emissive: 0x100204,
        emissiveIntensity: 0.12
    });

    const table = new THREE.Mesh(
        new THREE.PlaneGeometry(27.2, 15.3),
        tableMaterial
    );
    table.position.set(0, -0.38, -0.4);
    table.receiveShadow = true;
    scene.add(table);

    const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(27.2, 15.3)),
        new THREE.LineBasicMaterial({ color: 0xd4a85a, transparent: true, opacity: 0.2 })
    );
    border.position.copy(table.position);
    scene.add(border);

    [2.5, 4.4, 5.8, 7.05].forEach((radius, index) => {
        const curve = new THREE.EllipseCurve(0, 0, radius, radius * 0.56, 0, Math.PI * 2);
        const points = curve.getPoints(220).map(point => new THREE.Vector3(point.x, point.y - 0.18, -0.18 + index * 0.002));
        const line = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
                color: 0xe2b45c,
                transparent: true,
                opacity: 0.12 - index * 0.018
            })
        );
        scene.add(line);
    });

    const axisMaterial = new THREE.LineBasicMaterial({ color: 0xe2b45c, transparent: true, opacity: 0.085 });
    [[-7.2, 0, 7.2, 0], [0, -4.05, 0, 4.05], [-5.2, -2.9, 5.2, 2.9], [-5.2, 2.9, 5.2, -2.9]].forEach((coords, index) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(coords[0], coords[1] - 0.18, -0.16 - index * 0.001),
            new THREE.Vector3(coords[2], coords[3] - 0.18, -0.16 - index * 0.001)
        ]);
        scene.add(new THREE.Line(geometry, axisMaterial));
    });

    [
        [-7.05, -0.18],
        [7.05, -0.18],
        [0, 3.85],
        [0, -4.2]
    ].forEach(([x, y]) => {
        const mark = new THREE.Mesh(
            new THREE.RingGeometry(0.12, 0.22, 4),
            new THREE.MeshBasicMaterial({ color: 0xe2b45c, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
        );
        mark.position.set(x, y, -0.13);
        mark.rotation.z = Math.PI / 4;
        scene.add(mark);
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
        const active = card.userData.state === 'HELD' || card.userData.state === 'IDLE' || card.userData.state === 'MOUSE_PREVIEW';
        const target = new THREE.Color(active ? 0x4a330b : 0x17100a);
        for (let index = 0; index < 4; index += 1) {
            if (card.material[index] && card.material[index].color) {
                card.material[index].color.lerp(target, active ? 0.035 + pulse * 0.012 : 0.035);
                if (card.material[index].emissive) {
                    card.material[index].emissive.lerp(
                        new THREE.Color(active ? 0x221504 : 0x0e0502),
                        active ? 0.03 + pulse * 0.012 : 0.04
                    );
                }
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (activeInputMode === 'mouse') {
        if (spreadState === 'ACTIVE' || spreadState === 'ENTERING') updateDealingCards();
    } else if (isGestureReady) {
        handleGestures();
    }
    updateIdleFan();
    updateParticles();
    updateInteractiveGlow();

    let labelShown = false;

    if (spreadState === 'IDLE' && idleHeldCard) {
        _showLabelForCard(idleHeldCard, 1.0);
        labelShown = true;
    } else if (spreadState === 'ACTIVE') {
        const held = activeCards.find(c => c.userData.state === 'HELD' || c.userData.state === 'MOUSE_PREVIEW' || c.userData.state === 'MOUSE_CONFIRMING');
        if (held) {
            _showLabelForCard(held, 3.5);
            labelShown = true;
        }
    }

    if (!labelShown) hideIdleLabel();

    renderer.render(scene, camera);
}

init();
