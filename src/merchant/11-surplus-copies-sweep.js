  // ---- surplus finished items in the bank ----
  // Which finished bank items does no Ranger need? Returns {sell:[{pack,i,it,value}], held:[{it,value,why}], kept, why}
  function surplus_plan(with_bag) {
    const out = { sell: [], held: [], kept: 0, why: "" };
    const who_list = roster();
    for (const who of who_list)
      if (!gear_fresh_for(who)) {
        out.why =
          "no fresh gear report from " +
          who +
          " (nothing is sold until all Rangers have reported)";
        return out;
      }
    if (!value_fn()) {
      out.why = "the game's item value function is not available";
      return out;
    }
    const cands = [];
    const consider = (it, where) => {
      const def = it && G.items[it.name];
      if (!def || it.l || it.q > 1 || never_sell(it)) return;
      if (!def.compound && !def.upgrade) return;
      const cap = def.compound ? CFG.COMPOUND_TARGET_LEVEL : upg_max(it.name);
      if ((it.level || 0) < cap) return; // not finished: compounding / upgrading may still use it
      const score = gear_wearable(it)
        ? gear_score(it.name, it.level || 0, { stat_type: it.stat_type })
        : 0;
      cands.push(Object.assign({ it, score }, where));
    };
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach((it, i) => consider(it, { pack, i }));
    }
    if (with_bag) {
      const pend = S.gear_pending.slice();
      for (let i = 0; i < character.isize; i++) {
        const it = character.items[i];
        if (!it) continue;
        const k = pend.findIndex(
          (g) => g.name === it.name && g.level === (it.level || 0)
        );
        if (k >= 0) {
          pend.splice(k, 1); // waiting for a Ranger: not surplus
          continue;
        }
        consider(it, { bag: i });
      }
    }
    // the decisions live in AL.planners.surplus (src/lib/planners.js, pure)
    const plan = AL.planners.surplus({
      who_list,
      cands,
      slot_scores: (who) => {
        const res = {};
        const g = gear_of(who);
        for (const sl in (g && g.slots) || {}) {
          const w = g.slots[sl];
          res[sl] = w ? gear_score(w.name, w.level, { stat_type: w.stat_type }) : 0;
        }
        return res;
      },
      slot_of_type: SLOT_OF_TYPE,
      cfg: CFG,
      G_items: G.items,
      sell_value,
    });
    out.sell = plan.sell;
    out.held = plan.held;
    out.kept = plan.kept;
    return out;
  }
  // true = it handled the situation (sold); false = nothing to do
  async function sell_surplus(free) {
    const plan = surplus_plan();
    const sig =
      plan.why +
      "|" +
      plan.sell.map((c) => c.pack + c.i + c.it.name).join(",") +
      "|" +
      plan.held.length;
    if (plan.why) {
      if (S.surplus_sig !== sig)
        say("Surplus check skipped: " + plan.why, "#CF575F");
      S.surplus_sig = sig;
      return false;
    }
    const want = Math.max(
      0,
      Math.min(
        plan.sell.length,
        CFG.BANKFULL_TARGET_FREE - free,
        free_slots() - 3
      )
    );
    const pick = plan.sell.slice(0, want);
    if (S.surplus_sig !== sig) {
      S.surplus_sig = sig;
      say(
        "Surplus check: " +
          plan.kept +
          " finished item(s) kept for the Rangers, " +
          plan.sell.length +
          " surplus (" +
          plan.sell.reduce((a, c) => a + c.value, 0) +
          "g expected), " +
          plan.held.length +
          " held back"
      );
      for (const h of plan.held)
        say(
          "  held back: " +
            comp_label(h.it) +
            " ~" +
            h.value +
            "g - " +
            h.why +
            " (sell it yourself if you agree)"
        );
    }
    if (!pick.length) return false;
    say(
      "Bank nearly full (" +
        free +
        " free) - selling " +
        pick.length +
        " surplus finished item(s) no Ranger needs"
    );
    pick.sort((a, b) =>
      a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : b.i - a.i
    ); // highest slot first within a pack
    const mine = []; // bag slots holding what we took out
    const keys = {};
    for (const c of pick) {
      const before = {};
      for (const i of bag_list(
        (x) => x.name === c.it.name && (x.level || 0) === (c.it.level || 0)
      ))
        before[i] = true;
      const res = await call(() => bank_retrieve(c.pack, c.i));
      const got = await call(() =>
        wait_for(
          () =>
            bag_list(
              (x) =>
                x.name === c.it.name && (x.level || 0) === (c.it.level || 0)
            ).some((i) => !before[i]),
          4000
        )
      );
      if (res.failed || got.failed) {
        say(
          "Could not take " +
            comp_label(c.it) +
            " out of the bank: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        break;
      }
      const slot = bag_list(
        (x) => x.name === c.it.name && (x.level || 0) === (c.it.level || 0)
      ).find((i) => !before[i]);
      mine.push({ slot, name: c.it.name });
      keys[comp_key(c.it)] = true;
    }
    if (!mine.length) return true;
    const still = () =>
      mine
        .filter(
          (m) =>
            character.items[m.slot] && character.items[m.slot].name === m.name
        )
        .map((m) => m.slot);
    const npc = find_npc(CFG.JUNK_SELL_NPC);
    const r =
      npc &&
      (await travel(
        { map: npc.map, x: npc.x, y: npc.y },
        0,
        "selling surplus bank items"
      ));
    if (npc && !r.failed) {
      const g0 = character.gold;
      const res = await sell_junk_here(still);
      say(
        "Sold " +
          res.sold +
          " surplus item(s); gold is now " +
          character.gold +
          " (+" +
          Math.max(0, character.gold - g0) +
          ")"
      );
    } else say("Could not reach the seller; putting the items back", "#CF575F");
    // always go back to the bank: the compound round that called this goes on there
    if (await open_bank_for_compound()) {
      if (still().length)
        await put_back_in_bank((x) => !!keys[comp_key(x)] && !x.l);
    }
    return true;
  }

  // ---- copy limit: never more copies of one finished item than the Rangers can wear ----
  function copies_plan() {
    const out = { sell: [], held: [], kept: 0, why: "" };
    const who_list = roster();
    for (const who of who_list)
      if (!gear_fresh_for(who)) {
        out.why = "no fresh gear report from " + who;
        return out;
      }
    if (!value_fn()) {
      out.why = "the game's item value function is not available";
      return out;
    }
    const L = CFG.SURPLUS_COPY_LEVEL;
    const worn_names = [];
    for (const who of who_list) {
      const g = gear_of(who);
      for (const sl in (g && g.slots) || {}) {
        const w = g.slots[sl];
        if (w && w.name && (w.level || 0) >= L) worn_names.push(w.name);
      }
    }
    const pend = S.gear_pending.slice();
    const owned = [];
    const add = (it, where) => {
      const def = it && G.items[it.name];
      if (!def || it.l || it.q > 1 || (!def.upgrade && !def.compound)) return;
      const kb = !!CFG.KEEP_BEST_COPIES[it.name];
      if (!kb && (!gear_wearable(it) || (it.level || 0) < L)) return;
      const k = pend.findIndex(
        (g) => g.name === it.name && g.level === (it.level || 0)
      );
      let waiting = false;
      if (k >= 0 && where.bag !== undefined) {
        pend.splice(k, 1);
        waiting = true;
      }
      owned.push(Object.assign({ it, waiting, kb }, where));
    };
    for (let i = 0; i < character.isize; i++)
      add(character.items[i], { bag: i });
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach((it, i) => add(it, { pack, i }));
    }
    // the decisions live in AL.planners.copies (src/lib/planners.js, pure)
    const plan = AL.planners.copies({
      n_chars: who_list.length,
      worn_names,
      owned,
      cfg: CFG,
      G_items: G.items,
      sell_value,
    });
    out.sell = plan.sell;
    out.held = plan.held;
    out.kept = plan.kept;
    return out;
  }
  // The bank must be open. Sells the extra copies. Leaves the Merchant at the bank.
  async function sell_copies() {
    S.copies_last = now();
    // "Consolidate bank and inventory": only when the bank is running out of ITEM slots (not packs: a pack holds 42)
    const free_items = bank_free_slots();
    const pressure = free_items < CFG.BANKFULL_TRIGGER_FREE; // without it only the KEEP_BEST_COPIES surplus is sold
    if (!pressure && !Object.keys(CFG.KEEP_BEST_COPIES).length) return;
    if (pressure && S.consol_logged !== true) {
      S.consol_logged = true;
      say(
        "Consolidating bank and inventory: only " +
          free_items +
          " free bank item slots (limit " +
          CFG.BANKFULL_TRIGGER_FREE +
          ")"
      );
    }
    const plan = copies_plan();
    if (!pressure) plan.sell = plan.sell.filter((c) => c.kb);
    const sig =
      plan.why +
      "|" +
      plan.sell
        .map(
          (c) =>
            (c.pack || "bag") + (c.i !== undefined ? c.i : c.bag) + c.it.name
        )
        .join(",") +
      "|" +
      plan.held.length;
    if (plan.why) {
      if (S.copies_sig !== sig)
        say("Copy limit check skipped: " + plan.why, "#CF575F");
      S.copies_sig = sig;
      return;
    }
    if (S.copies_sig !== sig) {
      S.copies_sig = sig;
      if (plan.sell.length || plan.held.length)
        say(
          "Copy limit: " +
            plan.kept +
            " copies kept, " +
            plan.sell.length +
            " extra (" +
            plan.sell.reduce((a, c) => a + c.value, 0) +
            "g expected), " +
            plan.held.length +
            " held back"
        );
      for (const h of plan.held)
        say(
          "  held back: " +
            comp_label(h.it) +
            " ~" +
            h.value +
            "g - " +
            h.why +
            " (sell it yourself if you agree)"
        );
    }
    if (!plan.sell.length) return;
    // bag items first (no bank trip needed), then as many bank items as the bag has room for
    const room = Math.max(0, free_slots() - 3);
    const pick = plan.sell
      .filter((c) => c.bag !== undefined)
      .concat(plan.sell.filter((c) => c.pack !== undefined).slice(0, room));
    say(
      "Copy limit - selling " +
        pick.length +
        " extra copie(s) beyond what the Rangers can wear"
    );
    const bank_picks = pick
      .filter((c) => c.pack !== undefined)
      .sort((a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : b.i - a.i));
    const mine = pick
      .filter((c) => c.bag !== undefined)
      .map((c) => ({ slot: c.bag, name: c.it.name }));
    const keys = {};
    for (const c of pick) keys[comp_key(c.it)] = true;
    for (const c of bank_picks) {
      const same = (x) =>
        x.name === c.it.name && (x.level || 0) === (c.it.level || 0);
      const before = {};
      for (const i of bag_list(same)) before[i] = true;
      const res = await call(() => bank_retrieve(c.pack, c.i));
      const got = await call(() =>
        wait_for(() => bag_list(same).some((i) => !before[i]), 4000)
      );
      if (res.failed || got.failed) {
        say(
          "Could not take " +
            comp_label(c.it) +
            " out of the bank: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        break;
      }
      mine.push({
        slot: bag_list(same).find((i) => !before[i]),
        name: c.it.name,
      });
    }
    if (!mine.length) return;
    const still = () =>
      mine
        .filter(
          (m) =>
            character.items[m.slot] && character.items[m.slot].name === m.name
        )
        .map((m) => m.slot);
    const npc = find_npc(CFG.JUNK_SELL_NPC);
    const r =
      npc &&
      (await travel(
        { map: npc.map, x: npc.x, y: npc.y },
        0,
        "selling extra copies"
      ));
    if (npc && !r.failed) {
      const g0 = character.gold;
      const res = await sell_junk_here(still);
      say(
        "Sold " +
          res.sold +
          " extra copie(s); gold is now " +
          character.gold +
          " (+" +
          Math.max(0, character.gold - g0) +
          ")"
      );
    } else say("Could not reach the seller; putting the items back", "#CF575F");
    if (await open_bank_for_compound()) {
      if (still().length)
        await put_back_in_bank((x) => !!keys[comp_key(x)] && !x.l);
    }
  }

  // ---- gear sweep ----
  // Gear that is finished (max level) or stuck (cannot be taken further by us) and would beat a Ranger's worn slot.
  // The decisions live in AL.planners.sweep (src/lib/planners.js, pure); this wrapper reads the live state into its input.
  function sweep_plan() {
    const out = { give: [], why: "" };
    // v5: only characters with a fresh gear report are served, so an offline Ranger no longer blocks the sweep (the leader must have reported).
    // Selling decisions (surplus, copy limit) still wait for every Ranger: an offline one might need the item.
    if (!roster().some(gear_fresh_for)) {
      out.why = "no fresh gear report from " + roster().join(", ");
      return out;
    }
    const who_list = roster().filter(gear_fresh_for);
    const sup_list = support_names().filter(gear_fresh_for); // v5: support characters with a fresh report are served after the Rangers
    const items = [];
    const cs = comp_state();
    const add = (it, where) => {
      if (
        !it ||
        it.l ||
        it.q > 1 ||
        !(gear_wearable(it) || sup_list.some((w) => gear_wearable(it, w)))
      )
        return;
      const def = G.items[it.name];
      if (!def || (!def.upgrade && !def.compound)) return;
      items.push(Object.assign({ it }, where));
    };
    for (let i = 0; i < character.isize; i++)
      add(character.items[i], { bag: i });
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach((it, i) => add(it, { pack, i }));
    }
    // the Warrior's basher (kept in his bag, never worn): the first unlocked single one in the bag, else in the bank
    const find_kit = (nm) => {
      for (let i = 0; i < character.isize; i++) {
        const it = character.items[i];
        if (it && it.name === nm && !it.l && !(it.q > 1)) return { it, bag: i };
      }
      for (const pack of CFG.UPGRADE_PACKS) {
        const arr = character.bank && character.bank[pack];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i];
          if (it && it.name === nm && !it.l && !(it.q > 1)) return { it, pack, i };
        }
      }
      return null;
    };
    const plan = AL.planners.sweep({
      who_list,
      sup_list,
      items,
      cfg: CFG,
      G_items: G.items,
      fn: {
        comp_key,
        target_of,
        keep_of,
        comp_ok,
        scroll_grade,
        max_grade_of,
        ladder_ok: cs.ladder_ok,
        upg_max,
        upg_ok,
        upg_has_spare,
        gear_score,
        gear_wearable,
        support_cfg,
        two_hand,
        slots_of,
        slot_scores: (who) => {
          const res = {};
          const g = gear_of(who);
          for (const sl in (g && g.slots) || {}) {
            const w = g.slots[sl];
            res[sl] = w ? gear_score(w.name, w.level, { stat_type: w.stat_type, who }) : 0;
          }
          return res;
        },
        kit_missing,
        kit_names,
        find_kit,
      },
    });
    out.give = plan.give;
    if (plan.no_kit) out.no_kit = plan.no_kit;
    return out;
  }
  // The bank must be open. Takes what is needed into the bag, marks it as waiting for its Ranger, tells the leader.
  async function gear_sweep_here() {
    S.sweep_last = now();
    const plan = sweep_plan();
    if (plan.why) {
      if (S.sweep_sig !== plan.why)
        say("Gear sweep skipped: " + plan.why, "#CF575F");
      S.sweep_sig = plan.why;
      return;
    }
    if (
      plan.no_kit &&
      plan.no_kit.length &&
      now() - (S.kit_hint_at || 0) > 3600000
    ) {
      S.kit_hint_at = now();
      say(
        plan.no_kit.join(", ") +
          " has no basher in his bag (Stomp needs one) and I have none: buy a Wooden Basher from Gabriel (about 4,900 g) and put it in my bag or the bank",
        "#CF575F"
      );
    }
    // what is already waiting (one entry per item) counts first
    const claimed = {};
    for (const p of S.gear_pending) {
      const k =
        p.name + "|" + p.level + "|" + p.for + (p.alt ? "+" + p.slot : "");
      claimed[k] = (claimed[k] || 0) + 1;
    }
    const todo = [];
    for (const g of plan.give) {
      const k =
        g.c.it.name +
        "|" +
        (g.c.it.level || 0) +
        "|" +
        g.who +
        (/\+$/.test(g.who) ? g.slot : "");
      if (claimed[k] > 0) {
        claimed[k]--;
        continue;
      }
      todo.push(g);
    }
    const from_bank = todo.filter((g) => g.c.pack !== undefined);
    const room = Math.max(0, free_slots() - CFG.GEAR_SWEEP_BAG_RESERVE);
    const take = from_bank.slice(0, room);
    take.sort((a, b) =>
      a.c.pack < b.c.pack ? -1 : a.c.pack > b.c.pack ? 1 : b.c.i - a.c.i
    ); // highest slot first within a pack
    const got = [];
    for (const g of take) {
      const it = g.c.it;
      const before = bag_list(
        (x) => x.name === it.name && (x.level || 0) === (it.level || 0)
      ).length;
      const res = await call(() => bank_retrieve(g.c.pack, g.c.i));
      const ok = await call(() =>
        wait_for(
          () =>
            bag_list(
              (x) => x.name === it.name && (x.level || 0) === (it.level || 0)
            ).length > before,
          4000
        )
      );
      if (res.failed || ok.failed) {
        say(
          "Could not take " +
            comp_label(it) +
            " out of the bank: " +
            (res.reason || ok.reason),
          "#CF575F"
        );
        break;
      }
      got.push(g);
    }
    const mine = todo.filter((g) => g.c.bag !== undefined).concat(got);
    for (const g of mine) {
      const it = g.c.it;
      S.gear_pending.push({
        name: it.name,
        level: it.level || 0,
        for: g.who.replace(/\+$/, ""),
        kit: g.slot === "bag",
        alt: /\+$/.test(g.who),
        slot: g.slot,
      });
      say(
        "Gear sweep: " +
          comp_label(it) +
          " for " +
          g.who +
          " (better than his " +
          g.slot +
          ")",
        "#5BCB5B"
      );
    }
    if (from_bank.length > take.length)
      say(
        "Gear sweep: " +
          (from_bank.length - take.length) +
          " more item(s) wait in the bank (bag is nearly full)"
      );
    // the leader decides when the courier fetches it: tell him gear is waiting
    const waiting = [...new Set(S.gear_pending.map((p) => p.for))];
    if (waiting.length)
      await reply(CFG.RANGER_NAME, { type: "gear_ready", names: waiting });
  }