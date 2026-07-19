/*
 * Deterministic SVG plant renderer — Phase 0 (spec §2).
 *
 * drawPlant(render, opts) is pure string-in → string-out: the same render
 * params (the Phase 0 visual genome) + the same stage + the same instance id
 * always produce byte-identical SVG, on every device.
 *
 * Hard rule: no Math.random() in this file. All per-instance variation
 * (petal-angle jitter, rest droop direction) derives from a seeded hash of
 * the plant instance id.
 *
 * Ported from reference/evergrove-founding-45.html (the extended drawPlant:
 * radial, star, bell, spike, frond, cup, cluster, trumpet — pine's cone is
 * drawn via spike params, acceptable for Phase 0). New work: the five growth
 * stages, implemented as parameter transforms on the same draw call.
 */

export const STAGES = ['seed', 'sprout', 'bud', 'bloom', 'rest'];

const SOIL = '#0e281f';

/* ---------- seeded hashing (determinism) ---------- */

// FNV-1a 32-bit over the instance id string.
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic float in [0,1) for a given seed and channel number.
export function seededUnit(seed, channel) {
  const x = Math.imul(seed ^ Math.imul(channel + 1, 0x9e3779b9), 0x85ebca6b) >>> 0;
  return (x % 100000) / 100000;
}

/* ---------- color helpers ---------- */

function hx(c) {
  c = c.replace('#', '');
  return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)];
}
function toHex(a) {
  return '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function mix(c1, c2, t) {
  const a = hx(c1), b = hx(c2);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}
// Desaturate toward the color's own luminance — drains chroma, keeps value.
export function desat(c, amt) {
  const [r, g, b] = hx(c);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return toHex([r + (l - r) * amt, g + (l - g) * amt, b + (l - b) * amt]);
}

/* ---------- shared fragments ---------- */

function stemAndLeaves(stem) {
  return `<path d="M50 132 C 47 108 47 92 50 74" stroke="${stem}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`
    + `<path d="M49 112 C 34 108 28 98 26 88 C 40 90 47 98 49 112 Z" fill="${mix(stem, SOIL, .15)}"/>`
    + `<path d="M50 100 C 66 98 73 88 75 79 C 60 80 53 88 50 100 Z" fill="${stem}"/>`;
}

/* ---------- full bloom body (per form) ---------- */

function bloomBody(r, bloom, acc, gf, jitter) {
  const stem = r.stem;
  let body = '';
  if (r.shape !== 'frond') body += stemAndLeaves(stem);
  const cx = 50, cy = r.shape === 'frond' ? 70 : 58;

  if (r.shape === 'radial' || r.shape === 'star') {
    const n = r.petals || 10, pr = r.shape === 'star' ? 3.6 : 6.4, py = r.shape === 'star' ? 15 : 16;
    let pet = '';
    for (let i = 0; i < n; i++) {
      const ang = (360 / n) * i;
      pet += `<g transform="rotate(${ang} ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy - py}" rx="${pr}" ry="${r.shape === 'star' ? 15 : 11}" fill="${bloom}"/></g>`;
    }
    // instance jitter rotates the whole petal ring a few degrees
    body += `<g ${gf} transform="rotate(${jitter} ${cx} ${cy})">${pet}<circle cx="${cx}" cy="${cy}" r="${r.shape === 'star' ? 6 : 7.5}" fill="${acc}"/></g>`;
  } else if (r.shape === 'bell') {
    let bells = '';
    [60, 72, 84, 96].forEach((y, i) => {
      const x = cx + (i % 2 ? 11 : -11);
      bells += `<path d="M${x} ${y} q -8 2 -7 12 q 7 6 14 0 q 1 -10 -7 -12 Z" fill="${bloom}"/><circle cx="${x}" cy="${y + 13}" r="1.8" fill="${acc}"/>`;
    });
    body += `<g ${gf}>${bells}</g>`;
  } else if (r.shape === 'spike') {
    let fl = '';
    for (let i = 0; i < 8; i++) {
      const y = 44 + i * 5.2;
      const w = 4.2 + (i < 2 ? 0 : (8 - i) * .5);
      fl += `<circle cx="${cx - 4}" cy="${y}" r="${Math.max(2.6, w - 1)}" fill="${bloom}"/><circle cx="${cx + 4}" cy="${y + 2.4}" r="${Math.max(2.6, w - 1)}" fill="${mix(bloom, acc, .35)}"/>`;
    }
    body += `<g ${gf}>${fl}</g>`;
  } else if (r.shape === 'frond') {
    let fr = `<path d="M50 134 C 50 100 50 66 50 40" stroke="${stem}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    for (let i = 0; i < 8; i++) {
      const y = 44 + i * 11, len = 26 - i * 2.4;
      fr += `<path d="M50 ${y} q -${len * .6} -2 -${len} -8" stroke="${bloom}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M50 ${y + 3} q ${len * .6} -2 ${len} -8" stroke="${bloom}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }
    body = `<g ${gf}>${fr}</g>`;
  } else if (r.shape === 'cup') {
    const n = r.petals || 5;
    let pet = '';
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5);
      const ang = t * 116;
      pet += `<g transform="rotate(${ang} ${cx} ${cy + 8})"><path d="M${cx} ${cy + 10} C ${cx - 7} ${cy - 2}, ${cx - 6} ${cy - 16}, ${cx} ${cy - 20} C ${cx + 6} ${cy - 16}, ${cx + 7} ${cy - 2}, ${cx} ${cy + 10} Z" fill="${bloom}"/></g>`;
    }
    body += `<g ${gf}>${pet}<ellipse cx="${cx}" cy="${cy + 6}" rx="8" ry="5" fill="${acc}"/></g>`;
  } else if (r.shape === 'cluster') {
    const pts = [[0, -9], [-7, -4], [7, -4], [-11, 3], [11, 3], [-4, 0], [4, 0], [0, 2], [-8, 7], [8, 7], [0, 9], [-4, -7], [4, -7], [0, -2]];
    let fl = '';
    pts.forEach((p, i) => { fl += `<circle cx="${cx + p[0]}" cy="${cy + p[1]}" r="4.3" fill="${i % 3 ? bloom : mix(bloom, acc, .45)}"/>`; });
    body += `<g ${gf}>${fl}</g>`;
  } else if (r.shape === 'trumpet') {
    body += `<g ${gf}><path d="M${cx} ${cy + 18} C ${cx - 3} ${cy + 2}, ${cx - 17} ${cy - 4}, ${cx - 15} ${cy - 18} L ${cx + 15} ${cy - 18} C ${cx + 17} ${cy - 4}, ${cx + 3} ${cy + 2}, ${cx} ${cy + 18} Z" fill="${bloom}"/>`
      + `<ellipse cx="${cx}" cy="${cy - 18}" rx="15" ry="5.5" fill="${mix(bloom, acc, .5)}"/>`
      + `<ellipse cx="${cx}" cy="${cy - 16}" rx="6" ry="3" fill="${acc}"/></g>`;
  }
  return body;
}

