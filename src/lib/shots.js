// ============================== AL.shots: the game's armor formula and the Piercing Shot decision (2026-11-27) ==============================
// Sean 2026-11-27: "Piercing Shot rule for armor 400+". Pure functions (no game calls), unit-tested in tests/shots_unit.js.
// Source: the stock game, js/common_functions.js damage_multiplier() and node/server.js complete_attack() (the live server runs stock code except the Grinch edit):
//   damage = attack x damage_multiplier(target.armor - attacker.apiercing - info.apiercing)
//   and info.apiercing = (the skill's own piercing: Piercing Shot 500, everything else 0) + attacker.apiercing, so the attacker's OWN armor piercing counts TWICE in stock
//   (armor - 2 x own - skill). UNVERIFIED live: CFG.APIERCING_OWN_FACTOR (2) is the knob; set 1 if a live measurement says otherwise.
//   Piercing Shot (G.skills.piercingshot): level 72, 64 MP flat, attack x 0.75, +500 apiercing. A normal shot costs the character's mp_cost (about 20 MP for a level-75 Ranger).
//   A negative effective armor ADDS damage (up to x1.32), so piercing past the target's armor is not wasted.
AL.shots = (function () {
  "use strict";
  const min = Math.min, max = Math.max;
  // js/common_functions.js damage_multiplier, ported line by line
  function dmg_mult(d) {
    return min(
      1.32,
      max(
        0.05,
        1 -
          (max(0, min(100, d)) * 0.001 +
            max(0, min(100, d - 100)) * 0.001 +
            max(0, min(100, d - 200)) * 0.00095 +
            max(0, min(100, d - 300)) * 0.0009 +
            max(0, min(100, d - 400)) * 0.00082 +
            max(0, min(100, d - 500)) * 0.0007 +
            max(0, min(100, d - 600)) * 0.0006 +
            max(0, min(100, d - 700)) * 0.0005 +
            max(0, d - 800) * 0.0004) +
          max(0, min(50, 0 - d)) * 0.001 +
          max(0, min(50, -50 - d)) * 0.00075 +
          max(0, min(50, -100 - d)) * 0.0005 +
          max(0, -150 - d) * 0.00025
      )
    );
  }
  const num = (v, d) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  // o: { own_ap: character.apiercing, factor: CFG.APIERCING_OWN_FACTOR (2), skill_ap: 500, skill_mult: 0.75 }
  // the multiplier of a NORMAL shot and of a Piercing Shot against `armor`, and the damage ratio of the Piercing Shot to a normal one (1.12 = 12% more damage per shot)
  function piercing_ratio(armor, o) {
    o = o || {};
    const own = num(o.own_ap, 0) * num(o.factor, 2);
    const normal = dmg_mult(armor - own);
    const pierce = dmg_mult(armor - own - num(o.skill_ap, 500)) * num(o.skill_mult, 0.75);
    return { normal, pierce, ratio: pierce / normal };
  }
  // s: { armor, hp (the target's max HP), mp, max_mp, level, own_ap }; c: { MIN_GAIN, MIN_MP_PCT, MIN_TARGET_HP, MIN_LEVEL, MP_COST, OWN_FACTOR }
  // returns { use, gain, why }: gain = ratio - 1; MP per shot is about 3 x a normal shot, so it is only worth it where it adds real damage and MP is plentiful
  function should_pierce(s, c) {
    c = c || {};
    const armor = num(s.armor, 0);
    const r = piercing_ratio(armor, { own_ap: s.own_ap, factor: c.OWN_FACTOR });
    const gain = r.ratio - 1;
    if (num(s.level, 0) < num(c.MIN_LEVEL, 72)) return { use: false, gain, why: "level " + num(s.level, 0) + " < " + num(c.MIN_LEVEL, 72) };
    if (gain < num(c.MIN_GAIN, 0.25)) return { use: false, gain, why: "gain " + Math.round(gain * 100) + "% < " + Math.round(num(c.MIN_GAIN, 0.25) * 100) + "%" };
    if (num(s.hp, 0) < num(c.MIN_TARGET_HP, 100000)) return { use: false, gain, why: "target HP " + num(s.hp, 0) + " is small (it dies before the extra MP pays off)" };
    const mp_cost = num(c.MP_COST, 64);
    if (num(s.mp, 0) < mp_cost || num(s.mp, 0) < num(c.MIN_MP_PCT, 0.5) * num(s.max_mp, 1)) return { use: false, gain, why: "MP" };
    return { use: true, gain, why: "" };
  }
  return { dmg_mult, piercing_ratio, should_pierce };
})();
