// ── Diagonal-cascade carousel constants ────────────────────────
// Cards are positioned along a diagonal axis (lower-left → upper-right),
// each one slightly tilted on the Y axis so they read like overlapping
// glass slides — the same arrangement language as unveil.fr.

const CASCADE_DX = 0.46;          // X step between adjacent cards
const CASCADE_DY = 0.30;          // Y step (so cards march upward)
const CASCADE_DZ = 0.04;          // Z step (closer cards sit forward)
const CASCADE_TILT = -0.22;       // Y rotation, ~-12.5° — leans right
const CASCADE_BASE_SCALE = 1.55;  // baseline scale
const CASCADE_VISIBLE = 12;       // |delta| under this is rendered
const CASCADE_SCROLL_BASE = -0.0035; // gentle drift to the left

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _heldTarget = new THREE.Vector3();
const _scaleTarget = new THREE.Vector3();
const _cascadeTarget = new THREE.Vector3();

/**
 * Build the diagonal cascade of card meshes. Each card lives in a
 * shared THREE.Group anchored just in front of the camera so the
 * cascade scrolls as a whole when carouselVelocity changes.
 */
function createIdleFan() {
    const group = new THREE.Group();
    // Anchor the cascade just in front of the camera. The camera sits at
    // (0, -1.7, 11.2) and looks at (0, -0.55, 0), so z ≈ 6 puts the active
    // card comfortably in frame without colliding with the lens.
    group.position.set(0, -0.4, 6.4);
    scene.add(group);

    const deckCount = FULL_DECK.length;
    const displayOrder = window.DeckOrder
        ? DeckOrder.createShuffledDeckOrder(deckCount)
        : Array.from({ length: deckCount }, (_, index) => index);

    for (let i = 0; i < displayOrder.length; i++) {
        const cardIndex = displayOrder[i];
        const cardDef = FULL_DECK[cardIndex];
        const geo = new THREE.BoxGeometry(0.6, 1.0, 0.04);
        const mats = [
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            new THREE.MeshStandardMaterial({ color: 0x0d0d0d }),
            // +Z face = card back, points toward the user
            new THREE.MeshStandardMaterial({ map: makeRoundedTexture(CARD_BACK, 0.6, 1.0, 0.08) }),
            new THREE.MeshStandardMaterial({ color: 0x060606 })
        ];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Initial placement at row 0 so the lerp can ease everything to its
        // resting slot on the first few frames.
        mesh.position.set(0, 0, 0);
        mesh.rotation.y = CASCADE_TILT;
        mesh.userData.cascadeIndex = i;
        mesh.userData.cardIndex = cardIndex;
        mesh.userData.zh = cardDef.zh;
        mesh.userData.en = cardDef.en;
        mesh.userData.isPinched = false;
        group.add(mesh);
        idleCards.push({ mesh, group });
    }
}

/**
 * Per-frame placement. The shared variable `carouselVelocity` is now
 * interpreted as the scroll velocity along the cascade index axis, so
 * the existing TWO_FINGER swipe handler keeps working without changes.
 * `fanAngle` is reused as the floating-point cascade offset so any
 * legacy reads of it stay continuous.
 */
