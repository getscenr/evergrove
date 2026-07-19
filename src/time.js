/*
 * The clock. Local time only (spec §4) — a "day" flips at local midnight.
 *
 * Every module reads time through now(), never Date.now() directly, so the
 * dev time-travel control (?dev=1) can shift the whole game's clock. The dev
 * offset persists separately from the save (evergrove.devclock.v1) so a
 * shifted clock survives reloads — acceptance §12.4 tests clock manipulation
 * across sessions.
 */
const DEV_KEY = 'evergrove.devclock.v1';

let offset = 0;
try { offset = Number(localStorage.getItem(DEV_KEY)) || 0; } catch { /* private mode etc. */ }

export function now() { return Date.now() + offset; }

export function getDevOffset() { return offset; }
export function setDevOffset(ms) {
  offset = ms;
  try { localStorage.setItem(DEV_KEY, String(ms)); } catch { /* ignore */ }
}

// Local-date day key, e.g. "2026-07-17". Uses date components, so DST is safe.
export function dayKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayKey() { return dayKeyOf(now()); }

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Whole local days from key a to key b (positive if b is later).
// Rounding absorbs the ±1h DST wobble.
export function daysBetweenKeys(a, b) {
  return Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
}