/* ---------- growth-stage bodies ---------- */

function seedBody(stem) {
  // mound + sprout dot
  return `<ellipse cx="50" cy="128" rx="16" ry="7" fill="${mix(stem, SOIL, .55)}"/>`
    + `<path d="M50 127 C 49 123 49 120 50 117" stroke="${stem}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `<circle cx="50" cy="114.5" r="2.6" fill="${mix(stem, '#EAF3DC', .35)}"/>`;
}

function sproutBody(stem) {
  // stem + small leaves at 40% scale (spec §2), uniform across forms
  return `<g transform="translate(50 132) scale(0.4) translate(-50 -132)">${stemAndLeaves(stem)}</g>`;
}

function budBody(r, bloom, acc) {
  if (r.shape === 'frond') {
    // fiddlehead: curled shoot for the Ancients' frond form
    return `<path d="M50 134 C 50 116 50 100 50 84" stroke="${r.stem}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      + `<path d="M50 84 C 50 72 42 65 46 57 C 50 51 58 55 56 62 C 55 67 49 67 49 62" stroke="${bloom}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
  }
  // generic closed bud atop the normal stem
  return stemAndLeaves(r.stem)
    + `<path d="M50 76 C 43.5 67 43.5 56 50 47 C 56.5 56 56.5 67 50 76 Z" fill="${bloom}"/>`
    + `<path d="M50 74 C 46.5 68 46.5 60 50 54" stroke="${mix(bloom, r.stem, .5)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
    + `<circle cx="50" cy="50" r="1.8" fill="${acc}"/>`;
}

/* ---------- drawPlant ---------- */

// render: {stem, bloom, accent, shape, petals?, glow?}  (data/founding45.json)
// opts:   {stage: 'seed'|'sprout'|'bud'|'bloom'|'rest', id: instance id}
export function drawPlant(render, opts = {}) {
  const stage = opts.stage || 'bloom';
  const id = opts.id || 'x';
  const seed = hashSeed(id);

  let bloom = render.bloom, acc = render.accent;
  if (stage === 'bud') { bloom = desat(bloom, .3); acc = desat(acc, .3); }
  if (stage === 'rest') { bloom = desat(bloom, .2); acc = desat(acc, .2); }

  // glow is a bloom feature — earlier stages render without it
  const useGlow = !!render.glow && (stage === 'bloom' || stage === 'rest');
  const fid = `glow-${id}`;
  const defs = useGlow
    ? `<filter id="${fid}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : '';
  const gf = useGlow ? `filter="url(#${fid})"` : '';

  let body;
  if (stage === 'seed') {
    body = seedBody(render.stem);
  } else if (stage === 'sprout') {
    body = sproutBody(render.stem);
  } else if (stage === 'bud') {
    body = budBody(render, bloom, acc);
  } else {
    const jitter = +((seededUnit(seed, 1) - .5) * 8).toFixed(2); // ±4° petal-ring rotation
    body = bloomBody(render, bloom, acc, gf, jitter);
    if (stage === 'rest') {
      const dir = seededUnit(seed, 2) < .5 ? -1 : 1;
      body = `<g transform="rotate(${(2.8 * dir).toFixed(1)} 50 132)">${body}</g>`; // slight droop
    }
  }

  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;
}
