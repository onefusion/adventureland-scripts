// ============================== AL.planners: pure Merchant planners (stage 5 of the refactor, 2026-11-21) ==============================
// A planner decides; it does not walk, open the bank or send anything. It reads a plain input object and returns a plan, so it can be tested
// without the game. The Merchant builds the input from its live state (`env`) and acts on the plan.
// Planners so far: sweep (which finished / stuck gear goes to which character), copies (the copy limit), surplus (the bank-full seller).
AL.planners = (function () {
  "use strict";

  // ---- sweep ----
  // env.who_list / env.sup_list   Rangers / support characters with a fresh gear report (the Merchant already filtered them)
  // env.items                     candidate pieces [{ it, bag } | { it, pack, i }] (wearable, unlocked, unstacked, upgradeable or compoundable)
  // env.cfg                       { COMPOUND_NEED_DRIVEN, COMPOUND_SELL_AT_LEVEL, GEAR_MARGIN }
  // env.G_items                   G.items
  // env.fn                        the Merchant's helpers: comp_key, target_of, keep_of, comp_ok, scroll_grade, max_grade_of, ladder_ok (null when
  //                               the compound ladder is off), upg_max, upg_ok, upg_has_spare, gear_score, gear_wearable, support_cfg, two_hand,
  //                               slots_of, slot_scores(who) -> { slot: score of what he wears }, kit_missing, kit_names, find_kit(name)
  // Returns { give: [{ c, who, slot }], no_kit?: [names] }.
  function sweep(env) {
    const { who_list, sup_list, cfg, G_items, fn } = env;
    const out = { give: [] };
    const all = who_list.concat(sup_list);
    const items = env.items.slice();
    const counts = {};
    for (const c of items) counts[fn.comp_key(c.it)] = (counts[fn.comp_key(c.it)] || 0) + 1;
    const finished = (c) => {
      const def = G_items[c.it.name];
      const lv = c.it.level || 0;
      if (def.compound && cfg.COMPOUND_NEED_DRIVEN) {
        if (lv >= fn.target_of(c.it.name)) return true;
        const compoundable =
          counts[fn.comp_key(c.it)] >= 3 + fn.keep_of(c.it.name) &&
          fn.comp_ok(c.it) &&
          fn.scroll_grade(c.it) <= fn.max_grade_of(c.it.name) &&
          fn.ladder_ok(c.it.name, lv);
        return !compoundable; // waiting for a triple, or the ladder has no use for it: a Ranger may wear it now
      }
      if (def.compound && lv >= cfg.COMPOUND_SELL_AT_LEVEL) return true;
      if (def.upgrade && lv >= fn.upg_max(c.it.name)) return true;
      if (def.upgrade && !def.compound) return !(fn.upg_ok(c.it) && fn.upg_has_spare(c.it)); // the upgrade rounds will not take it further
      if (def.compound) return counts[fn.comp_key(c.it)] < 3; // no triple to compound it with
      return false;
    };
    const virt = {};
    for (const who of all) virt[who] = Object.assign({}, fn.slot_scores(who));
    // score of an item for one character (null when he cannot wear it): Rangers as before, support characters with their own weights
    const score_for = (c, who) =>
      fn.support_cfg(who)
        ? fn.gear_wearable(c.it, who)
          ? fn.gear_score(c.it.name, c.it.level || 0, { stat_type: c.it.stat_type, who })
          : null
        : fn.gear_wearable(c.it)
        ? fn.gear_score(c.it.name, c.it.level || 0, { stat_type: c.it.stat_type })
        : null;
    const cands = items
      .filter(finished)
      .map((c) => Object.assign(c, { score: Math.max(0, ...all.map((w) => score_for(c, w) || 0)) }))
      .sort((a, b) => b.score - a.score);
    for (const c of cands) {
      if (c.score <= 0) continue;
      for (const who of all) {
        const sc = score_for(c, who);
        if (!sc || sc <= 0) continue;
        if (fn.two_hand(who, c.it)) {
          const cur = (virt[who].mainhand || 0) + (virt[who].offhand || 0);
          if (sc > cur * cfg.GEAR_MARGIN) {
            virt[who].mainhand = sc;
            virt[who].offhand = 0;
            out.give.push({ c, who, slot: "mainhand" });
            break;
          }
          continue;
        }
        const slots = fn.slots_of(G_items[c.it.name].type, who) || [];
        let low = null;
        for (const sl of slots) {
          const v = virt[who][sl] || 0;
          if (!low || v < low.v) low = { sl, v };
        }
        if (low && sc > low.v * cfg.GEAR_MARGIN) {
          virt[who][low.sl] = sc;
          out.give.push({ c, who, slot: low.sl });
          break;
        }
      }
    }
    // the Warrior's basher (kept in his bag, never worn): one from the bag or the bank when his report shows none
    for (const who of sup_list) {
      if (!fn.kit_missing(who)) continue;
      let found = null;
      for (const nm of fn.kit_names(who)) {
        found = fn.find_kit(nm);
        if (found) break;
      }
      if (found) out.give.push({ c: found, who, slot: "bag" });
      else out.no_kit = (out.no_kit || []).concat(who);
    }
    return out;
  }

  // ---- copies (copy limit): never more copies of one finished item than the characters can wear ----
  // env.n_chars      how many characters count (the Rangers)
  // env.worn_names   one entry per worn piece at the copy level or better, in the order the reports list them
  // env.owned        every copy in bag and bank worth considering: { it, waiting, kb, bag | pack,i } (waiting = handed to a character at the next meeting)
  // env.cfg          { SURPLUS_COPIES_PER_RANGER, KEEP_BEST_COPIES, SURPLUS_MAX_VALUE_EACH }
  // env.G_items, env.sell_value(name, level)
  // Returns { sell: [c with .value], held: [{ it, value, why }], kept }.
  function copies(env) {
    const { cfg, G_items } = env;
    const out = { sell: [], held: [], kept: 0 };
    const by = {}; // item name -> { worn, owned: [] }
    const grp = (n) => (by[n] = by[n] || { worn: 0, owned: [] });
    for (const n of env.worn_names) grp(n).worn++;
    for (const c of env.owned) grp(c.it.name).owned.push(c);
    for (const name in by) {
      const def = G_items[name];
      const per = cfg.SURPLUS_COPIES_PER_RANGER[def.type] || 1;
      const allow =
        cfg.KEEP_BEST_COPIES[name] !== undefined
          ? cfg.KEEP_BEST_COPIES[name]
          : Math.max(0, per * env.n_chars - by[name].worn);
      // keep: items waiting for a Ranger first, then the highest level, then the ones with a Dexterity scroll on them
      const ranked = by[name].owned.sort(
        (a, b) =>
          (b.waiting ? 1 : 0) - (a.waiting ? 1 : 0) ||
          (b.it.level || 0) - (a.it.level || 0) ||
          (b.it.stat_type ? 1 : 0) - (a.it.stat_type ? 1 : 0)
      );
      ranked.forEach((c, n) => {
        if (n < allow) return void out.kept++;
        c.value = Math.round(env.sell_value(c.it.name, c.it.level || 0));
        if (c.it.p) out.held.push({ it: c.it, value: c.value, why: "special (" + c.it.p + ")" });
        else if (c.value > cfg.SURPLUS_MAX_VALUE_EACH)
          out.held.push({ it: c.it, value: c.value, why: "worth more than SURPLUS_MAX_VALUE_EACH" });
        else out.sell.push(c);
      });
    }
    out.sell.sort((a, b) => b.value - a.value);
    return out;
  }

  // ---- surplus (bank-full seller): which finished items does no character need? ----
  // env.who_list      the characters whose slots keep items (fresh reports, already checked by the Merchant)
  // env.cands         finished candidates [{ it, score, pack,i | bag }] (score 0 = nobody can wear it)
  // env.slot_scores   (who) -> { slot: score of what he wears }
  // env.slot_of_type  item type -> slots; env.cfg { GEAR_MARGIN, SURPLUS_KEEP_SPARE, SURPLUS_MAX_VALUE_EACH }; env.G_items; env.sell_value(name, level)
  // Returns { sell: [c with .value, most valuable first], held: [{ it, value, why }], kept }.
  function surplus(env) {
    const { cfg, G_items } = env;
    const out = { sell: [], held: [], kept: 0 };
    // what each character wears per slot, as a score; kept items raise the virtual floor of the slot they would take
    const virt = {};
    for (const who of env.who_list) virt[who] = Object.assign({}, env.slot_scores(who));
    const cands = env.cands.slice().sort((a, b) => b.score - a.score);
    const spare = {};
    for (const c of cands) {
      const def = G_items[c.it.name];
      let keep = false;
      if (c.score > 0) {
        const slots = env.slot_of_type[def.type] || [];
        for (const who of env.who_list) {
          let low = null;
          for (const sl of slots) {
            const v = virt[who][sl] || 0;
            if (!low || v < low.v) low = { sl, v };
          }
          if (low && c.score > low.v * cfg.GEAR_MARGIN) {
            virt[who][low.sl] = c.score;
            keep = true;
            break;
          }
        }
      }
      if (!keep && cfg.SURPLUS_KEEP_SPARE > 0) {
        spare[def.type] = (spare[def.type] || 0) + 1;
        if (spare[def.type] <= cfg.SURPLUS_KEEP_SPARE) keep = true;
      }
      if (keep) {
        out.kept++;
        continue;
      }
      c.value = Math.round(env.sell_value(c.it.name, c.it.level || 0));
      if (c.it.p) out.held.push({ it: c.it, value: c.value, why: "special (" + c.it.p + ")" });
      else if (c.value > cfg.SURPLUS_MAX_VALUE_EACH)
        out.held.push({ it: c.it, value: c.value, why: "worth more than SURPLUS_MAX_VALUE_EACH" });
      else out.sell.push(c);
    }
    out.sell.sort((a, b) => b.value - a.value); // the most valuable first: biggest step towards the next bank slot
    return out;
  }

  return { sweep, copies, surplus };
})();
