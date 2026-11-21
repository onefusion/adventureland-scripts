  // ============================== MAIN ============================
  // ===================== COMPOUNDING (accessories) ================
  // Round: bank (take triples + gold) -> scroll NPC (buy) -> upgrade NPC (odds check, then compound)
  //        -> [Gabriel if selling results] -> bank (put everything back) -> stand.
  // Switches in the game: set("compound_paused", true) stops it, false resumes. Stats: get("compound_stats").
  const is_paused = () => {
    try {
      const v = get("compound_paused");
      return v === true || v === "true";
    } catch (e) {
      return false;
    }
  };
  function load_stats() {
    try {
      const st = JSON.parse(get("compound_stats") || "null");
      if (st && typeof st.n === "number") return st;
    } catch (e) {}
    return { n: 0, wins: 0, exp: 0, var: 0 };
  }
  // Compare real wins with the sum of the quoted chances; pause when clearly worse (about 2.5 standard deviations).
  function check_odds_honesty(st) {
    if (st.n < CFG.COMPOUND_PAUSE_MIN_ATTEMPTS) return;
    const sd = Math.sqrt(st.var);
    if (st.wins < st.exp - 2.5 * sd) {
      try {
        set("compound_paused", true);
      } catch (e) {}
      say(
        "COMPOUND PAUSED: " +
          st.wins +
          " wins in " +
          st.n +
          " tries but the server quoted ~" +
          st.exp.toFixed(1) +
          ". The quoted odds look wrong. Resume with set('compound_paused', false)",
        "#CF575F"
      );
    }
  }
  const focus_of = (name) =>
    (CFG.COMPOUND_FOCUS && CFG.COMPOUND_FOCUS[name]) ||
    wc_focus(name) ||
    rc_focus(name);
  // ---- the Warrior's compound set (CFG.WARRIOR_COMPOUND) ----
  const wc_cfg = (name) =>
    (CFG.WARRIOR_COMPOUND &&
      CFG.WARRIOR_COMPOUND.items &&
      CFG.WARRIOR_COMPOUND.items[name]) ||
    null;
  const WC_CACHE = {};
  function wc_info(name) {
    const c = WC_CACHE[name];
    if (c && now() - c.at < 700) return c;
    const cfg = wc_cfg(name);
    const who = CFG.WARRIOR_COMPOUND && CFG.WARRIOR_COMPOUND.who;
    let have = 0; // worn by the Warrior or on its way to him
    const rep_ = who && S.gears[who];
    for (const sl in (rep_ && rep_.slots) || {}) {
      const w = rep_.slots[sl];
      if (w && w.name === name && (w.level || 0) >= cfg.level) have++;
    }
    for (const pd of S.gear_pending)
      if (pd.name === name && pd.for === who && (pd.level || 0) >= cfg.level)
        have++;
    const copies = [];
    const add = (it) => {
      if (it && it.name === name && (it.level || 0) >= cfg.level)
        copies.push(it);
    };
    for (let i = 0; i < character.isize; i++) add(character.items[i]);
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach(add);
    }
    copies.sort((a, b) => (a.level || 0) - (b.level || 0)); // the lowest qualifying copies are the ones kept, the better ones can go
    const need = Math.max(0, cfg.count - have);
    const keep = new Set(copies.slice(0, need));
    const out = { at: now(), done: have + copies.length >= cfg.count, keep };
    WC_CACHE[name] = out;
    return out;
  }
  // ---- the Ranger's compound focus (CFG.RANGER_COMPOUND): same counting as the Warrior's set, but only a focus that ends when the pieces are there ----
  const rc_cfg = (name) =>
    (CFG.RANGER_COMPOUND &&
      CFG.RANGER_COMPOUND.items &&
      CFG.RANGER_COMPOUND.items[name]) ||
    null;
  const RC_CACHE = {};
  function rc_done(name) {
    const cfg = rc_cfg(name);
    if (!cfg) return true;
    const c = RC_CACHE[name];
    if (c && now() - c.at < 700) return c.done;
    const who = cfg.who || CFG.RANGER_COMPOUND.who;
    let have = 0;
    const rep_ = who === CFG.RANGER_NAME ? S.ranger_gear : S.gears[who];
    for (const sl in (rep_ && rep_.slots) || {}) {
      const w = rep_.slots[sl];
      if (w && w.name === name && (w.level || 0) >= cfg.level) have++;
    }
    for (const pd of S.gear_pending)
      if (pd.name === name && pd.for === who && (pd.level || 0) >= cfg.level)
        have++;
    const add = (it) => {
      if (it && it.name === name && (it.level || 0) >= cfg.level) have++;
    };
    for (let i = 0; i < character.isize; i++) add(character.items[i]);
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach(add);
    }
    const done = have >= cfg.count;
    RC_CACHE[name] = { at: now(), done };
    return done;
  }
  function rc_focus(name) {
    const cfg = rc_cfg(name);
    if (!cfg || rc_done(name)) return null;
    return {
      target: cfg.level,
      keep: 0,
      max_grade: CFG.COMPOUND_MAX_SCROLL_GRADE,
      min_chance: CFG.COMPOUND_MIN_CHANCE,
      budget: 0,
    };
  }
  const wc_done = (name) => !!wc_cfg(name) && wc_info(name).done;
  // every copy except the ones that make up the Warrior's set: sold as it is, whatever its level (only once the set is complete)
  const wc_surplus = (it) =>
    !!it &&
    !it.l &&
    !it.p &&
    !!wc_cfg(it.name) &&
    wc_info(it.name).done &&
    !wc_info(it.name).keep.has(it);
  function wc_focus(name) {
    const cfg = wc_cfg(name);
    if (!cfg || wc_done(name)) return null;
    return {
      target: cfg.level,
      keep: 0,
      max_grade: CFG.COMPOUND_MAX_SCROLL_GRADE,
      min_chance: CFG.COMPOUND_MIN_CHANCE,
      budget: 0,
    };
  }
  const never_sell = (it) =>
    !!it && (CFG.NEVER_SELL.indexOf(it.name) !== -1 || support_wants(it));
  const target_of = (name) =>
    focus_of(name) ? focus_of(name).target : CFG.COMPOUND_TARGET_LEVEL;
  const keep_of = (name) =>
    focus_of(name) ? focus_of(name).keep : CFG.COMPOUND_KEEP_COPIES;
  const max_grade_of = (name) =>
    focus_of(name) ? focus_of(name).max_grade : CFG.COMPOUND_MAX_SCROLL_GRADE;
  const min_chance_of = (name) =>
    focus_of(name) ? focus_of(name).min_chance : CFG.COMPOUND_MIN_CHANCE;
  const comp_max_input = (name) => target_of(name) - 1;
  const comp_ok = (it) =>
    !!it &&
    !it.l &&
    !(it.q > 1) &&
    !!G.items[it.name] &&
    !!G.items[it.name].compound &&
    (it.level || 0) <= comp_max_input(it.name) &&
    CFG.COMPOUND_SKIP.indexOf(it.name) === -1 &&
    !(wc_cfg(it.name) && wc_done(it.name)); // the Warrior's set is complete: no more of it
  const comp_key = (it) => it.name + "|" + (it.level || 0) + "|" + (it.p || "");
  const comp_label = (it) => it.name + " +" + (it.level || 0);
  function bag_list(pred) {
    const out = [];
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (it && pred(it)) out.push(i);
    }
    return out;
  }
  function bank_list() {
    const out = [];
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (!Array.isArray(arr)) continue;
      arr.forEach((it, i) => {
        if (comp_ok(it)) out.push({ pack, i, it });
      });
    }
    return out;
  }
  // Groups of 3+ identical items across bag and bank, lowest level first (best odds, cheapest)
  // The compound scroll tier follows the item's grade (cscroll0 / cscroll1 / cscroll2), not a fixed name
  const upg_max = (name) =>
    Math.max(
      CFG.UPGRADE_MAX_LEVEL,
      (CFG.UPGRADE_MAX_LEVEL_BY_ITEM && CFG.UPGRADE_MAX_LEVEL_BY_ITEM[name]) ||
        0
    );
  const upg_min_chance = (name, it) => {
    const base =
      CFG.UPGRADE_MIN_CHANCE_BY_ITEM &&
      CFG.UPGRADE_MIN_CHANCE_BY_ITEM[name] !== undefined
        ? CFG.UPGRADE_MIN_CHANCE_BY_ITEM[name]
        : CFG.UPGRADE_MIN_CHANCE;
    return it && gamble_mode(it) === "fodder"
      ? Math.min(base, CFG.UPGRADE_GAMBLE_MIN_CHANCE)
      : base;
  };
  function scroll_grade(it) {
    try {
      if (typeof item_grade === "function") {
        const g = item_grade(it);
        if (g >= 0) return g;
      }
    } catch (e) {}
    const grades = (G.items[it.name] && G.items[it.name].grades) || [];
    let g = 0;
    for (let i = 0; i < grades.length; i++)
      if ((it.level || 0) >= grades[i]) g = i + 1;
    return g;
  }
  const scroll_for = (it) => "cscroll" + scroll_grade(it);
  // ---- compound ladder: what the Rangers still lack, per accessory ----
  // held(name, t) = copies at +t or better that the Rangers wear or the Merchant holds (bag + bank); demand D = Rangers x slots.
  // The compound ladder lives in AL.planners.ladder (src/lib/planners.js, pure); this wrapper hands it the pieces held.
  function comp_state() {
    const who_list = roster();
    const pieces = [];
    for (const who of who_list) {
      const g = gear_of(who);
      for (const sl in (g && g.slots) || {}) pieces.push(g.slots[sl]);
    }
    for (let i = 0; i < character.isize; i++) pieces.push(character.items[i]);
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach((it) => pieces.push(it));
    }
    return AL.planners.ladder({
      n_chars: who_list.length,
      pieces,
      cfg: CFG,
      G_items: G.items,
      fn: {
        focus_of,
        wearable: (name) => gear_wearable({ name }),
        gear_score: (name, level) => gear_score(name, level, {}),
        would_wear: (it, L) =>
          roster().some((w) => gear_fresh_for(w) && beats_worn(it, L, w)),
      },
    });
  }

  // The decisions live in AL.planners.compound_groups (src/lib/planners.js, pure); this wrapper counts the copies held and logs what was skipped.
  function plan_groups() {
    const by = {};
    for (const i of bag_list(comp_ok)) {
      const k = comp_key(character.items[i]);
      (by[k] = by[k] || { key: k, item: character.items[i], bag: 0, bank: [] })
        .bag++;
    }
    for (const b of bank_list()) {
      const k = comp_key(b.it);
      (by[k] = by[k] || { key: k, item: b.it, bag: 0, bank: [] }).bank.push(b);
    }
    const plan = AL.planners.compound_groups({
      groups: Object.values(by),
      cfg: CFG,
      fn: {
        keep_of,
        scroll_for,
        scroll_grade,
        max_grade_of,
        focus_of,
        ladder: comp_state,
      },
    });
    for (const g of plan.skipped)
      say(
        "Compound: " +
          comp_label(g.item) +
          " needs " +
          g.scroll +
          ", above the allowed tier (COMPOUND_MAX_SCROLL_GRADE " +
          max_grade_of(g.item.name) +
          ") - skipped"
      );
    return plan.groups;
  }
  const comp_due = () =>
    CFG.COMPOUND_ENABLED &&
    !is_paused() &&
    !has_jobs() &&
    now() >= S.compound_next;

  async function open_bank_for_compound() {
    const r =
      character.map === "bank"
        ? {}
        : await travel("bank", 0, "compound round: bank");
    if (r.failed || character.map !== "bank") {
      say(
        "Compound round: could not reach the bank: " +
          (r.reason || "wrong map"),
        "#CF575F"
      );
      return false;
    }
    const ready = await call(() => wait_for(() => character.bank, 8000));
    if (ready.failed) {
      say("Compound round: bank data never loaded", "#CF575F");
      return false;
    }
    return true;
  }
  async function put_back_in_bank(pred) {
    let n = 0;
    // gear waiting for a Ranger stays in the bag (one pending entry protects one item)
    const pend = S.gear_pending.slice();
    const waiting = (x) => {
      const k = pend.findIndex(
        (g) => g.name === x.name && g.level === (x.level || 0)
      );
      if (k < 0) return false;
      pend.splice(k, 1);
      return true;
    };
    const pred0 = pred;
    pred = (x) => !!pred0(x) && !waiting(x);
    const taken = {}; // v5: bank slots used by this call (the game's bank copy may lag behind)
    for (const i of bag_list(pred)) {
      const it = character.items[i];
      if (!it) continue;
      const name = it.name;
      let res = {};
      let gone = {};
      for (let attempt = 0; attempt < 2; attempt++) {
        const spot = attempt === 0 ? bank_spot(it, taken) : null; // v5: the item's own pack; the second try lets the game choose
        res = await call(() =>
          spot
            ? spot.onto
              ? bank_store(i, spot.pack)
              : bank_store(i, spot.pack, spot.slot)
            : bank_store(i)
        ); // v5: live the game timed out on a slot-addressed store ONTO an occupied slot: a stack deposit names only the pack
        gone = await call(() =>
          wait_for(
            () => !character.items[i] || character.items[i].name !== name,
            3000
          )
        );
        if (spot && !res.failed && !gone.failed) {
          if (spot.onto)
            taken[spot.pack + ":" + spot.slot + ":q"] =
              (taken[spot.pack + ":" + spot.slot + ":q"] || 0) + (it.q || 1);
          else taken[spot.pack + ":" + spot.slot] = true;
          const there = spot.onto
            ? {}
            : await call(() =>
                wait_for(
                  () =>
                    !!character.bank[spot.pack][spot.slot] &&
                    character.bank[spot.pack][spot.slot].name === name,
                  3000
                )
              ); // a stack deposit is not checked slot by slot (the game picks the stack)
          if (there.failed)
            layout_failed(
              name +
                " was stored but is not (or not added) in " +
                spot.pack +
                " slot " +
                spot.slot
            );
        }
        if (!res.failed && !gone.failed) break;
        if (!spot) break;
        layout_failed(
          "storing " +
            name +
            " into " +
            spot.pack +
            " slot " +
            spot.slot +
            " failed (" +
            (res.reason || gone.reason) +
            "), trying the game's own slot choice"
        );
      }
      if (res.failed || gone.failed) {
        say(
          "Could not store " +
            name +
            " in the bank: " +
            (res.reason || gone.reason),
          "#CF575F"
        );
        break;
      }
      n++;
    }
    return n;
  }

  // Bank nearly full: take the cheapest compoundables (normal grade, below +3) out and sell them. High grade and +3 stay.
  function bank_free_slots() {
    let free = 0;
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (!Array.isArray(arr)) continue;
      let used = 0;
      for (const it of arr) if (it) used++;
      free += Math.max(0, bank_cap() - used);
    }
    return free;
  }
  // Junk (JUNK_SELLABLE) sitting in the bank: take it out, sell it at Gabriel, whatever the free space. Returns true if it acted.
  const is_bank_junk = (it) =>
    !!it &&
    !it.l &&
    !it.p &&
    (!(it.q > 1) || CFG.JUNK_STACKS.indexOf(it.name) !== -1) &&
    !never_sell(it) &&
    (wc_surplus(it) ||
      (CFG.JUNK_SELLABLE.indexOf(it.name) !== -1 &&
        ((it.level || 0) <= CFG.JUNK_SELL_MAX_LEVEL ||
          CFG.JUNK_ANY_LEVEL.indexOf(it.name) !== -1)));
  function bank_junk_list() {
    const out = [];
    const bank = character.bank || {};
    for (const pack in bank) {
      const arr = bank[pack];
      if (!Array.isArray(arr)) continue;
      arr.forEach((it, i) => {
        if (is_bank_junk(it)) out.push({ pack, i, it });
      });
    }
    // stackable loot above its reserve (Poison Sacks): whole bank stacks, keeping the reserve in the bag + bank
    const rs = [];
    for (const pack in bank) {
      const arr = bank[pack];
      if (!Array.isArray(arr)) continue;
      arr.forEach((it, i) => {
        if (
          it &&
          !it.l &&
          CFG.STACK_RESERVE &&
          CFG.STACK_RESERVE[it.name] !== undefined &&
          reserve_of(it.name) > 0 &&
          !never_sell(it)
        )
          rs.push({ name: it.name, q: it.q || 1, ref: { pack, i, it } });
      });
    }
    S.reserve_sell = {};
    for (const e of reserve_pick(rs)) {
      out.push(e.ref);
      S.reserve_sell[e.name] = (S.reserve_sell[e.name] || 0) + e.q;
    }
    return out;
  }
  // the Poison Sack stacks just taken out of the bank for sale (never more than the sweep planned)
  function reserve_bag_slots() {
    const allow = Object.assign({}, S.reserve_sell || {});
    const out = [];
    for (const i of bag_list(
      (x) =>
        !x.l &&
        !!allow[x.name] &&
        CFG.STACK_RESERVE &&
        CFG.STACK_RESERVE[x.name] !== undefined
    ).sort(
      (a, b) => (character.items[a].q || 1) - (character.items[b].q || 1)
    )) {
      const q = character.items[i].q || 1;
      if (allow[character.items[i].name] >= q) {
        allow[character.items[i].name] -= q;
        out.push(i);
      }
    }
    return out;
  }
  async function sweep_bank_junk() {
    if (!CFG.BANK_JUNK_SWEEP || character.map !== "bank") return false;
    if (S.junk_sweep_block && now() < S.junk_sweep_block) return false;
    const junk = bank_junk_list();
    if (!junk.length) return false;
    // v5 (Sean 2026-11-17): bag AND bank full: first sell what is already sellable in the bag (Books of Cheer ...), that makes the room to take the bank junk out
    if (
      free_slots() - 3 < Math.min(junk.length, 6) &&
      sellable_slots().length
    ) {
      const gn = find_npc(CFG.JUNK_SELL_NPC);
      const gr =
        gn &&
        (await travel(
          { map: gn.map, x: gn.x, y: gn.y },
          0,
          "selling the bag junk first (the bag is full)"
        ));
      if (gn && !gr.failed) {
        const sres = await sell_junk_here();
        say(
          "Bank junk sweep: the bag is nearly full - sold " +
            sres.sold +
            " junk item(s) from the bag first; gold is now " +
            character.gold
        );
      }
      if (!(await open_bank_for_compound())) return true;
    }
    const room = Math.max(0, free_slots() - 3);
    const pick = junk.slice(0, room);
    if (!pick.length) {
      if (now() - (S.junk_room_warn || 0) > 30 * 60000) {
        S.junk_room_warn = now();
        say(
          "Bank junk sweep: " +
            junk.length +
            " junk item(s) in the bank but the bag has " +
            free_slots() +
            " free slots and nothing sellable in it",
          "#CF575F"
        );
      }
      return false;
    }
    say(
      "Bank junk sweep: " +
        junk.length +
        " junk item(s) in the bank (" +
        pick.map((b) => b.it.name).join(", ") +
        ") - selling " +
        pick.length
    );
    // slots shift as items leave a pack: highest index first within a pack
    pick.sort((a, b) =>
      a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : b.i - a.i
    );
    let took = 0;
    for (const b of pick) {
      const have = () =>
        bag_list((x) => x.name === b.it.name).reduce(
          (n, k) => n + (character.items[k].q || 1),
          0
        ); // (a stack may merge into one the bag already holds: count the quantity)
      const before = have();
      const res = await call(() => bank_retrieve(b.pack, b.i));
      const got = await call(() => wait_for(() => have() > before, 4000));
      if (res.failed || got.failed) {
        say(
          "Could not take " +
            b.it.name +
            " out of the bank: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        break;
      }
      took++;
    }
    if (!took) {
      S.junk_sweep_block = now() + 1800000;
      return false;
    }
    const npc = find_npc(CFG.JUNK_SELL_NPC);
    const r =
      npc &&
      (await travel(
        { map: npc.map, x: npc.x, y: npc.y },
        0,
        "selling bank junk"
      ));
    if (npc && !r.failed) {
      const res = await sell_junk_here(() =>
        bag_list(is_bank_junk).concat(reserve_bag_slots())
      );
      say(
        "Sold " +
          res.sold +
          " junk item(s) from the bank; gold is now " +
          character.gold
      );
    } else {
      say("Could not reach the seller; putting the junk back", "#CF575F");
      S.junk_sweep_block = now() + 1800000;
    }
    if (bag_list(is_bank_junk).length + reserve_bag_slots().length) {
      S.junk_sweep_block = now() + 1800000;
      if (await open_bank_for_compound())
        await put_back_in_bank(
          (x) =>
            is_bank_junk(x) ||
            reserve_bag_slots().some((k) => character.items[k] === x)
        );
    } else if (character.map !== "bank") {
      await open_bank_for_compound();
    }
    return true;
  }
  async function free_bank_space() {
    if (await sweep_bank_junk()) return;
    if (!CFG.BANKFULL_SELL) return;
    const free = bank_free_slots();
    if (free >= CFG.BANKFULL_TRIGGER_FREE) return;
    const cs = comp_state();
    const cheap = (it) =>
      !!it &&
      !it.l &&
      !never_sell(it) &&
      !focus_of(it.name) &&
      !(it.q > 1) &&
      !!G.items[it.name] &&
      !!G.items[it.name].compound &&
      scroll_grade(it) < CFG.BANKFULL_KEEP_GRADE &&
      (it.level || 0) < CFG.COMPOUND_TARGET_LEVEL &&
      !cs.useful(it); // not needed by a Ranger or by the ladder
    const counts = {};
    const all = bank_list();
    for (const b of all)
      counts[comp_key(b.it)] = (counts[comp_key(b.it)] || 0) + 1;
    for (const i of bag_list(comp_ok))
      counts[comp_key(character.items[i])] =
        (counts[comp_key(character.items[i])] || 0) + 1;
    const loose_first = (a, b) =>
      (counts[comp_key(a.it)] >= 3 ? 1 : 0) -
        (counts[comp_key(b.it)] >= 3 ? 1 : 0) ||
      (a.it.level || 0) - (b.it.level || 0);
    // 1) what he is already carrying has nowhere to go: sell it (complete triples are left for compounding)
    const bag_sell = bag_list(cheap)
      .map((i) => ({ i, it: character.items[i] }))
      .filter((x) => cs || counts[comp_key(x.it)] < 3); // need-driven: "cheap" already means no Ranger and no ladder step needs it
    // 2) then bank items until about BANKFULL_TARGET_FREE slots are free
    const victims = all.filter((b) => cheap(b.it)).sort(loose_first);
    const want = Math.max(
      0,
      Math.min(
        victims.length,
        CFG.BANKFULL_TARGET_FREE - free,
        free_slots() - 3 - bag_sell.length
      )
    );
    const pick = victims.slice(0, want);
    if (!bag_sell.length && !pick.length) {
      if (CFG.SURPLUS_SELL && (await sell_surplus(free))) return;
      if (S.bankfull_warned) return;
      S.bankfull_warned = true;
      say(
        "Bank is nearly full (" +
          free +
          " free) but nothing is eligible to sell (high grade and +" +
          CFG.COMPOUND_SELL_AT_LEVEL +
          " are kept)",
        "#CF575F"
      );
      return;
    }
    const total = bag_sell.length + pick.length;
    if (CFG.BANKFULL_DRY_RUN) {
      say(
        "Bank is nearly full (" +
          free +
          " free) - dry run, would sell " +
          total +
          ": " +
          bag_sell
            .map((x) => comp_label(x.it) + " (bag)")
            .concat(pick.map((b) => comp_label(b.it)))
            .join(", ")
      );
      return;
    }
    say(
      "Bank is nearly full (" +
        free +
        " free) - selling " +
        total +
        " normal-grade accessory item(s) (" +
        bag_sell.length +
        " from the bag, " +
        pick.length +
        " from the bank)"
    );
    const names = {};
    for (const x of bag_sell) names[comp_key(x.it)] = true;
    // slots shift as items leave a pack, so take them highest index first within a pack
    pick.sort((a, b) =>
      a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : b.i - a.i
    );
    for (const b of pick) {
      const before = bag_list((x) => x.name === b.it.name).length;
      const res = await call(() => bank_retrieve(b.pack, b.i));
      const got = await call(() =>
        wait_for(
          () => bag_list((x) => x.name === b.it.name).length > before,
          4000
        )
      );
      if (res.failed || got.failed) {
        say(
          "Could not take " +
            comp_label(b.it) +
            " out of the bank: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        break;
      }
      names[comp_key(b.it)] = true;
    }
    // only keys that are not part of a complete triple, so compounding material is never sold by mistake
    const mine = (x) => cheap(x) && !!names[comp_key(x)];
    const npc = find_npc(CFG.JUNK_SELL_NPC);
    const r =
      npc &&
      (await travel(
        { map: npc.map, x: npc.x, y: npc.y },
        0,
        "selling bank overflow"
      ));
    if (npc && !r.failed) {
      const res = await sell_junk_here(() => bag_list(mine));
      say(
        "Sold " +
          res.sold +
          " accessory item(s) to free bank space; gold is now " +
          character.gold
      );
    } else {
      say("Could not reach the seller; putting the items back", "#CF575F");
    }
    if (await open_bank_for_compound()) await put_back_in_bank(mine);
  }
