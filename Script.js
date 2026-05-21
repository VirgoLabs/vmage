/* ════════════════════════════════════════
   STATE
════════════════════════════════════════ */
let img = null;
let rotate = 0, flipH = 1, flipV = 1;
let imgOpacity = 100;
let vignetteStr = 0, noiseAmt = 0;
let activeFrame = 'none';
let textLayer = 'behind';
let textPos = 'middle-center';
let stickerPos = 'middle-center';
let activeBdayTheme = null;
let overlays = [];
let history = [], historyIdx = -1;
let bdayAnimId = null, bdayParticles = [];
let cropMode = false, cropStart = null, cropRect = null;

let filters = {
    brightness: 100, saturation: 100, inversion: 0,
    grayscale: 0, contrast: 100, blur: 0, sepia: 0, hueRotate: 0
};

const filterUnits = {
    brightness: '%', saturation: '%', inversion: '%',
    grayscale: '%', contrast: '%', blur: 'px', sepia: '%', hueRotate: '°'
};

const canvas = document.getElementById('previewCanvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const dropH = document.getElementById('dropHint');
const bdayCanvas = document.getElementById('bdayCanvas');
const bdayCtx = bdayCanvas.getContext('2d');
const cropCanvas = document.getElementById('cropOverlay');
const cropCtx = cropCanvas.getContext('2d');

/* ════════════════════════════════════════
   TOAST
════════════════════════════════════════ */
function toast(msg, err = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}
function needsImage() {
    if (!img) { toast('⚠ Load an image first', true); return true; }
    return false;
}

/* ════════════════════════════════════════
   FIT CANVAS TO IMAGE
════════════════════════════════════════ */
function fitCanvasToImage() {
    if (!img) {
        // No image: reset to default 3:4 ratio centered
        wrap.style.width = '';
        wrap.style.height = '';
        return;
    }

    const canvasZone = wrap.parentElement;
    const zoneW = canvasZone.offsetWidth - 24;
    const zoneH = window.innerHeight - 155;

    const ratio = img.naturalWidth / img.naturalHeight;

    let w = zoneW;
    let h = w / ratio;

    if (h > zoneH) {
        h = zoneH;
        w = h * ratio;
    }

    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    wrap.style.maxWidth = '100%';
}

/* ════════════════════════════════════════
   RENDER
════════════════════════════════════════ */
function buildFilter() {
    const f = filters;
    return `brightness(${f.brightness}%) saturate(${f.saturation}%) invert(${f.inversion}%) grayscale(${f.grayscale}%) contrast(${f.contrast}%) blur(${f.blur}px) sepia(${f.sepia}%) hue-rotate(${f.hueRotate}deg)`;
}

function render() {
    if (!img) return;

    const W = wrap.offsetWidth;
    const H = wrap.offsetHeight;
    if (!W || !H) return;

    canvas.width = W;
    canvas.height = H;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';

    ctx.clearRect(0, 0, W, H);

    // ── Step 1: Blurred BG (gaps fill) ──
    ctx.save();
    ctx.filter = 'blur(25px) brightness(0.5)';
    const bgs = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const bgw = img.naturalWidth * bgs * 1.1;
    const bgh = img.naturalHeight * bgs * 1.1;
    ctx.drawImage(img, (W - bgw) / 2, (H - bgh) / 2, bgw, bgh);
    ctx.restore();

    // ── Step 2: Behind overlays ──
    overlays.forEach(o => {
        if (o.layer === 'behind' || o.type === 'sticker') drawOverlay(o, W, H);
    });

    // ── Step 3: Main image contain (no crop) ──
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;

    ctx.save();
    ctx.filter = buildFilter();
    ctx.globalAlpha = imgOpacity / 100;
    ctx.translate(ox + dw / 2, oy + dh / 2);
    ctx.rotate(rotate * Math.PI / 180);
    ctx.scale(flipH, flipV);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    // ── Step 4: Front overlays ──
    overlays.forEach(o => {
        if (o.type === 'text' && o.layer === 'front') drawOverlay(o, W, H);
    });

    drawFrame(W, H);
    if (vignetteStr > 0) drawVignette(W, H);
    if (noiseAmt > 0) drawNoise(W, H);

    const info = document.getElementById('canvasInfo');
    info.style.display = 'block';
    info.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
}

function drawOverlay(o, W, H) {
    if (o.type === 'text') drawTextOverlay(o, W, H);
    else if (o.type === 'sticker') drawStickerOverlay(o, W, H);
}

function drawTextOverlay(o, W, H) {
    ctx.save();
    ctx.globalAlpha = (o.opacity ?? 100) / 100;
    const fs = o.fontSize || 36;
    ctx.font = `${o.fontStyle || 'normal'} ${o.fontWeight || 400} ${fs}px ${o.fontFamily || 'DM Mono,monospace'}`;
    ctx.textBaseline = 'middle';
    const lines = o.text.split('\n');
    const lh = fs * 1.35;
    const totalH = lines.length * lh;
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const pos = o.pos || 'middle-center';
    const [vert, horiz] = pos.split('-');
    const pad = 20;
    let x, y, align;
    if (horiz === 'left') { x = pad; align = 'left'; }
    else if (horiz === 'right') { x = W - pad; align = 'right'; }
    else { x = W / 2; align = 'center'; }
    if (vert === 'top') y = pad + totalH / 2;
    else if (vert === 'bottom') y = H - pad - totalH / 2;
    else y = H / 2;
    ctx.textAlign = align;
    if ((o.bgOpacity || 0) > 0) {
        const bx = align === 'left' ? x - 8 : align === 'right' ? x - maxW - 8 : x - maxW / 2 - 8;
        ctx.fillStyle = hexRgba(o.bgColor || '#000', (o.bgOpacity || 0) / 100);
        ctx.beginPath(); ctx.roundRect(bx, y - totalH / 2 - 6, maxW + 16, totalH + 12, 6); ctx.fill();
    }
    ctx.translate(x, y); ctx.rotate((o.rotation || 0) * Math.PI / 180); ctx.translate(-x, -y);
    lines.forEach((line, i) => {
        const ly = y + (i - (lines.length - 1) / 2) * lh;
        if ((o.strokeWidth || 0) > 0) {
            ctx.strokeStyle = o.strokeColor || '#000'; ctx.lineWidth = o.strokeWidth;
            ctx.strokeText(line, x, ly);
        }
        ctx.fillStyle = o.color || '#fff'; ctx.fillText(line, x, ly);
    });
    ctx.restore();
}

function drawStickerOverlay(o, W, H) {
    ctx.save();
    ctx.globalAlpha = 1;
    const size = o.size || 60;
    ctx.font = `${size}px serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const pos = o.pos || 'middle-center';
    const [vert, horiz] = pos.split('-');
    const pad = size / 2 + 10;
    let x, y;
    if (horiz === 'left') x = pad;
    else if (horiz === 'right') x = W - pad;
    else x = W / 2;
    if (vert === 'top') y = pad;
    else if (vert === 'bottom') y = H - pad;
    else y = H / 2;
    ctx.fillText(o.emoji, x, y);
    ctx.restore();
}

function drawFrame(W, H) {
    if (activeFrame === 'none') return;
    ctx.save();
    const t = 12;
    let color = '#fff';
    if (activeFrame === 'black') color = '#000';
    else if (activeFrame === 'gold') color = '#d4a017';
    else if (activeFrame === 'neon') color = '#e8ff47';
    else if (activeFrame === 'vintage') color = '#8b6914';
    ctx.strokeStyle = color;
    ctx.lineWidth = t;
    ctx.strokeRect(t / 2, t / 2, W - t, H - t);
    if (activeFrame === 'vintage') {
        ctx.strokeStyle = 'rgba(139,105,20,0.5)';
        ctx.lineWidth = 3;
        ctx.strokeRect(t + 4, t + 4, W - t * 2 - 8, H - t * 2 - 8);
    }
    if (activeFrame === 'neon') {
        ctx.shadowColor = '#e8ff47'; ctx.shadowBlur = 12;
        ctx.strokeRect(t / 2, t / 2, W - t, H - t);
    }
    ctx.restore();
}

function drawVignette(W, H) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${vignetteStr / 130})`);
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}

