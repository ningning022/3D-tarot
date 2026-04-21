const roundedTextureCache = new Map();

/** 用原生 Image 加载本地贴图（兼容 file:// 协议）
 *  Load local texture via native Image (works under file:// protocol) */
function makeTexture(src) {
    const tex = new THREE.Texture();
    const img = new Image();
    img.onload = () => { tex.image = img; tex.needsUpdate = true; };
    img.onerror = () => console.warn("图片加载失败 / Failed: " + src);
    img.src = src;
    return tex;
}

/** Canvas 圆角剪切路径生成圆角贴图 / Rounded-corner card texture via canvas clip */
function makeRoundedTexture(src, cardW, cardH, cornerR) {
    const cacheKey = `${src}|${cardW}|${cardH}|${cornerR}`;
    if (roundedTextureCache.has(cacheKey)) {
        return roundedTextureCache.get(cacheKey);
    }

    const res = 256;
    const cw = res, ch = Math.round(res * cardH / cardW);
    const cr = res * cornerR;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(cr, 0);
    ctx.lineTo(cw - cr, 0); ctx.arcTo(cw, 0, cw, cr, cr);
    ctx.lineTo(cw, ch - cr); ctx.arcTo(cw, ch, cw - cr, ch, cr);
    ctx.lineTo(cr, ch); ctx.arcTo(0, ch, 0, ch - cr, cr);
    ctx.lineTo(0, cr); ctx.arcTo(0, 0, cr, 0, cr);
    ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#100c04'; ctx.fillRect(0, 0, cw, ch);
    const tex = new THREE.Texture(canvas);
    tex.userData.keepCached = true;
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, cw, ch); tex.needsUpdate = true; };
    img.src = src;
    roundedTextureCache.set(cacheKey, tex);
    return tex;
}

function loadCardTexture(cardDef) {
    return makeTexture(IMG_BASE + cardDef.file);
}

// ── 罗马数字转换 / Chinese numeral → Roman numeral ──
const ZH_ROMAN = {
    '一': 'I', '二': 'II', '三': 'III', '四': 'IV', '五': 'V',
    '六': 'VI', '七': 'VII', '八': 'VIII', '九': 'IX', '十': 'X'
};

/** 将中文数字替换为加粗发光罗马数字 span
 *  Replace Chinese numerals with bold-glowing Roman numeral spans */
function zhWithRoman(str) {
    return str.replace(/[一二三四五六七八九十]/g,
        ch => `<b class="roman-num">${ZH_ROMAN[ch]}</b>`);
}

function disposeMaterial(material) {
    if (!material) return;
    if (Array.isArray(material)) {
        material.forEach(disposeMaterial);
        return;
    }
    if (material.map && !material.map.userData.keepCached) {
        material.map.dispose();
    }
    material.dispose();
}

function disposeObject(object) {
    if (!object) return;
    object.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) disposeMaterial(child.material);
    });
}
