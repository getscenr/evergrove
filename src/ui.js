/*
 * UI surfaces — M3: plant card with Focus Rings, gesture prompt strip,
 * Care Sheet (bottom sheet), toast queue. Codex arrives in M4.
 *
 * Legible generosity: every payout is itemized before AND after the
 * gesture; locked rings say why they're locked — no dead buttons.
 */
import { RING_ORDER, RING_LABELS, ringPayline } from './rings.js';
import { drawPlant } from './renderer.js';
import { CONFIG } from '../config.js';
import { slugify } from './state.js';

const RARITY_COLORS = { Common: '#5FC9C3', Uncommon: '#5FD08A', Rare: '#F2B84B' };
const BIOME_COLORS = {
  Meadow: '#F2B84B', Highland: '#B58BE0', Frostwood: '#6FA8E0',
  Wetland: '#5FC9C3', Tidepool: '#F07CA0', Emberflats: '#F0913F',
};
const STAGE_LABELS = { seed: 'Seed', sprout: 'Sprout', bud: 'In bud', bloom: 'In bloom', rest: 'Resting' };
const GESTURE_PROMPTS = {
  tend: 'draw a slow circle around the plant',
  nurture: 'press and hold — three droplets',
  cultivate: 'two quick snips across the stem',
  devote: 'hold for a breath… then circle slowly',
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createUI({ cardEl, sheetEl, toastsEl }) {
  /* ---------- toasts ---------- */
  const queue = [];
  let active = 0;
  function toast(text, { cls = '', ms = 2400 } = {}) {
    queue.push({ text, cls, ms });
    pump();
  }
  function pump() {
    if (active >= 2 || !queue.length) return;
    const t = queue.shift();
    active++;
    const el = document.createElement('div');
    el.className = 'toast ' + t.cls;
    el.textContent = t.text;
    toastsEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => {
      el.classList.remove('on');
      setTimeout(() => { el.remove(); active--; pump(); }, 400);
    }, t.ms);
  }

  /* ---------- plant card ---------- */
  // opts: {isFocal, bond:{lvl,next,have}, devStreak, rings:[{ring,status}],
  //        counters, onMakeFocal, onClose, onRing(ring), onRingInfo(status)}
  function showCard(plant, def, opts) {
    const rc = RARITY_COLORS[def.rarity] || '#5FC9C3';
    const bc = BIOME_COLORS[def.biome] || 'var(--green)';
    const flags = [
      def.cornerstone ? '<span class="flag cs">★ cornerstone</span>' : '',
      def.fruiting ? '<span class="flag frt">● fruiting</span>' : '',
      def.ancient ? '<span class="flag anc">◆ ancient</span>' : '',
    ].join('');
    const stageNote = plant.ready ? '<span class="ready-note">· ready to bloom at the next rain</span>' : '';
    const b = opts.bond;
    const bondLine = `Bond ${b.lvl ? 'L' + b.lvl : '—'}${b.next != null ? ` · ${b.have}/${b.next}` : ' · max'}`
      + (opts.devStreak ? ` &nbsp;·&nbsp; Devotion ● ${opts.devStreak}-day streak` : '');

    const ringBtns = opts.rings.map(({ ring, status }) => {
      const st = status.state;
      return `<button class="ring ${st}" data-ring="${ring}">
        <b>${RING_LABELS[ring]}</b>
        <span>${st === 'ready' ? esc(ringPayline(ring)) : esc(status.label)}</span>
      </button>`;
    }).join('');

    cardEl.classList.remove('gesturing');
    cardEl.innerHTML = `
      <button class="x" aria-label="Close">✕</button>
      <h2 class="${b.lvl >= 3 ? 'b3name' : ''}">${b.lvl >= 3 ? '✿ ' : ''}${esc(def.name)}</h2>
      <div class="crow">
        <span class="rar" style="color:${rc}">● ${esc(def.rarity)}</span>
        <span style="color:${bc}">${esc(def.biome)}</span>
        ${flags}
      </div>
      <div class="stage-line">Stage: <b>${STAGE_LABELS[plant.stage] || plant.stage}</b> ${stageNote}
        &nbsp;·&nbsp; ${bondLine}</div>
      <div class="rings-head">Focused care <span class="counters">${opts.counters}</span></div>
      <div class="rings">${ringBtns}</div>
      <div class="btns">
        <button class="btn pri" id="btnFocal" ${opts.isFocal ? 'disabled' : ''}>${opts.isFocal ? '★ Focal plant' : 'Make Focal'}</button>
      </div>`;
    cardEl.classList.add('show');
    cardEl.querySelector('.x').onclick = e => { e.stopPropagation(); opts.onClose?.(); };
    cardEl.querySelector('#btnFocal').onclick = e => { e.stopPropagation(); opts.onMakeFocal?.(); };
    cardEl.querySelectorAll('.ring').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const ring = btn.dataset.ring;
        const entry = opts.rings.find(r => r.ring === ring);
        if (entry.status.state === 'ready') opts.onRing?.(ring);
        else opts.onRingInfo?.(entry.status); // locked/done/cap still explain themselves
      };
    });
    cardEl.onclick = e => e.stopPropagation();
  }

  // Slim prompt while a gesture is armed — the plant stays visible above.
  function showGesturePrompt(ring, def, { onCancel }) {
    cardEl.classList.add('show', 'gesturing');
    cardEl.innerHTML = `
      <div class="gprompt">
        <div>
          <b>${RING_LABELS[ring]} · ${esc(def.name)}</b>
          <span id="ghint">${GESTURE_PROMPTS[ring]}</span>
        </div>
        <button class="x" aria-label="Cancel">✕</button>
      </div>`;
    cardEl.querySelector('.x').onclick = e => { e.stopPropagation(); onCancel?.(); };
    cardEl.onclick = e => e.stopPropagation();
  }
  function updateGestureHint(text) {
    const el = cardEl.querySelector('#ghint');
    if (el) el.textContent = text;
  }

  function hideCard() {
    cardEl.classList.remove('show', 'gesturing');
  }

  /* ---------- calendar strip (rewards visible before they're earned) ---------- */
  function calendarCell(spec, i, current, claimedToday) {
    const r = spec.chest || spec;
    const icon = spec.chest ? '🎁' : r.growth ? '✦' : r.materials ? '⬢' : '✿';
    const num = spec.chest ? `${r.growth}✦+${r.materials}⬢+🌱` : r.growth || r.materials || r.tokens;
    const cls = i === current ? (claimedToday ? 'cal now got' : 'cal now') : 'cal';
    return `<div class="${cls}"><i>${icon}</i><b>${num}</b><span>d${i + 1}</span></div>`;
  }

  /* ---------- Care Sheet (spec §5e) ---------- */
  // data: {tended, streak, shields:{available,lastUsed}, calendar:{index,claimedToday},
  //        care:{counts}, caps, growth, materials, tokens, satchelCount,
  //        slots, maxSlots, nextCost, reduceMotion, playtest}
  // handlers: {onToggleRM, onReset, onClose, onExpand, onOpenSatchel, onExport}
  function showSheet(data, handlers) {
    const ringRows = RING_ORDER.map(ring => {
      const used = data.care.counts[ring];
      const cap = data.caps[ring];
      const left = cap - used;
      const nest = ring === 'tend' ? '' : `<span class="nest">after ${RING_LABELS[RING_ORDER[RING_ORDER.indexOf(ring) - 1]]} on that plant</span>`;
      return `<div class="srow">
        <b>${RING_LABELS[ring]}</b>
        <span class="scount">${used}/${cap}</span>
        <span class="spay">${left > 0 ? `${left} left · ${esc(ringPayline(ring))}` : 'all used today — back tomorrow'}</span>
        ${nest}
      </div>`;
    }).join('');

    // shields: consumed silently, mentioned kindly (never guilt)
    const shieldNote = data.shields.lastUsed
      ? ` · a shield kept your streak warm (${data.shields.lastUsed.day})`
      : '';
    const calendarCells = CONFIG.calendar.map((c, i) =>
      calendarCell(c, i, data.calendar.index, data.calendar.claimedToday)).join('');
    // the pointer sits on the NEXT unclaimed day; if today is claimed it
    // already advanced, so highlight yesterday's claim implicitly via `got`
    const calNow = data.calendar.claimedToday
      ? CONFIG.calendar.map((c, i) => calendarCell(c, i, (data.calendar.index + CONFIG.calendar.length - 1) % CONFIG.calendar.length, true)).join('')
      : calendarCells;

    const groveRow = data.nextCost != null
      ? `<div class="srow"><b>Grove</b><span class="spay">${data.slots}/${data.maxSlots} slots · next slot costs ${data.nextCost} ✦</span>
           <button class="btn sec" id="shExpand" ${data.growth < data.nextCost ? 'disabled' : ''}>expand</button></div>`
      : `<div class="srow"><b>Grove</b><span class="spay">${data.slots}/${data.maxSlots} slots — the Phase 0 grove is full</span></div>`;

    sheetEl.innerHTML = `
      <button class="x" aria-label="Close">✕</button>
      <h2>Care Sheet</h2>
      <div class="ssec">
        <div class="srow"><b>Tend All</b><span class="spay">${data.tended ? '✓ tended today' : 'not yet — hold anywhere in the grove to rain'}</span></div>
        <div class="srow"><b>Streak</b><span class="spay">${data.streak} day${data.streak === 1 ? '' : 's'} · 🛡 ${data.shields.available} shield${data.shields.available === 1 ? '' : 's'}${shieldNote}</span></div>
      </div>
      <div class="ssec"><div class="stitle">Login calendar</div><div class="calstrip">${calNow}</div></div>
      <div class="ssec"><div class="stitle">Focus Rings today</div>${ringRows}</div>
      <div class="ssec">
        <div class="srow"><b>✦ Growth</b><span class="spay">${data.growth}</span></div>
        <div class="srow"><b>⬢ Materials</b><span class="spay">${data.materials}</span></div>
        <div class="srow"><b>✿ Tokens</b><span class="spay">${data.tokens} (cosmetic — later phases)</span></div>
        <div class="srow"><b>🌱 Satchel</b><span class="spay">${data.satchelCount} seed${data.satchelCount === 1 ? '' : 's'} waiting</span>
          ${data.satchelCount ? '<button class="btn sec" id="shSatchel">open</button>' : ''}</div>
        ${groveRow}
      </div>
      <div class="ssec">
        <div class="stitle">Settings</div>
        <div class="srow"><b>Reduce motion</b><button class="btn sec" id="shRM">${data.reduceMotion ? 'on' : 'off'}</button></div>
        ${data.playtest ? '<div class="srow"><b>Playtest log</b><button class="btn sec" id="shExport">export</button></div>' : ''}
        <div class="srow"><b>Reset grove</b><button class="btn sec" id="shReset">reset…</button></div>
        ${data.playtest ? '<div class="srow"><span class="spay">playtest build · thank you for growing with us 🌿</span></div>' : ''}
      </div>`;
    sheetEl.classList.add('show');
    sheetEl.querySelector('.x').onclick = e => { e.stopPropagation(); handlers.onClose?.(); };
    sheetEl.querySelector('#shRM').onclick = e => { e.stopPropagation(); handlers.onToggleRM?.(); };
    sheetEl.querySelector('#shExpand')?.addEventListener('click', e => { e.stopPropagation(); handlers.onExpand?.(); });
    sheetEl.querySelector('#shSatchel')?.addEventListener('click', e => { e.stopPropagation(); handlers.onOpenSatchel?.(); });
    sheetEl.querySelector('#shExport')?.addEventListener('click', e => { e.stopPropagation(); handlers.onExport?.(); });
    const resetBtn = sheetEl.querySelector('#shReset');
    let armedReset = false;
    resetBtn.onclick = e => {
      e.stopPropagation();
      if (!armedReset) {
        armedReset = true;
        resetBtn.textContent = 'tap again to confirm';
        setTimeout(() => { armedReset = false; resetBtn.textContent = 'reset…'; }, 2600);
      } else {
        handlers.onReset?.();
      }
    };
    sheetEl.onclick = e => e.stopPropagation();
  }
  function hideSheet() {
    sheetEl.classList.remove('show');
  }

  /* ---------- satchel picker (§6) ---------- */
  // seeds: [{seedId, def, count}] · slotIdx: target slot or null (browse)
  function showSatchel(seeds, slotIdx, { onPick, onClose }) {
    const rows = seeds.length ? seeds.map(s => `
      <button class="seedrow" data-seed="${s.seedId}">
        <span class="sthumb">${drawPlant(s.def.render, { stage: 'bloom', id: 'satchel-' + s.seedId })}</span>
        <span class="sinfo"><b>${esc(s.def.name)}</b><i>${esc(s.def.biome)} · ${esc(s.def.rarity)}${s.count > 1 ? ` · ×${s.count}` : ''}</i></span>
        <span class="sgo">${slotIdx != null ? 'plant →' : ''}</span>
      </button>`).join('')
      : '<div class="spay" style="padding:8px 2px">No seeds yet — Devote gifts and the calendar bring them 🌱</div>';
    sheetEl.innerHTML = `
      <button class="x" aria-label="Close">✕</button>
      <h2>Seed Satchel</h2>
      <div class="stitle" style="margin-bottom:8px">${slotIdx != null ? 'choose a seed for the new spot' : `${seeds.reduce((a, s) => a + s.count, 0)} seed${seeds.length === 1 ? '' : 's'} waiting`}</div>
      ${rows}`;
    sheetEl.classList.add('show');
    sheetEl.querySelector('.x').onclick = e => { e.stopPropagation(); onClose?.(); };
    sheetEl.querySelectorAll('.seedrow').forEach(b => {
      b.onclick = e => { e.stopPropagation(); onPick?.(b.dataset.seed); };
    });
    sheetEl.onclick = e => e.stopPropagation();
  }

  /* ---------- mini-Codex (§6) ---------- */
  // states: {seedId: 'bloomed'|'planted'|'owned'|null}
  function renderCodex(codexEl, catalog, states) {
    const chips = { bloomed: '<span class="cchip bl">✿ bloomed</span>', planted: '<span class="cchip pl">planted</span>', owned: '<span class="cchip ow">🌱 seed</span>' };
    const counts = { bloomed: 0, planted: 0, owned: 0 };
    const rows = catalog.list.map(def => {
      const id = slugify(def.name);
      const st = states[id];
      if (st) counts[st]++;
      return `<div class="crow2 ${st || 'unknown'}">
        <span class="cthumb">${drawPlant(def.render, { stage: 'bloom', id: 'codex-' + id })}</span>
        <span class="cinfo"><b>${st ? esc(def.name) : '???'}</b><i>${esc(def.biome)}${st ? ' · ' + esc(def.rarity) : ''}</i></span>
        ${st ? chips[st] : '<span class="cchip un">unmet</span>'}
      </div>`;
    }).join('');
    const discovered = counts.bloomed + counts.planted + counts.owned;
    codexEl.innerHTML = `
      <div class="chead">
        <h2>Codex — the Founding 45</h2>
        <span>${discovered}/45 discovered · ${counts.bloomed} bloomed</span>
      </div>
      <div class="clist">${rows}</div>`;
  }

  return {
    showCard, hideCard, showGesturePrompt, updateGestureHint,
    showSheet, hideSheet, showSatchel, renderCodex, toast,
  };
}
