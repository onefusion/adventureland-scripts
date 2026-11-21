  // ====================== JUNK PICKUP + SELL ======================
  function free_slots() {
    let n = 0;
    for (let i = 0; i < character.isize; i++) if (!character.items[i]) n++;
    return n;
  }
  // ---- stackable loot above its reserve (CFG.STACK_RESERVE) ----
  const reserve_of = (name) => {
    const r = CFG.STACK_RESERVE && CFG.STACK_RESERVE[name];
    return r === "full" ? Number((G.items[name] || {}).s) || 0 : Number(r) || 0;
  };
  function stack_total(name) {
    let n = 0;
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (it && it.name === name) n += it.q || 1;
    }
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr))
        arr.forEach((it) => {
          if (it && it.name === name) n += it.q || 1;
        });
    }
    return n;
  }
  // entries {name, q, ref}: the ones that can be sold, whole stack by whole stack, keeping the reserve (largest stacks first would keep the reserve in as few slots as possible, so smallest first here)
  function reserve_pick(entries) {
    const left = {};
    const out = [];
    for (const e of entries.slice().sort((a, b) => a.q - b.q)) {
      if (!(e.name in left)) left[e.name] = stack_total(e.name);
      if (left[e.name] - e.q >= reserve_of(e.name)) {
        left[e.name] -= e.q;
        out.push(e);
      }
    }
    return out;
  }
  function sellable_slots() {
    const out = [];
    const rs = [];
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (!it || never_sell(it)) continue;
      if (
        CFG.STACK_RESERVE &&
        CFG.STACK_RESERVE[it.name] !== undefined &&
        !it.l &&
        reserve_of(it.name) > 0
      ) {
        rs.push({ name: it.name, q: it.q || 1, ref: i });
        continue;
      }
      if (wc_surplus(it)) {
        out.push(i);
        continue;
      }
      if (CFG.JUNK_SELLABLE.indexOf(it.name) === -1 && !boss_gear_sellable(it))
        continue;
      if (
        it.l ||
        ((it.level || 0) > CFG.JUNK_SELL_MAX_LEVEL &&
          CFG.JUNK_ANY_LEVEL.indexOf(it.name) === -1)
      )
        continue;
      out.push(i);
    }
    for (const e of reserve_pick(rs)) out.push(e.ref);
    return out;
  }

  // boss gear nobody needs: sellable. Needs fresh gear reports from every Ranger and the game's value function (no guessing).
  function boss_gear_sellable(it) {
    try {
      if (
        !it ||
        it.l ||
        it.p ||
        (it.q || 1) > 1 ||
        (it.level || 0) > 0 ||
        never_sell(it)
      )
        return false;
      if (CFG.BOSS_GEAR.indexOf(it.name) === -1 || !G.items[it.name])
        return false;
      if (!value_fn() || !roster().every(gear_fresh_for)) return false;
      if (sell_value(it.name, 0) > CFG.SURPLUS_MAX_VALUE_EACH) return false;
      return !roster().some((w) => beats_worn(it, 0, w));
    } catch (e) {
      return false;
    }
  }
  const is_boss_keeper = (it) =>
    !!it &&
    !it.l &&
    CFG.BOSS_GEAR.indexOf(it.name) !== -1 &&
    !boss_gear_sellable(it);
  const is_keeper = (it) =>
    !!it &&
    !it.l &&
    (CFG.KEEP_FOR_COMPOUND.indexOf(it.name) !== -1 || is_boss_keeper(it));
  // Stackable loot handed over by the Ranger (named in his request): banked, never sold. Anything the Merchant
  // uses himself (potions, scrolls, stand stock) is protected.
  const stack_names = {};
  const stack_protected = (n) =>
    ["hpot", "mpot", "elixir", "scroll", "cscroll", "xscroll", "uscroll"].some(
      (p) => n.indexOf(p) === 0
    ) ||
    n === CFG.HP_POTION ||
    n === CFG.MP_POTION ||
    n === CFG.SELF_HEAL_POTION ||
    CFG.STAND_STOCK.some((x) => x.name === n);
  // (Sean 2026-11-19) scrolls are "protected" from sale / banking-as-loot, but split scroll stacks in the bank must still join: merge and bank_spot use this instead
  const merge_protected = (n) =>
    stack_protected(n) &&
    !["scroll", "cscroll", "uscroll", "xscroll"].some(
      (p) => n.indexOf(p) === 0
    );
  // (Sean 2026-11-18) the stackable items of the exchange plan (Raw Emerald, Market Parcels, Armor / Weapon Boxes, ...) are banked by the bag tidy whatever the Rangers' last request named: the exchange rounds take them out of the bank themselves
  const exch_stack = (n) =>
    !!G.items[n] &&
    !!G.items[n].s &&
    !stack_protected(n) &&
    CFG.EXCHANGE_PLAN.some((e) => e.item === n);
  const is_stack = (it) =>
    !!it && !it.l && (!!stack_names[it.name] || exch_stack(it.name));
  // v5: spare equipment the Rangers hand over (the Fire Bows): never sold, kept for the upgrade rounds and the gear sweep. Named in the Ranger's request.
  const gear_names = {};
  const is_gear_in = (it) => !!it && !it.l && !!gear_names[it.name];
  const received_slots = () =>
    sellable_slots().concat(
      bag_list(is_keeper),
      bag_list(is_stack),
      bag_list(is_gear_in)
    );

  async function sell_junk_here(slots_fn) {
    let sold = 0;
    for (const i of (slots_fn || sellable_slots)()) {
      const it = character.items[i];
      if (!it || never_sell(it)) continue; // the one guard every sale goes through
      const name = it.name;
      const gold_before = character.gold;
      const raw = (it.q || 1) === 1 ? raw_value(name, it.level || 0) : 0;
      const res = await call(() => sell(i, it.q || 1));
      const gone = await call(() =>
        wait_for(
          () => !character.items[i] || character.items[i].name !== name,
          2500
        )
      );
      if (!res.failed && !gone.failed && raw >= 1000) {
        // learn what Gabriel really pays compared with the game's item value
        await wait(200);
        const got = character.gold - gold_before;
        if (got > 0) {
          const ratio = got / raw;
          try {
            set("flip_factor", String(ratio));
          } catch (e) {}
          say(
            "Sale check: " +
              name +
              " +" +
              (it.level || 0) +
              " fetched " +
              got +
              "g, item value " +
              Math.round(raw) +
              " -> sell factor " +
              ratio.toFixed(3)
          );
        }
      }
      if (res.failed || gone.failed) {
        say(
          "Could not sell " +
            name +
            ": " +
            (res.reason || gone.reason || "slot unchanged"),
          "#CF575F"
        );
        return { sold, ok: false };
      }
      sold++;
      say(
        "Sold " +
          name +
          " (+" +
          Math.max(0, character.gold - gold_before) +
          "g)"
      );
      await wait(150);
    }
    return { sold, ok: true };
  }

  // Free bag slots by banking/selling what he does not need: compound material, leftover stackable loot, shop junk.
  async function make_space(need) {
    if (free_slots() >= need) return true;
    say(
      "Want " +
        need +
        " free slots for the pickup, have " +
        free_slots() +
        " - tidying the bag first"
    );
    const spare = (it) =>
      !!it &&
      !it.l &&
      !!G.items[it.name] &&
      (CFG.KEEP_FOR_COMPOUND.indexOf(it.name) !== -1 ||
        !!G.items[it.name].compound ||
        (!!G.items[it.name].s && !stack_protected(it.name)));
    if (bag_list(spare).length && (await open_bank_for_compound())) {
      await put_back_in_bank(spare);
      if (bag_list(spare).length) {
        await free_bank_space();
        if (character.map === "bank" || (await open_bank_for_compound()))
          await put_back_in_bank(spare);
      }
    }
    if (free_slots() < need && sellable_slots().length) {
      const npc = find_npc(CFG.JUNK_SELL_NPC);
      const r =
        npc &&
        (await travel(
          { map: npc.map, x: npc.x, y: npc.y },
          0,
          "selling shop junk to make room"
        ));
      if (npc && !r.failed) await sell_junk_here();
    }
    return free_slots() >= need;
  }

  async function serve_junk(req) {
    await make_space(req.count);
    if (req.cancelled) return end_job(req, "CANCELLED");
    // take what fits; the Ranger asks again for the rest
    const room = free_slots();
    if (room < 1) {
      say("Junk pickup refused: no free slot at all", "#CF575F");
      req.reason = "no_space";
      return end_job(req, "FAILED");
    }
    const cap = Math.min(req.count, room);
    if (cap < req.count)
      say(
        "Only " +
          room +
          " free slots: taking " +
          cap +
          " of " +
          req.count +
          " items now, the rest on the next pickup"
      );
    for (const k of Object.keys(stack_names)) delete stack_names[k];
    for (const n of req.names || [])
      if (G.items[n] && G.items[n].s && !stack_protected(n))
        stack_names[n] = true;
    for (const k of Object.keys(gear_names)) delete gear_names[k];
    for (const n of req.names || []) {
      const def = G.items[n];
      if (
        def &&
        !def.s &&
        !stack_protected(n) &&
        CFG.KEEP_FOR_COMPOUND.indexOf(n) === -1 &&
        CFG.JUNK_SELLABLE.indexOf(n) === -1
      )
        gear_names[n] = true;
    }
    try {
      await drain_stand("collecting junk");
      if (req.cancelled) return end_job(req, "CANCELLED");
      set_state(req, "EN_ROUTE");
      if (!(await go_to_ranger(req, "collecting junk from " + req.from))) {
        if (req.cancelled) return end_job(req, "CANCELLED");
        req.reason = req.fail_reason || "unreachable";
        return end_job(req, "FAILED");
      }
      set_state(req, "ARRIVED");
      // tell him we are next to him; he sends the items, then a job_sent message with the count
      const before = received_slots().length;
      await reply(req.from, { type: "job_ready", id: req.id, cap });
      set_state(req, "TRANSFERRING");
      const sent_msg = await call(() =>
        wait_for(
          () => S.junk_sent[req.id] !== undefined,
          CFG.JUNK_RECEIVE_WAIT_MS
        )
      );
      if (!sent_msg.failed) {
        // message arrived: give the items a moment to land (they are sent one by one)
        const want = before + S.junk_sent[req.id];
        await call(() => wait_for(() => received_slots().length >= want, 4000));
      } else if (received_slots().length <= before) {
        say("The Ranger never handed over any junk", "#CF575F");
        req.reason = "nothing_received";
        return end_job(req, "FAILED");
      }
      await wait(500);
      const have = received_slots().length;
      await give_pending_gear(req.from); // gear for him rides along at this meeting
      await give_courier_gear(req);
      req.result = { got: have };
      end_job(req, "DONE"); // he is free to go back to work; selling / banking continues here
      say("Collected " + have + " junk item(s) from " + req.from);
      if (!have) return;

      // sell to Gabriel (skipped when everything received is compound material)
      if (sellable_slots().length) {
        let npc = null;
        try {
          npc = find_npc(CFG.JUNK_SELL_NPC);
        } catch (e) {}
        if (!npc) npc = { map: "main", x: -89, y: -165 };
        const r = await travel(
          { map: npc.map || npc.in, x: npc.x, y: npc.y },
          0,
          "selling the Ranger's junk to Gabriel"
        );
        if (r.failed) say("Could not reach Gabriel: " + r.reason, "#CF575F");
        else {
          const res = await sell_junk_here();
          say(
            "Sold " + res.sold + " junk item(s); gold is now " + character.gold
          );
        }
      }
      // compound material goes to the bank, not to the shop - unless the bank is nearly full:
      // then normal-grade items below +3 are sold instead, high grade and +3 still get a slot
      if (bag_list(is_keeper).length) {
        if (await open_bank_for_compound()) {
          const free = bank_free_slots();
          const cheap = (it) =>
            is_keeper(it) &&
            scroll_grade(it) < CFG.BANKFULL_KEEP_GRADE &&
            (it.level || 0) < CFG.COMPOUND_SELL_AT_LEVEL;
          if (
            CFG.BANKFULL_SELL &&
            free < CFG.BANKFULL_TRIGGER_FREE &&
            bag_list(cheap).length
          ) {
            const nb = await put_back_in_bank(
              (it) => is_keeper(it) && !cheap(it)
            );
            if (nb) say("Banked " + nb + " accessory item(s) for compounding");
            say(
              "Bank is nearly full (" +
                free +
                " free) - selling " +
                bag_list(cheap).length +
                " normal-grade accessory item(s) instead of banking them"
            );
            let npc2 = null;
            try {
              npc2 = find_npc(CFG.JUNK_SELL_NPC);
            } catch (e) {}
            if (!npc2) npc2 = { map: "main", x: -89, y: -165 };
            const r2 = await travel(
              { map: npc2.map || npc2.in, x: npc2.x, y: npc2.y },
              0,
              "selling accessories the bank has no room for"
            );
            if (r2.failed)
              say("Could not reach Gabriel: " + r2.reason, "#CF575F");
            else {
              const res2 = await sell_junk_here(() => bag_list(cheap));
              say(
                "Sold " +
                  res2.sold +
                  " accessory item(s); gold is now " +
                  character.gold
              );
            }
          } else {
            const nb = await put_back_in_bank(is_keeper);
            say("Banked " + nb + " accessory item(s) for compounding");
          }
        }
      }
      // stackable loot goes to the bank too; if the bank is full, make room (sell cheap accessories) and try again
      if (bag_list(is_stack).length) {
        if (await open_bank_for_compound()) {
          let left = bag_list(is_stack).length;
          const nb = await put_back_in_bank(is_stack);
          left = bag_list(is_stack).length;
          if (nb) say("Banked " + nb + " stackable item(s)");
          if (left) {
            say(
              "Bank is full - making room before storing " +
                left +
                " stackable item(s)",
              "#CF575F"
            );
            await free_bank_space();
            if (character.map === "bank" || (await open_bank_for_compound())) {
              const nb2 = await put_back_in_bank(is_stack);
              if (nb2)
                say("Banked " + nb2 + " stackable item(s) after making room");
            }
            if (bag_list(is_stack).length)
              say(
                "Still no room in the bank: " +
                  bag_list(is_stack).length +
                  " stackable item(s) stay in my bag",
                "#CF575F"
              );
          }
        }
      }
      // bank whatever is above the threshold on the way home
      if (needs_bank()) {
        await bank_run(); // ends at the stand
      }
    } finally {
      await go_home();
    }
  }
