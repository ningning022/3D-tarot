const _spreadTarget = new THREE.Vector3();
const _spreadHome = new THREE.Vector3();
const _spreadHomeScale = new THREE.Vector3();
const _spreadWorldPos = new THREE.Vector3();
const _spreadWorldQuat = new THREE.Quaternion();
let mousePreviewCard = null;

function createRandomCardMarker() {
    return { __randomCard: true };
}

function getCurrentSpreadTemplate() {
    if (window.SpreadTemplates) return SpreadTemplates.getActiveTemplate();
    return { key: 'free', name: '自由牌阵 / Free Spread', fixedCount: null, slots: [] };
}

function createPlanFromSelected(selectedCards) {
    return SpreadTemplates.resolveSpreadPlan(
        getCurrentSpreadTemplate(),
        selectedCards,
        () => createRandomCardMarker()
    );
}

function removeCardIdFromDeckPool(cardId) {
    deckPool = deckPool.filter(id => id !== cardId);
}

function getStageCardRotation(slot, totalCards) {
    if (totalCards === 3) return [-0.08, 0, 0.08][slot - 1] || 0;
    if (totalCards <= 5) return (slot - (totalCards + 1) / 2) * 0.035;
    return 0;
}

function getStageCardY(targetY, totalCards) {
    if (totalCards === 3) return targetY - 0.42;
    if (totalCards <= 5) return targetY - 0.18;
    return targetY;
}

function spawnPlannedCard(planItem, slot, slotLabel) {
    if (!planItem || planItem.__randomCard) {
        spawnCard(slot, null, undefined, slotLabel);
        return;
    }
    const cardDef = FULL_DECK[planItem.userData.cardIndex];
    const isReversed = SpreadFlow.resolveSelectedOrientation(planItem);
    removeCardIdFromDeckPool(planItem.userData.cardIndex);
    spawnCard(slot, cardDef, isReversed, slotLabel);
}

