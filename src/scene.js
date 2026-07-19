/*
 * The grove scene: 2.5D layers, pointer parallax, tap-to-focus camera,
 * data-driven slot layout, and the bloom wave.
 * Extended from reference/evergrove-grove-prototype.html.
 *
 * Wave timing lives entirely in CSS: JS computes each plant's delay once and
 * sets it as a --wd custom property; animation-delay does the staggering.
 * The single setTimeout below is cleanup bookkeeping, not choreography.
 */
import { drawPlant, hashSeed, seededUnit } from './renderer.js';
import { CONFIG } from '../config.js';

/* ---------- slot layout (spec §3) ----------
 * Focal slot front-center; remaining slots alternate mid → back rings, each
 * ring filling left/right symmetrically outward from center. x may leave
 * [0,100] — the stage pans sideways (drag) to reach outer slots.
 */
const RINGS = {
  0: { size: 150, par: 1, fog: 0 },
  1: { size: 92, par: .55, fog: .18, step: 15, baseYs: [71, 73, 70, 72] },
  2: { size: 62, par: .25, fog: .45, step: 13, baseYs: [56, 55, 57, 56] },
};

export function slotLayout(n) {
  const slots = [{ x: 50, base: 88, ring: 0, size: RINGS[0].size, par: RINGS[0].par, fog: RINGS[0].fog }];
  let mid = 0, back = 0;
  for (let i = 1; i < n; i++) {
    const ring = (i % 2 === 1) ? 1 : 2;
    const k = ring === 1 ? mid++ : back++;
    const r = RINGS[ring];
    const side = k % 2 === 0 ? -1 : 1;
    const mag = (Math.floor(k / 2) + 1) * r.step;
    slots.push({
      x: 50 + side * mag,
      base: r.baseYs[k % r.baseYs.length],
      ring, size: r.size, par: r.par, fog: r.fog,
    });
  }
  return slots;
}

function reduceMotionOn() {
  return document.body.classList.contains('rm');
}

