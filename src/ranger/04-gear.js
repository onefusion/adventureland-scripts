  // ===================== GEAR (worn items shared with the Merchant) ============
  const GEAR_SLOTS = [
    "helmet",
    "chest",
    "pants",
    "gloves",
    "shoes",
    "cape",
    "ring1",
    "ring2",
    "earring1",
    "earring2",
    "amulet",
    "belt",
    "orb",
    "mainhand",
    "offhand",
  ];
  function send_gear_report() {
    AL.runtime.strip_never_wear(say);
    if (!CFG.GEAR_SHARE) return;
    const slots = {};
    for (const s of GEAR_SLOTS) {
      const it = character.slots && character.slots[s];
      if (it && it.name) {
        slots[s] = { name: it.name, level: it.level || 0 };
        if (it.stat_type) slots[s].stat_type = String(it.stat_type); // stat scroll applied (the Merchant scores it)
      }
    }
    call(() =>
      send_cm(CFG.MERCHANT_NAME, {
        type: "gear_report",
        cls: character.ctype,
        stat: { level: character.level, xp: Math.floor(character.xp || 0), max_xp: Math.floor(character.max_xp || 0), free: free_slots(), deaths: R.deaths || 0, drops: drops_out(), gold: Math.floor(character.gold || 0), farm: is_leader() ? String(CFG.FARM_MONSTER || "") : "" },
        slots,
        map: character.map,
        x: Math.round(character.x),
        y: Math.round(character.y),
      })
    );
  }
  const find_gear = (name, level) => {
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (it && it.name === name && (it.level || 0) === level) return i;
    }
    return -1;
  };
  // The Merchant hands over an item and says where it goes: wait for it, equip it
  async function gear_receive(d) {
    R.gear_recv_at = now();
    R.gear_busy = true;
    try {
      await gear_receive_inner(d);
    } finally {
      R.gear_busy = false;
    }
  }
  async function gear_receive_inner(d) {
    const slot = String(d.slot || "");
    const name = String(d.name || "");
    const level = Number(d.level) || 0;
    if (GEAR_SLOTS.indexOf(slot) === -1 || !name) return;
    const got = await call(() =>
      wait_for(() => find_gear(name, level) >= 0, 15000)
    );
    if (got.failed)
      return say(
        "Gear from the Merchant never arrived: " + name + " +" + level,
        "#CF575F"
      );
    const old = character.slots && character.slots[slot];
    const res = await call(() => equip(find_gear(name, level), slot));
    if (res.failed)
      return say(
        "Could not equip " + name + " +" + level + ": " + res.reason,
        "#CF575F"
      );
    say(
      "Equipped " +
        name +
        " +" +
        level +
        " in " +
        slot +
        (old && old.name
          ? " (was " + old.name + " +" + (old.level || 0) + ", now in the bag)"
          : ""),
      "#5BCB5B"
    );
    await wait(1500);
    send_gear_report();
    // hand-me-down: tell the Merchant what we just replaced; he says whether a follower Ranger would gain from it (gear_pass)
    if (old && old.name && is_leader() && CFG.PARTY_MEMBERS.length)
      call(() =>
        send_cm(CFG.MERCHANT_NAME, {
          type: "gear_replaced",
          name: old.name,
          level: old.level || 0,
          stat_type: old.stat_type ? String(old.stat_type) : undefined,
        })
      );
  }
  // The Merchant says a follower would gain from what we replaced: hand it over when he stands next to us, then tell him to equip it
  async function gear_pass(d) {
    const to = String(d.to || "");
    const name = String(d.name || "");
    const level = Number(d.level) || 0;
    const slot = String(d.slot || "");
    if (
      !is_leader() ||
      CFG.PARTY_MEMBERS.indexOf(to) === -1 ||
      GEAR_SLOTS.indexOf(slot) === -1 ||
      !name
    )
      return;
    R.gear_busy = true;
    try {
      const have = await call(() =>
        wait_for(() => find_gear(name, level) >= 0, 5000)
      );
      if (have.failed)
        return say(
          "Hand-me-down " + name + " +" + level + " is not in my bag",
          "#CF575F"
        );
      const close = () => {
        let p = null;
        try {
          p = get_player(to);
        } catch (e) {}
        return (
          !!p &&
          p.map === character.map &&
          d2(character, p) < CFG.PAY_RANGE + 50
        );
      };
      const there = await call(() => wait_for(close, 60000));
      if (there.failed)
        return say(
          to + " never came close - keeping " + name + " +" + level,
          "#CF575F"
        );
      const idx = find_gear(name, level);
      if (idx < 0) return;
      await call(() => send_cm(to, { type: "gear_give", name, level, slot })); // tell him first so he is already waiting
      const res = await call_paced("transfer", () => send_item(to, idx, 1));
      if (res.failed)
        return say(
          "Could not hand " +
            name +
            " +" +
            level +
            " to " +
            to +
            ": " +
            res.reason,
          "#CF575F"
        );
      say(
        "Gave " + name + " +" + level + " to " + to + " for his " + slot,
        "#5BCB5B"
      );
    } finally {
      R.gear_busy = false;
    }
  }
  if (CFG.GEAR_SHARE) {
    setTimeout(() => alive() && send_gear_report(), 20000);
    const gear_timer = setInterval(
      () => (alive() ? send_gear_report() : clearInterval(gear_timer)),
      CFG.GEAR_REPORT_MS
    );
  }
