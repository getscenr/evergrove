/*
 * Catalog loading + persistence.
 *
 * One versioned JSON blob in localStorage (evergrove.save.v1, spec §7);
 * migrate-forward on version bump. A corrupted save is stashed aside (never
 * silently destroyed) and a fresh grove is started.
 */
import { CONFIG } from '../config.js';
import { now, todayKey } from './time.js';

export const SAVE_KEY = 'evergrove.save.v1';
const CORRUPT_KEY = 'evergrove.save.corrupt';
const H = 3600000;

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function loadCatalog() {
  const res = await fetch('data/founding45.json');
  if (!res.ok) throw new Error(`founding45.json failed to load (HTTP ${res.status})`);
  const list = await res.json();
  const byId = new Map(list.map(s => [slugify(s.name), s]));
  return { list, byId };
}

/* ---------- save blob ---------- */

export function loadSave() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const save = JSON.parse(raw);
    if (!save || typeof save !== 'object' || !Array.isArray(save.plants)) throw new Error('bad shape');
    switch (save.version) {
      case 1: migrateV1toV2(save); // falls through
      case 2: migrateV2toV3(save); // falls through
      case 3: return save;
      default: throw new Error(`unknown save version ${save.version}`);
    }
  } catch (e) {
    console.warn('Evergrove: save unreadable, starting fresh (old blob kept under ' + CORRUPT_KEY + ')', e);
    try { localStorage.setItem(CORRUPT_KEY, raw); } catch { /* ignore */ }
    return null;
  }
}

// v2 (M3): Bonds, per-plant devotion, the seed satchel, and the daily
// Focus Ring care block.
function migrateV1toV2(save) {
  save.plants.forEach(p => {
    p.bond = p.bond || 0;
    p.devStreak = p.devStreak || 0;
    p.devLastDay = p.devLastDay || null;
    p.devoteCount = p.devoteCount || 0;
  });
  save.satchel = save.satchel || [];
  save.care = save.care || null; // built lazily by ensureCareDay
  save.version = 2;
}

// v3 (M4): login calendar, streak shields, cosmetic token counter.
function migrateV2toV3(save) {
  save.calendar = save.calendar || { index: 0, lastClaimDay: null };
  save.shields = save.shields || { available: CONFIG.shields.perWeek, weekStart: todayKey(), lastUsed: null };
  save.tokens = save.tokens || 0;
  save.version = 3;
}

export function persist(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {
    console.warn('Evergrove: could not persist save', e);
  }
}

export function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/* ---------- first run ---------- */

/*
 * The "3 random founder seeds" (§6) are rolled ONCE here and stored on the
 * save (extraFounders) — a player's starting grove is stable across reloads.
 * Math.random is fine outside the renderer; the roll happens exactly once
 * per save and its result persists.
 */
function rollExtraFounders(catalog) {
  const pool = catalog.list.map(s => slugify(s.name)).filter(id => !CONFIG.starters.includes(id));
  const picks = [];
  while (picks.length < 3) {
    const c = pool[Math.floor(Math.random() * pool.length)];
    if (!picks.includes(c)) picks.push(c);
  }
  return picks;
}

export function createNewSave(catalog) {
  const t = now();
  const extra = rollExtraFounders(catalog);
  const seedIds = [...CONFIG.starters, ...extra];
  const plants = seedIds.map((seedId, i) => ({
    iid: 'p' + (i + 1),
    seedId,
    slot: i,
    // backdated so the first session shows the whole growth ladder; catchUp
    // derives the real stage from these on boot
    plantedAt: t - (CONFIG.startAgesH[i] || 0) * H,
    stage: 'seed',
    budAt: null,
    bloomDay: null,
    hasBloomed: false,
    bond: 0,
    devStreak: 0,
    devLastDay: null,
    devoteCount: 0,
  }));
  let reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  return {
    version: 3,
    createdAt: t,
    growth: 0,
    materials: 0,
    tokens: 0,
    slots: CONFIG.grove.startSlots,
    plants,
    extraFounders: extra,
    satchel: [],
    care: null, // daily Focus Ring block, built lazily by ensureCareDay
    calendar: { index: 0, lastClaimDay: null },
    shields: { available: CONFIG.shields.perWeek, weekStart: todayKey(), lastUsed: null },
    lastCollectDay: todayKey(),
    lastTendDay: null,
    streak: { count: 0, lastDay: null },
    nextIid: 9,
    settings: { reduceMotion },
  };
}

/* ---------- build mode (playtest vs dev) ---------- */

const MODE_KEY = 'evergrove.mode';

export function getMode() {
  try { return localStorage.getItem(MODE_KEY) || 'dev'; } catch { return 'dev'; }
}
export function setMode(mode) {
  try {
    if (mode === 'dev') localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, mode);
  } catch { /* ignore */ }
}
