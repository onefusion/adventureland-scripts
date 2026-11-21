// ============================== AL.planners: pure Merchant planners (stage 5 of the refactor, 2026-11-21) ==============================
// A planner decides; it does not walk, open the bank or send anything. It reads a plain input object and returns a plan, so it can be tested
// without the game. The Merchant builds the input from its live state (`env`) and acts on the plan.
// Planners so far: sweep (which finished / stuck gear goes to which character), copies (the copy limit), surplus (the bank-full seller), ladder (the compound ladder), compound_groups (which stacks to compound).
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

  // ---- ladder (compound state): what the compound ladder wants, from the copies held ----
  // Rangers always wear the highest compounded gear; the preferred item of each kind is built up level by level until every slot is covered.
  // env.n_chars          how many characters count (the Rangers)
  // env.pieces           every piece to count, in order: worn (all reports), bag, bank   [{ name, level, l }]
  // env.cfg              { COMPOUND_TARGET_LEVEL, SURPLUS_COPIES_PER_RANGER }, env.G_items
  // env.fn               focus_of(name) -> { target } | null, wearable(name), gear_score(name, level), would_wear(it, level) (a character would wear it)
  // Returns { levels, demand, held, preferred, ladder_ok, take_triples, useful, report } (the shape the Merchant has always used).
  function ladder(env) {
    const { cfg, G_items, fn } = env;
    const target = cfg.COMPOUND_TARGET_LEVEL;
    const levels = {};
    for (const it of env.pieces) {
      if (!it || it.l || !it.name) continue;
      const def = G_items[it.name];
      if (!def || !def.compound || (!fn.focus_of(it.name) && !fn.wearable(it.name))) continue;
      (levels[it.name] = levels[it.name] || []).push(it.level || 0);
    }
    const demand = (name) => env.n_chars * (cfg.SURPLUS_COPIES_PER_RANGER[G_items[name].type] || 1);
    const held = (name, t) => (levels[name] || []).filter((l) => l >= t).length;
    // the preferred item of each kind: the best score at the target level
    const best = {};
    for (const name in levels) {
      const type = G_items[name].type;
      const sc = fn.gear_score(name, target);
      if (sc > 0 && (!best[type] || sc > best[type].sc)) best[type] = { name, sc };
    }
    const preferred = (name) => !!G_items[name] && !!best[G_items[name].type] && best[G_items[name].type].name === name;
    // may a triple of `name` at level L be compounded now?
    const ladder_ok = (name, L) => {
      if (fn.focus_of(name)) return L + 1 <= fn.focus_of(name).target; // focus items: funnel everything up to the target
      if (!preferred(name)) return false;
      const R = L + 1;
      if (R > target) return false;
      const D = demand(name);
      let open = false;
      for (let t = R; t <= target; t++) if (held(name, t) < D) open = true;
      if (!open) return false;
      for (let t = 1; t <= L; t++) if (held(name, t) - 2 < D) return false; // lower tiers must stay covered
      return true;
    };
    // is this item still useful as compound material or as a worn piece?
    const useful = (it) => {
      const name = it.name;
      const L = it.level || 0;
      if (!G_items[name] || !G_items[name].compound) return false;
      if (fn.focus_of(name)) return true; // books are never dead stock
      if (fn.would_wear(it, L)) return true; // a Ranger would wear it
      if (!preferred(name)) return false;
      for (let t = L + 1; t <= target; t++) if (held(name, t) < demand(name)) return true;
      return false;
    };
    const report = () =>
      Object.keys(levels)
        .filter(preferred)
        .map((n) => {
          const D = demand(n);
          const row = [];
          for (let t = 1; t <= target; t++) row.push("+" + t + " " + Math.min(held(n, t), D) + "/" + D);
          return n + ": " + row.join(", ");
        })
        .join(" | ");
    // plan up to `avail` triples at level L: each one consumes three copies and adds one at L+1, so later triples see the new state
    const take_triples = (name, L, avail) => {
      let k = 0;
      const arr = levels[name] || [];
      while (k < avail && ladder_ok(name, L)) {
        for (let i = 0; i < 3; i++) {
          const idx = arr.indexOf(L);
          if (idx >= 0) arr.splice(idx, 1);
        }
        arr.push(L + 1);
        k++;
      }
      return k;
    };
    return { levels, demand, held, preferred, ladder_ok, take_triples, useful, report };
  }

  // ---- compound groups: which stacks of identical items are compounded now, and how many triples ----
  // env.groups   [{ key, item, bag, bank: [..] }]  copies per kind and level (bag count, bank entries), built by the Merchant
  // env.cfg      { COMPOUND_NEED_DRIVEN }
  // env.fn       keep_of(name), scroll_for(item), scroll_grade(item), max_grade_of(name), focus_of(name), ladder() -> the ladder planner state
  // Returns { groups: [g with .scroll .grade .max_triples], skipped: [g] } (skipped = needs a scroll above the allowed tier), lowest level first.
  function compound_groups(env) {
    const { cfg, fn } = env;
    const skipped = [];
    let ladder_cs = null;
    const groups = env.groups
      .filter((g) => g.bag + g.bank.length >= 3 + fn.keep_of(g.item.name))
      .map((g) => Object.assign(g, { scroll: fn.scroll_for(g.item), grade: fn.scroll_grade(g.item) }))
      .filter((g) => {
        if (g.grade <= fn.max_grade_of(g.item.name)) return true;
        skipped.push(g);
        return false;
      })
      .sort((a, b) => (a.item.level || 0) - (b.item.level || 0))
      .filter((g) => {
        // never use the last copies: a failed compound destroys all three, so a full triple stays behind
        const spare = Math.floor((g.bag + g.bank.length - fn.keep_of(g.item.name)) / 3);
        if (!cfg.COMPOUND_NEED_DRIVEN && !fn.focus_of(g.item.name)) {
          g.max_triples = spare;
          return spare > 0;
        }
        if (!ladder_cs) ladder_cs = fn.ladder();
        // lowest level first; every planned triple changes what the next one sees
        g.max_triples = ladder_cs.take_triples(g.item.name, g.item.level || 0, spare);
        return g.max_triples > 0;
      });
    return { groups, skipped };
  }

  return { sweep, copies, surplus, ladder, compound_groups };
})();