function spawnCard(slot, cardDef, isReversed, slotLabel) {
    let cardId = cardDef ? FULL_DECK.indexOf(cardDef) : -1;
    if (!cardDef) {
        // 随机抽牌模式 / Random draw mode
        if (deckPool.length === 0) return;
        const poolIdx = Math.floor(Math.random() * deckPool.length);
        cardId = deckPool.splice(poolIdx, 1)[0];
        isReversed = Math.random() < 0.5;
        cardDef = FULL_DECK[cardId];
    }

    const cardW = 2.0;
    const cardH = 3.5;
    const geo = new THREE.BoxGeometry(cardW, cardH, 0.14);

    const materials = [
        new THREE.MeshStandardMaterial({ color: 0x17100a, roughness: 0.72, metalness: 0.08, emissive: 0x130804, emissiveIntensity: 0.18 }),
        new THREE.MeshStandardMaterial({ color: 0x17100a, roughness: 0.72, metalness: 0.08, emissive: 0x130804, emissiveIntensity: 0.18 }),
        new THREE.MeshStandardMaterial({ color: 0xb78635, roughness: 0.5, metalness: 0.34, emissive: 0x2d1605, emissiveIntensity: 0.16 }),
        new THREE.MeshStandardMaterial({ color: 0xb78635, roughness: 0.5, metalness: 0.34, emissive: 0x2d1605, emissiveIntensity: 0.16 }),
        new THREE.MeshStandardMaterial({ map: makeRoundedTexture(CARD_BACK, 2.1, 3.7, 0.06) }),       // 卡背圆角
        new THREE.MeshStandardMaterial({ map: makeRoundedTexture(IMG_BASE + cardDef.file, 2.1, 3.7, 0.06) })  // 卡面圆角
    ];

    const card = new THREE.Mesh(geo, materials);
    card.castShadow = true;
    card.receiveShadow = true;
    // 居中排列：以 spreadCards 张平均分布，间距 2.8
    const layout = SpreadLayout.computeBrowserSpreadLayout(spreadCards);
    const target = layout[slot - 1] || { x: 0, y: 0, scale: 1 };
    const xCenter = target.x;
    const homeY = getStageCardY(target.y, spreadCards);
    const homeRotationZ = getStageCardRotation(slot, spreadCards);
    card.position.set(target.x, -6, 0.14);
    card.scale.setScalar(target.scale);
    card.userData = {
        zh: cardDef.zh,
        en: cardDef.en,
        cardId: cardId,
        imageFile: cardDef.file,
        isReversed: isReversed,
        state: 'DEALING',
        slot: slot,
        slotLabel: slotLabel || `Slot ${slot}`,
        homeY: homeY,
        homeScale: target.scale,
        homeRotationZ: homeRotationZ,
        homeX: xCenter   // 记录原位X，供归位使用
    };

    card.rotation.z = homeRotationZ;
    scene.add(card);
    activeCards.push(card);
    if (typeof applyThemeCardBacks === 'function') {
        applyThemeCardBacks(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    }
}

function ensureIdleCardFaceLoaded(card) {
    if (!card || card.userData.faceLoaded) return;
    card.userData.faceLoaded = true;
    const cardDef = FULL_DECK[card.userData.cardIndex];
    disposeMaterial(card.material[5]);
    card.material[5] = new THREE.MeshStandardMaterial({
        map: makeRoundedTexture(IMG_BASE + cardDef.file, 0.68, 1.08, 0.08),
        roughness: 0.58,
        metalness: 0.03,
        emissive: 0x120806,
        emissiveIntensity: 0.08
    });
}

function getMouseCardId(card) {
    if (!card) return null;
    if (!card.userData.mouseId) {
        card.userData.mouseId = card.uuid || `card-${card.userData.cardId ?? card.userData.cardIndex}`;
    }
    return card.userData.mouseId;
}

function detachIdleCardToScene(card) {
    const entry = idleCards.find(c => c.mesh === card);
    if (!entry || !entry.group || card.parent === scene) return;
    card.getWorldPosition(_spreadWorldPos);
    card.getWorldQuaternion(_spreadWorldQuat);
    entry.group.remove(card);
    card.position.copy(_spreadWorldPos);
    card.quaternion.copy(_spreadWorldQuat);
    scene.add(card);
}

/**
 * Re-attach a previously-pinched card to the cascade group at its slot.
 * The cascade is index-driven (carousel.js), so we just hand the mesh
 * back to its group — updateIdleFan() recomputes its slot position from
 * mesh.userData.cascadeIndex on the next frame.
 */
function _reparentCardToRing(card) {
    const entry = idleCards.find(c => c.mesh === card);
    if (!entry || !entry.group) return;
    scene.remove(card);
    entry.group.add(card);
    card.rotation.set(0, 0, 0);
    card.scale.setScalar(1);
}

function returnIdleCardToRing(card) {
    const entry = idleCards.find(c => c.mesh === card);
    if (!entry || !entry.group || card.parent === entry.group) return;
    _reparentCardToRing(card);
}

function markIdleCardSelected(card) {
    if (!card) return false;
    if (idleHeldCard && idleHeldCard !== card) {
        returnIdleCardToRing(idleHeldCard);
    }
    if (!card.userData.hasOwnProperty('isReversed')) {
        card.userData.isReversed = Math.random() < 0.5;
    }
    ensureIdleCardFaceLoaded(card);
    detachIdleCardToScene(card);
    idleHeldCard = card;
    card.userData.isPinched = true;
    if (!idlePinchedCards.includes(card)) {
        idlePinchedCards.push(card);
    }
    idlePointedCard = card;
    isIdleRotating = false;
    if (typeof projectToScreen === 'function') {
        const point = projectToScreen(card);
        showIdleLabel(card.userData, point.x, point.y + 20);
    }
    if (typeof showGuideMessage === 'function') {
        showGuideMessage(`${card.userData.en} 已选 / Selected. 再点取消，或点新占卜 / New.`);
    }
    const unselectBtn = document.getElementById('unselect-card-button');
    if (unselectBtn) unselectBtn.style.display = '';
    return true;
}

function unselectIdleCardFromMouse(card) {
    if (!card) return false;
    if (idleHeldCard === card) idleHeldCard = null;
    returnIdleCardToRing(card);
    card.userData.isPinched = false;
    idlePinchedCards = idlePinchedCards.filter(item => item !== card);
    idlePointedCard = null;
    hideIdleLabel();
    isIdleRotating = true;
    if (typeof showGuideMessage === 'function') {
        showGuideMessage(`${card.userData.en} 已取消 / Unselected.`);
    }
    const unselectBtn = document.getElementById('unselect-card-button');
    if (unselectBtn) unselectBtn.style.display = 'none';
    return true;
}

function returnMousePreviewToSlot(card) {
    if (!card || card.userData.state !== 'MOUSE_PREVIEW') return false;
    card.userData.state = 'IDLE';
    _spreadHome.set(card.userData.homeX, card.userData.homeY || 0, 0);
    card.position.copy(_spreadHome);
    card.scale.setScalar(card.userData.homeScale || 1);
    card.rotation.y = 0;
    card.rotation.z = card.userData.homeRotationZ || 0;
    if (mousePreviewCard === card) mousePreviewCard = null;
    hideUI();
    hideIdleLabel();
    return true;
}

function previewCardFromMouse(card) {
    if (!card || card.userData.state === 'DEALING' || card.userData.state === 'MOUSE_CONFIRMING') return false;
    mousePreviewCard = card;
    card.userData.state = 'MOUSE_PREVIEW';
    card.rotation.y = Math.PI;
    card.rotation.z = card.userData.isReversed ? Math.PI : (card.userData.homeRotationZ || 0);
    card.scale.setScalar(Math.max(card.userData.homeScale || 1, 1.02));
    if (typeof showGuideMessage === 'function') {
        showGuideMessage('再次点击翻回 / Click again to flip back. 顶部按钮保存 / Top button saves.');
    }
    return true;
}

function returnAllMousePreviewsToSlot() {
    const previewed = activeCards.filter(c => c.userData.state === 'MOUSE_PREVIEW');
    previewed.forEach(c => returnMousePreviewToSlot(c));
    return previewed.length > 0;
}

function confirmCardFromMouse(card) {
    if (!card || card.userData.state === 'DEALING' || card.userData.state === 'MOUSE_CONFIRMING') return false;
    card.userData.state = 'MOUSE_CONFIRMING';
    card.rotation.y = Math.PI;
    card.rotation.z = card.userData.isReversed ? Math.PI : (card.userData.homeRotationZ || 0);
    card.scale.setScalar(Math.max(card.userData.homeScale || 1, 0.96));
    if (mousePreviewCard === card) mousePreviewCard = null;
    window.setTimeout(() => {
        if (activeCards.includes(card) && card.userData.state === 'MOUSE_CONFIRMING') {
            confirmCard(card);
        }
    }, 220);
    return true;
}

function handleMouseCardSelection() {
    raycaster.setFromCamera(handScreenPos, camera);

    if (spreadState === 'IDLE') {
        const hit = raycaster.intersectObjects(idleCards.map(entry => entry.mesh))[0];
        if (!hit) return false;
        const clickedId = getMouseCardId(hit.object);
        const selectedIdleIds = idlePinchedCards.map(getMouseCardId);
        const action = MouseInteraction.resolveMouseCardAction({ phase: 'idle', selectedIdleIds }, clickedId);
        if (action === 'SELECT_IDLE_CARD') return markIdleCardSelected(hit.object);
        if (action === 'UNSELECT_IDLE_CARD') return unselectIdleCardFromMouse(hit.object);
        return false;
    }

    if (spreadState === 'ACTIVE') {
        updateDealingCards();
        const hit = raycaster.intersectObjects(activeCards)[0];
        if (!hit) return false;
        const clickedId = getMouseCardId(hit.object);
        const previewedIds = activeCards.filter(c => c.userData.state === 'MOUSE_PREVIEW').map(getMouseCardId);
        const action = MouseInteraction.resolveMouseCardAction({ phase: 'active', previewedIds }, clickedId);
        if (action === 'PREVIEW_CARD') return previewCardFromMouse(hit.object);
        if (action === 'UNPREVIEW_CARD') return returnMousePreviewToSlot(hit.object);
        return false;
    }

    if (spreadState === 'AWAITING') {
        if (typeof showGuideMessage === 'function') {
            showGuideMessage('请选择下一阵或返回 / Use Next or Return.');
        }
        return false;
    }

    return false;
}

function handleMouseSpreadKeyboardAction(action) {
    if (action === 'CONFIRM') {
        const flipped = activeCards.filter(c => c.userData.state === 'MOUSE_PREVIEW');
        if (flipped.length === 0) return false;
        flipped.slice().forEach(card => confirmCard(card));
        return true;
    }
    if (action === 'CANCEL') {
        return returnAllMousePreviewsToSlot();
    }
    return false;
}

function handleGestures() {
    const now = Date.now();

    // ── IDLE 状态：待机，POINT/PINCH 选牌，OPEN 触发 ──
    if (spreadState === 'IDLE') {
        handleIdleGestures(now);
        return;
    }

    if (spreadState === 'ENTERING') {
        updateDealingCards();
        return;
    }

    // ── AWAITING 状态：等待是否继续下一阵 / Waiting for next-spread decision ──
    if (spreadState === 'AWAITING') {
        if (now < gestureDebounce) return; // 防抖
        if (currentGesture === 'OPEN') {
            gestureDebounce = now + 1200;
            hideSpreadPrompt();
            dealNextSpread();
        } else if (currentGesture === 'FIST') {
            gestureDebounce = now + 1800;
            returnToIdleFromSpread();
        }
        return;
    }

    if (spreadState !== 'ACTIVE') return;

    updateDealingCards();
    raycaster.setFromCamera(handScreenPos, camera);
    const intersects = raycaster.intersectObjects(activeCards);

    // Only one card can be HELD at a time — lock onto whichever is already held,
    // and only grab a new card when nothing is currently held.
    const alreadyHeld = activeCards.find(c => c.userData.state === 'HELD') || null;

    activeCards.forEach(card => {
        const isHit = intersects.length > 0 && intersects[0].object === card;

        if (card.userData.state === 'DEALING') {
            return;
        }

        if (currentGesture === 'PINCH' && (card === alreadyHeld || (!alreadyHeld && isHit))) {
            card.userData.state = 'HELD';
            _spreadTarget.set(handScreenPos.x * 7, handScreenPos.y * 4, 4);
            card.position.lerp(_spreadTarget, 0.15);
            _spreadHomeScale.setScalar(1);
            card.scale.lerp(_spreadHomeScale, 0.12);
            card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, Math.PI, 0.1);
            if (card.userData.isReversed) card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, Math.PI, 0.1);
        }

        // FIST（持牌中）: 确认祭献 / Confirm card
        else if (currentGesture === 'FIST' && card.userData.state === 'HELD') {
            if (now > gestureDebounce) {
                gestureDebounce = now + 800;
                confirmCard(card);
            }
        }

        // OPEN: 放回原位 / Return to slot
        else if (currentGesture === 'OPEN') {
            _spreadHome.set(card.userData.homeX, card.userData.homeY || 0, 0);
            card.position.lerp(_spreadHome, 0.1);
            _spreadHomeScale.setScalar(card.userData.homeScale || 1);
            card.scale.lerp(_spreadHomeScale, 0.1);
            card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, 0, 0.1);
            card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, card.userData.homeRotationZ || 0, 0.1);
            card.userData.state = 'IDLE';
            hideUI();
            hideIdleLabel();
        }
    });
}