function drawNoise(W, H) {
    ctx.save();
    ctx.globalAlpha = noiseAmt / 400;
    for (let i = 0; i < W * H * 0.08; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        const c = Math.random() > 0.5 ? 255 : 0;
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.restore();
}

function hexRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

/* ════════════════════════════════════════
   LOAD IMAGE
════════════════════════════════════════ */
const fileInput = document.getElementById('fileInput');
document.getElementById('chooseBtn').onclick = () => fileInput.click();
fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
        img = i;
        canvas.style.display = 'block';
        dropH.style.display = 'none';
        overlays = []; bdayParticles = [];
        stopBdayAnim();
        resetFilters();
        fitCanvasToImage();
        saveHistory();
        render();
        toast('🖼 Image loaded');
        document.getElementById('statusBar').textContent = `${file.name} · ${i.naturalWidth}×${i.naturalHeight}`;
    };
    i.src = url;
};

// drag-drop
wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag-over'); });
wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
wrap.addEventListener('drop', e => {
    e.preventDefault(); wrap.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change'));
});

window.addEventListener('resize', () => {
    if (img) {
        fitCanvasToImage();
        render();
    }
});

/* ════════════════════════════════════════
   HISTORY (Undo/Redo)
════════════════════════════════════════ */
function stateSnapshot() {
    return JSON.stringify({ filters: { ...filters }, rotate, flipH, flipV, imgOpacity, vignetteStr, noiseAmt, activeFrame, overlays: JSON.parse(JSON.stringify(overlays)) });
}
function saveHistory() {
    history = history.slice(0, historyIdx + 1);
    history.push(stateSnapshot());
    historyIdx = history.length - 1;
}
function applySnapshot(snap) {
    const s = JSON.parse(snap);
    Object.assign(filters, s.filters);
    rotate = s.rotate; flipH = s.flipH; flipV = s.flipV;
    imgOpacity = s.imgOpacity; vignetteStr = s.vignetteStr; noiseAmt = s.noiseAmt;
    activeFrame = s.activeFrame; overlays = s.overlays;
    syncSliders(); render();
}
document.getElementById('undoBtn').onclick = () => {
    if (historyIdx <= 0) { toast('Nothing to undo', true); return; }
    historyIdx--; applySnapshot(history[historyIdx]); toast('↩ Undo');
};
document.getElementById('redoBtn').onclick = () => {
    if (historyIdx >= history.length - 1) { toast('Nothing to redo', true); return; }
    historyIdx++; applySnapshot(history[historyIdx]); toast('↪ Redo');
};
function syncSliders() {
    Object.keys(filters).forEach(k => {
        const el = document.querySelector(`input[data-for="${k}"]`);
        if (el) el.value = filters[k];
        const vEl = document.getElementById('v-' + k);
        if (vEl) vEl.textContent = filters[k] + filterUnits[k];
    });
    document.getElementById('opacitySlider').value = imgOpacity;
    document.getElementById('v-opacity').textContent = imgOpacity + '%';
    document.getElementById('vignetteSlider').value = vignetteStr;
    document.getElementById('v-vignette').textContent = vignetteStr + '%';
    document.getElementById('noiseSlider').value = noiseAmt;
    document.getElementById('v-noise').textContent = noiseAmt + '%';
}

