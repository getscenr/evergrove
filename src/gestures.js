/*
 * Gestures — M2: the Tend All rain gesture (spec §5a).
 * Press-and-hold anywhere ≥400ms: rain swells from the touch point; release
 * triggers the bloom wave (scene.applyWave via the onRain callback).
 *
 * Single-pointer contract: only the pointer that started the hold can move,
 * cancel, or release it — a second resting finger must not fire the wave
 * early, steal the origin, or cancel the hold. Once rain begins the pointer
 * is captured so a release outside the stage (or window) still lands.
 *
 * Droplet positions/timings use Math.random — ephemeral VFX, not plant art;
 * the renderer's determinism rule doesn't apply here.
 */
import { CONFIG } from '../config.js';

export function createGestures({ stageEl, scene, onRain }) {
  let holdTimer = null;
  let activeId = null;   // pointerId that owns the current hold/rain
  let start = null;      // pointer-down position (client coords)
  let origin = null;     // rain origin in stage coords
  let raining = false;
  let fxEl = null;
  let suppressUntil = 0;

  stageEl.addEventListener('pointerdown', e => {
    if (scene.focused || raining || activeId !== null) return;
    activeId = e.pointerId;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(beginRain, CONFIG.rain.holdMs);
  });

  stageEl.addEventListener('pointermove', e => {
    if (e.pointerId !== activeId || !start || raining) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CONFIG.rain.moveCancelPx) cancelHold();
  });

  window.addEventListener('pointerup', e => {
    if (e.pointerId !== activeId) return;
    if (raining) endRain();
    else cancelHold();
  });
  window.addEventListener('pointercancel', e => {
    if (e.pointerId !== activeId) return;
    if (raining) endRain(true);
    else cancelHold();
  });
  // a lost pointer (window blur mid-hold) must never leave the rain stuck on
  window.addEventListener('blur', () => {
    if (raining) endRain(true);
    else cancelHold();
  });

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    start = null;
    activeId = null;
  }

  function beginRain() {
    if (!start) return;
    // wave still settling: keep the held press armed and start the moment
    // it clears — a hold begun during the wave tail must not die silently
    if (scene.waveActive) {
      holdTimer = setTimeout(beginRain, 120);
      return;
    }
    raining = true;
    scene.setPanEnabled(false);
    try { stageEl.setPointerCapture(activeId); } catch { /* pointer may be gone */ }
    const r = stageEl.getBoundingClientRect();
    origin = { x: start.x - r.left, y: start.y - r.top };
    spawnFx(origin);
  }

  function spawnFx(o) {
    fxEl = document.createElement('div');
    fxEl.className = 'rainfx';
    fxEl.style.left = o.x + 'px';
    fxEl.style.top = o.y + 'px';
    let inner = '<div class="mist"></div><div class="swell"></div><div class="swell" style="animation-delay:.55s"></div>';
    for (let i = 0; i < 20; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 18 + Math.random() * 95;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad * .55;
      const ds = (Math.random() * .7).toFixed(2);
      const dd = (.7 + Math.random() * .5).toFixed(2);
      inner += `<div class="drop" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;--ds:${ds}s;--dd:${dd}s"></div>`;
    }
    fxEl.innerHTML = inner;
    stageEl.appendChild(fxEl);
  }

  function endRain(aborted = false) {
    raining = false;
    try { stageEl.releasePointerCapture(activeId); } catch { /* already released */ }
    cancelHold();
    scene.setPanEnabled(true);
    suppressUntil = performance.now() + 400; // swallow the trailing click
    const el = fxEl;
    fxEl = null;
    if (el) {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 450);
    }
    if (!aborted && origin) onRain(origin);
    origin = null;
  }

  return {
    // main uses this to keep the post-rain click from opening a plant card
    suppressTap: () => raining || performance.now() < suppressUntil,
  };
}

/*
 * Focus Ring gesture recognizer (spec §5b) — swirl, droplets, prune, devote.
 *
 * A ring is ARMED from the plant card, so the recognizer always knows which
 * gesture to expect — that's what makes lenient thresholds safe. Forgiving
 * by design (cozy is the bar): imprecise thumbs assumed, generous tolerances
 * from config.gesture, a live guide shows progress during every attempt, and
 * a failed recognition costs nothing but an encouraging hint — completion is
 * the only thing that ever consumes a ring slot.
 */