export function createScene({ stageEl, camEl, hintEl, onPlantTap, onBackdropTap, onEmptySlotTap, onSlotsChanged }) {
  let slots = [];
  let plants = []; // view models: [{iid, seedId, slot, stage, ready, el, def}]
  let emptyEls = new Map(); // slot index → affordance element
  let catalogRef = null;
  let focused = null;
  let waveActive = false;
  let panEnabled = true;
  let ox = 0, panMax = 34;

  /* ---------- backdrop ---------- */
  [['36%', '16%', '#143528', .8, 'blur(1px)'], ['20%', '20%', '#1a4232', 1, ''], ['-8%', '30%', '#1f4c39', 1, '']]
    .forEach(([bot, h, col, op, bl]) => {
      const t = document.createElement('div');
      t.className = 'terr';
      Object.assign(t.style, { bottom: bot, height: h, background: col, opacity: op, filter: bl });
      camEl.appendChild(t);
    });
  for (let i = 0; i < 8; i++) {
    const f = document.createElement('div');
    f.className = 'fire';
    f.style.left = (6 + i * 12) + '%';
    f.style.top = (10 + (i % 4) * 9) + '%';
    f.style.animationDelay = (i * 0.4) + 's';
    camEl.appendChild(f);
  }

  /* ---------- plants ---------- */
  function baseFilter(s) {
    return s.fog ? `brightness(${1 - s.fog * .5}) ${s.ring === 2 ? 'blur(0.7px)' : ''}` : '';
  }

  function applySlot(p, animate = true) {
    const s = slots[p.slot];
    const h = s.size * 1.4;
    if (!animate) p.el.style.transition = 'none';
    Object.assign(p.el.style, {
      left: `calc(${s.x}% - ${s.size / 2}px)`,
      top: `calc(${s.base}% - ${h}px)`,
      width: s.size + 'px',
      height: h + 'px',
      zIndex: String(30 - s.ring * 10),
      filter: baseFilter(s),
      opacity: String(1 - s.fog * .3),
    });
    // sway: duration + phase seeded from instance id so plants never sync
    const seed = hashSeed(p.iid);
    const dur = (CONFIG.sway.minS + seededUnit(seed, 3) * (CONFIG.sway.maxS - CONFIG.sway.minS) + s.ring * .8).toFixed(2);
    const delay = (-seededUnit(seed, 4) * 4).toFixed(2);
    p.el.querySelector('.sw').style.animation = `sw${s.ring} ${dur}s ease-in-out ${delay}s infinite alternate`;
    if (!animate) requestAnimationFrame(() => p.el.style.transition = '');
  }

  function artSvg(p) {
    return drawPlant(p.def.render, { stage: p.stage, id: p.iid });
  }
  function renderPlantSvg(p) {
    p.el.querySelector('.sw').innerHTML = `<div class="art cur">${artSvg(p)}</div>`;
    p.el.classList.toggle('ready', !!p.ready);
  }

  function addPlantEl(p, animateIn = false) {
    const d = document.createElement('div');
    d.className = 'plant';
    d.dataset.iid = p.iid;
    d.innerHTML = `<div class="psh"></div><div class="sw"></div>`;
    camEl.appendChild(d);
    p.el = d;
    renderPlantSvg(p);
    applySlot(p, false);
    // moved-guard: a pan that starts and ends on this plant is not a tap
    d.addEventListener('click', e => { e.stopPropagation(); if (moved < 6) onPlantTap?.(p); });
    if (animateIn) {
      d.classList.add('nestle'); // the small planting moment (rm: instant via CSS)
      setTimeout(() => d.classList.remove('nestle'), CONFIG.plantNestleMs + 200);
    }
  }

  // Soft affordance on plantable slots (discoverable without a tutorial).
  function addEmptyEl(slotIdx) {
    const s = slots[slotIdx];
    if (!s || emptyEls.has(slotIdx)) return;
    const d = document.createElement('div');
    d.className = 'slotmark';
    const size = s.size * .62;
    Object.assign(d.style, {
      left: `calc(${s.x}% - ${size / 2}px)`,
      top: `calc(${s.base}% - ${size * .55}px)`,
      width: size + 'px',
      height: size * .62 + 'px',
      zIndex: String(29 - s.ring * 10),
      opacity: String(1 - s.fog * .4),
    });
    d.innerHTML = `<span>+</span>`;
    d.addEventListener('click', e => { e.stopPropagation(); if (moved < 6) onEmptySlotTap?.(slotIdx); });
    camEl.appendChild(d);
    emptyEls.set(slotIdx, d);
  }

  function refreshEmptySlots(totalSlots) {
    const occupied = new Set(plants.map(p => p.slot));
    for (let i = 0; i < totalSlots; i++) {
      if (occupied.has(i)) {
        emptyEls.get(i)?.remove();
        emptyEls.delete(i);
      } else {
        addEmptyEl(i);
      }
    }
  }

  function recomputePan() {
    const maxOverhang = Math.max(0, ...slots.map(s => Math.max(s.x - 100, -s.x)));
    panMax = Math.max(34, stageEl.clientWidth * (maxOverhang + 8) / 100);
  }

  function mount(grove, catalog) {
    catalogRef = catalog;
    slots = slotLayout(Math.max(grove.slots, grove.plants.length));
    plants = grove.plants.map(p => ({ ...p, def: catalog.byId.get(p.seedId), el: null }));
    plants.forEach(p => {
      if (!p.def) throw new Error(`Unknown seed id: ${p.seedId}`);
      addPlantEl(p);
    });
    refreshEmptySlots(grove.slots);
    recomputePan();
  }

  // Expansion bought: lay out the new slot and show its affordance.
  function setSlotCount(n) {
    slots = slotLayout(n);
    refreshEmptySlots(n);
    recomputePan();
  }

  // A seed was planted: replace the affordance with the new plant, gently.
  function addPlant(viewP) {
    const p = { ...viewP, def: catalogRef.byId.get(viewP.seedId), el: null };
    plants.push(p);
    emptyEls.get(p.slot)?.remove();
    emptyEls.delete(p.slot);
    addPlantEl(p, true);
    return p;
  }

  function byIid(iid) { return plants.find(p => p.iid === iid); }

  // Instant art refresh (tick-driven growth: seed→sprout etc.). During a
  // wave, only the model updates — re-rendering would wipe a pending
  // .art.next crossfade — and the art refresh runs after wave cleanup.
  const pendingRefresh = new Set();
  function updateStage(iid, stage, ready) {
    const p = byIid(iid);
    if (!p) return;
    p.stage = stage;
    p.ready = ready;
    if (waveActive) { pendingRefresh.add(iid); return; }
    renderPlantSvg(p);
  }
  function setReady(iid, ready) {
    const p = byIid(iid);
    if (!p || p.ready === !!ready) return;
    p.ready = !!ready;
    p.el.classList.toggle('ready', p.ready);
  }

  /*
   * Bond effects (spec §5c): L1 sheen, L2 richer saturation, L3 sparkle.
   * Deterministic — sparkle positions/phases derive from the instance-id
   * hash, never Math.random. Reduce-motion turns the twinkle into static
   * flourishes via CSS (body.rm .bspark).
   */
  function setBond(iid, level) {
    const p = byIid(iid);
    if (!p) return;
    p.el.classList.toggle('b1', level === 1);
    p.el.classList.toggle('b2', level === 2);
    p.el.classList.toggle('b3', level >= 3);
    const want = level >= 3 ? 3 : 0;
    const have = p.el.querySelectorAll('.bspark').length;
    if (want && !have) {
      const seed = hashSeed(p.iid);
      for (let i = 0; i < want; i++) {
        const s = document.createElement('i');
        s.className = 'bspark';
        s.style.left = (18 + seededUnit(seed, 10 + i) * 64) + '%';
        s.style.top = (8 + seededUnit(seed, 20 + i) * 42) + '%';
        s.style.animationDelay = (-seededUnit(seed, 30 + i) * 3).toFixed(2) + 's';
        p.el.appendChild(s);
      }
    } else if (!want && have) {
      p.el.querySelectorAll('.bspark').forEach(n => n.remove());
    }
  }

  // Center of the focused plant in stage coordinates (gesture guides anchor
  // here; getBoundingClientRect already accounts for the camera transform).
  function focusedCenter() {
    if (!focused) return null;
    const r = focused.el.getBoundingClientRect();
    const sr = stageEl.getBoundingClientRect();
    return { x: r.left + r.width / 2 - sr.left, y: r.top + r.height * .45 - sr.top, w: r.width, h: r.height };
  }

  /* ---------- parallax ---------- */
  function parallax() {
    if (focused) return;
    const off = reduceMotionOn() ? 0 : ox; // rm: no parallax drift
    plants.forEach(p => {
      const s = slots[p.slot];
      p.el.style.transform = `translateX(${-off * s.par}px)`;
    });
    camEl.querySelectorAll('.terr').forEach((t, i) => t.style.transform = `translateX(${-off * [.2, .5, .9][i]}px)`);
  }
  let down = false, lx = 0, moved = 0;
  stageEl.addEventListener('pointerdown', e => { down = true; lx = e.clientX; moved = 0; });
  window.addEventListener('pointercancel', () => down = false);
  stageEl.addEventListener('pointermove', e => {
    if (down && !focused && panEnabled) {
      const dx = e.clientX - lx;
      moved += Math.abs(dx);
      ox = Math.max(-panMax, Math.min(panMax, ox + dx * .4));
      lx = e.clientX;
      parallax();
    }
  });
  window.addEventListener('pointerup', () => down = false);
  stageEl.addEventListener('click', () => { if (focused && moved < 6) { onBackdropTap?.(); } });

  /* ---------- focus flow ---------- */
  function focusOn(p) {
    focused = p;
    const s = slots[p.slot];
    const r = stageEl.getBoundingClientRect();
    const px = s.x / 100, py = (s.base - 8) / 100;
    const dx = (0.5 - px) * r.width, dy = (0.34 - py) * r.height;
    camEl.style.transformOrigin = `${s.x}% ${s.base - 8}%`;
    camEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.75)`;
    p.el.style.zIndex = '45';
    plants.forEach(q => {
      if (q !== p) {
        const qs = slots[q.slot];
        q.el.style.filter = baseFilter(qs) + ' brightness(.5) blur(1.4px)';
      } else {
        q.el.style.filter = baseFilter(s);
      }
    });
    if (hintEl) hintEl.style.opacity = '0';
  }

  function unfocus() {
    focused = null;
    camEl.style.transform = 'none';
    plants.forEach(q => {
      const qs = slots[q.slot];
      q.el.style.filter = baseFilter(qs);
      q.el.style.zIndex = String(30 - qs.ring * 10);
    });
    if (hintEl) hintEl.style.opacity = '';
    parallax();
  }

  function swapFocal(p) {
    // resolve the focal plant inside the timeout: a double-tap queues two
    // swaps, and resolving early would make the second one swap right back
    setTimeout(() => {
      const focal = plants.find(q => q.slot === 0);
      if (!focal || focal === p) return;
      const tmp = focal.slot;
      focal.slot = p.slot;
      p.slot = tmp;
      applySlot(focal);
      applySlot(p);
      onSlotsChanged?.(plants.map(q => ({ iid: q.iid, slot: q.slot })));
    }, 320);
  }

  /* ---------- bloom wave (spec §5a) ---------- */

  function celebrateAt(p, delayMs) {
    const c = document.createElement('div');
    c.className = 'celebfx';
    c.style.setProperty('--cd', delayMs + 'ms');
    c.innerHTML = '<div class="cring"></div>'
      + Array.from({ length: 6 }, (_, i) => `<i style="--pa:${i * 60}deg"></i>`).join('');
    p.el.appendChild(c);
  }

  /*
   * origin: {x,y} in stage px. blooms: [{iid, first}] from loop.rainTend.
   * Every plant gets a delay by distance rank (ripple from the touch point);
   * blooming plants crossfade old→new art, others shimmer (watered visually).
   * Under reduce-motion: zero stagger, instant crossfades (CSS handles it).
   */
  function applyWave(origin, blooms, { onDone } = {}) {
    waveActive = true;
    const rm = reduceMotionOn();
    const stageRect = stageEl.getBoundingClientRect();
    const bloomSet = new Map(blooms.map(b => [b.iid, b]));

    const entries = plants.map(p => {
      const r = p.el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - stageRect.left;
      const cy = r.top + r.height * .7 - stageRect.top;
      return { p, dist: Math.hypot(cx - origin.x, cy - origin.y) };
    }).sort((a, b) => a.dist - b.dist);

    const stagger = rm ? 0 : CONFIG.rain.waveStaggerMs;
    const base = rm ? 0 : CONFIG.rain.waveBaseDelayMs;
    let maxDelay = 0;

    entries.forEach((e, rank) => {
      const p = e.p;
      const d = base + rank * stagger;
      maxDelay = Math.max(maxDelay, d);
      p.el.style.setProperty('--wd', d + 'ms');
      const b = bloomSet.get(p.iid);
      if (b) {
        p.stage = 'bloom';
        p.ready = false;
        p.el.classList.remove('ready');
        const next = document.createElement('div');
        next.className = 'art next';
        next.innerHTML = artSvg(p);
        p.el.querySelector('.sw').appendChild(next);
        p.el.classList.add('wavec');
        if (b.first) celebrateAt(p, d + (rm ? 100 : 650));
      } else {
        p.el.classList.add('waves');
      }
    });

    // bookkeeping only: promote the new art, drop wave classes. The tail
    // outlives the last celebration (--cd = d+650 + 1.4s petals), so a
    // first bloom is never cut off mid-sparkle.
    setTimeout(() => {
      plants.forEach(p => {
        const sw = p.el.querySelector('.sw');
        const next = sw.querySelector('.art.next');
        if (next) {
          sw.querySelector('.art.cur')?.remove();
          next.classList.remove('next');
          next.classList.add('cur');
        }
        p.el.classList.remove('wavec', 'waves');
        p.el.style.removeProperty('--wd');
        p.el.querySelectorAll('.celebfx').forEach(n => n.remove());
      });
      waveActive = false;
      pendingRefresh.forEach(iid => { const p = byIid(iid); if (p) renderPlantSvg(p); });
      pendingRefresh.clear();
      onDone?.();
    }, maxDelay + (rm ? 800 : 2300));
  }

  return {
    mount, focusOn, unfocus, swapFocal, updateStage, setReady, setBond,
    applyWave, focusedCenter, setSlotCount, addPlant,
    setPanEnabled(v) { panEnabled = v; },
    get focused() { return focused; },
    get waveActive() { return waveActive; },
    plantCount: () => plants.length,
  };
}