/* ════════════════════════════════════════
   LEFT TOOLBAR — FILTERS
════════════════════════════════════════ */
document.querySelectorAll('.t-btn[data-filter]').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.t-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.t-slider-wrap[id^="sw-"]').forEach(el => el.style.display = 'none');
        document.getElementById('sw-' + btn.dataset.filter).style.display = 'block';
    };
});

document.querySelectorAll('input[data-for]').forEach(sl => {
    sl.oninput = () => {
        if (!img) return;
        const k = sl.dataset.for;
        filters[k] = parseFloat(sl.value);
        const vEl = document.getElementById('v-' + k);
        if (vEl) vEl.textContent = sl.value + filterUnits[k];
        render();
    };
    sl.onchange = () => saveHistory();
});

document.getElementById('opacitySlider').oninput = function () {
    if (!img) return;
    imgOpacity = parseInt(this.value);
    document.getElementById('v-opacity').textContent = imgOpacity + '%';
    render();
};
document.getElementById('opacitySlider').onchange = () => saveHistory();

// Transform
document.querySelectorAll('.t-btn[data-action]').forEach(btn => {
    btn.onclick = () => {
        if (needsImage()) return;
        const a = btn.dataset.action;
        if (a === 'left') rotate -= 90;
        if (a === 'right') rotate += 90;
        if (a === 'flipH') flipH *= -1;
        if (a === 'flipV') flipV *= -1;
        render(); saveHistory();
    };
});

/* ════════════════════════════════════════
   VIGNETTE / NOISE
════════════════════════════════════════ */
document.getElementById('vignetteSlider').oninput = function () {
    vignetteStr = parseInt(this.value);
    document.getElementById('v-vignette').textContent = vignetteStr + '%';
    if (img) render();
};
document.getElementById('vignetteSlider').onchange = () => saveHistory();
document.getElementById('noiseSlider').oninput = function () {
    noiseAmt = parseInt(this.value);
    document.getElementById('v-noise').textContent = noiseAmt + '%';
    if (img) render();
};
document.getElementById('noiseSlider').onchange = () => saveHistory();

/* ════════════════════════════════════════
   PRESETS
════════════════════════════════════════ */
const presetDefs = {
    vivid: { brightness: 115, saturation: 160, contrast: 115, blur: 0, grayscale: 0, sepia: 0, hueRotate: 0, inversion: 0 },
    fade: { brightness: 110, saturation: 70, contrast: 85, blur: 0, grayscale: 0, sepia: 15, hueRotate: 0, inversion: 0 },
    noir: { brightness: 90, saturation: 0, contrast: 130, blur: 0, grayscale: 100, sepia: 0, hueRotate: 0, inversion: 0 },
    warm: { brightness: 105, saturation: 120, contrast: 100, blur: 0, grayscale: 0, sepia: 30, hueRotate: 10, inversion: 0 },
    cool: { brightness: 100, saturation: 110, contrast: 100, blur: 0, grayscale: 0, sepia: 0, hueRotate: 200, inversion: 0 },
    vintage: { brightness: 105, saturation: 80, contrast: 90, blur: 0, grayscale: 0, sepia: 40, hueRotate: 0, inversion: 0 },
    dramatic: { brightness: 85, saturation: 130, contrast: 155, blur: 0, grayscale: 0, sepia: 0, hueRotate: 0, inversion: 0 },
    dreamy: { brightness: 115, saturation: 90, contrast: 85, blur: 1.5, grayscale: 0, sepia: 20, hueRotate: 330, inversion: 0 },
};
document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
    btn.onclick = () => {
        if (needsImage()) return;
        document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Object.assign(filters, presetDefs[btn.dataset.preset]);
        syncSliders(); render(); saveHistory();
        toast(`✓ ${btn.textContent.trim()}`);
    };
});