/** 待机状态下的手势处理 / Gesture handling while in IDLE */
function updateDealingCards() {
    activeCards.forEach(card => {
        if (card.userData.state !== 'DEALING') return;
        _spreadHome.set(card.userData.homeX, card.userData.homeY || 0, 0);
        _spreadHomeScale.setScalar(card.userData.homeScale || 1);
        card.position.lerp(_spreadHome, 0.12);
        card.scale.lerp(_spreadHomeScale, 0.12);
        card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, 0, 0.1);
        card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, card.userData.homeRotationZ || 0, 0.1);
        if (card.position.distanceTo(_spreadHome) < 0.04) {
            card.position.copy(_spreadHome);
            card.scale.copy(_spreadHomeScale);
            card.userData.state = 'IDLE';
        }
    });
}

function handleIdleGestures(now) {
    if (idleCards.length === 0) return;

    // OPEN：进入正式牌阵
    if (SpreadFlow.shouldBeginEntering(spreadState, currentGesture, now, gestureDebounce)) {
        gestureDebounce = now + 1800;
        // 松开当前悬空牌（若有）先回位注册
        if (idleHeldCard) {
            _returnHeldCardToRing();
        }
        if (window.ConsultationFlow) {
            ConsultationFlow.open();
            return;
        }
        const selectedCards = SpreadFlow.createEnteringSnapshot(idlePinchedCards);
        idlePinchedCards = selectedCards;
        spreadState = 'ENTERING';
        startSpread(selectedCards);
        return;
    }

    // 用 raycaster 检测被指向/捏住的轮盘牌（仅检测未被 dismiss 的）
    const meshes = idleCards.map(c => c.mesh);
    raycaster.setFromCamera(handScreenPos, camera);
    const hits = raycaster.intersectObjects(meshes);
    const hitMesh = hits.length > 0 ? hits[0].object : null;

    if (currentGesture === 'PINCH') {
        if (idleHeldCard) {
            // 继续持牌 — 标签位置由 animate() 更新
            isIdleRotating = false;
        } else if (hitMesh) {
            // 开始捏牌：将牌从旋转的 group 剥离到 scene，保持世界坐标
            const entry = idleCards.find(c => c.mesh === hitMesh);
            if (entry && entry.group) {
                hitMesh.getWorldPosition(_spreadWorldPos);
                hitMesh.getWorldQuaternion(_spreadWorldQuat);
                entry.group.remove(hitMesh);
                hitMesh.position.copy(_spreadWorldPos);
                hitMesh.quaternion.copy(_spreadWorldQuat);
                scene.add(hitMesh);
            }
            // 首次捏起：随机决定正/逆位，加载牌面贴图到 material[5]
            if (!hitMesh.userData.hasOwnProperty('isReversed')) {
                hitMesh.userData.isReversed = Math.random() < 0.5;
            }
            if (!hitMesh.userData.faceLoaded) {
                hitMesh.userData.faceLoaded = true;
                const cardDef = FULL_DECK[hitMesh.userData.cardIndex];
                disposeMaterial(hitMesh.material[5]);
                hitMesh.material[5] = new THREE.MeshStandardMaterial({
                    map: makeRoundedTexture(IMG_BASE + cardDef.file, 0.6, 1.0, 0.08)
                });
            }
            idleHeldCard = hitMesh;
            isIdleRotating = false;
            idlePointedCard = null;
        }
    } else if (currentGesture === 'TWO_FINGER') {
        // 双指滑动控制轮盘转速 / Two-finger swipe to control rotation speed
        if (idleHeldCard) _returnHeldCardToRing();
        hideIdleLabel();
        isIdleRotating = true;    // 滑动时保持旋转（速度由 carouselVelocity 控制）
        idlePointedCard = null;

        const curX = handScreenPos.x;
        if (twoFingerPrevX !== null) {
            const dx = curX - twoFingerPrevX; // 右滑 > 0，左滑 < 0
            // 将手部位移映射为旋转速度冲量
            // handScreenPos.x 范围约 [-1, 1]，dx 每帧通常 0.002~0.02
            // 向左滑（dx < 0）→ 加速正向（更负 = 更快向左旋转）
            // 向右滑（dx > 0）→ 冲量向右（正值，会使旋转反向）
            const SWIPE_SCALE = 0.12;    // 放大系数
            const MAX_KICK = 0.025;   // 最大冲量限制
            const kick = THREE.MathUtils.clamp(-dx * SWIPE_SCALE, -MAX_KICK, MAX_KICK);
            carouselVelocity += kick;
        }
        twoFingerPrevX = curX;

    } else if (currentGesture === 'POINT') {
        // 若之前有持牌，先放回
        if (idleHeldCard) {
            _returnHeldCardToRing();
        }
        hideIdleLabel();
        twoFingerPrevX = null;

        // 停止旋转，高亮被指向的牌
        isIdleRotating = false;
        idlePointedCard = hitMesh;
    } else {
        // NONE: 若有悬空牌则放回
        if (idleHeldCard) {
            _returnHeldCardToRing();
        }
        hideIdleLabel();
        twoFingerPrevX = null;
        isIdleRotating = true;
        idlePointedCard = null;
    }
}

