/*
 * Pure game logic — time catch-up, offline accrual, the daily tend.
 * No DOM here; functions mutate the save state and return event summaries
 * the caller renders (legible generosity: every number surfaces in the UI).
 *
 * The daily cycle (spec §4, one judgment call logged in DECISIONS.md):
 *   seed --2h--> sprout --6h--> bud --(rain, once ≥12h old)--> bloom
 *   bloom --(day flip after its tended bloom-day)--> rest --(rain)--> bloom …
 * Rest applies at the day flip, not at tend time, so each day starts with a
 * rested grove and the daily rain re-blooms it in one wave.
 */
import { CONFIG } from '../config.js';
import { dayKeyOf, daysBetweenKeys } from './time.js';
import { pickUnownedFounder } from './rings.js';

const H = 3600000;

// Ready = will bloom at the next rain (drives the telegraph pulse).
export function isReady(p, nowMs) {
  if (p.stage === 'rest') return true;
  return p.stage === 'bud' && p.budAt != null && nowMs - p.budAt >= CONFIG.stage.budToBloomMinH * H;
}

/*
 * Advance every plant to where the clock says it should be. Safe to run any
 * time; no-ops when nothing changed. Returns iids whose stage changed.
 */
export function catchUp(state, nowMs) {
  const today = dayKeyOf(nowMs);
  const sproutAtMs = CONFIG.stage.seedToSproutH * H;
  const budAtMs = (CONFIG.stage.seedToSproutH + CONFIG.stage.sproutToBudH) * H;
  const changed = [];
  for (const p of state.plants) {
    const before = p.stage;
    if (p.stage === 'seed' && nowMs >= p.plantedAt + sproutAtMs) p.stage = 'sprout';
    if (p.stage === 'sprout' && nowMs >= p.plantedAt + budAtMs) {
      p.stage = 'bud';
      p.budAt = p.plantedAt + budAtMs; // idealized moment, not "when we noticed"
    }
    // a tended bloom rests once its bloom-day is over (forgiving: absence just
    // means you return to a rested grove and one rain wakes all of it)
    if (p.stage === 'bloom' && p.bloomDay && p.bloomDay < today) p.stage = 'rest';
    if (p.stage !== before) changed.push(p.iid);
  }
  return changed;
}

/*
 * Offline growth (spec §1/§4): plants keep growing while you're away.
 * Accrues per completed local day since the last collect, capped at
 * offlineCapDays — a warm welcome, not a jackpot or a punishment.
 */
export function collectOffline(state, nowMs) {
  const today = dayKeyOf(nowMs);
  if (!state.lastCollectDay) { state.lastCollectDay = today; return null; }
  const rawDays = daysBetweenKeys(state.lastCollectDay, today);
  if (rawDays <= 0 || state.plants.length === 0) {
    if (rawDays > 0) state.lastCollectDay = today;
    return null;
  }
  const days = Math.min(rawDays, CONFIG.offlineCapDays);
  const amount = days * CONFIG.economy.idleGrowthPerPlantPerDay * state.plants.length;
  state.growth += amount;
  state.lastCollectDay = today;
  return { days, amount, perPlantPerDay: CONFIG.economy.idleGrowthPerPlantPerDay, plantCount: state.plants.length, capped: rawDays > CONFIG.offlineCapDays };
}

/*
 * Tend All (spec §5a). Idempotent per local day: the first rain pays baseline
 * Growth per plant and marks the day tended; re-raining waters visually and
 * pays nothing new — but a bud that ripened since the last rain still blooms
 * (beauty is never withheld; it carries no currency).
 */
export function rainTend(state, nowMs) {
  const today = dayKeyOf(nowMs);
  const firstOfDay = state.lastTendDay !== today;
  const blooms = [];

  for (const p of state.plants) {
    if (p.stage === 'bud' && isReady(p, nowMs)) {
      p.stage = 'bloom';
      p.bloomDay = today;
      blooms.push({ iid: p.iid, first: !p.hasBloomed });
      p.hasBloomed = true;
    } else if (p.stage === 'rest') {
      p.stage = 'bloom';
      p.bloomDay = today;
      blooms.push({ iid: p.iid, first: false });
    }
  }

  let payout = 0;
  let shieldsUsed = 0;
  if (firstOfDay) {
    payout = CONFIG.economy.rainGrowthPerPlant * state.plants.length;
    state.growth += payout;
    state.lastTendDay = today;
    const s = state.streak;
    if (s.lastDay !== today) {
      if (!s.lastDay) {
        s.count = 1;
      } else {
        const gap = daysBetweenKeys(s.lastDay, today);
        const missed = gap - 1;
        if (gap === 1) {
          s.count += 1;
        } else if (missed > 0 && missed <= state.shields.available) {
          // a shield kept the streak warm — consumed silently, mentioned kindly
          state.shields.available -= missed;
          state.shields.lastUsed = { day: today, count: missed };
          shieldsUsed = missed;
          s.count += 1;
        } else {
          s.count = 1; // fresh start, never framed as loss (the bundle greets long lapses)
        }
      }
      s.lastDay = today;
    }
  }

  return {
    paid: firstOfDay,
    payout,
    perPlant: CONFIG.economy.rainGrowthPerPlant,
    plantCount: state.plants.length,
    blooms,
    shieldsUsed,
  };
}

