/*
 * Bootstrap: load catalog + save, catch the clock up, collect offline growth,
 * greet (calendar / welcome-back), mount the scene, wire everything.
 */
import { CONFIG } from '../config.js';
import { loadCatalog, loadSave, createNewSave, persist, resetSave, getMode, setMode, slugify } from './state.js';
import {
  catchUp, collectOffline, rainTend, isReady,
  refillShields, claimCalendar, welcomeBackBundle, daysAway,
  nextSlotCost, buySlot, plantSeed,
} from './loop.js';
import { ringStatus, completeRing, ensureCareDay, bondLevel, bondProgress, RING_ORDER, RING_LABELS } from './rings.js';
import { now, todayKey, getDevOffset, setDevOffset } from './time.js';
import { createScene } from './scene.js';
import { createUI } from './ui.js';
import { createGestures, createRingRecognizer } from './gestures.js';
import { createPtLog, clearPtLog } from './ptlog.js';

function applyReduceMotion(on) {
  document.body.classList.toggle('rm', !!on);
}

/*
 * Playtest build mode (M4 directive 4): first visit with ?playtest=1 locks
 * the mode, asserts a fresh save + zero clock offset, and reloads clean.
 * Re-visiting with the same bookmarked URL never wipes a tester's grove.
 * ?playtest=0 returns to dev mode.
 */
function handleModeParams() {
  const params = new URLSearchParams(location.search);
  if (params.get('playtest') === '1' && getMode() !== 'playtest') {
    setMode('playtest');
    resetSave();
    setDevOffset(0);
    clearPtLog();
    location.replace(location.pathname);
    return true;
  }
  if (params.get('playtest') === '0' && getMode() === 'playtest') {
    setMode('dev');
    location.replace(location.pathname);
    return true;
  }
  return false;
}

