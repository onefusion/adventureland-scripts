  // =========================== SHOPPING ===========================
  // inventory + what is already on the stand, so listing a batch never triggers a re-buy
  const held = (name) => quantity(name) + listed_qty(name);
  const stand_stock_low = () =>
    CFG.STAND_STOCK.some(
      (x) =>
        held(x.name) < x.low &&
        character.gold - CFG.STAND_STOCK_GOLD_FLOOR >= 10 * unit_cost(x.name) // can afford a useful batch
    );
  // v5: the delivery stock goes up while a boss event is live on the server (the Rangers grab potions from him at the post)
  function boss_live() {
    try {
      const Sv = parent.S;
      return !!(Sv && ["grinch", "snowman"].some((k) => Sv[k] && Sv[k].live));
    } catch (e) {
      return false;
    }
  }
  function stock_target() {
    return boss_live()
      ? Math.max(CFG.BOSS_STOCK_TARGET, CFG.STOCK_TARGET)
      : CFG.STOCK_TARGET;
  }
  function stock_low_at() {
    return boss_live()
      ? Math.max(CFG.BOSS_STOCK_LOW, CFG.STOCK_LOW)
      : CFG.STOCK_LOW;
  }
  // v5: a courier's notice names what he will ask for: have it in the bag before he arrives
  const courier_note_live = () =>
    !!S.courier_note && now() < S.courier_note.until;
  const stock_low = () =>
    quantity(CFG.HP_POTION) < stock_low_at() ||
    quantity(CFG.MP_POTION) < stock_low_at() ||
    (courier_note_live() &&
      (quantity(CFG.HP_POTION) < S.courier_note.hp ||
        quantity(CFG.MP_POTION) < S.courier_note.mp)) ||
    stand_stock_low();

  async function shop() {
    await drain_stand("shopping");
    const npc = find_npc("fancypots");
    if (!npc) {
      say("Cannot locate the potion NPC", "#CF575F");
      S.last_shop_fail = now();
      return false;
    }
    const r = await travel(
      { map: npc.map, x: npc.x, y: npc.y },
      0,
      "restocking potions at Ernis (fancypots)"
    );
    if (r.failed) {
      say("Could not reach the potion NPC: " + r.reason, "#CF575F");
      S.last_shop_fail = now();
      return false;
    }
    let ok = true;
    for (const name of [CFG.HP_POTION, CFG.MP_POTION]) {
      const have = quantity(name);
      const want = stock_target() - have;
      if (want <= 0) continue;
      const n = Math.min(want, Math.floor(character.gold / unit_cost(name)));
      if (n <= 0) {
        say(
          "Not enough gold for " + name + " (have " + character.gold + ")",
          "#CF575F"
        );
        S.last_poor = now();
        ok = false;
        continue;
      }
      const res = await call(() => buy_with_gold(name, n));
      const got = await call(() =>
        wait_for(() => quantity(name) >= have + n, 6000)
      );
      if (res.failed || got.failed) {
        say(
          "Buying " +
            name +
            " failed or incomplete: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        ok = false;
      } else say("Bought " + n + "x " + name);
    }
    // stand-only stock: never more than `target` on hand, only with gold above the floor
    for (const x of CFG.STAND_STOCK) {
      const have = held(x.name);
      if (have >= x.low) continue;
      const budget = character.gold - CFG.STAND_STOCK_GOLD_FLOOR;
      const n = Math.min(
        x.target - have,
        Math.floor(budget / unit_cost(x.name))
      );
      if (n <= 0) continue;
      const res = await call(() => buy_with_gold(x.name, n));
      const got = await call(() =>
        wait_for(() => held(x.name) >= have + n, 6000)
      );
      if (res.failed || got.failed) {
        say(
          "Buying " +
            x.name +
            " failed or incomplete: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        ok = false;
      } else say("Bought " + n + "x " + x.name + " for the stand");
    }
    if (!ok) S.last_shop_fail = now();
    S.last_list_try = 0; // new stock: list it as soon as the stand is open again
    return ok;
  }

  // ======================= HEALING =================================
  const hp_pct = () => character.hp / character.max_hp;
  const needs_heal = () =>
    !character.rip &&
    hp_pct() < CFG.HP_USE_PCT &&
    now() - S.last_heal_fail > CFG.HEAL_RETRY_MS;

  async function drink_until_healed() {
    for (let i = 0; i < 25 && hp_pct() < CFG.SELF_HEAL_UNTIL_PCT; i++) {
      const name = pick_hp_potion(hp_pct());
      if (!name) return false; // nothing to drink
      if (is_on_cooldown("use_hp")) {
        await wait(300);
        continue;
      }
      const before = quantity(name);
      await call(() => equip(locate_item(name)));
      await call(() => wait_for(() => quantity(name) < before, 2500));
      await wait(200);
    }
    return true;
  }

  async function heal_up() {
    // 1) drink what he is carrying (stand stays open, he does not move)
    if (pick_hp_potion(hp_pct())) {
      say("HP at " + Math.round(hp_pct() * 100) + "% - drinking a potion");
      await drink_until_healed();
      if (hp_pct() >= CFG.HP_USE_PCT) return;
    }
    // 2) none left: buy some from Ernis, drink, then go back to open the stand
    say(
      "HP at " +
        Math.round(hp_pct() * 100) +
        "% and no HP potion - buying " +
        CFG.SELF_HEAL_BUY +
        "x " +
        CFG.SELF_HEAL_POTION +
        " at Ernis",
      "#CF575F"
    );
    await drain_stand("healing");
    const npc = find_npc("fancypots");
    const r = npc
      ? await travel(
          { map: npc.map, x: npc.x, y: npc.y },
          0,
          "buying a healing potion at Ernis (fancypots)"
        )
      : { failed: true, reason: "npc_unknown" };
    if (r.failed) {
      say("Could not reach Ernis to heal: " + r.reason, "#CF575F");
      S.last_heal_fail = now();
      return go_home();
    }
    const n = Math.min(
      CFG.SELF_HEAL_BUY,
      Math.floor(character.gold / unit_cost(CFG.SELF_HEAL_POTION))
    );
    if (n <= 0) {
      say("No gold for a healing potion", "#CF575F");
      S.last_heal_fail = now();
      return go_home();
    }
    const have = quantity(CFG.SELF_HEAL_POTION);
    const res = await call(() => buy_with_gold(CFG.SELF_HEAL_POTION, n));
    const got = await call(() =>
      wait_for(() => quantity(CFG.SELF_HEAL_POTION) >= have + n, 6000)
    );
    if (res.failed || got.failed) {
      say(
        "Buying a healing potion failed: " + (res.reason || got.reason),
        "#CF575F"
      );
      S.last_heal_fail = now();
      return go_home();
    }
    say("Bought " + n + "x " + CFG.SELF_HEAL_POTION + " for myself");
    S.last_list_try = 0;
    await drink_until_healed();
    return go_home(); // main loop reopens the stand
  }

  // ============== WITHDRAW WHEN TOO POOR TO RESTOCK ==============
  // Gold needed to bring both delivery potions up to STOCK_TARGET.
  // Priced at the real NPC prices: tier-1 up to STOCK_TARGET, tier-0 up to its target, plus the stand-gold floor kept back
  const restock_cost = () =>
    [CFG.HP_POTION, CFG.MP_POTION].reduce(
      (sum, n) =>
        sum + Math.max(0, stock_target() - quantity(n)) * unit_cost(n),
      0
    ) +
    CFG.STAND_STOCK.reduce(
      (sum, x) =>
        sum + Math.max(0, x.target - held(x.name)) * unit_cost(x.name),
      0
    ) +
    CFG.STAND_STOCK_GOLD_FLOOR;
  const delivery_low = () =>
    quantity(CFG.HP_POTION) < stock_low_at() ||
    quantity(CFG.MP_POTION) < stock_low_at() ||
    CFG.STAND_STOCK.some((x) => held(x.name) < x.low);
  const too_poor_to_restock = () =>
    delivery_low() &&
    character.gold < restock_cost() &&
    now() - S.last_withdraw_fail > CFG.WITHDRAW_RETRY_MS;

  async function withdraw_and_shop() {
    await drain_stand("a bank withdrawal");
    const cost = restock_cost();
    const r = await travel(
      "bank",
      0,
      "withdrawing gold for potions (need " + cost + ")"
    );
    if (r.failed || character.map !== "bank") {
      say("Could not reach the bank: " + (r.reason || "wrong map"), "#CF575F");
      S.last_withdraw_fail = now();
      return go_home();
    }
    const ready = await call(() => wait_for(() => character.bank, 8000));
    if (ready.failed) {
      say("Bank data never loaded", "#CF575F");
      S.last_withdraw_fail = now();
      return go_home();
    }
    const shortfall = Math.max(0, cost - character.gold);
    const avail = Number(character.bank && character.bank.gold);
    // exactly what the potions cost on top of the gold he has, never more than POTION_BANK_CAP_PCT of the bank in one visit
    const cap = isFinite(avail)
      ? Math.floor(avail * CFG.POTION_BANK_CAP_PCT)
      : shortfall;
    const want = Math.min(shortfall, cap);
    const amount = Math.floor(isFinite(avail) ? Math.min(want, avail) : want);
    if (shortfall > cap)
      say(
        "Potion funding is capped at " +
          Math.round(CFG.POTION_BANK_CAP_PCT * 100) +
          "% of the bank (" +
          cap +
          " of " +
          shortfall +
          " needed): tier-1 first, the rest next round",
        "#51D2E1"
      );
    if (!(amount > 0)) {
      say(
        "Nothing to withdraw from the bank (balance " + avail + ")",
        "#CF575F"
      );
      S.last_withdraw_fail = now();
      return go_home();
    }
    if (amount < shortfall && isFinite(avail) && avail < shortfall)
      say(
        "Bank only holds " +
          amount +
          " but " +
          shortfall +
          " is needed - buying what I can",
        "#CF575F"
      );
    const before = character.gold;
    const wd = await call(() => bank_withdraw(amount));
    const done = await call(() =>
      wait_for(() => character.gold >= before + amount - 1, 5000)
    );
    if (wd.failed || done.failed) {
      say("Withdrawal failed: " + (wd.reason || done.reason), "#CF575F");
      S.last_withdraw_fail = now();
      return go_home();
    }
    say(
      "Withdrew " +
        amount +
        " gold (potions short by " +
        shortfall +
        "); now " +
        character.gold
    );
    await shop(); // walks to Ernis and buys with the fresh gold
    return go_home();
  }

  // ============================= BANKING ==========================
  // never deposit down below the withdrawal buffer, or a withdrawal would be undone on the next bank run
  const keep_gold = () => Math.max(CFG.GOLD_KEEP, CFG.WITHDRAW_BUFFER);
  const needs_bank = () =>
    character.gold >= CFG.BANK_THRESHOLD &&
    character.gold - keep_gold() >= CFG.BANK_MIN_DEPOSIT &&
    now() - S.last_bank_fail > CFG.BANK_RETRY_MS;

  async function bank_run() {
    await drain_stand("banking");
    const r =
      character.map === "bank" ? {} : await travel("bank", 0, "banking gold");
    if (r.failed || character.map !== "bank") {
      say("Could not reach the bank: " + (r.reason || "wrong map"), "#CF575F");
      S.last_bank_fail = now();
      return go_home();
    }
    const ready = await call(() => wait_for(() => character.bank, 8000));
    if (ready.failed) {
      say("Bank data never loaded", "#CF575F");
      S.last_bank_fail = now();
      return go_home();
    }
    const amount = Math.floor(character.gold - keep_gold());
    if (amount > 0) {
      const before = character.gold;
      const dep = await call(() => bank_deposit(amount));
      const done = await call(() =>
        wait_for(() => character.gold <= before - amount + 1, 5000)
      );
      if (dep.failed || done.failed) {
        say("Deposit failed: " + (dep.reason || done.reason), "#CF575F");
        S.last_bank_fail = now();
      } else say("Deposited " + amount + " gold (kept " + character.gold + ")");
    }
    return go_home();
  }

  // ============================= DELIVERY =========================
  // Walks to the meeting point the Ranger gave (his retreat spot in town) and waits for him there.
  // Sets req.fail_reason: no_show (nobody there after NO_SHOW_WAIT_MS) | unreachable | ranger_not_in_reach.
  async function go_to_ranger(req, why) {
    if (!Number.isFinite(req.x) || !Number.isFinite(req.y)) {
      req.fail_reason = "bad_position";
      return false;
    }
    const r = await travel(
      { map: req.map, x: req.x, y: req.y },
      0,
      why || "delivering potions to " + req.from
    );
    if (req.cancelled) return false; // cancel / travel_to_main turned us back
    if (r.failed) {
      say("Could not reach the Ranger: " + r.reason, "#CF575F");
      req.fail_reason = "unreachable";
      return false;
    }
    const t0 = now();
    let seen = false;
    for (;;) {
      if (!alive() || character.rip || req.cancelled) return false;
      const p = get_player(req.from);
      if (p) {
        seen = true;
        if (d2(character, p) <= CFG.HANDOFF_RANGE) return true;
        await call(() => xmove(p.x, p.y)); // he moves while fighting - close the gap
      }
      // nobody there: wait only NO_SHOW_WAIT_MS; once he has been seen the normal approach limit applies
      if (now() - t0 > (seen ? CFG.APPROACH_MAX_MS : CFG.NO_SHOW_WAIT_MS))
        break;
      await wait(300);
    }
    req.fail_reason = seen ? "ranger_not_in_reach" : "no_show";
    say(
      seen
        ? "Ranger not within reach after " + CFG.APPROACH_MAX_MS + "ms"
        : "No-show: nobody at the meeting point after " +
            CFG.NO_SHOW_WAIT_MS +
            "ms - going home",
      "#CF575F"
    );
    return false;
  }

  async function handoff(req) {
    const sent = { hp: 0, mp: 0 };
    for (const [key, name, want] of [
      ["hp", CFG.HP_POTION, req.hp],
      ["mp", CFG.MP_POTION, req.mp],
    ]) {
      let remaining = Math.min(want, quantity(name));
      while (remaining > 0) {
        const idx = locate_item(name);
        if (idx < 0) break;
        const q = Math.min(remaining, character.items[idx].q || 1);
        const before = quantity(name);
        const res = await call(() => send_item(req.from, idx, q));
        if (res.failed) {
          say("send_item failed: " + res.reason, "#CF575F");
          break;
        }
        const ok = await call(() =>
          wait_for(() => quantity(name) <= before - q, 3000)
        );
        if (ok.failed) {
          say(
            "Inventory did not change after send_item (" + name + ")",
            "#CF575F"
          );
          break;
        }
        sent[key] += q;
        remaining -= q;
        await wait(150);
      }
    }
    return sent;
  }

  // Hand-me-downs: the leader tells us what he just replaced. If a follower Ranger would gain from it, the leader is told to pass it on
  // (they stand next to each other, so no trip for the Merchant).
  function on_gear_replaced(d) {
    const name =
      typeof d.name === "string" && d.name.length <= 40 ? d.name : "";
    const level = clamp_int(d.level, 0, 20);
    const def = G.items[name];
    if (!def || !SLOT_OF_TYPE[def.type]) return;
    const it = {
      name,
      level,
      stat_type:
        typeof d.stat_type === "string" && d.stat_type.length <= 12
          ? d.stat_type
          : undefined,
    };
    if (!gear_wearable(it)) return;
    const score = gear_score(name, level, { stat_type: it.stat_type });
    const tg = score > 0 ? best_target(it, score, true) : null;
    if (!tg) return;
    say(
      "Hand-me-down: " +
        name +
        " +" +
        level +
        " goes from " +
        CFG.RANGER_NAME +
        " to " +
        tg.who +
        " (" +
        tg.f.slot +
        ")",
      "#5BCB5B"
    );
    reply(CFG.RANGER_NAME, {
      type: "gear_pass",
      to: tg.who,
      name,
      level,
      slot: tg.f.slot,
    });
  }

  // Gear waits for the next exchange with the Ranger (a normal town meeting). He is never hunted down in the field.
  async function give_pending_gear(to, via) {
    via = via || to; // who physically receives the item (the courier carries it for `to`)
    const g = gear_of(to);
    if (!S.gear_pending.length || !g || now() - g.at > 10 * 60000) return;
    for (const p of S.gear_pending.filter(
      (q) => (q.for || CFG.RANGER_NAME) === to
    )) {
      const idx = bag_list(
        (x) => x.name === p.name && (x.level || 0) === p.level
      )[0];
      if (idx === undefined) {
        S.gear_pending = S.gear_pending.filter((q) => q !== p);
        continue;
      }
      const it = character.items[idx];
      if (
        p.alt
          ? !beats_worn(it, p.level, to + "+")
          : p.kit
          ? !kit_missing(to)
          : !beats_worn(it, p.level, to)
      ) {
        S.gear_pending = S.gear_pending.filter((q) => q !== p); // he wears something as good by now
        continue;
      }
      const slot = p.alt
        ? "alt:" + p.slot
        : p.kit
        ? "bag"
        : worn_floor(it, to).slot;
      // tell him first so he is already waiting for the item when it lands
      await reply(via, {
        type: "gear_give",
        name: p.name,
        level: p.level,
        slot,
        ...(via !== to ? { to } : {}),
      });
      const res = await call(() => send_item(via, idx, 1));
      const gone = await call(() =>
        wait_for(
          () =>
            !character.items[idx] ||
            character.items[idx].name !== p.name ||
            (character.items[idx].level || 0) !== p.level,
          3000
        )
      );
      if (res.failed || gone.failed) {
        say(
          "Could not hand over " +
            p.name +
            " +" +
            p.level +
            ": " +
            (res.reason || gone.reason),
          "#CF575F"
        );
        break;
      }
      S.gear_pending = S.gear_pending.filter((q) => q !== p);
      say(
        "Gave " +
          p.name +
          " +" +
          p.level +
          " to " +
          via +
          (via !== to ? " to carry to " + to : "") +
          " for the " +
          slot,
        "#5BCB5B"
      );
      await wait(500);
    }
  }
  // courier meeting: the courier also takes whatever is waiting for the other Rangers
  async function give_courier_gear(req) {
    for (const n of req.courier || []) await give_pending_gear(n, req.from);
  }

  async function serve_request(req) {
    // 1) make sure we can actually fill the order (this may leave the stand): one shop run
    if (quantity(CFG.HP_POTION) < req.hp || quantity(CFG.MP_POTION) < req.mp)
      await shop();
    if (req.cancelled) return end_job(req, "CANCELLED");
    if (quantity(CFG.HP_POTION) + quantity(CFG.MP_POTION) === 0) {
      req.reason = "no_stock";
      return end_job(req, "FAILED");
    }
    // 2) don't walk out on a customer
    await drain_stand("delivery");
    if (req.cancelled) return end_job(req, "CANCELLED");
    set_state(req, "EN_ROUTE");
    // 3) go to him and hand the potions over
    const ok = await go_to_ranger(req);
    if (req.cancelled) return end_job(req, "CANCELLED");
    if (!ok) {
      req.reason = req.fail_reason || "unreachable";
      return end_job(req, "FAILED");
    }
    set_state(req, "ARRIVED");
    set_state(req, "TRANSFERRING");
    const gold_before = character.gold;
    const sent = await handoff(req);
    await give_pending_gear(req.from);
    await give_courier_gear(req);
    req.result = { hp: sent.hp, mp: sent.mp, got: sent.hp + sent.mp };
    end_job(req, "DONE");
    say(
      "Delivered " + sent.hp + " HP / " + sent.mp + " MP potions to " + req.from
    );
    // He pays from his side and needs us nearby - stay briefly
    await call(() =>
      wait_for(() => character.gold > gold_before, CFG.GOLD_WAIT_MS)
    );
  }
