/*
 * Playtest instrumentation (spec §8) — local only, no network, no SDK.
 * Enabled in playtest mode; the export button in the Care Sheet is the
 * entire pipeline. Logs: sessions (start/length), per-day rain + ring
 * usage by type + plants planted + streak; D1/D7 derived at export.
 */
import { now, todayKey } from './time.js';

const KEY = 'evergrove.ptlog.v1';

export function createPtLog(enabled) {
  let log = null;
  if (enabled) {
    try { log = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { log = null; }
    if (!log || !Array.isArray(log.sessions)) {
      log = { createdAt: now(), firstDay: todayKey(), sessions: [], days: {} };
    }
  }

  function write() {
    if (!log) return;
    try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* ignore */ }
  }
  function day() {
    const k = todayKey();
    if (!log.days[k]) log.days[k] = { rain: false, rings: { tend: 0, nurture: 0, cultivate: 0, devote: 0 }, planted: 0, streak: 0 };
    return log.days[k];
  }

  const api = {
    enabled: !!log,
    sessionStart() {
      if (!log) return;
      log.sessions.push({ start: now(), end: now() });
      day();
      write();
    },
    heartbeat() { // called from the 30s tick + visibility hidden
      if (!log || !log.sessions.length) return;
      log.sessions[log.sessions.length - 1].end = now();
      write();
    },
    rain(streakCount) {
      if (!log) return;
      const d = day();
      d.rain = true;
      d.streak = streakCount;
      write();
    },
    ring(type) {
      if (!log) return;
      day().rings[type] = (day().rings[type] || 0) + 1;
      write();
    },
    planted() {
      if (!log) return;
      day().planted++;
      write();
    },
    export() {
      if (!log) return null;
      const dayKeys = Object.keys(log.days).sort();
      const opened = new Set(dayKeys);
      const addDays = (key, n) => {
        const [y, m, d] = key.split('-').map(Number);
        const t = new Date(y, m - 1, d, 12).getTime() + n * 86400000;
        const dt = new Date(t);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };
      const sessions = log.sessions.map(s => ({ ...s, minutes: +((s.end - s.start) / 60000).toFixed(1) }));
      return {
        exportedAt: new Date(now()).toISOString(),
        firstDay: log.firstDay,
        distinctDays: dayKeys.length,
        d1Return: opened.has(addDays(log.firstDay, 1)),
        d7Return: opened.has(addDays(log.firstDay, 7)),
        totalSessions: sessions.length,
        avgSessionMinutes: sessions.length ? +(sessions.reduce((a, s) => a + s.minutes, 0) / sessions.length).toFixed(1) : 0,
        days: log.days,
        sessions,
      };
    },
    reset() {
      log = { createdAt: now(), firstDay: todayKey(), sessions: [], days: {} };
      write();
    },
  };
  return api;
}

export function clearPtLog() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
