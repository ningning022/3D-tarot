// The centered #result-display banner has been retired in favor of the
// per-card label (#idle-card-label). showUI/hideUI remain as no-ops so
// any legacy caller stays harmless.
function showUI() {}

function hideUI() {}

/**
 * 在待机状态显示随轮盘牌移动的标签 / Show label following the carousel card
 * @param {Object} data  - card userData { zh, en }
 * @param {number} screenX - CSS pixel X
 * @param {number} screenY - CSS pixel Y (bottom of card)
 */
function showIdleLabel(data, screenX, screenY) {
    const el = document.getElementById('idle-card-label');
    if (!el) return;
    const orientText = data.isReversed
        ? '<span class="idle-label-orient reversed">逆位 / REVERSED</span>'
        : '<span class="idle-label-orient upright">正位 / UPRIGHT</span>';
    el.innerHTML = `<span class="idle-label-zh">${zhWithRoman(data.zh)}</span>`
        + `<span class="idle-label-en">${data.en}</span>`
        + orientText;
    // Clamp position so label stays inside viewport
    const elW = el.offsetWidth || 200;
    const elH = el.offsetHeight || 90;
    const clampedX = Math.max(elW / 2, Math.min(window.innerWidth - elW / 2, screenX));
    const clampedY = Math.max(0, Math.min(window.innerHeight - elH - 8, screenY));
    el.style.left = clampedX + 'px';
    el.style.top = clampedY + 'px';
    el.style.opacity = '1';
    el.style.display = 'block';
}

function hideIdleLabel() {
    const el = document.getElementById('idle-card-label');
    if (el) { el.style.opacity = '0'; el.style.display = 'none'; }
}

const _labelBottomPt = new THREE.Vector3();

/**
 * 将持牌底边投影到屏幕，显示跟随标签
 * @param {THREE.Mesh} mesh       - 正在被持有的牌
 * @param {number}     geoHeight  - 该牌 BoxGeometry 的原始高度（未缩放）
 */
function _showLabelForCard(mesh, geoHeight) {
    mesh.getWorldPosition(_labelBottomPt);
    // 底边中点 = 世界坐标Y - 半高 * 缩放
    _labelBottomPt.y -= (geoHeight / 2) * mesh.scale.y;
    _labelBottomPt.project(camera);
    const screenX = (_labelBottomPt.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-_labelBottomPt.y * 0.5 + 0.5) * window.innerHeight + 12;
    showIdleLabel(mesh.userData, screenX, screenY);
}

// ── Per-card label pool ─────────────────────────────────────
// Each face-up active card gets its own DOM label that follows it,
// so multiple flipped cards all show their names at the same time.
const _cardLabelPool = new Map(); // uuid -> HTMLElement

function _ensureCardLabel(uuid) {
    let el = _cardLabelPool.get(uuid);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'card-label-floating';
    el.dataset.cardUuid = uuid;
    document.body.appendChild(el);
    _cardLabelPool.set(uuid, el);
    return el;
}

function _renderLabelHtml(data) {
    const orient = data.isReversed
        ? '<span class="idle-label-orient reversed">逆位 / REVERSED</span>'
        : '<span class="idle-label-orient upright">正位 / UPRIGHT</span>';
    return `<span class="idle-label-zh">${zhWithRoman(data.zh)}</span>`
        + `<span class="idle-label-en">${data.en}</span>`
        + orient;
}

function showLabelForActiveCard(mesh, geoHeight) {
    if (!mesh || !mesh.uuid) return;
    mesh.getWorldPosition(_labelBottomPt);
    _labelBottomPt.y -= (geoHeight / 2) * mesh.scale.y;
    _labelBottomPt.project(camera);
    const screenX = (_labelBottomPt.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-_labelBottomPt.y * 0.5 + 0.5) * window.innerHeight + 12;
    const el = _ensureCardLabel(mesh.uuid);
    el.innerHTML = _renderLabelHtml(mesh.userData);
    const elW = el.offsetWidth || 200;
    const elH = el.offsetHeight || 90;
    const clampedX = Math.max(elW / 2, Math.min(window.innerWidth - elW / 2, screenX));
    const clampedY = Math.max(0, Math.min(window.innerHeight - elH - 8, screenY));
    el.style.left = clampedX + 'px';
    el.style.top = clampedY + 'px';
    el.style.opacity = '1';
    el.style.display = 'block';
    el.dataset.frame = String(_labelFrame);
}

let _labelFrame = 0;

function syncCardLabels(visibleMeshes, geoHeight) {
    _labelFrame++;
    visibleMeshes.forEach(mesh => showLabelForActiveCard(mesh, geoHeight));
    // Hide any pooled label whose card was not rendered this frame
    _cardLabelPool.forEach((el, uuid) => {
        if (el.dataset.frame !== String(_labelFrame)) {
            el.style.opacity = '0';
            el.style.display = 'none';
        }
    });
}

function clearAllCardLabels() {
    _cardLabelPool.forEach(el => {
        el.style.opacity = '0';
        el.style.display = 'none';
    });
}

function disposeCardLabel(uuid) {
    const el = _cardLabelPool.get(uuid);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    _cardLabelPool.delete(uuid);
}