/* ════════════════════════════════════════
   FRAMES
════════════════════════════════════════ */
document.querySelectorAll('.preset-btn[data-frame]').forEach(btn => {
    btn.onclick = () => {
        if (needsImage()) return;
        document.querySelectorAll('.preset-btn[data-frame]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFrame = btn.dataset.frame;
        render(); saveHistory();
    };
});

/* ════════════════════════════════════════
   RESET / CLEAR
════════════════════════════════════════ */
function resetFilters() {
    filters = { brightness: 100, saturation: 100, inversion: 0, grayscale: 0, contrast: 100, blur: 0, sepia: 0, hueRotate: 0 };
    rotate = 0; flipH = 1; flipV = 1; imgOpacity = 100; vignetteStr = 0; noiseAmt = 0; activeFrame = 'none';
    syncSliders();
    document.querySelectorAll('.preset-btn[data-preset], .preset-btn[data-frame]').forEach(b => b.classList.remove('active'));
}
document.getElementById('resetBtn').onclick = () => {
    if (!img) return;
    overlays = []; stopBdayAnim(); resetFilters(); render(); saveHistory(); toast('↺ Reset');
};
document.getElementById('clearBtn').onclick = () => {
    img = null; overlays = []; canvas.style.display = 'none'; dropH.style.display = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height); stopBdayAnim();
    // Reset wrap to default sizing
    wrap.style.width = '';
    wrap.style.height = '';
    document.getElementById('statusBar').textContent = 'No image loaded';
    document.getElementById('canvasInfo').style.display = 'none';
    toast('✕ Cleared');
};

/* ════════════════════════════════════════
   BG STRIP
════════════════════════════════════════ */
document.getElementById('bgRemoveBtn').onclick = () => {
    if (needsImage()) return;
    toast('✂ BG stripping is a pro feature — try export & use remove.bg!');
};

/* ════════════════════════════════════════
   CROP
════════════════════════════════════════ */
document.getElementById('cropBtn').onclick = () => {
    if (needsImage()) return;
    cropMode = !cropMode;
    cropCanvas.style.display = cropMode ? 'block' : 'none';
    document.getElementById('cropBtn').style.background = cropMode ? 'rgba(71,232,200,.2)' : '';
    if (cropMode) {
        toast('Draw crop area then release');
        cropCanvas.width = wrap.offsetWidth; cropCanvas.height = wrap.offsetHeight;
    } else {
        if (cropRect) applyCrop();
        cropRect = null;
    }
};

cropCanvas.addEventListener('mousedown', e => {
    if (!cropMode) return;
    const r = cropCanvas.getBoundingClientRect();
    cropStart = { x: e.clientX - r.left, y: e.clientY - r.top };
});
cropCanvas.addEventListener('mousemove', e => {
    if (!cropMode || !cropStart) return;
    const r = cropCanvas.getBoundingClientRect();
    const ex = e.clientX - r.left, ey = e.clientY - r.top;
    cropRect = { x: Math.min(cropStart.x, ex), y: Math.min(cropStart.y, ey), w: Math.abs(ex - cropStart.x), h: Math.abs(ey - cropStart.y) };
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.fillStyle = 'rgba(0,0,0,0.45)';
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.clearRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
    cropCtx.strokeStyle = '#e8ff47'; cropCtx.lineWidth = 1.5;
    cropCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
});
cropCanvas.addEventListener('mouseup', () => { cropStart = null; });

function applyCrop() {
    if (!cropRect || cropRect.w < 10 || cropRect.h < 10) { toast('Too small', true); return; }
    const tmp = document.createElement('canvas');
    tmp.width = cropRect.w; tmp.height = cropRect.h;
    tmp.getContext('2d').drawImage(canvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
    const ci = new Image();
    ci.onload = () => {
        img = ci; overlays = [];
        fitCanvasToImage();
        render(); saveHistory();
        toast('✓ Cropped!');
    };
    ci.src = tmp.toDataURL();
    cropCanvas.style.display = 'none';
    document.getElementById('cropBtn').style.background = '';
    cropMode = false;
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
}

/* ════════════════════════════════════════
   TABS
════════════════════════════════════════ */
document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.getElementById('tab-' + t.dataset.tab).classList.add('active');
    };
});

/* ════════════════════════════════════════
   TEXT
════════════════════════════════════════ */
document.getElementById('fontSize').oninput = function () { document.getElementById('fontSizeVal').textContent = this.value + 'px'; };
document.getElementById('textRotation').oninput = function () { document.getElementById('textRotVal').textContent = this.value + '°'; };
document.getElementById('textOpacity').oninput = function () { document.getElementById('textOpacityVal').textContent = this.value + '%'; };
document.getElementById('strokeWidth').oninput = function () { document.getElementById('strokeWidthVal').textContent = this.value; };