/** 将悬空牌重新挂回 group 并归位 / Re-parent held card back to group */
function _returnHeldCardToRing() {
    if (!idleHeldCard) return;
    const card = idleHeldCard;
    idleHeldCard = null;

    // 标记已查看过
    card.userData.isPinched = true;
    if (!idlePinchedCards.includes(card)) {
        idlePinchedCards.push(card);
    }

    // 将牌从 scene 重新挂回旋转 group，并还原 local 位置
    _reparentCardToRing(card);
}

function confirmCard(card) {
    createAshEffect(card.position.clone());

    recordConfirmedCard(card);

    if (typeof disposeCardLabel === 'function' && card.uuid) disposeCardLabel(card.uuid);
    disposeObject(card);
    scene.remove(card);
    activeCards = activeCards.filter(c => c !== card);
    hideUI();

    confirmedInSpread++;

    // 本阵所有牌全部确认 → 牌阵完成 / All confirmed → spread complete
    if (confirmedInSpread >= spreadCards) {
        spreadCount++;
        const savePromise = completeReadingHistory(spreadCount);
        settleCapturedReading(
            savePromise,
            () => setTimeout(() => showSpreadPrompt(), 800),
            error => console.error('Failed to persist captured reading:', error)
        );
    }
    if (typeof updatePrimaryActionButton === 'function') updatePrimaryActionButton();
}

