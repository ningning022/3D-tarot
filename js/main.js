// Holders for theme-driven re-tuning (set in init()).
let _ambient, _frontLight, _topLight, _rimLight, _candleGlow, _tableGlow;

const LIGHT_PRESETS = {
    dark: {
        exposure: 0.98,
        ambient: { color: 0xffd7aa, intensity: 0.42 },
        front:   { color: 0xffc57d, intensity: 1.52 },
        top:     { color: 0xffb45d, intensity: 1.10 },
        rim:     { color: 0xd49842, intensity: 1.28 },
        candle:  { color: 0xffa24d, intensity: 1.55 },
        table:   { color: 0xb22a24, intensity: 0.82 }
    },
    light: {
        // Cool daylight: pull the warm amber off the lights so the
        // blue/white card backs read as their actual pigment instead
        // of being painted yellow by the stage lights.
        exposure: 1.18,
        ambient: { color: 0xeaf2ff, intensity: 0.92 },
        front:   { color: 0xf4f8ff, intensity: 1.10 },
        top:     { color: 0xeef3ff, intensity: 0.72 },
        rim:     { color: 0xd97757, intensity: 0.42 }, // amber kicker only
        candle:  { color: 0xffd6b8, intensity: 0.28 },
        table:   { color: 0xd97757, intensity: 0.00 }  // off in daylight
    }
};

function applyThemeLights(theme) {
    const preset = LIGHT_PRESETS[theme] || LIGHT_PRESETS.dark;
    if (renderer) renderer.toneMappingExposure = preset.exposure;
    if (_ambient)    { _ambient.color.setHex(preset.ambient.color);  _ambient.intensity    = preset.ambient.intensity; }
    if (_frontLight) { _frontLight.color.setHex(preset.front.color); _frontLight.intensity = preset.front.intensity; }
    if (_topLight)   { _topLight.color.setHex(preset.top.color);     _topLight.intensity   = preset.top.intensity; }
    if (_rimLight)   { _rimLight.color.setHex(preset.rim.color);     _rimLight.intensity   = preset.rim.intensity; }
    if (_candleGlow) { _candleGlow.color.setHex(preset.candle.color); _candleGlow.intensity = preset.candle.intensity; }
    if (_tableGlow)  { _tableGlow.color.setHex(preset.table.color);  _tableGlow.intensity  = preset.table.intensity; }
    applyThemeCardBacks(theme);
}

/**
 * Bring out the original Rider-Waite back colours in each theme:
 *
 *   light → multiply the texture by a cool white tint so the cream
 *           ground reads as paper-white and the teal-blue florals
 *           pop as vivid pigment instead of muddy amber. A small
 *           cool-blue emissive lifts the whole back without warming
 *           it, counteracting the warm-amber stage lights.
 *   dark  → leave the material un-tinted so the back keeps its
 *           candle-lit moodiness; reset any lingering light values.
 *
 * Index 4 of the box-geometry materials holds the back texture for
 * both cascade cards (carousel.js) and dealt cards (spread.js).
 */
function applyThemeCardBacks(theme) {
    const isLight = theme === 'light';
    const tuneBack = mat => {
        if (!mat) return;
        if (isLight) {
            // Push the back hard toward white + saturated blue:
            //   color: pure white so the texture's full brightness shows
            //   emissive: punchy royal-blue at high intensity to pull
            //             the teal florals into vivid blue and lift the
            //             cream ground toward white in highlights
            mat.color && mat.color.setHex(0xffffff);
            mat.emissive && mat.emissive.setHex(0x3a5fb8);
            mat.emissiveIntensity = 0.55;
            mat.roughness = 0.22;
            mat.metalness = 0.05;
        } else {
            mat.color && mat.color.setHex(0xffffff);
            mat.emissive && mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0.0;
            mat.roughness = 0.7;
            mat.metalness = 0.0;
        }
        mat.needsUpdate = true;
    };
    const visit = card => {
        if (!card || !Array.isArray(card.material)) return;
        tuneBack(card.material[4]);
    };
    if (typeof idleCards !== 'undefined') idleCards.forEach(({ mesh }) => visit(mesh));
    if (typeof activeCards !== 'undefined') activeCards.forEach(visit);
}

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

    _ambient = new THREE.AmbientLight(0xffd7aa, 0.42);
    scene.add(_ambient);
    _frontLight = new THREE.DirectionalLight(0xffc57d, 1.52);
    _frontLight.position.set(-3.8, 6.2, 9.2);
    _frontLight.castShadow = true;
    _frontLight.shadow.mapSize.set(3072, 3072);
    _frontLight.shadow.camera.left = -14;
    _frontLight.shadow.camera.right = 14;
    _frontLight.shadow.camera.top = 8;
    _frontLight.shadow.camera.bottom = -8;
    _frontLight.shadow.camera.near = 0.5;
    _frontLight.shadow.camera.far = 32;
    _frontLight.shadow.bias = -0.00018;
    _frontLight.shadow.normalBias = 0.035;
    scene.add(_frontLight);

    _topLight = new THREE.PointLight(0xffb45d, 1.1, 42);
    _topLight.position.set(0, 5.2, 5.8);
    scene.add(_topLight);

    _rimLight = new THREE.PointLight(0xd49842, 1.28, 34);
    _rimLight.position.set(5.8, -4.2, 5.4);
    scene.add(_rimLight);

    _candleGlow = new THREE.PointLight(0xffa24d, 1.55, 16);
    _candleGlow.position.set(4.7, 3.2, 3.6);
    scene.add(_candleGlow);

    _tableGlow = new THREE.PointLight(0xb22a24, 0.82, 26);
    _tableGlow.position.set(0, -2.8, 4.2);
    scene.add(_tableGlow);

    // Match the lights to whatever theme.js already applied.
    const initialTheme = (document.documentElement.dataset.theme === 'light') ? 'light' : 'dark';
    applyThemeLights(initialTheme);
    window.addEventListener('theme-change', e => applyThemeLights(e.detail && e.detail.theme));

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
    bindCascadeWheel();
    if (window.InputMode) {
        InputMode.bindChooser();
        InputMode.startPreferredMode();
    }
    animate();
}

/**
 * Mouse-wheel handler for the diagonal cascade carousel. Translates a
 * wheel delta into cascade scroll velocity, mirroring how unveil.fr
 * lets visitors flick through their image stack with a quick scroll.
 * Only active in IDLE so it never fights the spread interactions.
 */
function bindCascadeWheel() {
    window.addEventListener('wheel', (event) => {
        if (spreadState !== 'IDLE') return;
        if (idleHeldCard) return; // don't scroll while inspecting a card
        // deltaY > 0 (scroll down/forward) → advance cascade rightward
        // Trackpads send small deltas; mouse wheels send 100+ per notch.
        const kick = Math.max(-0.06, Math.min(0.06, event.deltaY * 0.0008));
        carouselVelocity += kick;
        // Cap absolute velocity so a single fast scroll can't run away.
        carouselVelocity = Math.max(-0.5, Math.min(0.5, carouselVelocity));
    }, { passive: true });
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