document.querySelectorAll('.pos-btn[data-pos]').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('.pos-btn[data-pos]').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); textPos = b.dataset.pos;
    };
});
document.querySelectorAll('.pos-btn[data-spos]').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('.pos-btn[data-spos]').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); stickerPos = b.dataset.spos;
    };
});
document.querySelectorAll('[data-layer]').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('[data-layer]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); textLayer = btn.dataset.layer;
    };
});

document.getElementById('addTextBtn').onclick = () => {
    if (needsImage()) return;
    const text = document.getElementById('textContent').value.trim();
    if (!text) { toast('⚠ Enter text first', true); return; }
    overlays.push({
        type: 'text', layer: textLayer, text,
        fontFamily: document.getElementById('fontFamily').value,
        fontWeight: document.getElementById('fontWeight').value,
        fontSize: parseInt(document.getElementById('fontSize').value),
        fontStyle: document.getElementById('fontStyle').value,
        color: document.getElementById('textColor').value,
        strokeColor: document.getElementById('strokeColor').value,
        strokeWidth: parseInt(document.getElementById('strokeWidth').value),
        bgColor: document.getElementById('textBg').value,
        bgOpacity: parseInt(document.getElementById('textBgOpacity').value),
        pos: textPos,
        rotation: parseInt(document.getElementById('textRotation').value),
        opacity: parseInt(document.getElementById('textOpacity').value),
    });
    render(); saveHistory(); toast('✓ Text added');
};
document.getElementById('removeLastText').onclick = () => {
    const idx = [...overlays].reverse().findIndex(o => o.type === 'text');
    if (idx === -1) { toast('No text', true); return; }
    overlays.splice(overlays.length - 1 - idx, 1);
    render(); saveHistory(); toast('Text removed');
};

