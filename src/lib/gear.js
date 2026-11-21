
// ============================== AL.gear: gear scoring (stage 1 of the refactor, 2026-11-20) ==============================
// One scorer class for everything that is the same for all classes (item stats at a level, stat-scroll points, set bonuses), and one
// subclass per character class for what differs (which stats count and how much). Written to give EXACTLY the numbers of the v5 Merchant
// (`gear_score` / `support_score`): tests/golden_gear.js compares every wearable item at levels 0-7 against values dumped from v5.
//
// The scorer reads the world through `env` (so it can be tested without the game):
//   env.G           the game data object (G.items, G.sets)
//   env.CFG         the Merchant's config (GEAR_WEIGHTS, FREQ_PCT_PER_POINT, ABILITY_WEIGHTS, SET_BONUS, STAT_AS_MAIN ...)
//   env.gears       { characterName: gear report } (report.slots = slot -> { name, level })
//   env.lead_gear   the Ranger lead's report (the fallback for set pieces worn and the dex weight source)
//   env.slot_of_type  item type -> slots of the Ranger map (used to find which worn piece a candidate would replace)
// Each is a getter or a plain value; they are read at every call, so the Merchant can swap state without rebuilding the scorers.
// Logging: `env.log(msg)` (optional) is called at the decision points (a set credit, a scroll counted) when env.debug is true.
AL.gear = (function () {
  "use strict";

  class GearScorer {
    // profile: { who, cls, main, weights, scroll, main_from_weapon } for support classes; Rangers use CFG.GEAR_WEIGHTS and need no profile
    constructor(env, profile) {
      this.env = env;
      this.profile = profile || null;
    }
    get G() {
      return this.env.G;
    }
    get CFG() {
      return this.env.CFG;
    }
    trace(msg) {
      if (this.env.debug && typeof this.env.log === "function") this.env.log("[gear] " + msg);
    }

    // ---- shared: an item property at a level, exactly as the game builds it (progression/stats.js): upgrade steps 7-10 and compound
    // steps 6+ are multiplied, and a stat that grows gets +1 per step from +7.
    prop_at(def, level, p) {
      let v = Number(def[p]) || 0;
      const u = def.upgrade || def.compound;
      if (u && Number(u[p])) {
        for (let i = 1; i <= (level || 0); i++) {
          let m = 1;
          if (def.upgrade) {
            if (i === 7) m = 1.25;
            else if (i === 8) m = 1.5;
            else if (i === 9) m = 2;
            else if (i >= 10) m = 3;
          } else {
            if (i === 5) m = 1.25; // confirmed with Book of Cheer (dex 40 -> 48 at +5, 57 at +6, 69 at +7)
            else if (i === 6) m = 1.5;
            else if (i === 7) m = 2;
            else if (i >= 8) m = 3;
          }
          if (p === "stat") {
            v += Math.round(u[p] * m);
            if (i >= 7) v++;
          } else v += u[p] * m;
        }
      }
      return v;
    }
    // points of the chosen stat a scroll gives this item at this level
    stat_points(def, level) {
      let v = this.prop_at(def, level, "stat");
      if ((level || 0) === 10 && v && def.tier && def.tier >= 3) v += 2;
      return v;
    }
    // the stat points a scroll would add to this item (0 when the item has no "stat" value)
    scroll_points(def, level) {
      return Number(def.stat) > 0 ? this.stat_points(def, level) * this.CFG.STAT_SCROLL_MULT : 0;
    }

    // ---- shared: set bonuses. G.sets[name] = { 2: {dex: 3}, 3: {speed: 2, dex: 3}, ... }: the bonuses ADD UP as more pieces are worn.
    // weight of one set-bonus stat for this class (subclasses answer; main_w is the main stat's weight of the moment)
    set_weight(p, main_w) {
      return 0;
    }
    // value of n worn pieces of a set, in score points (stats weighted like item stats)
    set_value(setname, n, main_w) {
      const def = (this.G && this.G.sets && this.G.sets[setname]) || null;
      if (!def) return 0;
      let v = 0;
      for (let i = 1; i <= n; i++) {
        const b = def[i];
        if (!b || typeof b !== "object") continue;
        for (const p in b) v += (Number(b[p]) || 0) * this.set_weight(p, main_w);
      }
      return v;
    }
    // the report whose worn pieces count: this character's, else the Ranger lead's
    worn_report(who) {
      const gears = this.env.gears;
      return who && gears && gears[who] ? gears[who] : this.env.lead_gear;
    }
    // What this piece adds to the set bonus given the pieces worn in the OTHER slots (the same formula scores the worn piece, so a swap
    // inside the same set cancels out). Same-slot replacement does not count the replaced piece.
    set_credit(name, def, opts, main_w) {
      const CFG = this.CFG;
      if (!CFG.SET_BONUS || !def || !def.set || !this.G || !this.G.sets || !this.G.sets[def.set]) return 0;
      const rep = this.worn_report(opts && opts.who);
      const worn = (rep && rep.slots) || {};
      const own = (this.env.slot_of_type && this.env.slot_of_type[def.type]) || [];
      let others = 0;
      let in_own = 0;
      for (const k in worn) {
        const it = worn[k];
        const d = it && this.G.items[it.name];
        if (!d || d.set !== def.set) continue;
        if (own.indexOf(k) !== -1) in_own++;
        else others++;
      }
      others += in_own > 0 && in_own >= own.length ? in_own - 1 : in_own; // every slot of this type holds a piece of the set: one of them is the one being replaced; otherwise the piece goes into a free / other slot and all worn ones count
      const credit = this.set_value(def.set, others + 1, main_w) - this.set_value(def.set, others, main_w);
      if (credit) this.trace("set " + def.set + ": " + name + " adds " + credit + " with " + others + " other piece(s) worn");
      return credit;
    }
    // the score of an item at a level; opts: { who, stat_type: the stat scroll already applied, assume_dex: count a scroll that could still be applied }
    score(name, level, opts) {
      return 0;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // The Ranger: attack first, then dex (a dex point is worth weapon attack / 20), attack speed, ability, range ...
  class RangerScorer extends GearScorer {
    constructor(env) {
      super(env, null);
    }
    // The Ranger's main stat is dex and the game adds weapon_attack * dex / 20 to his attack (progression/stats.js), so one dex point is
    // worth (weapon attack / 20) attack. Never worth less than the configured dex weight.
    dex_weight() {
      const CFG = this.CFG;
      const base = CFG.GEAR_WEIGHTS.dex;
      const mult = Number(CFG.DEX_WEIGHT_MULT) > 0 ? Number(CFG.DEX_WEIGHT_MULT) : 1;
      if (!CFG.DEX_AUTO_WEIGHT) return base * mult;
      const lg = this.env.lead_gear;
      const w = lg && lg.slots && lg.slots.mainhand;
      const def = w && this.G.items[w.name];
      if (!def) return base * mult;
      return mult * Math.max(base, (CFG.GEAR_WEIGHTS.attack * this.prop_at(def, w.level, "attack")) / 20);
    }
    // What one percent of the Ranger's damage is worth in score points: weapon attack x (1 + worn dex / 20) x the attack weight.
    damage_ref() {
      const lg = this.env.lead_gear;
      const g = lg && lg.slots;
      const w = g && g.mainhand;
      const wd = w && this.G.items[w.name];
      const wa = wd ? this.prop_at(wd, w.level, "attack") : 100;
      let dex = 0;
      if (g)
        for (const k in g) {
          const it = g[k];
          const d = it && this.G.items[it.name];
          if (d) dex += this.prop_at(d, it.level, "dex");
        }
      return this.CFG.GEAR_WEIGHTS.attack * wa * (1 + dex / 20);
    }
    set_weight(p, main_w) {
      const CFG = this.CFG;
      if (p === "dex") return this.dex_weight();
      return CFG.GEAR_WEIGHTS[p] !== undefined ? CFG.GEAR_WEIGHTS[p] : (CFG.SET_WEIGHTS || {})[p] || 0;
    }
    score(name, level, opts) {
      const def = this.G.items[name];
      if (!def) return 0;
      opts = opts || {};
      const CFG = this.CFG;
      const stat = this.scroll_points(def, level);
      let scroll_stat = null;
      if (stat > 0) {
        if (opts.stat_type) scroll_stat = opts.stat_type;
        else if ((opts.assume_dex || CFG.STAT_AS_MAIN) && CFG.DEX_SCROLL_POTENTIAL) scroll_stat = "dex";
      }
      const dw = this.dex_weight();
      let score = 0;
      for (const p in CFG.GEAR_WEIGHTS) {
        let v = this.prop_at(def, level, p);
        if (p === scroll_stat) v += stat;
        score += v * (p === "dex" ? dw : CFG.GEAR_WEIGHTS[p]);
      }
      // attack speed: every point is a percentage of all his damage
      const fq = this.prop_at(def, level, "frequency");
      if (fq) score += (fq * CFG.FREQ_PCT_PER_POINT * this.damage_ref()) / 100;
      // ability: attr0 is its proc chance; weights come from Sean's ranking
      const aw = def.ability && CFG.ABILITY_IGNORE_ITEMS.indexOf(name) === -1 && CFG.ABILITY_WEIGHTS[def.ability];
      if (aw) score += (aw * this.prop_at(def, level, "attr0") * this.damage_ref()) / 100;
      score += this.set_credit(name, def, opts);
      return score;
    }
    // best the item could be at the upgrade cap, counting a Dexterity scroll it could still take
    potential(it, upg_max) {
      return this.score(it.name, upg_max(it.name), { stat_type: it.stat_type, assume_dex: true });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Support classes (Warrior, Priest): the weights come from the character's profile; the class's main stat is raised to
  // (attack weight x weapon attack / 20) when `main_from_weapon` is not false, as for the Ranger's dex.
  class SupportScorer extends GearScorer {
    main_weight(who) {
      const sup = this.profile;
      const rep = this.env.gears && this.env.gears[who];
      const w = rep && rep.slots && rep.slots.mainhand;
      const wd = w && this.G.items[w.name];
      return Math.max(
        sup.weights[sup.main] || 0,
        wd && sup.main_from_weapon !== false ? ((sup.weights.attack || 0) * this.prop_at(wd, w.level, "attack")) / 20 : 0
      );
    }
    set_weight(p, main_w) {
      const sup = this.profile;
      return p === sup.main ? main_w : sup.weights[p] || 0;
    }
    score(name, level, opts) {
      const def = this.G.items[name];
      if (!def) return 0;
      opts = opts || {};
      const sup = this.profile;
      const CFG = this.CFG;
      const main_w = this.main_weight(opts.who);
      let score = 0;
      const sc_stat = sup.scroll && this.G.items[sup.scroll] && this.G.items[sup.scroll].stat;
      const sc_pts = this.scroll_points(def, level);
      for (const p in sup.weights) {
        let v = this.prop_at(def, level, p);
        if (sc_pts && p === sc_stat && (opts.stat_type === sc_stat || (!opts.stat_type && CFG.STAT_AS_MAIN) || opts.assume_dex)) {
          v += sc_pts; // a scroll applied (or one that could be)
          this.trace(name + ": +" + sc_pts + " " + sc_stat + " counted from a scroll");
        }
        score += v * (p === sup.main ? main_w : sup.weights[p]);
      }
      return score + this.set_credit(name, def, opts, main_w); // set bonuses (the stats weighted like the character's own)
    }
  }
  class WarriorScorer extends SupportScorer {}
  class PriestScorer extends SupportScorer {}

  // ------------------------------------------------------------------------------------------------------------------------
  // The scorer for a character: its profile (CFG.SUPPORT_GEAR[who]) decides the class; no profile = a Ranger.
  const CLASS_SCORER = { warrior: WarriorScorer, priest: PriestScorer };
  function scorers(env) {
    const ranger = new RangerScorer(env);
    const cache = {};
    return {
      ranger,
      for_who(who) {
        const sup = who && env.CFG.SUPPORT_GEAR && env.CFG.SUPPORT_GEAR[who];
        if (!sup) return ranger;
        const C = CLASS_SCORER[sup.cls] || SupportScorer;
        // a new object per call keeps the profile live (CFG can change); the object is cheap
        return new C(env, sup);
      },
    };
  }
  return { GearScorer, RangerScorer, SupportScorer, WarriorScorer, PriestScorer, scorers };
})();
