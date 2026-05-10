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
    bindDailyDrawToggle();
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
            } else if (action === 'SAVE_READING') {
                const flipped = (typeof activeCards !== 'undefined' ? activeCards : [])
                    .filter(c => c.userData.state === 'MOUSE_PREVIEW' || c.userData.state === 'HELD');
                if (flipped.length === 0) {
                    showGuideMessage('点击牌面翻看后再保存 / Flip cards face-up before saving.');
                } else {
                    flipped.slice().forEach(card => {
                        if (typeof confirmCard === 'function') confirmCard(card);
                    });
                }
            } else if (action === 'ABORT_READING') {
                if (typeof returnToIdleFromSpread === 'function') returnToIdleFromSpread();
            } else {
                showGuideMessage('请先完成当前牌阵 / Finish the current spread first.');
            }
            updatePrimaryActionButton();
        });
    }

    const unselectBtn = document.getElementById('unselect-card-button');
    if (unselectBtn) {
        unselectBtn.addEventListener('click', () => {
            if (typeof unselectIdleCardFromMouse === 'function' && typeof idleHeldCard !== 'undefined' && idleHeldCard) {
                unselectIdleCardFromMouse(idleHeldCard);
                updatePrimaryActionButton();
            }
            unselectBtn.style.display = 'none';
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

function bindDailyDrawToggle() {
    const panel = document.querySelector('.daily-draw-panel');
    const body = panel && document.getElementById('daily-draw-body');
    if (!panel || !body) return;
    panel.querySelector('.daily-draw-toggle').addEventListener('click', () => {
        const expanded = panel.getAttribute('aria-expanded') === 'true';
        panel.setAttribute('aria-expanded', String(!expanded));
        body.hidden = expanded;
    });
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
    window.handleMouseRightClick = function handleMouseRightClick() {
        if (spreadState === 'IDLE' && typeof idleHeldCard !== 'undefined' && idleHeldCard) {
            if (typeof unselectIdleCardFromMouse === 'function') {
                unselectIdleCardFromMouse(idleHeldCard);
                updatePrimaryActionButton();
                const btn = document.getElementById('unselect-card-button');
                if (btn) btn.style.display = 'none';
            }
            return true;
        }
        if (spreadState === 'ACTIVE') {
            if (typeof returnAllMousePreviewsToSlot === 'function') {
                return returnAllMousePreviewsToSlot();
            }
        }
        return false;
    };

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

    if (spreadState === 'IDLE' && idleHeldCard) {
        _showLabelForCard(idleHeldCard, 1.0);
        if (typeof clearAllCardLabels === 'function') clearAllCardLabels();
    } else if (spreadState === 'ACTIVE') {
        hideIdleLabel();
        const faceUp = activeCards.filter(c =>
            c.userData.state === 'MOUSE_PREVIEW'
            || c.userData.state === 'HELD'
            || c.userData.state === 'MOUSE_CONFIRMING'
        );
        if (typeof syncCardLabels === 'function') syncCardLabels(faceUp, 3.5);
    } else {
        hideIdleLabel();
        if (typeof clearAllCardLabels === 'function') clearAllCardLabels();
    }

    renderer.render(scene, camera);
}

init();