/* ════════════════════════════════════════
   BIRTHDAY ANIMATIONS
════════════════════════════════════════ */
function mkBalloon(W, H) {
    const cols = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bce', '#c77dff'];
    return { type: 'balloon', x: Math.random() * W, y: H + 60 + Math.random() * 80, vy: -(1.2 + Math.random() * 1.5), vx: (Math.random() - .5) * .6, size: 24 + Math.random() * 20, color: cols[Math.random() * cols.length | 0], sway: Math.random() * Math.PI * 2, swaySpeed: .02 + Math.random() * .02, opacity: .85 + Math.random() * .15 };
}
function mkConfetti(W, H) {
    const cols = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bce', '#e8ff47'];
    return { type: 'confetti', x: Math.random() * W, y: -10, vy: 2 + Math.random() * 3, vx: (Math.random() - .5) * 2, w: 7 + Math.random() * 7, h: 4 + Math.random() * 5, rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - .5) * .15, color: cols[Math.random() * cols.length | 0], opacity: .7 + Math.random() * .3 };
}
function mkSparkle(W, H) {
    return { type: 'sparkle', x: Math.random() * W, y: Math.random() * H, life: 1, decay: .02 + Math.random() * .02, size: 4 + Math.random() * 10, color: ['#fff176', '#ffe082', '#fff', '#f8bbd9'][Math.random() * 4 | 0] };
}
function mkFirework(W, H) {
    const cx = 80 + Math.random() * (W - 160), cy = 60 + Math.random() * H * .5;
    const color = `hsl(${Math.random() * 360},100%,65%)`;
    const parts = [];
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, sp = 2 + Math.random() * 3; parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: .015 + Math.random() * .015, size: 3 + Math.random() * 4, color }); }
    return { type: 'firework', particles: parts };
}
function initBdayParticles(W, H) {
    bdayParticles = [];
    if (document.getElementById('animBalloons').checked) for (let i = 0; i < 10; i++) bdayParticles.push(mkBalloon(W, H));
    if (document.getElementById('animConfetti').checked) for (let i = 0; i < 50; i++) bdayParticles.push(mkConfetti(W, H));
    if (document.getElementById('animSparkles').checked) for (let i = 0; i < 25; i++) bdayParticles.push(mkSparkle(W, H));
    if (document.getElementById('animFireworks').checked) bdayParticles.push(mkFirework(W, H));
}
function animateBday(W, H) {
    bdayCtx.clearRect(0, 0, W, H);
    const np = [];
    for (const p of bdayParticles) {
        if (p.type === 'balloon') {
            p.sway += p.swaySpeed; p.x += Math.sin(p.sway) * .8 + p.vx; p.y += p.vy;
            if (p.y + p.size > -10) {
                bdayCtx.save(); bdayCtx.globalAlpha = p.opacity;
                bdayCtx.beginPath(); bdayCtx.ellipse(p.x, p.y, p.size * .7, p.size, 0, 0, Math.PI * 2);
                bdayCtx.fillStyle = p.color; bdayCtx.fill();
                bdayCtx.beginPath(); bdayCtx.ellipse(p.x - p.size * .2, p.y - p.size * .3, p.size * .18, p.size * .28, -.4, 0, Math.PI * 2);
                bdayCtx.fillStyle = 'rgba(255,255,255,.4)'; bdayCtx.fill();
                bdayCtx.beginPath(); bdayCtx.moveTo(p.x, p.y + p.size + 5); bdayCtx.lineTo(p.x + Math.sin(p.sway) * 8, p.y + p.size + 28);
                bdayCtx.strokeStyle = 'rgba(255,255,255,.2)'; bdayCtx.lineWidth = 1; bdayCtx.stroke();
                bdayCtx.restore(); np.push(p);
            } else if (document.getElementById('animBalloons').checked) np.push(mkBalloon(W, H));
        } else if (p.type === 'confetti') {
            p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed;
            if (p.y < H + 20) {
                bdayCtx.save(); bdayCtx.globalAlpha = p.opacity;
                bdayCtx.translate(p.x, p.y); bdayCtx.rotate(p.rot);
                bdayCtx.fillStyle = p.color; bdayCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                bdayCtx.restore(); np.push(p);
            } else if (document.getElementById('animConfetti').checked) np.push(mkConfetti(W, H));
        } else if (p.type === 'sparkle') {
            p.life -= p.decay;
            if (p.life > 0) {
                bdayCtx.save(); bdayCtx.globalAlpha = p.life; bdayCtx.fillStyle = p.color;
                bdayCtx.beginPath();
                for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r = i % 2 === 0 ? p.size : p.size * .4; const px = p.x + Math.cos(a) * r, py = p.y + Math.sin(a) * r; i === 0 ? bdayCtx.moveTo(px, py) : bdayCtx.lineTo(px, py); }
                bdayCtx.closePath(); bdayCtx.fill(); bdayCtx.restore(); np.push(p);
            } else if (document.getElementById('animSparkles').checked) np.push(mkSparkle(W, H));
        } else if (p.type === 'firework') {
            let alive = false; const sp = [];
            for (const fp of p.particles) {
                fp.x += fp.vx; fp.y += fp.vy; fp.vy += .08; fp.life -= fp.decay;
                if (fp.life > 0) {
                    bdayCtx.save(); bdayCtx.globalAlpha = fp.life;
                    bdayCtx.beginPath(); bdayCtx.arc(fp.x, fp.y, fp.size * fp.life, 0, Math.PI * 2);
                    bdayCtx.fillStyle = fp.color; bdayCtx.fill(); bdayCtx.restore();
                    sp.push(fp); alive = true;
                }
            }
            if (alive) { p.particles = sp; np.push(p); }
            else if (document.getElementById('animFireworks').checked) np.push(mkFirework(W, H));
        }
    }
    bdayParticles = np;
    bdayAnimId = requestAnimationFrame(() => animateBday(W, H));
}
function startBdayAnim() {
    stopBdayAnim();
    const W = wrap.offsetWidth, H = wrap.offsetHeight;
    bdayCanvas.width = W; bdayCanvas.height = H;
    bdayCanvas.style.display = 'block';
    initBdayParticles(W, H); animateBday(W, H);
}
function stopBdayAnim() {
    if (bdayAnimId) { cancelAnimationFrame(bdayAnimId); bdayAnimId = null; }
    bdayCanvas.style.display = 'none';
    bdayCtx.clearRect(0, 0, bdayCanvas.width, bdayCanvas.height);
}
document.getElementById('stopAnimBtn').onclick = stopBdayAnim;

const bdayThemes = {
    royal: { text: '#d8b4fe', accent: '#9333ea' },
    fire: { text: '#fca5a5', accent: '#ef4444' },
    ocean: { text: '#7dd3fc', accent: '#0ea5e9' },
    forest: { text: '#86efac', accent: '#22c55e' },
    gold: { text: '#fcd34d', accent: '#f59e0b' },
    neon: { text: '#e879f9', accent: '#a855f7' },
};
document.querySelectorAll('.bday-card').forEach(c => {
    c.onclick = () => {
        document.querySelectorAll('.bday-card').forEach(x => x.classList.remove('active'));
        c.classList.add('active'); activeBdayTheme = c.dataset.theme;
    };
});
document.getElementById('applyBdayBtn').onclick = () => {
    if (needsImage()) return;
    const name = document.getElementById('bdayName').value.trim() || 'You';
    const theme = activeBdayTheme ? bdayThemes[activeBdayTheme] : bdayThemes.royal;
    const W = wrap.offsetWidth, H = wrap.offsetHeight;
    overlays = overlays.filter(o => o._bday !== true);
    overlays.push({
        type: 'text', layer: 'front', _bday: true,
        text: `Happy Birthday\n${name}!`,
        fontFamily: "'Syne',sans-serif", fontWeight: '800',
        fontSize: Math.max(14, W * 0.035 | 0), fontStyle: 'normal',
        color: theme.text, strokeColor: '#000', strokeWidth: Math.max(1, W * .003 | 0),
        bgColor: '#000', bgOpacity: 0, pos: 'top-center', rotation: 0, opacity: 92,
    });
    overlays.push({
        type: 'text', layer: 'front', _bday: true,
        text: 'Cheers your day 🥂🥂',
        fontFamily: "'DM Mono',monospace", fontWeight: '500',
        fontSize: Math.max(8, W * 0.018 | 0), fontStyle: 'italic',
        color: theme.accent, strokeColor: '#000', strokeWidth: 1,
        bgColor: '#000', bgOpacity: 0, pos: 'bottom-center', rotation: 0, opacity: 90,
    });
    render(); startBdayAnim(); saveHistory();
    toast('🎂 Birthday applied!');
};

