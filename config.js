/*
 * Every tunable number lives here (spec §4) — playtest will move them.
 * Times in hours; costs/rewards in Growth.
 */
export const CONFIG = {
  // stage progression (spec §4)
  stage: {
    seedToSproutH: 2,
    sproutToBudH: 6,
    budToBloomMinH: 12, // bud blooms at next rain once this old
  },
  offlineCapDays: 3, // forgiveness cap (spec §4)

  economy: {
    // Retuned in M3 so the §5b ring percentages land on whole numbers:
    // 25/50/100/200% of 4 = 1/2/4/8. Idle raised 6→7 to keep expansion
    // pacing (first slot ~day 3 with focused care).
    rainGrowthPerPlant: 4,       // Tend All baseline payout, per plant per day
    idleGrowthPerPlantPerDay: 7, // offline accrual, per plant per completed day
  },

  // Focus Rings (spec §5b): caps per day, rewards per completed gesture.
  // growth values are 25/50/100/200% of economy.rainGrowthPerPlant.
  rings: {
    tend:      { cap: 10, growth: 1, bond: 1 },
    nurture:   { cap: 5,  growth: 2, bond: 2, materialChance: 0.2 },
    cultivate: { cap: 3,  growth: 4, bond: 3 },
    devote:    { cap: 1,  growth: 8, bond: 5, gift: true, giftMaterials: 3 },
  },

  // Bond XP → levels (spec §5c: L1≈7, L2≈25, L3≈60)
  bonds: { levels: [7, 25, 60] },

  // Ring gesture recognition — deliberately lenient (cozy is the bar):
  // thresholds assume imprecise thumbs; a failed attempt never costs a slot.
  gesture: {
    swirlArcDeg: 250,     // spec sketches ≥270°; relaxed per forgiving-gestures directive
    swirlMinRadiusPx: 14, // points closer than this to center are ignored, not failed
    swirlHintDeg: 110,    // partial arcs past this get an encouraging hint
    nurtureDropMs: 380,   // a droplet lands every … while holding (3 drops = done)
    nurtureDrops: 3,
    pruneMinPx: 36,       // a swipe this long counts
    pruneMaxMs: 900,      // … if drawn within this time
    pruneWindowMs: 5000,  // both swipes within this window
    devoteHoldMs: 2000,   // the small ritual: hold …
    devoteArcDeg: 170,    // … then circle (lenient half-turn)
  },

  rain: {
    holdMs: 400,        // press-and-hold threshold (spec §5a)
    moveCancelPx: 8,    // finger drift beyond this = drag, not hold
    waveStaggerMs: 40,  // per-plant bloom-wave stagger, by distance rank (§5a)
    waveBaseDelayMs: 350, // droplets land before the first pop
  },

  grove: {
    startSlots: 8,
    maxSlots: 24,
  },
  /*
   * M4 tuning pass (directive: config only, front-loaded): slot 9 is cheap
   * enough that a casual player (rain + idle only, ~120 Growth by day 2)
   * expands on day 2–3; the 1.6 factor steepens the tail instead of
   * inflating faucets. cost(n) = round(baseCost × factor^(n − 9)):
   * 100, 160, 256, 410, 655, 1049, 1678, 2684, …
   */
  expansion: { baseCost: 100, factor: 1.6 },

  // Login calendar (§5d): 7 visible days, cycling. Whole numbers only.
  // tokens = cosmetic placeholder counter in Phase 0.
  calendar: [
    { growth: 10 },
    { materials: 2 },
    { growth: 15 },
    { tokens: 1 },
    { materials: 3 },
    { growth: 20 },
    { chest: { growth: 25, materials: 3, seed: true } }, // day-7 chest
  ],

  // Streak shields (§5d): automatic, refilled weekly, consumed silently
  // and mentioned kindly. Lapse beyond bundleAfterDays → warm gift instead
  // of any loss language.
  shields: { perWeek: 2 },
  welcomeBack: { lapseDays: 3, materials: 3, seed: true },

  plantNestleMs: 900, // the small planting moment (reduce-motion: instant)

  // sway animation bounds (seconds) — per-plant value seeded from instance id
  sway: { minS: 4.6, maxS: 7.4 },

  tickMs: 30000, // while-open clock check (stage growth, midnight flip)

  // §6 — the five chosen starters; new saves add 3 once-rolled founders
  starters: ['sunflower', 'bluebell', 'field-poppy', 'lavender', 'lady-fern'],

  /*
   * New-player grove ages (hours before "now" each starting plant was
   * planted). Tuned so day 1 opens with two ripe buds (first-bloom
   * celebrations at the very first rain) and the rest ramp over days 2–3.
   * seed→sprout at 2h, sprout→bud at 8h, bud ripe at 20h.
   */
  startAgesH: [21, 20.5, 10, 12, 5, 2.5, 1, 0.2],
};