async function boot() {
  if (handleModeParams()) return;
  const playtest = getMode() === 'playtest';
  if (playtest && getDevOffset() !== 0) setDevOffset(0); // assert honest clock

  const catalog = await loadCatalog();
  const ptlog = createPtLog(playtest);

  let save = loadSave();
  if (!save) {
    save = createNewSave(catalog);
    persist(save);
  }
  applyReduceMotion(save.settings.reduceMotion);

  refillShields(save, now());
  catchUp(save, now());
  const rawGap = daysAway(save, now());
  const collected = collectOffline(save, now());
  const bundle = welcomeBackBundle(save, rawGap, catalog);
  const calGrant = claimCalendar(save, now(), catalog);
  persist(save);

  const ui = createUI({
    cardEl: document.getElementById('card'),
    sheetEl: document.getElementById('sheet'),
    toastsEl: document.getElementById('toasts'),
  });

  let rain = null;
  let recognizer = null;

  const scene = createScene({
    stageEl: document.getElementById('stage'),
    camEl: document.getElementById('cam'),
    hintEl: document.getElementById('hint'),
    onPlantTap: p => {
      if (rain?.suppressTap() || recognizer?.suppressTap()) return;
      scene.focusOn(p);
      showPlantCard(p);
    },
    onBackdropTap: () => {
      if (recognizer?.suppressTap()) return;
      close();
    },
    onEmptySlotTap: slotIdx => {
      if (rain?.suppressTap() || recognizer?.suppressTap()) return;
      openSatchel(slotIdx);
    },
    onSlotsChanged: list => {
      for (const { iid, slot } of list) {
        const sp = save.plants.find(x => x.iid === iid);
        if (sp) sp.slot = slot;
      }
      persist(save);
    },
  });

  function close() {
    recognizer?.disarm();
    scene.unfocus();
    ui.hideCard();
  }

  scene.mount({
    slots: save.slots,
    plants: save.plants.map(p => ({
      iid: p.iid, seedId: p.seedId, slot: p.slot, stage: p.stage, ready: isReady(p, now()),
    })),
  }, catalog);
  save.plants.forEach(p => scene.setBond(p.iid, bondLevel(p.bond)));

  const chip = document.getElementById('chip');
  const satchelBtn = document.getElementById('satchelBtn');
  function updateChip() {
    chip.textContent = `✦ ${save.growth} Growth`;
  }
  function updateSatchelBadge() {
    satchelBtn.hidden = save.satchel.length === 0;
    satchelBtn.textContent = `🌱 ${save.satchel.length}`;
  }
  updateChip();
  updateSatchelBadge();
  document.getElementById('subtitle').textContent = `Phase 0 · ${save.plants.length} plants`;

  /* ---------- greeting toasts (in arrival order) ---------- */
  function collectToastText(c, live = false) {
    const days = `${c.days} day${c.days > 1 ? 's' : ''}`;
    if (c.capped) return `Welcome back ✦ +${c.amount} Growth (${c.plantCount} plants × ${c.perPlantPerDay} × ${c.days} days — growth saved for you)`;
    if (live && c.days === 1) return `A new day in the grove ✦ +${c.amount} Growth (${c.plantCount} plants × ${c.perPlantPerDay})`;
    return `While you were away ✦ +${c.amount} Growth (${c.plantCount} plants × ${c.perPlantPerDay} × ${days})`;
  }
  function calendarToast(g) {
    if (!g) return;
    const bits = [];
    if (g.growth) bits.push(`+${g.growth} Growth`);
    if (g.materials) bits.push(`+${g.materials} Materials`);
    if (g.tokens) bits.push(`+${g.tokens} ✿ Token (cosmetic)`);
    if (g.seedId) bits.push(`${catalog.byId.get(g.seedId).name} seed 🌱`);
    ui.toast(`${g.chest ? 'Day-7 chest 🎁' : `Calendar day ${g.day} 🗓`} ${bits.join(' · ')}`, g.chest ? { cls: 'gold', ms: 3200 } : {});
    updateSatchelBadge();
  }
  if (collected) ui.toast(collectToastText(collected));
  if (bundle) {
    const bits = [`+${bundle.materials} Materials`];
    if (bundle.seedId) bits.unshift(`${catalog.byId.get(bundle.seedId).name} seed 🌱`);
    ui.toast(`The grove missed you 🌿 a gift: ${bits.join(' · ')}`, { cls: 'gold', ms: 3600 });
  }
  calendarToast(calGrant);
  updateChip();
  updateSatchelBadge();

  if (!playtest && getDevOffset() !== 0 && !new URLSearchParams(location.search).has('dev')) {
    ui.toast(`Dev clock offset active (${(getDevOffset() / 3600000).toFixed(1)}h) — open ?dev=1 to reset`, { ms: 4200 });
  }

  /* ---------- plant card + Focus Rings ---------- */
  function counterString() {
    const c = ensureCareDay(save, todayKey()).counts;
    const R = CONFIG.rings;
    return `${c.tend}/${R.tend.cap} · ${c.nurture}/${R.nurture.cap} · ${c.cultivate}/${R.cultivate.cap} · ${c.devote ? '●' : '○'}`;
  }

  function showPlantCard(viewP) {
    const sp = save.plants.find(x => x.iid === viewP.iid);
    const today = todayKey();
    ui.showCard(viewP, viewP.def, {
      isFocal: viewP.slot === 0,
      bond: bondProgress(sp.bond),
      devStreak: sp.devStreak || 0,
      counters: counterString(),
      rings: RING_ORDER.map(ring => ({ ring, status: ringStatus(save, sp, ring, today) })),
      onMakeFocal: () => { close(); scene.swapFocal(viewP); },
      onClose: close,
      onRing: ring => {
        ui.showGesturePrompt(ring, viewP.def, {
          onCancel: () => { recognizer.disarm(); showPlantCard(viewP); },
        });
        recognizer.arm(ring, viewP);
      },
      onRingInfo: status => ui.toast(status.label),
    });
  }

  recognizer = createRingRecognizer({
    stageEl: document.getElementById('stage'),
    scene,
    onSuccess: (ring, viewP) => {
      const sp = save.plants.find(x => x.iid === viewP.iid);
      const res = completeRing(save, sp, ring, now(), catalog);
      if (!res) { showPlantCard(viewP); return; }
      persist(save);
      ptlog.ring(ring);
      const bits = [`+${res.growth} Growth`, `+${res.bond} Bond`];
      if (res.material) bits.push('+1 Material ✨');
      if (res.gift?.type === 'seed') bits.push(`gift: ${catalog.byId.get(res.gift.seedId).name} seed 🌱`);
      if (res.gift?.type === 'materials') bits.push(`gift: +${res.gift.amount} Materials`);
      ui.toast(`${RING_LABELS[ring]} · ${viewP.def.name} · ${bits.join(' · ')}`, { ms: 2200 });
      if (res.levelUp) {
        scene.setBond(viewP.iid, res.levelUp.to);
        const perks = { 1: 'a soft sheen', 2: 'richer blooms', 3: 'sparkles + a name flourish' };
        ui.toast(`✿ ${viewP.def.name} reached Bond L${res.levelUp.to} — ${perks[res.levelUp.to]}`, { cls: 'gold', ms: 3000 });
      }
      updateChip();
      updateSatchelBadge();
      showPlantCard(viewP);
    },
    onHint: text => ui.updateGestureHint(text),
  });

  /* ---------- satchel + planting (§6) ---------- */
  function groupedSeeds() {
    const counts = new Map();
    save.satchel.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    return [...counts.entries()].map(([seedId, count]) => ({ seedId, count, def: catalog.byId.get(seedId) }));
  }
  function firstEmptySlot() {
    const occupied = new Set(save.plants.map(p => p.slot));
    for (let i = 0; i < save.slots; i++) if (!occupied.has(i)) return i;
    return null;
  }
  function openSatchel(slotIdx = null) {
    if (!save.satchel.length) {
      ui.toast('No seeds yet — Devote gifts and the calendar bring them 🌱');
      return;
    }
    ui.showSatchel(groupedSeeds(), slotIdx, {
      onClose: () => ui.hideSheet(),
      onPick: seedId => {
        const target = slotIdx != null ? slotIdx : firstEmptySlot();
        if (target == null) {
          ui.toast('No empty spots — expand the grove from the Care Sheet 🌿');
          return;
        }
        const sp = plantSeed(save, seedId, target, now());
        if (!sp) return;
        persist(save);
        ptlog.planted();
        scene.addPlant({ iid: sp.iid, seedId: sp.seedId, slot: sp.slot, stage: sp.stage, ready: false });
        ui.hideSheet();
        ui.toast(`${catalog.byId.get(seedId).name} planted 🌱 — a sprout in ~${CONFIG.stage.seedToSproutH}h`);
        updateSatchelBadge();
        document.getElementById('subtitle').textContent = `Phase 0 · ${save.plants.length} plants`;
      },
    });
  }
  satchelBtn.onclick = () => openSatchel(null);

  /* ---------- Care Sheet ---------- */
  function exportLog() {
    const data = ptlog.export();
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `evergrove-playtest-${todayKey()}.json`;
      a.click();
    } catch { /* some mobile browsers */ }
    navigator.clipboard?.writeText(json).catch(() => { });
    ui.toast('Playtest log exported 📋 (file + clipboard)');
  }

  function openSheet() {
    ensureCareDay(save, todayKey());
    ui.showSheet({
      tended: save.lastTendDay === todayKey(),
      streak: save.streak.count,
      shields: save.shields,
      calendar: { index: save.calendar.index, claimedToday: save.calendar.lastClaimDay === todayKey() },
      care: save.care,
      caps: Object.fromEntries(RING_ORDER.map(r => [r, CONFIG.rings[r].cap])),
      growth: save.growth,
      materials: save.materials,
      tokens: save.tokens,
      satchelCount: save.satchel.length,
      slots: save.slots,
      maxSlots: CONFIG.grove.maxSlots,
      nextCost: nextSlotCost(save),
      reduceMotion: save.settings.reduceMotion,
      playtest,
    }, {
      onClose: () => ui.hideSheet(),
      onToggleRM: () => {
        save.settings.reduceMotion = !save.settings.reduceMotion;
        persist(save);
        applyReduceMotion(save.settings.reduceMotion);
        openSheet();
      },
      onExpand: () => {
        const r = buySlot(save);
        if (!r) return;
        persist(save);
        scene.setSlotCount(save.slots);
        ui.toast(`Grove expanded 🌿 spot ${r.slots} is ready · −${r.cost} Growth`);
        updateChip();
        openSheet();
      },
      onOpenSatchel: () => openSatchel(null),
      onExport: exportLog,
      onReset: () => { resetSave(); location.reload(); },
    });
  }
  document.getElementById('careBtn').onclick = openSheet;

  /* ---------- mini-Codex (§6) ---------- */
  const codexEl = document.getElementById('codex');
  const navGrove = document.getElementById('navGrove');
  const navCodex = document.getElementById('navCodex');
  function codexStates() {
    const st = {};
    for (const def of catalog.list) {
      const id = slugify(def.name);
      if (save.plants.some(p => p.seedId === id && p.hasBloomed)) st[id] = 'bloomed';
      else if (save.plants.some(p => p.seedId === id)) st[id] = 'planted';
      else if (save.satchel.includes(id)) st[id] = 'owned';
      else st[id] = null;
    }
    return st;
  }
  function showCodex() {
    close();
    ui.hideSheet();
    ui.renderCodex(codexEl, catalog, codexStates());
    codexEl.classList.add('show');
    navCodex.classList.add('on');
    navGrove.classList.remove('on');
  }
  function showGrove() {
    codexEl.classList.remove('show');
    navGrove.classList.add('on');
    navCodex.classList.remove('on');
  }
  navCodex.onclick = showCodex;
  navGrove.onclick = showGrove;

  /* ---------- clock sync (tick + pre-rain) ---------- */
  function syncClock({ live = true } = {}) {
    refillShields(save, now());
    const changed = catchUp(save, now());
    const gap = daysAway(save, now());
    const c = collectOffline(save, now());
    const b = welcomeBackBundle(save, gap, catalog);
    const g = claimCalendar(save, now(), catalog);
    if (changed.length || c || b || g) {
      persist(save);
      changed.forEach(iid => {
        const p = save.plants.find(x => x.iid === iid);
        scene.updateStage(iid, p.stage, isReady(p, now()));
      });
      if (c) ui.toast(collectToastText(c, live));
      if (b) {
        const bits = [`+${b.materials} Materials`];
        if (b.seedId) bits.unshift(`${catalog.byId.get(b.seedId).name} seed 🌱`);
        ui.toast(`The grove missed you 🌿 a gift: ${bits.join(' · ')}`, { cls: 'gold', ms: 3600 });
      }
      calendarToast(g);
      updateChip();
      updateSatchelBadge();
    }
    save.plants.forEach(p => scene.setReady(p.iid, isReady(p, now())));
    ptlog.heartbeat();
  }

  /* ---------- the rain ---------- */
  rain = createGestures({
    stageEl: document.getElementById('stage'),
    scene,
    onRain: origin => {
      syncClock();
      const res = rainTend(save, now());
      persist(save);
      ptlog.rain(save.streak.count);
      scene.applyWave(origin, res.blooms);
      if (res.paid) {
        ui.toast(`+${res.payout} Growth · ${res.plantCount} plants × ${res.perPlant} · day tended ✓`);
      } else if (!res.blooms.length) {
        ui.toast('Already tended today — the grove loved the extra rain');
      }
      if (res.shieldsUsed) {
        ui.toast(`🛡 A shield kept your streak warm — day ${save.streak.count} continues`, { cls: 'gold', ms: 3000 });
      }
      const firsts = res.blooms.filter(b => b.first);
      if (firsts.length) {
        const names = firsts
          .map(f => catalog.byId.get(save.plants.find(p => p.iid === f.iid).seedId).name)
          .join(' & ');
        ui.toast(`✿ First bloom${firsts.length > 1 ? 's' : ''} — ${names}!`, { cls: 'gold', ms: 3400 });
      }
      updateChip();
    },
  });

  setInterval(syncClock, CONFIG.tickMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ptlog.heartbeat();
    else syncClock(); // resumed tab: land the day flip before any input
  });
  ptlog.sessionStart();

  /* ---------- dev panel (?dev=1, never in playtest builds) ---------- */
  if (!playtest && new URLSearchParams(location.search).has('dev')) {
    const { initDevPanel } = await import('./dev.js');
    initDevPanel({ save, persist, onToggleReduceMotion: applyReduceMotion });
  }
}

boot().catch(err => {
  const el = document.getElementById('boot-note');
  el.hidden = false;
  el.textContent = `Couldn't start the grove: ${err.message}. Serve this folder (npx serve) rather than opening the file directly.`;
});
