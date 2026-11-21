  // ===================== GEAR + UPGRADES ==========================
  // The Ranger sends what he wears (gear_report). Upgrades are only spent on gear that could beat it.
  // Item stats are estimated as base + upgrade-per-level * level (an approximation, used only to rank items).
  const SLOT_OF_TYPE = {
    helmet: ["helmet"],
    chest: ["chest"],
    pants: ["pants"],
    gloves: ["gloves"],
    shoes: ["shoes"],
    cape: ["cape"],
    ring: ["ring1", "ring2"],
    earring: ["earring1", "earring2"],
    amulet: ["amulet"],
    belt: ["belt"],
    orb: ["orb"],
    quiver: ["offhand"], // Rangers wear it in the offhand slot (dex, range, armor)
    // source (books) is NOT wearable by Rangers (confirmed live 2026-11-15): quivers go into the offhand (shield) slot only
    weapon: ["mainhand"],
  };
  // v5: support characters (Priest ...): their own slot map (books and shields in the offhand, no quivers), weights and wearable rules
  const support_cfg = (who) =>
    (who && CFG.SUPPORT_GEAR && CFG.SUPPORT_GEAR[who]) || null;
  const support_names = () => Object.keys(CFG.SUPPORT_GEAR || {});
  const SUPPORT_SLOT_OF_TYPE = Object.assign({}, SLOT_OF_TYPE, {
    shield: ["offhand"],
    source: ["offhand"],
  });
  delete SUPPORT_SLOT_OF_TYPE.quiver;
  const slots_of = (type, who) =>
    (support_cfg(who) ? SUPPORT_SLOT_OF_TYPE : SLOT_OF_TYPE)[type];
  // v5: items a support character keeps in his bag (the Warrior's basher for Stomp) and whether his last report shows none
  const kit_names = (who) =>
    (support_cfg(who) && support_cfg(who).bag_kit) || [];
  const kit_missing = (who) => {
    const g = S.gears[who];
    const k = kit_names(who);
    return !!g && k.length > 0 && !k.some((n) => g.bag && g.bag[n] > 0);
  };
  const two_hand = (who, it) => {
    const sup = support_cfg(who);
    const def = it && G.items[it.name];
    return !!(
      sup &&
      def &&
      def.type === "weapon" &&
      (sup.two_hand_types || []).indexOf(def.wtype) !== -1
    );
  };
  // would a support character (last report, however old) wear this item? Such items are never sold.
  function support_wants(it) {
    try {
      if (!it || !G.items[it.name]) return false;
      for (const who of support_names()) {
        if (
          S.gears[who] &&
          kit_missing(who) &&
          kit_names(who).indexOf(it.name) !== -1
        )
          return true; // the Warrior has no basher yet: keep every one for him
        if (!S.gears[who] || !gear_wearable(it, who)) continue;
        if (beats_worn(it, it.level || 0, who)) return true;
      }
    } catch (e) {}
    return false;
  }
  // <gear-scoring>
  // The scoring itself lives in the shared lib (AL.gear, src/lib/gear.js): one GearScorer class for what is the same for every class (item stats at a level,
  // stat-scroll points, set bonuses) and a subclass per character class (Ranger, Warrior, Priest). Tests: tests/golden_gear.js (every wearable item x level x option
  // against the numbers of the v5 scorer) and tests/gear_score.js. The Merchant only supplies the world below and keeps the old function names as thin wrappers.
  // CFG.GEAR_TRACE: true logs every set credit and every stat scroll the scorer counts (lines start with [gear]).
  const gear_env = {
    get G() {
      return G;
    },
    CFG,
    get gears() {
      return S.gears;
    },
    get lead_gear() {
      return S.ranger_gear;
    },
    slot_of_type: SLOT_OF_TYPE, // the Ranger's slot map: the set-credit code finds the worn piece a candidate would replace with it
    get debug() {
      return !!CFG.GEAR_TRACE;
    },
    log: (m) => say(m, "#B0B0B0"),
  };
  const gear_scorers = AL.gear.scorers(gear_env);
  const prop_at = (def, level, p) => gear_scorers.ranger.prop_at(def, level, p);
  // opts: { who, stat_type: the stat scroll already applied, assume_dex: count a scroll that could still be applied }; a character with a CFG.SUPPORT_GEAR profile is scored by its class scorer, anyone else as a Ranger
  function gear_score(name, level, opts) {
    return gear_scorers.for_who(opts && opts.who).score(name, level, opts);
  }
  // best the item could be at the upgrade cap, counting a Dexterity scroll it could still take
  const potential_score = (it) => gear_scorers.ranger.potential(it, upg_max);
  // </gear-scoring>
  function gear_wearable(it, who) {
    const def = it && G.items[it.name];
    const sup = support_cfg(who);
    if (sup) {
      if (!def || !SUPPORT_SLOT_OF_TYPE[def.type]) return false;
      if (sup.skip_types && sup.skip_types.indexOf(def.type) !== -1)
        return false; // e.g. the Warrior cannot hold a Book (source)
      if (def.class && def.class.indexOf(sup.cls) === -1) return false;
      if (
        def.type === "weapon" &&
        !(def.class && def.class.indexOf(sup.cls) !== -1) &&
        sup.weapon_types.indexOf(def.wtype) === -1
      )
        return false;
      return true;
    }
    if (!def || !SLOT_OF_TYPE[def.type]) return false;
    if (def.class && def.class.indexOf(CFG.GEAR_CLASS) === -1) return false;
    if (
      def.type === "weapon" &&
      CFG.GEAR_WEAPON_TYPES.indexOf(def.wtype) === -1
    )
      return false;
    return true;
  }
  // the worn item this one would replace: the weakest of the matching slots (an empty slot counts as 0)
  // The Rangers, leader first. SexyDexy (RANGER_NAME) always has first call on gear; the others get what he does not need.
  // v5: a Ranger that has not sent a gear report for ROSTER_AWAY_MS counts as away (logged off) and is left out, so no
  // single offline Ranger blocks the sweep, the sells or the crafting. During the first 5 minutes after a restart everybody
  // counts (the reports have not come in yet). If nobody is recent, the leader alone stays (the tasks then wait for his report).
  const ROSTER_AWAY_MS = 30 * 60000;
  const roster_all = () =>
    [CFG.RANGER_NAME].concat(
      CFG.TRUSTED_NAMES.filter((n) => n !== CFG.RANGER_NAME)
    );
  const roster = () => {
    const all = roster_all();
    if (now() - BOOT_AT < 300000) return all;
    const here = all.filter((w) => {
      const g = w === CFG.RANGER_NAME ? S.ranger_gear : S.gears[w];
      return !!g && now() - g.at < ROSTER_AWAY_MS;
    });
    return here.length ? here : [CFG.RANGER_NAME];
  };
  const gear_of = (who) =>
    who === CFG.RANGER_NAME ? S.ranger_gear : S.gears[who];
  const gear_fresh_for = (who) => {
    const g = gear_of(who);
    return !!g && now() - g.at < 10 * 60000;
  };
  // the first Ranger (leader first) whose worn gear this score would beat; null when nobody would gain
  function best_target(it, score, only_followers) {
    for (const who of roster()) {
      if (only_followers && who === CFG.RANGER_NAME) continue;
      if (!gear_fresh_for(who)) continue;
      const f = worn_floor(it, who);
      if (score > f.score * CFG.GEAR_MARGIN) return { who, f };
    }
    return null;
  }
  function worn_floor(it, who) {
    who = who || CFG.RANGER_NAME;
    const g = gear_of(who);
    const slots = slots_of(G.items[it.name].type, who);
    if (two_hand(who, it)) {
      // a two-handed weapon replaces the weapon AND the off hand
      const sc = (sl) => {
        const w = g && g.slots[sl];
        return w
          ? gear_score(w.name, w.level, { stat_type: w.stat_type, who })
          : 0;
      };
      return { slot: "mainhand", score: sc("mainhand") + sc("offhand") };
    }
    let best = null;
    for (const s of slots) {
      const w = g && g.slots[s];
      const score = w
        ? gear_score(w.name, w.level, { stat_type: w.stat_type, who })
        : 0;
      if (!best || score < best.score) best = { slot: s, score };
    }
    return best;
  }
  const gear_fresh = () =>
    !!S.ranger_gear && now() - S.ranger_gear.at < 10 * 60000;
  function beats_worn(it, level, who) {
    const f = worn_floor(it, who);
    const sc = gear_score(it.name, level, { stat_type: it.stat_type, who });
    return sc > f.score * CFG.GEAR_MARGIN && sc > 0;
  }