/* ════════════════════════════════════════
   SAVE / EXPORT
════════════════════════════════════════ */
function doSave() {
    if (needsImage()) return;
    const wasAnim = bdayAnimId !== null;
    if (wasAnim) cancelAnimationFrame(bdayAnimId);
    render();
    let sv = canvas;
    if (bdayCanvas.style.display !== 'none') {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        const tc = tmp.getContext('2d'); tc.drawImage(canvas, 0, 0); tc.drawImage(bdayCanvas, 0, 0, canvas.width, canvas.height);
        sv = tmp;
    }
    const fmt = prompt('Format: png / jpg / webp', 'png');
    if (!fmt) { if (wasAnim) animateBday(canvas.width, canvas.height); return; }
    const f = fmt.toLowerCase();
    const mime = f === 'jpg' || f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png';
    const ext = f === 'jpg' || f === 'jpeg' ? 'jpg' : f === 'webp' ? 'webp' : 'png';
    const a = document.createElement('a');
    a.download = `lens-edit.${ext}`; a.href = sv.toDataURL(mime); a.click();
    toast(`💾 ${ext.toUpperCase()} saved`);
    if (wasAnim) animateBday(canvas.width, canvas.height);
}
document.getElementById('saveBtn').onclick = doSave;
document.getElementById('saveBtn2').onclick = doSave;

/* ════════════════════════════════════════
   KEYBOARD SHORTCUTS
════════════════════════════════════════ */
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); document.getElementById('undoBtn').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); document.getElementById('redoBtn').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(); }
});

/* ════════════════════════════════════════
   RECORDING VARIABLES
════════════════════════════════════════ */

let mediaRecorder = null;
let recordedChunks = [];
let recordAnimId = null;

let currentAudio = null;
let audioCtx = null;


/* ════════════════════════════════════════
   DOWNLOAD HELPER
════════════════════════════════════════ */

function downloadBlob(blob, filename) {

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);

    a.click();

    setTimeout(() => {

        URL.revokeObjectURL(url);
        a.remove();

    }, 1000);
}


/* ════════════════════════════════════════
   RECORD BUTTON — FIXED
════════════════════════════════════════ */

