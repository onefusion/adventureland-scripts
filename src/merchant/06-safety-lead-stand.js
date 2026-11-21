  // ============================ SAFETY ============================
  // Runs on its own timer so it still works while a long trip is awaited.
  // Which HP potion to drink: the cheap stand-stock one first. The Ranger's delivery potions
  // are only touched as a last resort (critical HP), so a hit does not eat his restock.
  function pick_hp_potion(pct) {
    const order = [CFG.SELF_HEAL_POTION];
    if (CFG.HP_POTION !== CFG.SELF_HEAL_POTION && pct < CFG.FLEE_HP_PCT)
      order.push(CFG.HP_POTION);
    for (const n of order) if (quantity(n) > 0) return n;
    return null;
  }
  function drink_hp(pct) {
    const name = pick_hp_potion(pct);
    if (!name || is_on_cooldown("use_hp")) return null;
    call(() => equip(locate_item(name))); // by name - use_skill("use_hp") would pick one for us
    return name;
  }

  function emergency_tick() {
    if (!alive() || character.rip) return;
    // safety net: an open stand makes him crawl, so if he is ever walking with it open, close it
    if (
      character.stand &&
      (smart.moving || is_moving(character)) &&
      now() - S.stand_guard_at > 3000
    ) {
      S.stand_guard_at = now();
      say("Stand was open while moving - closing it", "#CF575F");
      call(() => close_stand());
    }
    const pct = character.hp / character.max_hp;
    if (pct < CFG.HP_USE_PCT) drink_hp(pct);
    if (pct < CFG.FLEE_HP_PCT && now() - S.fled_at > 20000) {
      S.fled_at = now();
      say("HP critical - teleporting to town", "#CF575F");
      if (character.stand) call(() => close_stand());
      call(() => town());
    }
  }
  setInterval(emergency_tick, 1000);

  // ====================== PARTY LEADER ======================
  function party_tick() {
    if (!alive() || !CFG.PARTY_ENABLED || character.rip) return;
    if (now() - S.party_at < CFG.PARTY_INVITE_MS) return;
    S.party_at = now();
    let members = {};
    try {
      members = get_party() || {};
    } catch (e) {}
    let active = null;
    try {
      active = get_active_characters();
    } catch (e) {}
    for (const n of roster().concat(CFG.SUPPORT_NAMES || [])) {
      if (n === character.name || members[n]) continue;
      if (active && !active[n]) continue; // not running: nothing to invite
      say("Inviting " + n + " to the party");
      call(() => send_party_invite(n));
    }
  }
  setInterval(party_tick, 5000);

  async function survive() {
    if (!character.rip) return false;
    say("Dead - respawning", "#CF575F");
    await wait(2500);
    await call(() => respawn());
    await wait(1500);
    return true;
  }

  // ===================== STAND: DRAIN / OPEN / LIST ===============
  function customers_near() {
    const out = [];
    for (const id in parent.entities) {
      const e = parent.entities[id];
      if (
        !e ||
        e.type !== "character" ||
        e.npc ||
        e.rip ||
        e.name === character.name
      )
        continue;
      if (is_trusted(e.name) || support_cfg(e.name)) continue; // our own characters are not customers
      if (d2(character, e) <= CFG.CUSTOMER_RADIUS) out.push(e);
    }
    return out;
  }

  // Wait until nobody is mid-purchase, then close the stand. Call before leaving.
  //   1. stay open while a sale landed recently or a customer is next to the stand
  //   2. after DRAIN_SOFT_MS close the stand (stops NEW purchases), then wait out
  //      the quiet window so anything already in flight still lands
  //   3. never wait longer than DRAIN_MAX_MS
  async function drain_stand(reason) {
    const started = now();
    let closed = !character.stand;
    let announced = false;
    for (;;) {
      if (!character.stand) closed = true;
      const waited = now() - started;
      const quiet = now() - S.last_sale >= CFG.SALE_QUIET_MS;
      const customers = customers_near().length;

      if (quiet && (closed || customers === 0)) break;
      if (waited >= CFG.DRAIN_MAX_MS) {
        say(
          "Stand drain timed out (" + reason + ") - leaving anyway",
          "#CF575F"
        );
        break;
      }
      if (!announced) {
        announced = true;
        say("Waiting for the stand to go quiet before " + reason + "...");
      }
      if (!closed && waited >= CFG.DRAIN_SOFT_MS) {
        say("Closing the stand to stop new purchases");
        await call(() => close_stand());
        closed = true;
      }
      await wait(250);
    }
    if (character.stand) await call(() => close_stand());
    await call(() => wait_for(() => !character.stand, 3000));
    return { waited: now() - started };
  }

  function listed_qty(name) {
    let q = 0;
    const slots = character.slots || {};
    for (const k in slots)
      if (k.indexOf("trade") === 0 && slots[k] && slots[k].name === name)
        q += slots[k].q || 1;
    return q;
  }

  // Puts potions on the stand and keeps the slots topped up as new stock arrives.
  // - empty slot: list the spare stock (everything above the delivery reserve)
  // - partly sold slot: take it back and relist the larger amount (only while no sale is in flight)
  async function ensure_listings() {
    if (now() - S.last_list_try < CFG.LIST_RETRY_MS) return;
    const quiet = () =>
      now() - S.last_sale >= CFG.SALE_QUIET_MS && customers_near().length === 0;
    const spare_of = (L) =>
      quantity(L.name) - (L.reserve !== undefined ? L.reserve : stock_low_at()); // delivery stock is never listed

    let busy = false;
    for (const L of CFG.STAND_LISTINGS) {
      const slot = "trade" + L.slot;
      let cur = character.slots && character.slots[slot];

      if (cur && cur.name && cur.name !== L.name) {
        say(
          slot + " holds " + cur.name + ", not " + L.name + " - leaving it",
          "#CF575F"
        );
        continue;
      }
      if (cur && cur.name) {
        // already listed: top up when a useful amount of new stock is waiting
        const room = L.qty - (cur.q || 1);
        const add = Math.min(room, spare_of(L));
        if (add < Math.max(5, Math.ceil(L.qty * 0.2))) continue;
        if (!quiet()) {
          busy = true; // a sale is in flight - try again shortly instead of waiting out the full retry period
          continue;
        }
        S.last_list_try = now();
        say(
          "Topping up " +
            L.name +
            " on the stand (" +
            (cur.q || 1) +
            " listed, " +
            add +
            " more available)"
        );
        await call(() => unequip(slot));
        await call(() =>
          wait_for(
            () => !(character.slots[slot] && character.slots[slot].name),
            3000
          )
        );
        cur = character.slots && character.slots[slot];
        if (cur && cur.name) {
          say("Could not take " + slot + " back to top it up", "#CF575F");
          continue;
        }
      }

      const idx = locate_item(L.name);
      const spare = spare_of(L);
      if (idx < 0 || spare <= 0) {
        if (!cur)
          say(
            "Nothing spare to list for " +
              L.name +
              " (have " +
              quantity(L.name) +
              ", keeping " +
              (L.reserve !== undefined ? L.reserve : stock_low_at()) +
              ")"
          );
        continue;
      }
      const q = Math.min(L.qty, spare, character.items[idx].q || 1);
      S.last_list_try = now();
      const res = await call(() => trade(idx, L.slot, L.price, q));
      if (res.failed)
        say("Listing " + L.name + " failed: " + res.reason, "#CF575F");
      else say("Listed " + q + "x " + L.name + " @ " + L.price);
    }
    if (busy) S.last_list_try = now() - CFG.LIST_RETRY_MS + 2000; // retry in ~2s
  }

  async function ensure_stand() {
    if (!at_spot(CFG.STAND_SPOT, CFG.STAND_SPOT_RADIUS)) {
      if (!is_moving(character)) {
        S.idle_walk = true; // not an action: a new job pre-empts the walk home
        let r;
        try {
          r = await travel(CFG.STAND_SPOT, 0, "returning to the stand spot");
        } finally {
          S.idle_walk = false;
        }
        if (r.failed && r.reason !== "aborted") await wait(3000);
      }
      return;
    }
    if (is_moving(character)) return;
    if (!character.stand) {
      await call(() => open_stand()); // no argument: finds the stand item itself
      await wait(500);
    }
    if (character.stand) await ensure_listings();
  }

  // back to the stand - skipped when a job is already waiting, and pre-empted by one that arrives on the way