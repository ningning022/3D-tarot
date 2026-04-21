const _spreadTarget = new THREE.Vector3();
const _spreadHome = new THREE.Vector3();
const _spreadHomeScale = new THREE.Vector3();
const _spreadWorldPos = new THREE.Vector3();
const _spreadWorldQuat = new THREE.Quaternion();

function spawnCard(slot, cardDef, isReversed) {
    let cardId = cardDef ? FULL_DECK.indexOf(cardDef) : -1;
    if (!cardDef) {
        // 随机抽牌模式 / Random draw mode
        if (deckPool.length === 0) return;
        const poolIdx = Math.floor(Math.random() * deckPool.length);
        cardId = deckPool.splice(poolIdx, 1)[0];
        isReversed = Math.random() < 0.5;
        cardDef = FULL_DECK[cardId];
    }

    const geo = new THREE.BoxGeometry(2.1, 3.7, 0.08);

    const materials = [
        new THREE.MeshStandardMaterial({ color: 0x111111 }),
        new THREE.MeshStandardMaterial({ color: 0x111111 }),
        new THREE.MeshStandardMaterial({ color: 0x111111 }),
        new THREE.MeshStandardMaterial({ color: 0x111111 }),
        new THREE.MeshStandardMaterial({ map: makeRoundedTexture(CARD_BACK, 2.1, 3.7, 0.06) }),       // 卡背圆角
        new THREE.MeshStandardMaterial({ map: makeRoundedTexture(IMG_BASE + cardDef.file, 2.1, 3.7, 0.06) })  // 卡面圆角
    ];

    const card = new THREE.Mesh(geo, materials);
    // 居中排列：以 spreadCards 张平均分布，间距 2.8
    const layout = SpreadLayout.computeBrowserSpreadLayout(spreadCards);
    const target = layout[slot - 1] || { x: 0, y: 0, scale: 1 };
    const xCenter = target.x;
    card.position.set(target.x, -6, 0);
    card.scale.setScalar(target.scale);
    card.userData = {
        zh: cardDef.zh,
        en: cardDef.en,
        cardId: cardId,
        imageFile: cardDef.file,
        isReversed: isReversed,
        state: 'DEALING',
        slot: slot,
        homeY: target.y,
        homeScale: target.scale,
        homeX: xCenter   // 记录原位X，供归位使用
    };

    scene.add(card);
    activeCards.push(card);
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
            hideSpreadPrompt();
            // 清除场景中残余抽牌 / Remove any remaining spread cards
            activeCards.forEach(c => {
                disposeObject(c);
                scene.remove(c);
            });
            activeCards = [];
            hideUI();
            // 重置状态，返回待机动画 / Return to idle carousel
            fanAngle = 0;
            idlePinchedCards = [];
            idleHeldCard = null;
            idlePointedCard = null;
            isIdleRotating = true;
            document.getElementById('idle-title').style.opacity = '1';
            document.getElementById('guide-text').innerText =
                '张手(OPEN): 开始占卜 / Open hand to begin';
            document.getElementById('status').innerText =
                `第${spreadCount}阵已完成 / Spread ${spreadCount} done`;
            createIdleFan();
            spreadState = 'IDLE';
        }
        return;
    }

    if (spreadState !== 'ACTIVE') return;

    updateDealingCards();
    raycaster.setFromCamera(handScreenPos, camera);
    const intersects = raycaster.intersectObjects(activeCards);

    activeCards.forEach(card => {
        const isHit = intersects.length > 0 && intersects[0].object === card;

        // PINCH: 翻牌查看 / Flip & inspect
        if (card.userData.state === 'DEALING') {
            return;
        }

        if (currentGesture === 'PINCH' && (isHit || card.userData.state === 'HELD')) {
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
            card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, 0, 0.1);
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
        card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, 0, 0.1);
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
        // 其他手势（NONE / FIST）：若有悬空牌则放回
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
    const entry = idleCards.find(c => c.mesh === card);
    if (entry && entry.group) {
        const group = entry.group;
        // 计算固定位置（group 旋转是动态的，归位用本地坐标即可）
        const angle = card.userData.baseAngle;
        scene.remove(card);
        group.add(card);
        // 重置为初始局部坐标
        card.position.set(
            CAROUSEL_R * Math.sin(angle),
            0,
            CAROUSEL_R * Math.cos(angle)
        );
        card.rotation.set(0, angle + Math.PI, 0);
        card.scale.setScalar(1); // 缩放由 updateIdleFan 处理
    }
}

function confirmCard(card) {
    createAshEffect(card.position.clone());

    recordConfirmedCard(card);

    disposeObject(card);
    scene.remove(card);
    activeCards = activeCards.filter(c => c !== card);
    hideUI();

    confirmedInSpread++;

    // 本阵所有牌全部确认 → 牌阵完成 / All confirmed → spread complete
    if (confirmedInSpread >= spreadCards) {
        spreadCount++;
        completeReadingHistory(spreadCount);

        setTimeout(() => showSpreadPrompt(), 800);
    }
}

/** 发下一组牌（无 idle pinch，固定3张）/ Deal next spread */
function dealNextSpread() {
    confirmedInSpread = 0;
    spreadCards = 3;
    spreadState = 'ACTIVE';
    resetReadingCapture();
    if (deckPool.length < 3) {
        deckPool = [...Array(78).keys()];
        prependHistoryNote('✦ 牌库已重置 / Deck Reshuffled ✦');
    }
    for (let i = 0; i < 3; i++) spawnCard(i + 1);
}

function showSpreadPrompt() {
    spreadState = 'AWAITING';
    document.getElementById('spread-prompt').style.display = 'block';
    gestureDebounce = Date.now() + 1000; // 1s 延迟防止立即误触
}

function hideSpreadPrompt() {
    document.getElementById('spread-prompt').style.display = 'none';
}

/** OPEN 触发：轮播飞散，用已选牌（或随机3张）发牌 */
function startSpread(selectedCards) {
    document.getElementById('idle-title').style.opacity = '0';
    hideIdleLabel();
    resetReadingCapture();
    if (Array.isArray(selectedCards)) {
        idlePinchedCards = SpreadFlow.createEnteringSnapshot(selectedCards);
    }

    const pinched = idlePinchedCards.slice(); // 已pinch的牌列表
    idlePinchedCards = [];
    idleHeldCard = null;
    idlePointedCard = null;

    dismissIdleFan();

    setTimeout(() => {
        spreadState = 'ACTIVE';
        confirmedInSpread = 0;
        document.getElementById('guide-text').innerText =
            '捏合(PINCH): 翻牌/Flip | 握拳(FIST): 祭献/Confirm';

        if (pinched.length > 0) {
            // 用 idle 中已选牌作为本阵数据
            spreadCards = pinched.length;
            pinched.forEach((mesh, i) => {
                // 从 mesh.userData 中读取轮盘时装载的牌定义（来自 FULL_DECK）
                const cardDef = FULL_DECK[mesh.userData.cardIndex];
                const isReversed = SpreadFlow.resolveSelectedOrientation(mesh);
                spawnCard(i + 1, cardDef, isReversed);
            });
        } else {
            // 无选牌：随机抽3张
            spreadCards = 3;
            for (let i = 0; i < 3; i++) spawnCard(i + 1);
        }
    }, 700);
}
