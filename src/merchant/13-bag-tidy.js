  // ---- bag tidy ----
  // Nothing else frees a full Merchant bag. He sells the junk he is allowed to sell, extra finished/extra-copy gear
  // (same keep rules as the bank sellers), banks compound material and loot when the bank has room, and logs what fills the bag.
  function bag_census() {
    const n = {};
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (!it) continue;
      const k =
        it.name +
        (it.level ? " +" + it.level : "") +
        (it.q > 1 ? " x" + it.q : "");
      n[k] = (n[k] || 0) + 1;
    }
    return Object.keys(n)
      .map((k) => (n[k] > 1 ? n[k] + "x " : "") + k)
      .join(", ");
  }
  // Compound gear in the bag that nobody will ever need: not wanted by a Ranger, not the preferred kind, or its ladder tiers are all covered.
  // (Complete triples of these used to sit in the bag forever: not compounded, not sold.) Needs fresh gear reports from every Ranger.
  function dead_stock_bag() {
    const out = { sell: [], why: "" };
    for (const who of roster())
      if (!gear_fresh_for(who)) {
        out.why = "no fresh gear report from " + who;
        return out;
      }
    if (!value_fn()) {
      out.why = "the game's item value function is not available";
      return out;
    }
    const cs = comp_state();
    const pend = S.gear_pending.slice();
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (!it || it.l || it.p || it.q > 1) continue;
      const def = G.items[it.name];
      if (
        !def ||
        !def.compound ||
        never_sell(it) ||
        focus_of(it.name) ||
        (it.level || 0) >= CFG.COMPOUND_TARGET_LEVEL
      )
        continue;
      if (scroll_grade(it) >= CFG.BANKFULL_KEEP_GRADE) continue;
      const k = pend.findIndex(
        (g) => g.name === it.name && g.level === (it.level || 0)
      );
      if (k >= 0) {
        pend.splice(k, 1);
        continue;
      }
      if (cs.useful(it)) continue;
      const value = Math.round(sell_value(it.name, it.level || 0));
      if (value > CFG.SURPLUS_MAX_VALUE_EACH) continue;
      out.sell.push({ bag: i, it, value });
    }
    return out;
  }
  const tidy_due = () =>
    CFG.BAG_TIDY &&
    !has_jobs() &&
    !is_paused() &&
    (free_slots() <= CFG.BAG_TIDY_FREE ||
      sellable_slots().length >= CFG.BAG_TIDY_JUNK ||
      bag_list(is_stack).length > 0) &&
    now() >= (S.tidy_next || 0);
  async function bag_tidy() {
    S.tidy_next = now() + CFG.BAG_TIDY_EVERY_MS;
    say(
      (free_slots() <= CFG.BAG_TIDY_FREE
        ? "Bag is nearly full ("
        : "Junk is piling up (") +
        free_slots() +
        " free): " +
        bag_census(),
      "#E1A951"
    );
    await drain_stand("a bag tidy");
    // 1) what can be sold from the bag: junk always, surplus gear by the same rules as the bank
    const sell_slots = {};
    for (const i of sellable_slots()) sell_slots[i] = "junk";
    let note = "";
    const sp = surplus_plan(true);
    const cp = copies_plan();
    if (sp.why || cp.why) note = sp.why || cp.why;
    for (const c of (sp.why ? [] : sp.sell).concat(cp.why ? [] : cp.sell))
      if (c.bag !== undefined && !sell_slots[c.bag])
        sell_slots[c.bag] = comp_label(c.it) + " ~" + c.value + "g";
    const ds = dead_stock_bag();
    if (ds.why && !note) note = ds.why;
    for (const c of ds.sell)
      if (!sell_slots[c.bag])
        sell_slots[c.bag] =
          comp_label(c.it) +
          " ~" +
          c.value +
          "g (no Ranger or ladder step needs it)";
    if (note)
      say(
        "Bag tidy: gear checks skipped - " + note + " (junk is still sold)",
        "#CF575F"
      );
    if (note) S.tidy_next = now() + 240000; // look again soon: the gear reports may just not be in yet
    const slots = Object.keys(sell_slots).map(Number);
    if (slots.length) {
      const npc = find_npc(CFG.JUNK_SELL_NPC);
      const r =
        npc &&
        (await travel(
          { map: npc.map, x: npc.x, y: npc.y },
          0,
          "selling from the full bag"
        ));
      if (npc && !r.failed) {
        const names = {};
        for (const i of slots)
          names[i] = character.items[i] && character.items[i].name;
        const res = await sell_junk_here(() =>
          slots.filter(
            (i) => character.items[i] && character.items[i].name === names[i]
          )
        );
        say(
          "Bag tidy: sold " +
            res.sold +
            " item(s); " +
            free_slots() +
            " bag slots free"
        );
      } else say("Bag tidy: could not reach the seller", "#CF575F");
    }
    // 1b) stackable loot a Ranger handed over (boss event): banked, never sold; a full bank gets room made first
    if (bag_list(is_stack).length && (await open_bank_for_compound())) {
      let nb = await put_back_in_bank(is_stack);
      if (bag_list(is_stack).length) {
        await free_bank_space();
        if (character.map === "bank" || (await open_bank_for_compound()))
          nb += await put_back_in_bank(is_stack);
      }
      say(
        "Bag tidy: banked " +
          nb +
          " stackable item(s)" +
          (bag_list(is_stack).length
            ? "; " +
              bag_list(is_stack).length +
              " could not be banked (bank full)"
            : "")
      );
    }
    // 2) still tight: bank what the compound/upgrade rounds will pick up again (never gear waiting for a Ranger: put_back protects it)
    if (free_slots() <= CFG.BAG_TIDY_FREE) {
      if (await open_bank_for_compound()) {
        const n = await put_back_in_bank(
          (x) =>
            !x.l &&
            !!G.items[x.name] &&
            (is_keeper(x) ||
              !!G.items[x.name].compound ||
              !!G.items[x.name].upgrade)
        );
        if (n)
          say(
            "Bag tidy: put " +
              n +
              " item(s) in the bank; " +
              free_slots() +
              " bag slots free"
          );
        else
          say(
            "Bag tidy: nothing could be banked (bank " +
              (bank_free_slots()
                ? "has room but the items are protected"
                : "is full") +
              ")",
            "#CF575F"
          );
      }
    }
    // 3) still nearly out of room: bank everything he does not need on him (potions, scrolls and stand stock stay; so does gear waiting for a Ranger).
    //    Boss drops (Grinch) are rarely compound / upgrade material, so step 2 left them in the bag.
    if (
      free_slots() <= CFG.BAG_TIDY_FORCE_FREE &&
      (await open_bank_for_compound())
    ) {
      const n = await put_back_in_bank(
        (x) => !x.l && !x.p && !!G.items[x.name] && !stack_protected(x.name)
      );
      if (n)
        say(
          "Bag tidy: banked " +
            n +
            " more item(s) he does not need on him; " +
            free_slots() +
            " bag slots free"
        );
    }
    if (free_slots() <= CFG.BAG_TIDY_FREE)
      say(
        "Bag is still nearly full (" +
          free_slots() +
          " free) - needs your attention: " +
          bag_census(),
        "#CF575F"
      );
    return go_home();
  }

  async function compound_round() {
    S.compound_next = now() + CFG.COMPOUND_EVERY_MS; // set first, so a failed round never loops
    S.compound_attempts = 0;
    if (!S.compound_chained) S.compound_chain = 0;
    S.compound_chained = false;
    await drain_stand("a compound round");
    if (!(await open_bank_for_compound())) return go_home();

    // the Rangers' needs first: hand-outs are marked as waiting, so nothing below sells or compounds them
    if (CFG.GEAR_SWEEP && now() - S.sweep_last >= CFG.GEAR_SWEEP_EVERY_MS)
      await gear_sweep_here();
    if (
      CFG.SURPLUS_SELL &&
      CFG.SURPLUS_COPIES &&
      now() - (S.copies_last || 0) >= CFG.GEAR_SWEEP_EVERY_MS
    )
      await sell_copies();
    await free_bank_space();
    {
      const rep_ = comp_state().report();
      if (rep_ && rep_ !== S.ladder_sig) {
        S.ladder_sig = rep_;
        say(
          "Compound ladder (copies at that level or better / Ranger slots): " +
            rep_,
          "#51D2E1"
        );
      }
    }
    const bank_gold = Number(character.bank && character.bank.gold);
    if (!(bank_gold >= CFG.COMPOUND_BANK_FLOOR)) {
      say(
        "Compounding stopped: bank holds " +
          bank_gold +
          " gold, below the " +
          CFG.COMPOUND_BANK_FLOOR +
          " floor",
        "#CF575F"
      );
      return go_home();
    }
    if (S.compound_cap === null) {
      S.compound_cap = Math.floor(bank_gold * CFG.COMPOUND_SESSION_PCT);
      say(
        "Compounding budget for this session: " +
          S.compound_cap +
          " gold (" +
          Math.round(CFG.COMPOUND_SESSION_PCT * 100) +
          "% of the bank)"
      );
    }
    let left = S.compound_cap - S.compound_spent;
    const groups = plan_groups();
    if (!groups.length) {
      say(
        "Compound round: no triples of identical items (+" +
          (CFG.COMPOUND_TARGET_LEVEL - 1) +
          " or lower) found"
      );
      return go_home();
    }
    // pick groups while the budget (for the scroll tier each one needs) and the bag space last
    const by_slots = Math.floor(Math.max(0, free_slots() - 3) / 3);
    const chosen = [];
    const planned = {}; // scrolls already earmarked per tier
    let plan_cost = 0;
    // one entry per TRIPLE: a pile of 30 identical rings gives up to COMPOUND_MAX_GROUPS entries, not just one
    for (const g of groups) {
      const triples = Math.min(
        Math.floor((g.bag + g.bank.length) / 3),
        g.max_triples === undefined ? Infinity : g.max_triples
      );
      for (let t = 0; t < triples; t++) {
        if (chosen.length >= Math.min(CFG.COMPOUND_MAX_GROUPS, by_slots)) break;
        const used = planned[g.scroll] || 0;
        const extra = quantity(g.scroll) > used ? 0 : unit_cost(g.scroll);
        const g_left = focus_of(g.item.name)
          ? Math.max(left, focus_of(g.item.name).budget || 0)
          : left;
        if (plan_cost + extra > Math.max(0, g_left)) break; // same scroll for the rest of this pile
        planned[g.scroll] = used + 1;
        plan_cost += extra;
        chosen.push(Object.assign({}, g, { triple: t }));
      }
    }
    const n = chosen.length;
    if (n <= 0) {
      say(
        "Compound round skipped: budget left " +
          left +
          ", free slots " +
          free_slots(),
        "#CF575F"
      );
      return go_home();
    }
    const scroll_names = Object.keys(planned);
    const touched = {};
    say(
      "Compound round: " +
        n +
        " triple(s) = " +
        n * 3 +
        " item(s) to compound (limit " +
        CFG.COMPOUND_MAX_GROUPS +
        " triples, " +
        Math.floor(by_slots) +
        " by bag space)"
    );

    // take what ALL the triples of each kind need out of the bank (highest slot first within a pack: slots may shift)
    const per_key = {};
    for (const g of chosen)
      (per_key[g.key] = per_key[g.key] || { g, n: 0 }).n++;
    for (const k of Object.keys(per_key)) {
      const g = per_key[k].g;
      touched[g.item.name] = true;
      let need = per_key[k].n * 3 - g.bag;
      const order = g.bank
        .slice()
        .sort((a, b) =>
          a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : b.i - a.i
        );
      for (const b of order) {
        if (need <= 0) break;
        const before = bag_list((x) => comp_key(x) === g.key).length;
        const res = await call(() => bank_retrieve(b.pack, b.i));
        const got = await call(() =>
          wait_for(
            () => bag_list((x) => comp_key(x) === g.key).length > before,
            4000
          )
        );
        if (res.failed || got.failed) {
          say(
            "Could not take " +
              comp_label(g.item) +
              " out of the bank: " +
              (res.reason || got.reason),
            "#CF575F"
          );
          break;
        }
        need--;
      }
    }
    if (yield_now()) {
      say(
        "Compound round: a job is waiting - putting the items back in the bank"
      );
      await put_back_in_bank((it) => touched[it.name]);
      S.compound_next = now() + 3000;
      return;
    }
    // gold for the scrolls (only above the bank floor)
    const to_buy = {};
    let cost = 0;
    for (const nm of scroll_names) {
      const miss = Math.max(0, planned[nm] - quantity(nm));
      if (miss) {
        to_buy[nm] = miss;
        cost += miss * unit_cost(nm);
      }
    }
    if (cost > 0 && character.gold < cost) {
      const want = cost - character.gold;
      if (bank_gold - want < CFG.COMPOUND_BANK_FLOOR) {
        say(
          "Compounding stopped: withdrawing " +
            want +
            " would take the bank below its floor",
          "#CF575F"
        );
        await put_back_in_bank((it) => touched[it.name]);
        return go_home();
      }
      const before = character.gold;
      const wd = await call(() => bank_withdraw(want));
      const done = await call(() =>
        wait_for(() => character.gold >= before + want - 1, 5000)
      );
      if (wd.failed || done.failed) {
        say(
          "Compound round: withdrawal failed: " + (wd.reason || done.reason),
          "#CF575F"
        );
        await put_back_in_bank((it) => touched[it.name]);
        return go_home();
      }
    }
    // buy the scrolls
    if (cost > 0) {
      const npc = find_npc(CFG.COMPOUND_SCROLL_NPC);
      const r =
        npc &&
        (await travel(
          { map: npc.map, x: npc.x, y: npc.y },
          0,
          "buying compound scrolls"
        ));
      if (!npc || r.failed) {
        say("Compound round: could not reach the scroll NPC", "#CF575F");
        if (await open_bank_for_compound())
          await put_back_in_bank((it) => touched[it.name]);
        return go_home();
      }
      for (const nm of Object.keys(to_buy)) {
        const k = to_buy[nm];
        const had = quantity(nm);
        const res = await call(() => buy_with_gold(nm, k));
        const got = await call(() =>
          wait_for(() => quantity(nm) >= had + k, 6000)
        );
        if (res.failed || got.failed) {
          say(
            "Compound round: buying " +
              nm +
              " failed: " +
              (res.reason || got.reason),
            "#CF575F"
          );
          if (await open_bank_for_compound())
            await put_back_in_bank((it) => touched[it.name]);
          return go_home();
        }
        S.compound_spent += k * unit_cost(nm);
        say(
          "Bought " +
            k +
            "x " +
            nm +
            " (session spend " +
            S.compound_spent +
            " / " +
            S.compound_cap +
            ")"
        );
      }
    }
    // odds check, then (unless dry run) compound
    const up = find_npc(CFG.COMPOUND_UPGRADE_NPC);
    if (up)
      await travel(
        { map: up.map, x: up.x, y: up.y },
        0,
        "compounding next to the upgrade NPC"
      );
    for (const g of chosen) {
      // yield point: a group (3 items) is one atomic action; a waiting job goes first. The next round re-plans from the bank.
      if (yield_now()) {
        say("Compound round: a job is waiting - stopping at a group boundary");
        S.compound_next = now() + 3000;
        break;
      }
      act(
        "Compound " + comp_label(g.item) + " x3",
        P.ETA_S.compound_group,
        true
      );
      const slots = bag_list((x) => comp_key(x) === g.key);
      const si = locate_item(g.scroll);
      if (slots.length < 3 || si < 0) {
        say(
          "Skipping " +
            comp_label(g.item) +
            ": not enough items or no scroll in the bag",
          "#CF575F"
        );
        continue;
      }
      const [a, b, c] = slots;
      const odds = await call(() => compound(a, b, c, si, null, true));
      const chance = Number(odds.chance);
      if (odds.failed || !(chance >= 0)) {
        say(
          "No odds for " +
            comp_label(g.item) +
            ": " +
            JSON.stringify(odds.failed ? odds.reason : odds),
          "#CF575F"
        );
        continue;
      }
      const tag =
        comp_label(g.item) +
        " x3 with " +
        g.scroll +
        ": " +
        Math.round(chance * 1000) / 10 +
        "% (grace " +
        (odds.grace === undefined ? "?" : odds.grace) +
        ")";
      if (chance < min_chance_of(g.item.name)) {
        say(
          "COMPOUND skipped (below " +
            Math.round(min_chance_of(g.item.name) * 100) +
            "%): " +
            tag
        );
        continue;
      }
      if (CFG.COMPOUND_DRY_RUN) {
        say("COMPOUND dry run - would attempt " + tag);
        continue;
      }
      const lvl_up = (x) =>
        x.name === g.item.name &&
        (x.level || 0) === (g.item.level || 0) + 1 &&
        (x.p || "") === (g.item.p || "");
      const made_before = bag_list(lvl_up).length;
      S.compound_attempts++;
      const res = await call(() => compound(a, b, c, si, null));
      await call(() =>
        wait_for(
          () =>
            bag_list(lvl_up).length > made_before ||
            bag_list((x) => comp_key(x) === g.key).length <= slots.length - 3,
          6000
        )
      );
      await wait(300);
      const win = bag_list(lvl_up).length > made_before;
      const st = load_stats();
      st.n++;
      st.exp += chance;
      st.var += chance * (1 - chance);
      if (win) st.wins++;
      try {
        set("compound_stats", JSON.stringify(st));
      } catch (e) {}
      say(
        "COMPOUND " +
          (win
            ? "SUCCESS"
            : res.failed
            ? "FAILED (" + res.reason + ")"
            : "LOST the 3 items") +
          " - " +
          tag +
          " | totals " +
          st.wins +
          "/" +
          st.n +
          ", quoted ~" +
          st.exp.toFixed(1),
        win ? "#5BCB5B" : "#CF575F"
      );
      if (win) S.compound_made[g.item.name] = true;
      check_odds_honesty(st);
      if (is_paused()) break;
    }
    // finished items at the sell level: sell them, or keep them in the bank
    if (CFG.COMPOUND_RESULT_ACTION === "sell" && !CFG.COMPOUND_DRY_RUN) {
      const sellers = bag_list(
        (x) =>
          S.compound_made[x.name] &&
          (x.level || 0) >= CFG.COMPOUND_SELL_AT_LEVEL &&
          !x.l
      );
      if (sellers.length) {
        const npc = find_npc(CFG.JUNK_SELL_NPC);
        const r =
          npc &&
          (await travel(
            { map: npc.map, x: npc.x, y: npc.y },
            0,
            "selling compounded items"
          ));
        if (npc && !r.failed) {
          for (const i of bag_list(
            (x) =>
              S.compound_made[x.name] &&
              (x.level || 0) >= CFG.COMPOUND_SELL_AT_LEVEL &&
              !x.l
          )) {
            const it = character.items[i];
            if (!it) continue;
            const g0 = character.gold;
            const nm = comp_label(it);
            await call(() => sell(i, 1));
            await call(() => wait_for(() => !character.items[i], 2500));
            say("Sold " + nm + " (+" + Math.max(0, character.gold - g0) + "g)");
          }
        }
      }
    }
    // everything of the touched kinds goes back to the bank (leftover triples, results we keep)
    if (await open_bank_for_compound()) {
      const n_back = await put_back_in_bank(
        (x) =>
          touched[x.name] &&
          !x.l &&
          !(x.q > 1) &&
          !!G.items[x.name] &&
          !!G.items[x.name].compound
      );
      if (n_back) say("Put " + n_back + " item(s) back in the bank");
      // storing may have filled the bank (or failed because it was full): make room now, not next round
      const was_full = bank_free_slots() < CFG.BANKFULL_TRIGGER_FREE;
      await free_bank_space();
      if (was_full && character.map === "bank") {
        const n2 = await put_back_in_bank(
          (x) =>
            !x.l &&
            !(x.q > 1) &&
            !!G.items[x.name] &&
            !!G.items[x.name].compound &&
            !!touched[x.name]
        );
        if (n2)
          say(
            "Put " + n2 + " leftover item(s) in the bank now that there is room"
          );
      }
    }
    // something was compounded: go straight into the next round (new +1/+2 results may form fresh triples);
    // it ends on its own when there is nothing left to compound or the budget is spent
    if (
      S.compound_attempts > 0 &&
      !is_paused() &&
      (S.compound_chain || 0) < CFG.COMPOUND_MAX_CHAIN_ROUNDS
    ) {
      S.compound_chain = (S.compound_chain || 0) + 1;
      S.compound_chained = true;
      S.compound_next = now();
      return;
    }
    S.compound_chain = 0;
    return go_home();
  }
