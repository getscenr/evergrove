/*
 * Dev time-travel panel (?dev=1) — acceptance §12.4 requires verifying day
 * flips, offline accrual, and forgiveness by clock manipulation.
 *
 * Time jumps write the persistent dev offset and RELOAD the page: every jump
 * exercises the real boot path (load → catchUp → collect), which is exactly
 * what the criterion tests. Not shipped chrome — only mounts with the flag.
 */
import { now, todayKey, getDevOffset, setDevOffset } from './time.js';
import { resetSave } from './state.js';

const H = 3600000;

export function initDevPanel({ save, persist, onToggleReduceMotion }) {
  const panel = document.createElement('div');
  panel.className = 'devp';

  const fmt = ms => {
    const d = new Date(ms);
    return `${todayKey()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const offH = getDevOffset() / H;

  panel.innerHTML = `
    <b>DEV · TIME TRAVEL</b>
    <div class="dnow">${fmt(now())}${offH ? ` (offset ${offH >= 0 ? '+' : ''}${offH.toFixed(1)}h)` : ''}</div>
    <div class="row">
      <button data-h="2">+2h</button>
      <button data-h="6">+6h</button>
      <button data-h="12">+12h</button>
      <button data-h="24">+1d</button>
      <button data-h="72">+3d</button>
      <button data-h="168">+7d</button>
    </div>
    <div class="row">
      <button id="dev-clock-reset">reset clock</button>
      <button id="dev-save-reset">reset grove</button>
      <button id="dev-rm">motion: ${save.settings.reduceMotion ? 'reduced' : 'full'}</button>
    </div>`;

  panel.querySelectorAll('button[data-h]').forEach(b => {
    b.onclick = () => {
      setDevOffset(getDevOffset() + Number(b.dataset.h) * H);
      location.reload();
    };
  });
  panel.querySelector('#dev-clock-reset').onclick = () => {
    setDevOffset(0);
    location.reload();
  };
  panel.querySelector('#dev-save-reset').onclick = () => {
    resetSave();
    location.reload();
  };
  panel.querySelector('#dev-rm').onclick = () => {
    save.settings.reduceMotion = !save.settings.reduceMotion;
    persist(save);
    onToggleReduceMotion(save.settings.reduceMotion);
    panel.querySelector('#dev-rm').textContent = `motion: ${save.settings.reduceMotion ? 'reduced' : 'full'}`;
  };

  document.querySelector('.stage-wrap').appendChild(panel);
}