function updateIdleFan() {
    if (idleCards.length === 0) return;
    const group = idleCards[0] && idleCards[0].group;
    const total = idleCards.length;

    // Self-drift in IDLE; suppressed once a card is held or the user
    // is dragging via TWO_FINGER (spread.js writes carouselVelocity).
    if (group && spreadState === 'IDLE' && isIdleRotating) {
        fanAngle += carouselVelocity;
        // Wrap so the cascade is an infinite loop.
        if (fanAngle >= total) fanAngle -= total;
        if (fanAngle < 0) fanAngle += total;
        // Ease back toward the baseline drift each frame.
        carouselVelocity += (CASCADE_SCROLL_BASE - carouselVelocity) * 0.04;
    }

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
            return;
        }

        if (mesh === idleHeldCard) {
            // Held card is detached from the group (see spread.js
            // detachIdleCardToScene). Lift toward the cursor in world space.
            _heldTarget.set(handScreenPos.x * 5, handScreenPos.y * 3, 7.5);
            mesh.position.lerp(_heldTarget, 0.18);
            _scaleTarget.setScalar(1.6);
            mesh.scale.lerp(_scaleTarget, 0.14);
            // Flip the front face toward the camera; reverse the orientation
            // via z-rotation when the card was drawn upside down.
            mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, Math.PI, 0.12);
            const targetRZ = mesh.userData.isReversed ? Math.PI : 0;
            mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, targetRZ, 0.12);
            return;
        }

        // Wrap the delta into [-total/2, +total/2) so cards always pick
        // the shortest path back to their slot.
        let delta = mesh.userData.cascadeIndex - fanAngle;
        if (delta > total / 2) delta -= total;
        if (delta < -total / 2) delta += total;

        // Cull cards that are far from the visible window. Setting
        // mesh.visible to false skips them in raycasting and rendering.
        const absDelta = Math.abs(delta);
        mesh.visible = absDelta < CASCADE_VISIBLE;
        if (!mesh.visible) return;

        // Diagonal slot position. Closer-to-center cards sit a hair
        // forward in Z so the overlap reads as depth, not flatness.
        _cascadeTarget.set(
            delta * CASCADE_DX,
            delta * CASCADE_DY,
            -absDelta * CASCADE_DZ
        );

        const isHovered = (mesh === idlePointedCard);
        if (isHovered) {
            // Pop the hovered card forward + grow. This is the POINT
            // / mouse-hover affordance.
            _cascadeTarget.z += 0.55;
            mesh.position.lerp(_cascadeTarget, 0.22);
            _scaleTarget.setScalar(CASCADE_BASE_SCALE * 1.18);
            mesh.scale.lerp(_scaleTarget, 0.18);
        } else {
            mesh.position.lerp(_cascadeTarget, 0.16);
            _scaleTarget.setScalar(CASCADE_BASE_SCALE);
            mesh.scale.lerp(_scaleTarget, 0.12);
        }

        // All cards share the same tilt so the cascade reads as a
        // unified gesture rather than a random pile.
        mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, CASCADE_TILT, 0.12);
        mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, 0, 0.12);

        // Previously-inspected cards keep a faint gold rim on their sides,
        // so the user can tell which ones they've already seen.
        if (mesh.userData.isPinched) {
            const goldRim = new THREE.Color(0x4a3500);
            mesh.material[0].color.lerp(goldRim, 0.05);
            mesh.material[1].color.lerp(goldRim, 0.05);
            mesh.material[2].color.lerp(goldRim, 0.05);
            mesh.material[3].color.lerp(goldRim, 0.05);
        }
    });
}

/**
 * OPEN → spread. Each cascade card flies off along its current diagonal
 * tilt and fades out, so the exit reads as the cascade dispersing.
 */
function dismissIdleFan() {
    const group = idleCards[0] && idleCards[0].group;
    idleCards.forEach(({ mesh }) => {
        mesh.getWorldPosition(_wp);
        mesh.getWorldQuaternion(_wq);
        if (group) group.remove(mesh);
        mesh.position.copy(_wp);
        mesh.quaternion.copy(_wq);
        scene.add(mesh);

        mesh.userData.dismissing = true;
        mesh.userData.dismissAlpha = 1.0;
        // Velocity biased along the cascade axis (+x, +y) so cards
        // disperse in the same direction they were stacked.
        mesh.userData.dismissVel = new THREE.Vector3(
            0.06 + Math.random() * 0.10,
            0.05 + Math.random() * 0.10,
            (Math.random() - 0.5) * 0.10
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
 * Project a cascade card's world position to screen pixel coords so the
 * floating label can follow it.
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
