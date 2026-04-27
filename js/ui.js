function showUI(data) {
    const el = document.getElementById('result-display');
    el.style.opacity = 1;
    el.style.transform = 'translate(-50%, 0)';
    document.getElementById('card-name').innerHTML = zhWithRoman(data.zh);
    document.getElementById('card-name-en').innerText = data.en;
    const orient = data.isReversed ? '逆位 / REVERSED' : '正位 / UPRIGHT';
    document.getElementById('card-orient').innerText = data.slotLabel
        ? `${data.slotLabel} · ${orient}`
        : orient;
}

function hideUI() {
    const el = document.getElementById('result-display');
    el.style.opacity = 0;
    el.style.transform = 'translate(-50%, 30px)';
}

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
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
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
