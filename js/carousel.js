// ── 轮播常量 / Carousel constants ──
const CAROUSEL_R = 16;   // 圆盘半径
const CAROUSEL_CZ = 20;  // 圆心Z（屏幕前方更远，可见弧段≈100°）
const CAM_Z = 10;         // 摄像机 Z
const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _heldTarget = new THREE.Vector3();
const _scaleTarget = new THREE.Vector3();

/** 创建环绕阵列：圆心在屏幕正前方，牌背朝内朝用户 */
function createIdleFan() {
    const group = new THREE.Group();
    group.position.z = CAROUSEL_CZ; // 圆心在屏幕前方
    scene.add(group);

    for (let i = 0; i < 78; i++) {
        const angle = (i / 78) * Math.PI * 2;
        const geo = new THREE.BoxGeometry(0.6, 1.0, 0.04);
        const mats = [
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            // material[4] = +Z面 = 圆角牌背，朝内（朝圆心/用户）
            new THREE.MeshStandardMaterial({ map: makeRoundedTexture(CARD_BACK, 0.6, 1.0, 0.08) }),
            new THREE.MeshStandardMaterial({ color: 0x060606 }),
        ];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(
            CAROUSEL_R * Math.sin(angle),
            0,
            CAROUSEL_R * Math.cos(angle)
        );
        // 牌背朝内：+Z面指向圆心 => rotation.y = angle + π
        mesh.rotation.y = angle + Math.PI;
        // 保存初始角度，方便回位 / Store base angle for return
        mesh.userData.baseAngle = angle;
        mesh.userData.cardIndex = i;
        mesh.userData.zh = FULL_DECK[i].zh;    // 供标签使用 / For label
        mesh.userData.en = FULL_DECK[i].en;
        mesh.userData.isPinched = false; // 是否已被查看过 / Has been inspected
        group.add(mesh);
        idleCards.push({ mesh, group });
    }
}

/** 每帧更新轮播 / Update carousel each frame */
function updateIdleFan() {
    if (idleCards.length === 0) return;
    const group = idleCards[0] && idleCards[0].group;

    // 只有 isIdleRotating 为真且在IDLE状态时才自转
    if (group && spreadState === 'IDLE' && isIdleRotating) {
        // 使用速度变量驱动旋转，每帧阻尼回归基础速度
        group.rotation.y += carouselVelocity;
        carouselVelocity += (CAROUSEL_BASE_SPEED - carouselVelocity) * 0.025; // easing
    }

    // 反向补偿透视，远端手动放大、近端手动缩小，使尺寸过渡更一致
    const zArcFront = CAROUSEL_CZ - CAROUSEL_R; // 圆圈最远端 z = 4
    const zArcEdge = Math.min(CAM_Z - 0.4, CAROUSEL_CZ); // 近端夹止 z = 9.6

    idleCards.forEach(({ mesh }) => {
        if (mesh.userData.dismissing) {
            mesh.position.addScaledVector(mesh.userData.dismissVel, 1);
            mesh.userData.dismissVel.y += 0.005;
            mesh.userData.dismissAlpha -= 0.035;
            const a = Math.max(0, mesh.userData.dismissAlpha);
            mesh.traverse(obj => {
                if (obj.isMesh && obj.material) {
                    obj.material.transparent = true;
                    obj.material.opacity = a;
                }
            });
        } else if (mesh === idleHeldCard) {
            // 被捏住时已从 group 剥离到 scene，直接在世界坐标操作
            // 目标：屏幕中央偏手部位置，靠近摄像机
            _heldTarget.set(handScreenPos.x * 5, handScreenPos.y * 3, 7.5);
            mesh.position.lerp(_heldTarget, 0.15);
            // 缩小到 1.1（中等预览，原来0.55的2倍）
            _scaleTarget.setScalar(1.1);
            mesh.scale.lerp(_scaleTarget, 0.12);
            // 翻面：material[5]（-Z面，牌正面）朝向摄像机需 rotation.y = PI
            mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, Math.PI, 0.12);
            // 逆位时 Z 轴翻转 180°
            const targetRZ = mesh.userData.isReversed ? Math.PI : 0;
            mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, targetRZ, 0.12);
        } else {
            // 正常轮播牌的缩放补偿
            mesh.getWorldPosition(_wp);
            // nz: 0=最远端(圆圈正前方), 1=最近端(圆壳边缘)
            const nz = Math.max(0, Math.min(1,
                (_wp.z - zArcFront) / (zArcEdge - zArcFront)
            ));
            // 远端手动放大、近端手动缩小，平衡相机透视影响
            const baseScale = 1.6 - nz * 0.9; // 1.6(远端) ~ 0.7(近端)

            if (mesh === idlePointedCard) {
                // 被指向的牌：轻微放大并向前
                _scaleTarget.setScalar(baseScale * 1.25);
                mesh.scale.lerp(_scaleTarget, 0.12);
            } else if (mesh.userData.isPinched) {
                // 已被查看过的牌：金色高亮（通过放大轻微区分）
                _scaleTarget.setScalar(baseScale);
                mesh.scale.lerp(_scaleTarget, 0.1);
                // 金色边框效果：修改侧面颜色
                mesh.material[0].color.lerp(new THREE.Color(0x4a3500), 0.05);
                mesh.material[1].color.lerp(new THREE.Color(0x4a3500), 0.05);
                mesh.material[2].color.lerp(new THREE.Color(0x4a3500), 0.05);
                mesh.material[3].color.lerp(new THREE.Color(0x4a3500), 0.05);
            } else {
                _scaleTarget.setScalar(baseScale);
                mesh.scale.lerp(_scaleTarget, 0.1);
            }
        }
    });
}

/** 解散轮播，牌飞散淡出 / Dismiss carousel with fly-out */
function dismissIdleFan() {
    const group = idleCards[0] && idleCards[0].group;
    idleCards.forEach(({ mesh }) => {
        // 将牌从 group 剥离到 scene，保持世界坐标
        mesh.getWorldPosition(_wp);
        mesh.getWorldQuaternion(_wq);
        if (group) group.remove(mesh);
        mesh.position.copy(_wp);
        mesh.quaternion.copy(_wq);
        scene.add(mesh);

        mesh.userData.dismissing = true;
        mesh.userData.dismissAlpha = 1.0;
        mesh.userData.dismissVel = new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            0.08 + Math.random() * 0.12,
            (Math.random() - 0.5) * 0.15
        );
    });
    if (group) scene.remove(group);
    setTimeout(() => {
        idleCards.forEach(({ mesh }) => {
            disposeObject(mesh);
            scene.remove(mesh);
        });
        idleCards = [];
    }, 1600);
}

/**
 * 将轮盘牌的世界坐标投影到屏幕像素坐标，用于跟随标签
 * Project a carousel card's world position to screen pixel coords
 */
function projectToScreen(mesh) {
    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);
    pos.project(camera);
    return {
        x: (pos.x * 0.5 + 0.5) * window.innerWidth,
        y: (-pos.y * 0.5 + 0.5) * window.innerHeight
    };
}