/** 发下一组牌（无 idle pinch，固定3张）/ Deal next spread */
function dealNextSpread() {
    confirmedInSpread = 0;
    spreadState = 'ACTIVE';
    mousePreviewCard = null;
    const plan = createPlanFromSelected([]);
    spreadCards = plan.totalCards;
    resetReadingCapture({
        kind: 'spread',
        templateKey: plan.templateKey,
        templateName: plan.templateName
    });
    if (deckPool.length < spreadCards) {
        deckPool = [...Array(78).keys()];
        prependHistoryNote('✦ 牌库已重置 / Deck Reshuffled ✦');
    }
    plan.selectedCards.forEach((item, index) => {
        spawnPlannedCard(item, index + 1, plan.slotLabels[index]);
    });
    if (typeof updatePrimaryActionButton === 'function') updatePrimaryActionButton();
}

function showSpreadPrompt() {
    spreadState = 'AWAITING';
    document.getElementById('spread-prompt').style.display = 'block';
    if (typeof updatePrimaryActionButton === 'function') updatePrimaryActionButton();
    gestureDebounce = Date.now() + 1000; // 1s 延迟防止立即误触
}

function hideSpreadPrompt() {
    document.getElementById('spread-prompt').style.display = 'none';
}

function returnToIdleFromSpread() {
    hideSpreadPrompt();
    activeCards.forEach(c => {
        if (typeof disposeCardLabel === 'function' && c.uuid) disposeCardLabel(c.uuid);
        disposeObject(c);
        scene.remove(c);
    });
    activeCards = [];
    mousePreviewCard = null;
    hideUI();
    hideIdleLabel();
    if (typeof clearAllCardLabels === 'function') clearAllCardLabels();
    fanAngle = 0;
    idlePinchedCards = [];
    idleHeldCard = null;
    idlePointedCard = null;
    isIdleRotating = true;
    document.getElementById('spread-template-ring').classList.remove('hidden');
    document.getElementById('guide-text').innerText =
        (typeof activeInputMode !== 'undefined' && activeInputMode === 'mouse')
            ? '点击选牌 / Click cards, then 新占卜 / New.'
            : '张手 OPEN：开始占卜 / Open hand to begin';
    const status = document.getElementById('status');
    if (status) status.innerText = `第 ${spreadCount} 阵完成 / Spread ${spreadCount} done`;
    createIdleFan();
    spreadState = 'IDLE';
    if (typeof updatePrimaryActionButton === 'function') updatePrimaryActionButton();
}

