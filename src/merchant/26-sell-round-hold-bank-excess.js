  // ---- v5: manual sell round (top button "Sell round", or set("sell_round", "1")): the bank junk sweep, surplus copies and the bag tidy, now ----
  function sell_now_poll() {
    if (S.sell_now) return true;
    try {
      if (String(get("sell_round") || "")) {
        set("sell_round", "");
        S.sell_now = true;
      }
    } catch (e) {}
    return !!S.sell_now;
  }
  async function sell_round_now() {
    S.sell_now = false;
    say(
      "Manual sell round: bank junk and surplus first, then the bag",
      "#51D2E1"
    );
    try {
      await gear_sweep(); // opens the bank: bank junk to Gabriel, surplus copies, bank space; then walks home
    } catch (e) {
      say(
        "Manual sell round: the bank part failed: " + ((e && e.message) || e),
        "#CF575F"
      );
    }
    if (has_jobs()) return;
    S.tidy_next = 0;
    await bag_tidy(); // the bag: junk, surplus, stackables to the bank
    say("Manual sell round: done, gold is now " + character.gold, "#58CF40");
  }
  // ---- v5: manual hold (console only: set("hold_at", "lostandfound" | "ponty" | "release"); the "Go Lost&Found" and "Go Ponty" buttons were removed) ----
  // He walks to the NPC and STAYS there (no rounds, no stand, no walking home) so Sean can run commands by hand. A Ranger job still takes
  // him away; afterwards he walks back. "Release" (or Re-engage) ends it.
  const HOLD_NPCS = {
    lostandfound: "lostandfound",
    ponty: "secondhands",
    secondhands: "secondhands",
  };
  function hold_poll() {
    try {
      const v = String(get("hold_at") || "").toLowerCase();
      if (v) {
        set("hold_at", "");
        if (v === "release" || v === "off") S.hold = null;
        else if (HOLD_NPCS[v])
          S.hold = {
            npc: HOLD_NPCS[v],
            label: v === "lostandfound" ? "Lost and Found" : "Ponty",
          };
        else
          say(
            "Manual hold: unknown place '" +
              v +
              "' (use lostandfound, ponty or release)",
            "#CF575F"
          );
      }
    } catch (e) {}
    return !!S.hold;
  }
  async function hold_at_npc() {
    const h = S.hold;
    if (!h) return;
    await drain_stand("a manual hold");
    const npc =
      find_npc(h.npc) ||
      (h.npc === "secondhands" ? CFG.MARKET_NPC_FALLBACK : null);
    if (!npc) {
      say(
        "Manual hold: cannot place the NPC " + h.npc + " (" + h.label + ")",
        "#CF575F"
      );
      S.hold = null;
      return;
    }
    const r = await travel(
      { map: npc.map, x: npc.x, y: npc.y },
      0,
      "manual hold at " + h.label
    );
    if (r.failed) {
      say(
        "Manual hold: could not reach " + h.label + ": " + r.reason,
        "#CF575F"
      );
      if (r.reason !== "aborted") S.hold = null;
      return;
    }
    say(
      "Manual hold: at " +
        h.label +
        " (" +
        npc.map +
        " " +
        Math.round(npc.x) +
        "," +
        Math.round(npc.y) +
        '). Staying here until \'Release\' (or set("hold_at", "release")). A Ranger job still takes him away and he walks back afterwards.',
      "#58CF40"
    );
    while (alive() && S.hold === h && !has_jobs()) {
      hold_poll();
      await wait(1000);
    }
    if (S.hold === h) return; // a job interrupted: the task is due again afterwards
    say("Manual hold: released - going home", "#51D2E1");
    await go_home();
  }
  sched_add({
    name: "hold",
    label: "Manual hold",
    due: () => !has_jobs() && hold_poll(),
    run: () => hold_at_npc(),
  });
  // ---- v5: "Bank excess" (top button, or set("bank_excess", "1")): everything in the bag except the potions and the stand stock goes to the bank ----
  function bank_excess_poll() {
    if (S.bank_excess) return true;
    try {
      if (String(get("bank_excess") || "")) {
        set("bank_excess", "");
        S.bank_excess = true;
      }
    } catch (e) {}
    return !!S.bank_excess;
  }
  const keeps_in_bag = (it) =>
    /^stand\d/.test(it.name) || // the Merchant's Stand itself (bag slot 0) never leaves the bag
    /^[hm]pot\d/.test(it.name) ||
    [CFG.HP_POTION, CFG.MP_POTION].includes(it.name) ||
    CFG.STAND_STOCK.some((x) => x.name === it.name) ||
    CFG.STAND_LISTINGS.some((x) => x.name === it.name);
  async function bank_excess_now() {
    S.bank_excess = false;
    await drain_stand("a bag emptying");
    if (!(await open_bank_for_compound())) {
      say("Bank excess: could not open the bank", "#CF575F");
      return go_home();
    }
    const n = await put_back_in_bank((it) => !keeps_in_bag(it));
    const left = [];
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (it && !keeps_in_bag(it))
        left.push(it.name + (it.q > 1 ? " x" + it.q : ""));
    }
    say(
      "Bank excess: " +
        n +
        " item stack(s) moved to the bank" +
        (left.length
          ? "; still in the bag (could not store): " + left.join(", ")
          : "; the bag now holds only potions / stand stock"),
      left.length ? "#CF575F" : "#58CF40"
    );
    S.upgrade_next = Math.min(S.upgrade_next, now() + 60000);
    S.compound_next = Math.min(S.compound_next, now() + 60000);
    return go_home();
  }
  sched_add({
    name: "bankxs",
    label: "Bank excess",
    due: () => !has_jobs() && bank_excess_poll(),
    run: () => bank_excess_now(),
  });
  sched_add({
    name: "sellnow",
    label: "Sell round",
    due: () => !has_jobs() && sell_now_poll(),
    run: () => sell_round_now(),
  });
  sched_add({
    name: "sale",
    label: "Private sale",
    due: () => !has_jobs() && sale_poll(),
    run: () => private_sale(),
  });
  sched_add({
    name: "tidy",
    label: "Bag tidy",
    pre: bag_warn_pre,
    due: () => tidy_due(),
    run: () => bag_tidy(),
    on: () => CFG.BAG_TIDY,
    next: () => S.tidy_next || 0,
  });
  sched_add({
    name: "sweep",
    label: "Gear sweep",
    due: () => sweep_due(),
    run: () => gear_sweep(),
    on: () => CFG.GEAR_SWEEP || (CFG.SURPLUS_SELL && CFG.SURPLUS_COPIES),
    next: () =>
      Math.min(
        S.sweep_last + CFG.GEAR_SWEEP_STANDALONE_MS,
        CFG.SURPLUS_COPIES
          ? (S.copies_last || 0) + CFG.GEAR_SWEEP_STANDALONE_MS
          : Infinity
      ),
  });
  sched_add({
    name: "mluck_town",
    label: "Merchant's Luck (town)",
    due: () => mluck_town_due(),
    run: () => mluck_town_round(),
    on: () => CFG.MLUCK_TOWN_ALWAYS || (CFG.MLUCK_GRINCH && grinch_live()),
    next: () => S.mluck_town_next || 0,
  });
  sched_add({
    name: "mluck_party",
    label: "Merchant's Luck (party stop)",
    due: () => mluck_party_due(),
    run: () => mluck_party_round(),
    on: () => CFG.MLUCK_PARTY,
    next: () => 0,
  });
  sched_add({
    name: "exchange",
    label: "Exchange run",
    due: () => exch_due(1),
    run: () => exchange_round(1),
    on: () => CFG.EXCHANGE_ENABLED,
    next: () => Math.max(S.exch_next, S.exch_empty_until || 0),
  });
  sched_add({
    name: "exchange2",
    label: "Exchange round 2 (Xyn)",
    due: () => exch_due(2),
    run: () => exchange_round(2),
    on: () => CFG.EXCHANGE_ENABLED,
    next: () => Math.max(S.exch2_next, S.exch2_empty_until || 0),
  });
  sched_add({
    name: "compound",
    label: "Compound round",
    due: () => comp_due(),
    run: () => compound_round(),
    on: () => CFG.COMPOUND_ENABLED,
    next: () => S.compound_next,
  });
  sched_add({
    name: "upgrade",
    label: "Upgrade round",
    pre: gear_warn_pre,
    due: () => upg_due(),
    run: () => upgrade_round(),
    on: () => CFG.UPGRADE_ENABLED,
    next: () => S.upgrade_next,
  });

  sched_add({
    name: "craft",
    label: "Crafting",
    due: () => craft_due(),
    run: () => craft_round(),
    on: () => CFG.CRAFT_ENABLED,
    next: () => S.craft_next,
  });
  sched_add({
    name: "donate",
    label: "Donation",
    due: () => donate_due(),
    run: () => donate_round(),
    on: () => CFG.DONATE_ENABLED,
    next: () => S.donate_next,
  });
  sched_add({
    name: "lottery",
    label: "Lottery",
    due: () => lottery_due(),
    run: () => lottery_round(),
    on: () => CFG.LOTTERY_ENABLED,
    next: () => S.lottery_next,
  });
  sched_add({
    name: "market",
    label: "Market watch",
    due: () => market_due(),
    run: () => market_round(),
    on: () => CFG.MARKET_ENABLED,
    next: () => S.market_next,
  });
  sched_add({
    name: "ron",
    label: "Ron the Goblin",
    due: () => ron_due(),
    run: () => market_round(mk_ron()),
    on: () => CFG.RON_ENABLED && CFG.MARKET_BUY,
    next: () => S.ron_next,
  });
  sched_add({
    name: "mluck",
    label: "Merchant's Luck",
    due: () => mluck_due(),
    run: () => mluck_round(),
    on: () => mluck_on(),
    next: () => S.mluck_next || 0,
  });

  // SIDE-EFFECT-FREE "could run now" checks, for the "also due" counters only (the real due() functions log or move timers).
  const SCHED_READY = {
    exchange: () =>
      CFG.EXCHANGE_ENABLED &&
      !exch_over() &&
      !is_paused() &&
      !has_jobs() &&
      now() >= S.exch_next &&
      now() >= S.exch_empty_until &&
      free_slots() >= CFG.EXCHANGE_MIN_FREE_SLOTS,
    exchange2: () =>
      CFG.EXCHANGE_ENABLED &&
      !exch_over() &&
      !is_paused() &&
      !has_jobs() &&
      now() >= S.exch2_next &&
      now() >= S.exch2_empty_until &&
      free_slots() >= CFG.EXCHANGE_MIN_FREE_SLOTS,
    donate: () => donate_due(),
    lottery: () => lottery_due(),
    craft: () =>
      CFG.CRAFT_ENABLED &&
      !is_paused() &&
      !has_jobs() &&
      now() >= S.craft_next &&
      free_slots() >= CFG.CRAFT_MIN_FREE_SLOTS,
    compound: () => comp_due(),
    tidy: () => tidy_due(),
    sweep: () =>
      (CFG.GEAR_SWEEP || (CFG.SURPLUS_SELL && CFG.SURPLUS_COPIES)) &&
      !has_jobs() &&
      roster().every(gear_fresh_for) &&
      now() >=
        Math.min(
          S.sweep_last + CFG.GEAR_SWEEP_STANDALONE_MS,
          CFG.SURPLUS_COPIES
            ? (S.copies_last || 0) + CFG.GEAR_SWEEP_STANDALONE_MS
            : Infinity
        ),
    upgrade: () => upg_due(),
  };
  const sched_ready = (t) => {
    const f = SCHED_READY[t.name];
    try {
      return !!f && !!f();
    } catch (e) {
      return false;
    }
  };
  const sched_min = (ms) =>
    ms < 60000 ? Math.round(ms / 1000) + "s" : Math.round(ms / 60000) + "m";