document.getElementById('recordBtn').onclick = async () => {

    if (needsImage()) return;

    const btn = document.getElementById('recordBtn');

    /* ───── STOP RECORDING ───── */

    if (
        mediaRecorder &&
        mediaRecorder.state === 'recording'
    ) {

        mediaRecorder.stop();

        cancelAnimationFrame(recordAnimId);

        /* STOP AUDIO */

        if (currentAudio) {

            currentAudio.pause();
            currentAudio.currentTime = 0;
        }

        /* STOP STREAM TRACKS */

        if (mediaRecorder.stream) {

            mediaRecorder.stream
                .getTracks()
                .forEach(track => track.stop());
        }

        /* CLOSE AUDIO CONTEXT */

        if (audioCtx) {

            audioCtx.close();
        }

        btn.textContent = '⏺ Record';

        btn.style.background = '';

        toast('⏹ Recording Stopped');

        return;
    }

    /* ───── RECORD CANVAS ───── */

    const W = wrap.offsetWidth;
    const H = wrap.offsetHeight;

    const recCanvas =
        document.createElement('canvas');

    recCanvas.width = W;
    recCanvas.height = H;

    const recCtx =
        recCanvas.getContext('2d');

    function drawRecordFrame() {

        recCtx.clearRect(0, 0, W, H);

        recCtx.drawImage(
            canvas,
            0,
            0,
            W,
            H
        );

        if (
            bdayCanvas.style.display !== 'none'
        ) {

            recCtx.drawImage(
                bdayCanvas,
                0,
                0,
                W,
                H
            );
        }

        recordAnimId =
            requestAnimationFrame(
                drawRecordFrame
            );
    }

    drawRecordFrame();

    /* ───── VIDEO STREAM ───── */

    const canvasStream =
        recCanvas.captureStream(30);

    /* ───── AUDIO ───── */

    let audioTracks = [];

    const musicFile =
        document.getElementById('musicSelect')?.value;

    if (musicFile) {

        currentAudio = new Audio();

        currentAudio.src = musicFile;

        currentAudio.loop = true;

        currentAudio.crossOrigin = 'anonymous';

        currentAudio.volume = 1;

        /* IMPORTANT */
        currentAudio.load();

        audioCtx =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();

        /* ADD THIS */
        await audioCtx.resume();

        const source =
            audioCtx.createMediaElementSource(
                currentAudio
            );
        const destination =
            audioCtx.createMediaStreamDestination();

        source.connect(destination);

        source.connect(audioCtx.destination);

        audioTracks =
            destination.stream.getAudioTracks();

        try {

            await currentAudio.play();

        } catch (err) {

            console.error(err);

            toast(
                'Audio playback blocked',
                true
            );

            return;
        }
    }

    /* ───── FINAL STREAM ───── */

    const finalStream =
        new MediaStream();

    canvasStream
        .getVideoTracks()
        .forEach(track => {

            finalStream.addTrack(track);

        });

    audioTracks.forEach(track => {

        finalStream.addTrack(track);

    });

    /* ───── MIME TYPE ───── */

    let mimeType = '';

    if (
        MediaRecorder.isTypeSupported(
            'video/webm;codecs=vp9,opus'
        )
    ) {

        mimeType =
            'video/webm;codecs=vp9,opus';

    } else if (
        MediaRecorder.isTypeSupported(
            'video/webm;codecs=vp8,opus'
        )
    ) {

        mimeType =
            'video/webm;codecs=vp8,opus';

    } else {

        mimeType = 'video/webm';
    }

    /* ───── CREATE RECORDER ───── */

    recordedChunks = [];

    try {

        mediaRecorder =
            new MediaRecorder(
                finalStream,
                {
                    mimeType,
                    videoBitsPerSecond: 4000000,
                    audioBitsPerSecond: 192000
                }
            );

    } catch (err) {

        console.error(err);

        toast(
            'MediaRecorder unsupported',
            true
        );

        return;
    }

    /* ───── RECORD DATA ───── */

    mediaRecorder.ondataavailable = e => {

        if (e.data.size > 0) {

            recordedChunks.push(e.data);
        }
    };

    /* ───── RECORD STOP ───── */

    mediaRecorder.onstop = async () => {

        cancelAnimationFrame(recordAnimId);

        const blob =
            new Blob(
                recordedChunks,
                {
                    type: mimeType
                }
            );

        recordedChunks = [];

        let format = prompt(
            'Save format: webm or mp4',
            'webm'
        );

        if (!format)
            format = 'webm';

        format =
            format.toLowerCase();

        /* WEBM */

        if (format === 'webm') {

            downloadBlob(
                blob,
                'lens-video.webm'
            );

            toast(
                '🎥 WEBM Saved'
            );
        }

        /* MP4 */

        else if (format === 'mp4') {

            try {

                const mp4Blob =
                    await convertWebmToMp4(blob);

                downloadBlob(
                    mp4Blob,
                    'lens-video.mp4'
                );

                toast('🎥 MP4 Saved');

            } catch (err) {

                console.error(err);

                toast(
                    '❌ MP4 conversion failed',
                    true
                );

                downloadBlob(
                    blob,
                    'lens-video.webm'
                );
            }
        }

        /* CLEANUP */

        finalStream
            .getTracks()
            .forEach(t => t.stop());

        if (currentAudio) {

            currentAudio.pause();

            currentAudio.currentTime = 0;
        }

        if (audioCtx) {

            audioCtx.close();
        }

        btn.textContent = '⏺ Record';
        btn.style.background = '';
    };

    /* ───── START ───── */

    mediaRecorder.start(100);

    btn.textContent = '⏹ Stop';

    btn.style.background =
        'rgba(255,0,80,.25)';

    toast('🎬 Recording Started');
};


async function convertWebmToMp4(webmBlob) {

    toast('⏳ Loading FFmpeg...');

    const { FFmpeg } = FFmpegWASM;

    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
        console.log(message);
    });

    await ffmpeg.load();

    /* INPUT FILE */

    const inputData =
        new Uint8Array(
            await webmBlob.arrayBuffer()
        );

    await ffmpeg.writeFile(
        'input.webm',
        inputData
    );

    toast('🎬 Converting to MP4...');

    /* IMPORTANT:
       - map video + audio
       - convert opus -> aac
       - faststart for browser support
    */

    await ffmpeg.exec([

        '-i',
        'input.webm',

        /* VIDEO */

        '-c:v',
        'libx264',

        '-preset',
        'ultrafast',

        '-pix_fmt',
        'yuv420p',

        /* AUDIO */

        '-c:a',
        'libmp3lame',

        '-ar',
        '44100',

        '-b:a',
        '192k',

        /* MAP STREAMS */

        '-map',
        '0:v:0',

        '-map',
        '0:a:0?',

        /* WEB COMPATIBILITY */

        '-movflags',
        '+faststart',

        'output.mp4'
    ]);

    /* READ OUTPUT */

    const mp4Data =
        await ffmpeg.readFile(
            'output.mp4'
        );

    toast('✅ MP4 Ready');

    return new Blob(
        [mp4Data.buffer],
        {
            type: 'video/mp4'
        }
    );
}