/*
 * Focus Rings — pure logic (spec §5b/§5c). No DOM here.
 *
 * Nesting: Devote ⊆ Cultivate ⊆ Nurture ⊆ Tend, per plant, per day.
 * Caps (10/5/3/1) are global across the grove; completions are tracked per
 * plant so deeper rings unlock only on plants that received the shallower
 * one today. Completing a gesture is the ONLY thing that consumes a slot —
 * failed recognitions never reach this module.
 */
import { CONFIG } from '../config.js';
import { dayKeyOf, daysBetweenKeys } from './time.js';
import { slugify } from './state.js';

export const RING_ORDER = ['tend', 'nurture', 'cultivate', 'devote'];
export const RING_LABELS = { tend: 'Tend', nurture: 'Nurture', cultivate: 'Cultivate', devote: 'Devote' };

// One-line payout descriptions — shown BEFORE the gesture (legible generosity).
export function ringPayline(ring) {
  const c = CONFIG.rings[ring];
  const bits = [`+${c.growth} Growth`, `+${c.bond} Bond`];
  if (c.materialChance) bits.push(`${Math.round(c.materialChance * 100)}% chance +1 Material`);
  if (c.gift) bits.push('a gift (seed or Materials)');
  return bits.join(' · ');
}

// Reset the daily care block when the local day changes.
export function ensureCareDay(state, today) {
  if (!state.care || state.care.day !== today) {
    state.care = { day: today, counts: { tend: 0, nurture: 0, cultivate: 0, devote: 0 }, perPlant: {} };
  }
  return state.care;
}

export function ringsDoneOn(state, iid, today) {
  return ensureCareDay(state, today).perPlant[iid] || [];
}

/*
 * Availability of one ring on one plant:
 *   ready | done (this plant, today) | cap (grove-wide today) | locked (nesting)
 * `label` is always human-readable — no dead buttons, every state says why.
 */
export function ringStatus(state, plant, ring, today) {
  const care = ensureCareDay(state, today);
  const cfg = CONFIG.rings[ring];
  const done = ringsDoneOn(state, plant.iid, today);
  if (done.includes(ring)) return { state: 'done', label: '✓ done on this plant today' };
  if (care.counts[ring] >= cfg.cap) return { state: 'cap', label: `all ${cfg.cap} used today — back tomorrow` };
  const idx = RING_ORDER.indexOf(ring);
  if (idx > 0) {
    const prev = RING_ORDER[idx - 1];
    if (!done.includes(prev)) {
      return { state: 'locked', prev, label: `unlocks after ${RING_LABELS[prev]} on this plant` };
    }
  }
  return { state: 'ready', label: ringPayline(ring) };
}

export function bondLevel(bond) {
  const L = CONFIG.bonds.levels;
  let lvl = 0;
  for (let i = 0; i < L.length; i++) if (bond >= L[i]) lvl = i + 1;
  return lvl;
}
export function bondProgress(bond) {
  const L = CONFIG.bonds.levels;
  const lvl = bondLevel(bond);
  if (lvl >= L.length) return { lvl, next: null };
  return { lvl, next: L[lvl], have: bond };
}

/*
 * The collection pull (§6): pick a founder seed weighted toward ones you
 * don't own — used by Devote gifts, the day-7 calendar chest, and the
 * welcome-back bundle. Returns a seedId (added to the satchel) or null when
 * every founder is owned. Math.random is fine outside the renderer.
 */
export function pickUnownedFounder(state, catalog) {
  const owned = new Set([...state.plants.map(p => p.seedId), ...state.satchel]);
  const unowned = catalog.list.map(s => slugify(s.name)).filter(id => !owned.has(id));
  if (!unowned.length) return null;
  const seedId = unowned[Math.floor(Math.random() * unowned.length)];
  state.satchel.push(seedId);
  return seedId;
}

// Devote's guaranteed gift (§5b): a seed while unowned founders remain,
// Materials once the collection is complete.
function rollGift(state, catalog) {
  const seedId = pickUnownedFounder(state, catalog);
  if (seedId) return { type: 'seed', seedId };
  state.materials += CONFIG.rings.devote.giftMaterials;
  return { type: 'materials', amount: CONFIG.rings.devote.giftMaterials };
}

/*
 * Apply a completed ring gesture. Returns an exact reward summary for the
 * toast — every number surfaced, nothing hidden.
 */
export function completeRing(state, plant, ring, nowMs, catalog) {
  const today = dayKeyOf(nowMs);
  const status = ringStatus(state, plant, ring, today);
  if (status.state !== 'ready') return null; // defensive; UI never offers non-ready rings
  const cfg = CONFIG.rings[ring];
  const care = state.care;

  care.counts[ring]++;
  (care.perPlant[plant.iid] = care.perPlant[plant.iid] || []).push(ring);

  state.growth += cfg.growth;
  const before = bondLevel(plant.bond);
  plant.bond += cfg.bond;
  const after = bondLevel(plant.bond);

  let material = false;
  if (cfg.materialChance && Math.random() < cfg.materialChance) {
    state.materials += 1;
    material = true;
  }

  let gift = null;
  if (cfg.gift) {
    gift = rollGift(state, catalog);
    plant.devoteCount = (plant.devoteCount || 0) + 1;
    // per-plant devotion streak (§5c: recorded and shown on the card)
    if (plant.devLastDay !== today) {
      plant.devStreak = (plant.devLastDay && daysBetweenKeys(plant.devLastDay, today) === 1)
        ? (plant.devStreak || 0) + 1 : 1;
      plant.devLastDay = today;
    }
  }

  return {
    ring, growth: cfg.growth, bond: cfg.bond, material, gift,
    levelUp: after > before ? { from: before, to: after } : null,
    counts: { ...care.counts },
  };
}