export function createRingRecognizer({ stageEl, scene, onSuccess, onHint }) {
  const G = CONFIG.gesture;
  let armed = null;        // {ring, plant}
  let guideEl = null;
  let suppressUntil = 0;
  let activeId = null;

  // per-attempt state
  let center = null, lastAng = null, cum = 0;      // swirl / devote arc
  let dropTimer = null, drops = 0;                  // nurture
  let strokeStart = null, strokeMax = 0;            // prune stroke
  let swipes = 0, swipeWindowT0 = 0;                // prune count
  let devotePhase = null, devoteTimer = null;       // 'hold' | 'arc'

  const ARC_R = 62, ARC_C = 2 * Math.PI * ARC_R;

  /* ---------- guide overlay ---------- */
  function buildGuide() {
    removeGuide();
    const c = scene.focusedCenter();
    if (!c) return;
    center = { x: c.x, y: c.y };
    guideEl = document.createElement('div');
    guideEl.className = 'guide';
    guideEl.style.left = c.x + 'px';
    guideEl.style.top = c.y + 'px';
    const ring = armed.ring;
    if (ring === 'tend' || ring === 'devote') {
      guideEl.innerHTML = `
        <svg viewBox="0 0 160 160">
          <circle class="ghost" cx="80" cy="80" r="${ARC_R}"/>
          <circle class="prog" cx="80" cy="80" r="${ARC_R}"
            stroke-dasharray="${ARC_C.toFixed(1)}" stroke-dashoffset="${ARC_C.toFixed(1)}"/>
        </svg>`;
      if (ring === 'devote') guideEl.querySelector('.prog').classList.add('devhold');
    } else if (ring === 'nurture') {
      guideEl.innerHTML = `<div class="gdrops"><i></i><i></i><i></i></div>`;
    } else if (ring === 'cultivate') {
      guideEl.innerHTML = `
        <svg viewBox="0 0 160 160">
          <line class="cut c1" x1="46" y1="52" x2="114" y2="108"/>
          <line class="cut c2" x1="114" y1="52" x2="46" y2="108"/>
        </svg>`;
    }
    stageEl.appendChild(guideEl);
  }
  function removeGuide() {
    guideEl?.remove();
    guideEl = null;
  }
  function setArcProgress(frac) {
    const p = guideEl?.querySelector('.prog');
    if (p) p.style.strokeDashoffset = (ARC_C * (1 - Math.min(1, frac))).toFixed(1);
  }

  /* ---------- arming ---------- */
  function arm(ring, plant) {
    armed = { ring, plant };
    resetAttempt();
    swipes = 0;
    buildGuide();
  }
  function disarm() {
    armed = null;
    resetAttempt();
    removeGuide();
  }
  function resetAttempt() {
    lastAng = null;
    cum = 0;
    drops = 0;
    strokeStart = null;
    strokeMax = 0;
    devotePhase = null;
    clearInterval(dropTimer); dropTimer = null;
    clearTimeout(devoteTimer); devoteTimer = null;
    activeId = null;
    guideEl?.querySelectorAll('.gdrops i').forEach(i => i.classList.remove('on'));
    if (armed?.ring !== 'cultivate') setArcProgress(0);
  }

  /* ---------- shared swirl math ---------- */
  function angleAt(e) {
    const sr = stageEl.getBoundingClientRect();
    const dx = e.clientX - sr.left - center.x;
    const dy = e.clientY - sr.top - center.y;
    if (Math.hypot(dx, dy) < G.swirlMinRadiusPx) return null; // too close: ignore, don't fail
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }
  function accumulateArc(e, targetDeg) {
    const a = angleAt(e);
    if (a == null) return false;
    if (lastAng != null) {
      let d = a - lastAng;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      cum += d;
    }
    lastAng = a;
    setArcProgress(Math.abs(cum) / targetDeg);
    return Math.abs(cum) >= targetDeg;
  }

  /* ---------- droplet visual (nurture) ---------- */
  function landDrop() {
    drops++;
    const slots = guideEl?.querySelectorAll('.gdrops i');
    if (slots?.[drops - 1]) slots[drops - 1].classList.add('on');
    if (drops >= G.nurtureDrops) {
      clearInterval(dropTimer); dropTimer = null;
      succeed();
    }
  }

  function succeed() {
    const a = armed;
    suppressUntil = performance.now() + 420;
    disarm();
    onSuccess(a.ring, a.plant);
  }
  function softFail(hint) {
    resetAttempt();
    if (armed?.ring === 'cultivate' && swipes === 0) {
      guideEl?.querySelectorAll('.cut').forEach(l => l.classList.remove('on'));
    }
    onHint(hint);
  }

  /* ---------- pointer flow ---------- */
  stageEl.addEventListener('pointerdown', e => {
    if (!armed || activeId !== null) return;
    activeId = e.pointerId;
    suppressUntil = performance.now() + 60; // any armed press is gesture, not tap
    const ring = armed.ring;
    if (ring === 'tend') {
      lastAng = null; cum = 0;
    } else if (ring === 'nurture') {
      drops = 0;
      dropTimer = setInterval(landDrop, G.nurtureDropMs);
    } else if (ring === 'cultivate') {
      strokeStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      strokeMax = 0;
      if (swipes === 0) swipeWindowT0 = performance.now();
    } else if (ring === 'devote') {
      devotePhase = 'hold';
      guideEl?.querySelector('.prog')?.classList.add('filling');
      devoteTimer = setTimeout(() => {
        devotePhase = 'arc';
        lastAng = null; cum = 0;
        guideEl?.querySelector('.prog')?.classList.remove('filling', 'devhold');
        setArcProgress(0);
        onHint('now circle slowly — the ritual finishes with a swirl');
      }, G.devoteHoldMs);
    }
  });

  stageEl.addEventListener('pointermove', e => {
    if (!armed || e.pointerId !== activeId) return;
    const ring = armed.ring;
    if (ring === 'tend') {
      if (accumulateArc(e, G.swirlArcDeg)) succeed();
    } else if (ring === 'cultivate' && strokeStart) {
      strokeMax = Math.max(strokeMax, Math.hypot(e.clientX - strokeStart.x, e.clientY - strokeStart.y));
    } else if (ring === 'devote' && devotePhase === 'arc') {
      if (accumulateArc(e, G.devoteArcDeg)) succeed();
    }
  });

  function release(e) {
    if (!armed || e.pointerId !== activeId) return;
    const ring = armed.ring;
    activeId = null;
    suppressUntil = performance.now() + 350;
    if (ring === 'tend') {
      if (Math.abs(cum) >= G.swirlHintDeg) softFail('almost — keep circling a little further');
      else softFail('draw a slow circle around the plant');
    } else if (ring === 'nurture') {
      if (dropTimer) softFail(`hold still a moment — ${G.nurtureDrops} droplets`);
    } else if (ring === 'cultivate') {
      const dt = strokeStart ? performance.now() - strokeStart.t : 0;
      if (strokeStart && strokeMax >= G.pruneMinPx && dt <= G.pruneMaxMs) {
        swipes++;
        guideEl?.querySelector(swipes === 1 ? '.c1' : '.c2')?.classList.add('on');
        if (swipes >= 2) { swipes = 0; succeed(); return; }
        onHint('one more snip ✂');
        strokeStart = null;
        // both swipes must land within the (generous) window
        setTimeout(() => {
          if (armed?.ring === 'cultivate' && swipes === 1 && performance.now() - swipeWindowT0 >= G.pruneWindowMs) {
            swipes = 0;
            guideEl?.querySelectorAll('.cut').forEach(l => l.classList.remove('on'));
            onHint('two quick snips across the stem');
          }
        }, G.pruneWindowMs + 20);
      } else if (strokeStart) {
        softFail('a quick flick across the stem');
      }
    } else if (ring === 'devote') {
      if (devotePhase === 'hold') softFail('hold a little longer, then circle');
      else if (devotePhase === 'arc') softFail('almost — a slow half-circle finishes it');
    }
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  return {
    arm, disarm,
    get armed() { return armed; },
    suppressTap: () => armed !== null || performance.now() < suppressUntil,
  };
}