/** OPEN 触发：轮播飞散，用已选牌（或随机3张）发牌 */
function startSpread(selectedCards) {
    document.getElementById('spread-template-ring').classList.add('hidden');
    spreadState = 'ENTERING';
    if (typeof updatePrimaryActionButton === 'function') updatePrimaryActionButton();
    hideIdleLabel();
    if (Array.isArray(selectedCards)) {
        idlePinchedCards = SpreadFlow.createEnteringSnapshot(selectedCards);
    }

    const pinched = idlePinchedCards.slice(); // 已pinch的牌列表
    const plan = createPlanFromSelected(pinched);
    idlePinchedCards = [];
    idleHeldCard = null;
    idlePointedCard = null;

    dismissIdleFan();

    setTimeout(() => {
        spreadState = 'ACTIVE';
        mousePreviewCard = null;
        confirmedInSpread = 0;
        spreadCards = plan.totalCards;
        resetReadingCapture({
            kind: 'spread',
            templateKey: plan.templateKey,
            templateName: plan.templateName
        });
        document.getElementById('guide-text').innerText =
            (typeof activeInputMode !== 'undefined' && activeInputMode === 'mouse')
                ? '点击翻看 / Click to flip. 再点翻回 / Click again to flip back. 顶部按钮保存 / Save via top button.'
                : '捏合 PINCH：翻牌 / Flip | 握拳 FIST：确认 / Confirm';

        if (deckPool.length < plan.selectedCards.filter(item => item && item.__randomCard).length) {
            deckPool = [...Array(78).keys()];
            prependHistoryNote('✦ 牌库已重置 / Deck Reshuffled ✦');
        }

        plan.selectedCards.forEach((item, index) => {
            spawnPlannedCard(item, index + 1, plan.slotLabels[index]);
        });
        if (typeof updatePrimaryActionButton === 'function') updatePrimaryActionButton();
    }, 700);
}