/* ---------- habit surfaces (M4, spec §5d) ---------- */

// Shields refill automatically: 2 per week, week anchored at first play.
export function refillShields(state, nowMs) {
  const today = dayKeyOf(nowMs);
  let changed = false;
  while (daysBetweenKeys(state.shields.weekStart, today) >= 7) {
    state.shields.weekStart = dayKeyOf(new Date(state.shields.weekStart + 'T12:00').getTime() + 7 * 86400000);
    state.shields.available = CONFIG.shields.perWeek;
    changed = true;
  }
  return changed;
}

/*
 * Login calendar: one claim per distinct login day; missed days simply
 * don't advance the pointer (no catch-up pressure, no loss). Returns the
 * granted reward summary or null.
 */
export function claimCalendar(state, nowMs, catalog) {
  const today = dayKeyOf(nowMs);
  if (state.calendar.lastClaimDay === today) return null;
  const idx = state.calendar.index;
  const r = CONFIG.calendar[idx];
  const grant = { day: idx + 1, growth: 0, materials: 0, tokens: 0, seedId: null, chest: !!r.chest };
  const apply = spec => {
    if (spec.growth) { state.growth += spec.growth; grant.growth += spec.growth; }
    if (spec.materials) { state.materials += spec.materials; grant.materials += spec.materials; }
    if (spec.tokens) { state.tokens += spec.tokens; grant.tokens += spec.tokens; }
    if (spec.seed) grant.seedId = pickUnownedFounder(state, catalog); // collection pull, may be null
  };
  apply(r.chest || r);
  state.calendar.index = (idx + 1) % CONFIG.calendar.length;
  state.calendar.lastClaimDay = today;
  return grant;
}

/*
 * Welcome-back bundle (§5d): a lapse beyond lapseDays is greeted with a
 * gift — never compensation, never loss language. Call with the raw gap
 * BEFORE collectOffline advances lastCollectDay.
 */
export function welcomeBackBundle(state, rawGapDays, catalog) {
  if (rawGapDays <= CONFIG.welcomeBack.lapseDays) return null;
  state.materials += CONFIG.welcomeBack.materials;
  const seedId = CONFIG.welcomeBack.seed ? pickUnownedFounder(state, catalog) : null;
  return { materials: CONFIG.welcomeBack.materials, seedId, days: rawGapDays };
}

// Raw days since last visit — peek before collectOffline mutates.
export function daysAway(state, nowMs) {
  if (!state.lastCollectDay) return 0;
  return Math.max(0, daysBetweenKeys(state.lastCollectDay, dayKeyOf(nowMs)));
}

/* ---------- expansion (§6) ---------- */

export function nextSlotCost(state) {
  if (state.slots >= CONFIG.grove.maxSlots) return null;
  const n = state.slots + 1;
  return Math.round(CONFIG.expansion.baseCost * Math.pow(CONFIG.expansion.factor, n - (CONFIG.grove.startSlots + 1)));
}

export function buySlot(state) {
  const cost = nextSlotCost(state);
  if (cost == null || state.growth < cost) return null;
  state.growth -= cost;
  state.slots += 1;
  return { cost, slots: state.slots };
}

// Plant a satchel seed into an empty slot (§6). New plants start at seed.
export function plantSeed(state, seedId, slot, nowMs) {
  const i = state.satchel.indexOf(seedId);
  if (i === -1) return null;
  if (state.plants.some(p => p.slot === slot) || slot >= state.slots) return null;
  state.satchel.splice(i, 1);
  const plant = {
    iid: 'p' + state.nextIid++,
    seedId, slot,
    plantedAt: nowMs,
    stage: 'seed', budAt: null, bloomDay: null, hasBloomed: false,
    bond: 0, devStreak: 0, devLastDay: null, devoteCount: 0,
  };
  state.plants.push(plant);
  return plant;
}
