  // ===== Lost and Found donations =====
  function donate_ledger() {
    let l = null;
    try {
      l = JSON.parse(get("donate_ledger") || "null");
    } catch (e) {}
    const day = String(Math.floor(Date.now() / 86400000));
    if (!l || l.day !== day)
      l = { day, spent: 0, probe: l ? !!l.probe : false };
    return l;
  }
  function donate_track() {
    try {
      return JSON.parse(get("donate_track") || "null");
    } catch (e) {
      return null;
    }
  }
  function donate_track_save(t) {
    try {
      set("donate_track", JSON.stringify(t));
    } catch (e) {}
  }
  // gold that left the bank+bag through donations / lottery, counted so it does not look like "earned less"
  function donate_track_out(n) {
    const t = donate_track();
    if (!t) return;
    t.out = (Number(t.out) || 0) + n;
    donate_track_save(t);
  }
  const donate_cap = () => {
    const t = donate_track();
    return CFG.DONATE_CAP_ADAPT && t && t.cap > 0
      ? t.cap
      : CFG.DONATE_DAILY_CAP;
  };
  // Once per UTC day, with the bank open: compare today's wealth with yesterday's snapshot and move the cap by at most one step.
  function donate_cap_update(wealth) {
    const today = String(Math.floor(Date.now() / 86400000));
    let t = donate_track();
    if (!t || !(t.cap > 0)) {
      donate_track_save({
        day: today,
        t0: Date.now(),
        wealth0: wealth,
        cap: CFG.DONATE_DAILY_CAP,
        out: 0,
      });
      return;
    }
    if (!CFG.DONATE_CAP_ADAPT || t.day === today) return;
    const el = Date.now() - (Number(t.t0) || 0);
    let cap = t.cap;
    let earned_day = null;
    if (el >= 12 * 3600000 && el <= 72 * 3600000) {
      earned_day = Math.round(
        ((wealth - (Number(t.wealth0) || 0) + (Number(t.out) || 0)) *
          86400000) /
          el
      );
      let target =
        Math.floor(
          (Math.max(0, earned_day) * CFG.DONATE_EARN_SHARE) / CFG.DONATE_STEP
        ) * CFG.DONATE_STEP;
      target = Math.min(
        cap + CFG.DONATE_STEP,
        Math.max(cap - CFG.DONATE_STEP, target)
      );
      cap = Math.min(CFG.DONATE_CAP_MAX, Math.max(CFG.DONATE_CAP_MIN, target));
    }
    say(
      "Donation cap: " +
        (earned_day === null
          ? "no usable 24h reading, cap stays "
          : "earned about " +
            earned_day +
            " gold per 24h (not counting compound/upgrade/potion spending) -> cap ") +
        cap +
        " per day (was " +
        t.cap +
        ")",
      "#58CF40"
    );
    donate_track_save({
      day: today,
      t0: Date.now(),
      wealth0: wealth,
      cap,
      out: 0,
    });
  }
  const donate_left = () => Math.max(0, donate_cap() - donate_ledger().spent);
  const donate_off = () => {
    try {
      const v = get("donate_off");
      return v === true || v === "true";
    } catch (e) {
      return false;
    }
  };
  const donate_due = () =>
    CFG.DONATE_ENABLED &&
    !donate_off() &&
    !is_paused() &&
    !has_jobs() &&
    now() >= S.donate_next &&
    donate_left() >= 1 &&
    free_slots() >= CFG.DONATE_MIN_FREE_SLOTS;
  async function donate_round() {
    S.donate_next = now() + CFG.DONATE_EVERY_MS;
    await drain_stand("a donation");
    if (!(await open_bank_for_compound())) return go_home();
    const led = donate_ledger();
    const bank_gold = Number(character.bank && character.bank.gold) || 0;
    donate_cap_update(bank_gold + (Number(character.gold) || 0));
    const spare = Math.max(0, bank_gold - CFG.DONATE_BANK_FLOOR);
    const want = led.probe ? CFG.DONATE_STEP : CFG.DONATE_PROBE_GOLD;
    const amount = Math.min(want, spare, donate_left());
    if (amount < Math.min(want, 1000)) {
      say(
        "Donation: nothing to give - spare gold " +
          spare +
          " (bank " +
          bank_gold +
          " minus floor " +
          CFG.DONATE_BANK_FLOOR +
          "), daily cap left " +
          donate_left()
      );
      return go_home();
    }
    const before_g = character.gold;
    const wd = await call(() => bank_withdraw(amount));
    const got = await call(() =>
      wait_for(() => character.gold >= before_g + amount - 1, 5000)
    );
    if (wd.failed || got.failed) {
      say(
        "Donation: could not withdraw " +
          amount +
          ": " +
          (wd.reason || got.reason),
        "#CF575F"
      );
      return go_home();
    }
    let npc = find_npc("lostandfound");
    if (!npc) npc = CFG.DONATE_NPC_FALLBACK;
    act("Donate", 90, true);
    const r = await travel(
      { map: npc.map, x: npc.x, y: npc.y },
      0,
      "donating at Lost and Found"
    );
    if (r.failed) {
      say("Donation: could not reach Lost and Found: " + r.reason, "#CF575F");
      return go_home();
    }
    const tally0 = bag_tally();
    const xp0 = Number(character.xp) || 0;
    const lvl0 = character.level;
    const gold0 = character.gold;
    const res = await paced(() => call(() => donate_gold(amount)));
    if (res.failed) {
      say(
        "Donation of " +
          amount +
          " failed: " +
          (res.reason || JSON.stringify(res)),
        "#CF575F"
      );
      S.donate_next = now() + 3 * CFG.DONATE_EVERY_MS;
      return go_home();
    }
    await wait(1200);
    const tally1 = bag_tally();
    const got_items = [];
    for (const n in tally1) {
      const d = tally1[n] - (tally0[n] || 0);
      if (d > 0) got_items.push(d + "x " + n);
    }
    const resp = JSON.stringify(res).slice(0, 300);
    const code = res.response || "";
    const gave = gold0 - character.gold;
    say(
      "Donation: gave " +
        gave +
        " gold -> answer " +
        resp +
        "; XP +" +
        ((Number(character.xp) || 0) - xp0) +
        " (level " +
        lvl0 +
        " -> " +
        character.level +
        ")" +
        (got_items.length
          ? "; handed back: " + got_items.join(", ")
          : "; nothing handed back"),
      "#58CF40"
    );
    if (/low/.test(String(code))) {
      say(
        "Donation: the NPC calls " +
          amount +
          " too little - stopping donations until DONATE_PROBE_GOLD / DONATE_STEP are raised",
        "#CF575F"
      );
      S.donate_next = now() + 12 * 3600000;
    } else if (gave > 0) {
      led.spent += gave;
      led.probe = true;
      donate_track_out(gave);
      try {
        set("donate_ledger", JSON.stringify(led));
      } catch (e) {}
    }
    return go_home();
  }
