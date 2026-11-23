  // ===== Christmas event exchange: bank -> NPCs (Winterland) -> sell/bank the rewards. The upgrade / compound rounds then work on what came out. =====
  const exch_over = () => {
    if (!CFG.EXCHANGE_END) return false;
    const t = Date.parse(CFG.EXCHANGE_END);
    return Number.isFinite(t) && Date.now() > t;
  };
  // v5 (Sean 2026-11-18): the two exchange rounds take turns. When both are due, the one whose turn it is goes first, and a round that started (even if a potion / junk job interrupted it) hands the turn to the other.
  const exch_time_ready = (rd) =>
    now() >= S[rd === 2 ? "exch2_next" : "exch_next"] &&
    now() >= S[rd === 2 ? "exch2_empty_until" : "exch_empty_until"];
  const exch_due = (rd) =>
    CFG.EXCHANGE_ENABLED &&
    !exch_over() &&
    !is_paused() &&
    !has_jobs() &&
    exch_time_ready(rd) &&
    ((S.exch_turn || 1) === rd || !exch_time_ready(rd === 2 ? 1 : 2)) &&
    exch_space_ok();
  // not enough bag space: no bank trip at all (logged at most every 30 minutes)
  function exch_space_ok() {
    if (free_slots() >= CFG.EXCHANGE_MIN_FREE_SLOTS) return true;
    if (now() - (S.exch_space_warn || 0) > 30 * 60000) {
      S.exch_space_warn = now();
      say(
        "Exchange run waits: only " +
          free_slots() +
          " free bag slots, it needs " +
          CFG.EXCHANGE_MIN_FREE_SLOTS +
          " (up to that many non-stackable rewards can land in the bag)",
        "#CF575F"
      );
    }
    return false;
  }
  // lv (optional): only items of exactly that level (recipes need the exact level)
  const bag_qty = (name, lv) => {
    let n = 0;
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (
        it &&
        it.name === name &&
        (lv === undefined || (it.level || 0) === lv)
      )
        n += it.q || 1;
    }
    return n;
  };
  const bank_stacks = (name, lv) => {
    const out = [];
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr))
        arr.forEach((it, i) => {
          if (
            it &&
            it.name === name &&
            (lv === undefined || (it.level || 0) === lv)
          )
            out.push({ pack, i, q: it.q || 1 });
        });
    }
    return out;
  };
  const bag_tally = () => {
    const t = {};
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (it) t[it.name] = (t[it.name] || 0) + (it.q || 1);
    }
    return t;
  };
  // exchange one stack that holds exactly the amount wanted; returns how many items were used up
  async function exchange_stack(slot, name, cap) {
    let used = 0;
    for (let n = 0; n < cap + 2; n++) {
      const it = character.items[slot];
      if (!it || it.name !== name) break;
      const q0 = it.q || 1;
      const res = await paced(() => call(() => exchange(slot)));
      if (res.failed) {
        say(
          "Exchange of " +
            name +
            " failed: " +
            (res.reason || res.response || "unknown"),
          "#CF575F"
        );
        break;
      }
      await call(() =>
        wait_for(() => !(character.q && character.q.exchange), 15000)
      );
      await wait(300);
      const now_it = character.items[slot];
      const q1 = now_it && now_it.name === name ? now_it.q || 1 : 0;
      if (q1 >= q0) {
        say("Exchange of " + name + " used nothing up - stopping", "#CF575F");
        break;
      }
      used += q0 - q1;
      if (q1 === 0) break;
    }
    return used;
  }
  // Takes one of each ingredient of the Xmas Box recipe out of the bank (the bank is open), crafts at Leo, returns to the bank and puts
  // the leftover pieces back. Returns the set of ingredient names (to put back later), or null when the bank could not be reopened.
  async function xbox_step() {
    const names = {};
    const rec = G.craft && G.craft.xbox;
    if (!CFG.XBOX_ENABLED || !rec || !rec.items) return names;
    for (const [, name] of rec.items) names[name] = true;
    let sets = CFG.XBOX_PER_RUN;
    const short = [];
    for (const [q, name] of rec.items) {
      const have = mats_have(name);
      sets = Math.min(sets, Math.floor(have / q));
      if (have < q) short.push(name);
    }
    if (rec.cost > 0)
      sets = Math.min(
        sets,
        Math.floor((character.gold - keep_gold()) / rec.cost)
      );
    if (sets <= 0) {
      const sig = "xbox:" + short.join(",");
      if (S.xbox_sig !== sig)
        say(
          "Xmas Box: not enough quantum pieces yet (missing " +
            (short.join(", ") || "gold") +
            ")"
        );
      S.xbox_sig = sig;
      return names;
    }
    if (free_slots() < rec.items.length + 2) {
      // the pieces are back in the bank before any exchange reward can land, so only the pieces and the box need room here
      say(
        "Xmas Box skipped: needs " +
          (rec.items.length + 2) +
          " free bag slots, has " +
          free_slots(),
        "#CF575F"
      );
      return names;
    }
    for (const [q, name] of rec.items) {
      const need = q * sets;
      for (const st of bank_stacks(name).sort((a, b) => b.q - a.q)) {
        if (bag_qty(name) >= need) break;
        const before = bag_qty(name);
        const res = await call(() => bank_retrieve(st.pack, st.i));
        const ok = await call(() =>
          wait_for(() => bag_qty(name) > before, 4000)
        );
        if (res.failed || ok.failed) {
          say(
            "Xmas Box: could not take " +
              name +
              " out of the bank: " +
              (res.reason || ok.reason),
            "#CF575F"
          );
          break;
        }
      }
      sets = Math.min(sets, Math.floor(bag_qty(name) / q));
    }
    if (sets > 0) {
      const who = rec.quest || "craftsman";
      const npc = find_npc(who) || CFG.CRAFT_NPC_FALLBACK[who];
      if (!npc) say("Xmas Box: cannot place the NPC " + who, "#CF575F");
      else {
        act("Craft xbox", 60, true);
        const r = await travel(
          { map: npc.map, x: npc.x, y: npc.y },
          0,
          "crafting a Xmas Box"
        );
        if (r.failed)
          say("Xmas Box: could not reach " + who + ": " + r.reason, "#CF575F");
        else
          for (let k = 0; k < sets; k++) {
            const before = bag_qty("xbox");
            const res = await call(() => auto_craft("xbox"));
            const ok = await call(() =>
              wait_for(() => bag_qty("xbox") > before, 6000)
            );
            if (res.failed || ok.failed) {
              say(
                "Xmas Box: crafting failed: " +
                  (res.reason || ok.reason) +
                  " (locked or bound pieces cannot be crafted)",
                "#CF575F"
              );
              break;
            }
            say("Crafted a Xmas Box (" + who + ")", "#5BCB5B");
          }
      }
    }
    // back to the bank: the pieces left over go home, and the exchange plan below reads the bank again
    if (!(await open_bank_for_compound())) {
      go_home();
      return null;
    }
    await put_back_in_bank((it) => !!names[it.name]);
    return names;
  }
  // Sean 2026-11-22: Monster Tokens (in the bank) -> Hunter Warrior gear at Daisy (npc "monsterhunter"), exchange_buy("monstertoken", name).
  // The pieces then go through the normal upgrade rounds (+7) and the gear sweep hands them to the Warrior. Returns false when nothing was done.
  // best level of any copy of the piece the Merchant knows of (bag, bank, worn by anyone); -1 = none
  const token_best = (name) => {
    let best = -1;
    const see = (it) => {
      if (it && it.name === name) best = Math.max(best, it.level || 0);
    };
    for (let i = 0; i < character.isize; i++) see(character.items[i]);
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach(see);
    }
    for (const who of roster()) {
      const g = gear_of(who);
      for (const sl in (g && g.slots) || {}) see(g.slots[sl]);
    }
    return best;
  };
  async function token_step() {
    if (!CFG.TOKEN_BUY_ENABLED) return;
    const tok = CFG.TOKEN_BUY_ITEM;
    const costs = (G.tokens && G.tokens[tok]) || null;
    if (!costs) return;
    const have = mats_have(tok);
    // ONE piece at a time (Sean 2026-11-22): the first piece of the list that has no copy at TOKEN_BUY_UNTIL_LEVEL yet.
    // A copy that exists but is still below it is being upgraded: nothing is bought until it is done. A broken piece (no copy left) is bought again.
    const buy = [];
    for (const name of CFG.TOKEN_BUY_LIST) {
      const best = token_best(name);
      if (best >= CFG.TOKEN_BUY_UNTIL_LEVEL) continue; // this slot is finished
      if (best >= 0) {
        const sig = "tok-wait:" + name + best;
        if (S.token_sig !== sig) say("Monster Tokens: " + name + " +" + best + " is being upgraded to +" + CFG.TOKEN_BUY_UNTIL_LEVEL + " first, nothing new is bought");
        S.token_sig = sig;
        return;
      }
      const c = costs[name];
      if (c && have >= c) buy.push(name);
      else {
        const sig = "tok-short:" + name + have;
        if (S.token_sig !== sig) say("Monster Tokens: next piece is " + name + " (" + c + " tokens), " + have + " in the bank - waiting");
        S.token_sig = sig;
      }
      break;
    }
    if (!buy.length) return;
    let left = have - buy.reduce((a, n) => a + costs[n], 0);
    const need = have - left;
    if (free_slots() < buy.length + 2) {
      say("Monster Tokens skipped: needs " + (buy.length + 2) + " free bag slots, has " + free_slots(), "#CF575F");
      return;
    }
    for (const st of bank_stacks(tok).sort((a, b) => b.q - a.q)) {
      if (bag_qty(tok) >= need) break;
      const before = bag_qty(tok);
      const res = await call(() => bank_retrieve(st.pack, st.i));
      const ok = await call(() => wait_for(() => bag_qty(tok) > before, 4000));
      if (res.failed || ok.failed) {
        say("Monster Tokens: could not take them out of the bank: " + (res.reason || ok.reason), "#CF575F");
        break;
      }
    }
    const npc = find_npc(CFG.TOKEN_NPC) || CFG.TOKEN_NPC_FALLBACK;
    say("Monster Tokens: buying " + buy.join(", ") + " (" + need + " of " + have + " tokens)");
    act("Buy hunter gear", 60, true);
    const r = await travel({ map: npc.map, x: npc.x, y: npc.y }, 0, "buying Hunter gear with Monster Tokens");
    if (r.failed) say("Monster Tokens: could not reach Daisy: " + r.reason, "#CF575F");
    else
      for (const name of buy) {
        const before = bag_qty(name);
        const t0 = bag_qty(tok);
        const res = await call(() => exchange_buy(tok, name));
        const ok = await call(() => wait_for(() => bag_qty(name) > before && bag_qty(tok) < t0, 6000));
        if (res.failed || ok.failed) {
          say("Monster Tokens: buying " + name + " failed: " + (res.reason || ok.reason), "#CF575F");
          break;
        }
        say("Bought " + name + " for " + costs[name] + " Monster Tokens", "#5BCB5B");
      }
    if (!(await open_bank_for_compound())) {
      go_home();
      return null;
    }
    const keep = {};
    keep[tok] = true;
    for (const name of CFG.TOKEN_BUY_LIST) keep[name] = true;
    await put_back_in_bank((it) => !!keep[it.name]);
  }
  async function exchange_round(rd) {
    rd = rd === 2 ? 2 : 1; // round 1 = the Christmas NPCs (Winterland), round 2 = everything at Xyn (plan entries with round: 2) + the Xmas Box crafting
    const KN = rd === 2 ? "exch2_next" : "exch_next";
    const KE = rd === 2 ? "exch2_empty_until" : "exch_empty_until";
    const L = rd === 2 ? "Exchange round 2" : "Exchange run";
    S[KN] = now() + (rd === 2 ? CFG.EXCHANGE2_EVERY_MS : CFG.EXCHANGE_EVERY_MS);
    S.exch_turn = rd === 2 ? 1 : 2; // the other round is next, whatever happens to this one
    await drain_stand("an exchange run");
    if (!(await open_bank_for_compound())) return go_home();
    if (free_slots() < CFG.EXCHANGE_MIN_FREE_SLOTS) {
      say(
        L +
          " skipped: only " +
          free_slots() +
          " free bag slots, it needs " +
          CFG.EXCHANGE_MIN_FREE_SLOTS,
        "#CF575F"
      );
      return go_home();
    }
    const xnames = rd === 2 ? await xbox_step() : {}; // quantum pieces -> Xmas Box at Leo (back to the bank afterwards)
    if (xnames === null) return go_home();
    if (rd === 2 && (await token_step()) === null) return;
    // what is there to do?
    const plan = [];
    let soonest = Infinity; // timed entries (every_ms) that are not due yet
    for (const p of CFG.EXCHANGE_PLAN.filter((q) => (q.round || 1) === rd)) {
      const def = G.items[p.item];
      if (!def || !(def.e > 0)) continue;
      if (
        p.every_ms &&
        now() - ((S.exch_last || {})[p.item] || 0) < p.every_ms
      ) {
        soonest = Math.min(
          soonest,
          ((S.exch_last || {})[p.item] || 0) + p.every_ms - now()
        );
        continue;
      }
      const have =
        bag_qty(p.item) + bank_stacks(p.item).reduce((a, b) => a + b.q, 0);
      // Sean 2026-11-22: a "big run" entry (big_times / big_every_ms): every big_every_ms this item gets big_times exchanges instead of times
      const big = p.big_every_ms && now() - ((S.exch_big || {})[p.item] || 0) >= p.big_every_ms;
      const times = Math.min(big ? p.big_times : p.times, Math.floor(have / def.e));
      if (times > 0) plan.push({ p, def, times, amount: times * def.e, big });
    }
    if (!plan.length) {
      const back = Math.max(
        60000,
        Math.min(CFG.EXCHANGE_EMPTY_BACKOFF_MS, soonest)
      );
      S[KE] = now() + back;
      say(
        L +
          ": no event items left in the bag or bank (or the hourly ones are not due yet) - looking again in " +
          Math.round(back / 60000) +
          " min"
      );
      return go_home();
    }
    // the stacks taken out of the bank use bag slots too: 30 must still be free once they are in the bag
    let stack_slots_needed = 0;
    for (const x of plan) {
      let got = bag_qty(x.p.item);
      for (const st of bank_stacks(x.p.item).sort((a, b) => b.q - a.q)) {
        if (got >= x.amount) break;
        got += st.q;
        stack_slots_needed++;
      }
    }
    if (free_slots() - stack_slots_needed < CFG.EXCHANGE_MIN_FREE_SLOTS) {
      say(
        L +
          " skipped: " +
          free_slots() +
          " free bag slots, " +
          stack_slots_needed +
          " needed for the event stacks and " +
          CFG.EXCHANGE_MIN_FREE_SLOTS +
          " kept free for the rewards",
        "#CF575F"
      );
      return go_home();
    }
    const plan_names = {};
    for (const x of plan) plan_names[x.p.item] = true;
    for (const p of CFG.EXCHANGE_PLAN) plan_names[p.item] = true;
    const base_names = {}; // everything he carries now (potions, scrolls, stand stock...) is left alone
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (it && !plan_names[it.name]) base_names[it.name] = true;
    }
    // take what the plan needs out of the bank (a retrieve takes a whole stack)
    for (const x of plan) {
      let got = bag_qty(x.p.item);
      for (const st of bank_stacks(x.p.item).sort((a, b) => b.q - a.q)) {
        if (got >= x.amount || free_slots() <= CFG.EXCHANGE_MIN_FREE_SLOTS)
          break;
        const before = bag_qty(x.p.item);
        const res = await call(() => bank_retrieve(st.pack, st.i));
        const ok = await call(() =>
          wait_for(() => bag_qty(x.p.item) > before, 4000)
        );
        if (res.failed || ok.failed) {
          say(
            "Could not take " +
              x.p.item +
              " out of the bank: " +
              (res.reason || ok.reason),
            "#CF575F"
          );
          break;
        }
        got = bag_qty(x.p.item);
      }
      x.amount = Math.min(x.amount, Math.floor(got / x.def.e) * x.def.e);
    }
    say(L + ": " + plan.map((x) => x.amount + " " + x.p.item).join(", "));
    const t_before = bag_tally();
    let yielded = false;
    for (const x of plan) {
      if (x.amount <= 0) continue;
      if (yield_now()) {
        say(L + ": a job is waiting - stopping before " + x.p.item);
        yielded = true;
        S[KN] = now() + 3000;
        break;
      }
      let npc = find_npc(x.p.npc);
      if (!npc) npc = CFG.EXCHANGE_NPC_FALLBACK[x.p.npc];
      if (!npc) {
        say(
          L + ": cannot place the NPC " + x.p.npc + " - skipping " + x.p.item,
          "#CF575F"
        );
        continue;
      }
      act("Exchange " + x.p.item, 50 + x.times * 4, true);
      if (x.big) (S.exch_big = S.exch_big || {})[x.p.item] = now(); // the 12 h clock of the big run starts now
      if (x.p.every_ms) (S.exch_last = S.exch_last || {})[x.p.item] = now(); // timed entry: the hour starts now, even if the trip fails
      const r = await travel(
        { map: npc.map, x: npc.x, y: npc.y },
        0,
        "exchanging " + x.p.item
      );
      if (r.failed) {
        say(L + ": could not reach " + x.p.npc + ": " + r.reason, "#CF575F");
        continue;
      }
      let left = x.amount;
      for (const slot0 of bag_list((it) => it.name === x.p.item).sort(
        (a, b) => (character.items[b].q || 1) - (character.items[a].q || 1)
      )) {
        if (left < x.def.e) break;
        if (free_slots() < 3) {
          say(L + ": the bag is nearly full - stopping", "#CF575F");
          left = 0;
          break;
        }
        let slot = slot0;
        const it = character.items[slot];
        if (!it || it.name !== x.p.item) continue;
        const take = Math.min(it.q || 1, left);
        const use = Math.floor(take / x.def.e) * x.def.e;
        if (use < x.def.e) continue;
        if (use < (it.q || 1)) {
          const had = bag_list((y) => y.name === x.p.item);
          const res = await call(() => split(slot, use));
          const ok = await call(() =>
            wait_for(
              () => bag_list((y) => y.name === x.p.item).length > had.length,
              4000
            )
          );
          if (res.failed || ok.failed) {
            say(
              "Could not split " + x.p.item + ": " + (res.reason || ok.reason),
              "#CF575F"
            );
            break;
          }
          slot = bag_list(
            (y) => y.name === x.p.item && (y.q || 1) === use
          ).find((i) => had.indexOf(i) === -1);
          if (slot === undefined) break;
        }
        left -= await exchange_stack(slot, x.p.item, use);
      }
      say("Exchanged " + (x.amount - left) + " " + x.p.item);
    }
    // what came out
    const t_after = bag_tally();
    const got = [];
    for (const n in t_after) {
      if (base_names[n] || plan_names[n]) continue;
      got.push(t_after[n] - (t_before[n] || 0) + "x " + n);
    }
    if (got.length) say("Exchange rewards: " + got.join(", "), "#5BCB5B");
    const is_reward = (it) =>
      !!it && !it.l && !base_names[it.name] && !plan_names[it.name];
    const is_gear = (it) =>
      !!G.items[it.name] && !!SLOT_OF_TYPE[G.items[it.name].type];
    const is_sell = (it) =>
      is_reward(it) &&
      !is_keeper(it) &&
      (CFG.EXCHANGE_SELL.indexOf(it.name) !== -1 ||
        (is_gear(it) &&
          !(gear_wearable(it) && !!best_target(it, potential_score(it)))));
    if (bag_list(is_sell).length) {
      const gnpc = find_npc(CFG.JUNK_SELL_NPC);
      const r =
        gnpc &&
        (await travel(
          { map: gnpc.map, x: gnpc.x, y: gnpc.y },
          0,
          "selling event rewards"
        ));
      if (gnpc && !r.failed) {
        const res = await sell_junk_here(() => bag_list(is_sell));
        say(
          "Sold " + res.sold + " event reward(s); gold is now " + character.gold
        );
      }
    }
    // the rest goes into the bank; the next upgrade / compound round finds it there
    if (await open_bank_for_compound()) {
      const n = await put_back_in_bank(
        (it) =>
          !!plan_names[it.name] ||
          !!xnames[it.name] ||
          (is_reward(it) && !is_sell(it))
      );
      if (n) {
        say("Put " + n + " item(s) from the exchange run into the bank");
        S.upgrade_next = Math.min(S.upgrade_next, now() + 60000);
        S.compound_next = Math.min(S.compound_next, now() + 60000);
      }
    }
    return go_home();
  }
