  // ===== Crafting at Leo =====
  // CRAFT_TARGETS items are made until enough exist: materials come from the bag and the bank, nothing else is touched.
  // The finished item stays in the bag; the upgrade rounds and the gear sweep take it from there.
  function craft_needs() {
    const out = [];
    if (!CFG.CRAFT_ENABLED) return out;
    const who_list = roster();
    S.craft_why = "";
    for (const who of who_list)
      if (!gear_fresh_for(who)) {
        S.craft_why = "no fresh gear report from " + who;
        return out;
      }
    // v5: CRAFT_TARGETS - make an item until this many exist in total (worn by the Rangers + in the Merchant's bag + in the bank)
    for (const t of CFG.CRAFT_TARGETS) {
      if (!G.items[t.item] || !G.craft || !G.craft[t.item]) continue;
      if (rc_cfg(t.item) && rc_done(t.item)) continue; // the Ranger's compound focus has what it needs (e.g. the +3 orb): no more of it
      // an item with a compound focus counts as the copies it took to make it (a +3 = 27 copies); everything else counts each item once
      const wt = (lv) => (rc_cfg(t.item) ? Math.pow(3, lv || 0) : 1);
      let have = 0;
      for (const who of who_list) {
        const g = gear_of(who);
        for (const sl in (g && g.slots) || {})
          if (g.slots[sl] && g.slots[sl].name === t.item)
            have += wt(g.slots[sl].level);
      }
      for (let i = 0; i < character.isize; i++) {
        const it = character.items[i];
        if (it && it.name === t.item) have += (it.q || 1) * wt(it.level);
      }
      for (const pack of CFG.UPGRADE_PACKS) {
        const arr = character.bank && character.bank[pack];
        if (Array.isArray(arr))
          arr.forEach((it) => {
            if (it && it.name === t.item) have += (it.q || 1) * wt(it.level);
          });
      }
      const n = Math.min(CFG.CRAFT_MAX_PER_RUN, t.total - have);
      if (n > 0) out.push({ item: t.item, n, target: true });
    }
    return out;
  }
  const craft_due = () => {
    if (!CFG.CRAFT_ENABLED || is_paused() || has_jobs()) return false;
    if (now() < S.craft_next) return false;
    if (free_slots() < CFG.CRAFT_MIN_FREE_SLOTS) {
      craft_note(
        "only " +
          free_slots() +
          " free bag slots, needs " +
          CFG.CRAFT_MIN_FREE_SLOTS
      );
      return false;
    }
    const needs = craft_needs();
    if (!needs.length) {
      craft_note(
        S.craft_why ||
          "the CRAFT_TARGETS counts are met (worn, in the bag or in the bank)"
      );
      return false;
    }
    return true;
  };
  function craft_note(why) {
    if (now() - (S.craft_note_at || 0) < 30 * 60000) return;
    S.craft_note_at = now();
    say("Crafting: nothing to do right now - " + why);
  }
  const mats_have = (name, lv) =>
    bag_qty(name, lv) + bank_stacks(name, lv).reduce((a, b) => a + b.q, 0);
  async function craft_round() {
    S.craft_next = now() + CFG.CRAFT_EVERY_MS;
    await drain_stand("a crafting trip");
    if (!(await open_bank_for_compound())) return go_home();
    const needs = craft_needs();
    // v5: the recipe fee (Venom Band: 240,000) is paid from the bag: take what is missing out of the bank first
    {
      let fee = 0;
      for (const nd of needs)
        fee += ((G.craft[nd.item] || {}).cost || 0) * nd.n;
      const short = fee + keep_gold() - character.gold;
      const avail = Number(character.bank && character.bank.gold) || 0;
      if (fee > 0 && short > 0 && avail > 0) {
        const amount = Math.min(avail, short + CFG.WITHDRAW_BUFFER);
        const wd = await call(() => bank_withdraw(amount));
        if (wd.failed)
          say(
            "Crafting: could not withdraw " +
              amount +
              " gold for the recipe fee: " +
              (wd.reason || "?"),
            "#CF575F"
          );
        else
          await call(() =>
            wait_for(() => character.gold >= fee + keep_gold(), 4000)
          );
      }
    }
    // what can be made from what is there
    const plan = [];
    for (const nd of needs) {
      const rec = G.craft[nd.item];
      let times = nd.n;
      const short = [];
      for (const [q, name, lv] of rec.items) {
        const have = mats_have(name, lv || 0);
        times = Math.min(times, Math.floor(have / q));
        if (have < q)
          short.push(q - have + " more " + name + (lv ? " +" + lv : ""));
      }
      if (
        rec.cost > 0 &&
        rec.cost * Math.max(1, times) > character.gold - keep_gold()
      )
        times = 0;
      if (times > 0) plan.push({ item: nd.item, rec, times });
      else {
        const sig = nd.item + ":" + short.join(",");
        if (S.craft_sig !== sig)
          say(
            "Crafting " +
              nd.item +
              " for the Rangers is waiting for materials: " +
              (short.join(", ") || "gold"),
            "#CF575F"
          );
        S.craft_sig = sig;
        S.craft_next = now() + CFG.CRAFT_EMPTY_BACKOFF_MS;
      }
    }
    if (!plan.length) return go_home();
    // take what the recipes need out of the bank (a retrieve takes a whole stack)
    for (const x of plan) {
      for (const [q, name, lv0] of x.rec.items) {
        const lv = lv0 || 0;
        const need = q * x.times;
        for (const st of bank_stacks(name, lv).sort((a, b) => b.q - a.q)) {
          if (bag_qty(name, lv) >= need || free_slots() <= 2) break;
          const before = bag_qty(name, lv);
          const res = await call(() => bank_retrieve(st.pack, st.i));
          const ok = await call(() =>
            wait_for(() => bag_qty(name, lv) > before, 4000)
          );
          if (res.failed || ok.failed) {
            say(
              "Could not take " +
                name +
                " out of the bank: " +
                (res.reason || ok.reason),
              "#CF575F"
            );
            break;
          }
        }
        x.times = Math.min(x.times, Math.floor(bag_qty(name, lv) / q));
      }
    }
    for (const x of plan) {
      const who = x.rec.quest || "craftsman";
      let npc = find_npc(who);
      if (!npc) npc = CFG.CRAFT_NPC_FALLBACK[who];
      if (!npc) {
        say(
          "Crafting: cannot place the NPC " + who + " - skipping " + x.item,
          "#CF575F"
        );
        continue;
      }
      if (x.times <= 0) continue;
      if (yield_now()) {
        say("Crafting: a job is waiting - stopping");
        S.craft_next = now() + 3000;
        break;
      }
      act("Craft " + x.item, 60 + x.times * 10, true);
      const r = await travel(
        { map: npc.map, x: npc.x, y: npc.y },
        0,
        "crafting " + x.item
      );
      if (r.failed) {
        say("Crafting: could not reach " + who + ": " + r.reason, "#CF575F");
        break;
      }
      // the game's auto_craft ignores locked / bound / giveaway items and wants the exact level: say which ingredient it will refuse
      const blocked = [];
      for (const [q, name, lv] of x.rec.items) {
        let usable = false;
        const seen = [];
        for (let i = 0; i < character.isize; i++) {
          const it = character.items[i];
          if (!it || it.name !== name) continue;
          const bad =
            (it.l ? "locked " : "") +
            (it.b ? "bound " : "") +
            (it.giveaway ? "giveaway " : "") +
            ((it.level || 0) !== (lv || 0)
              ? "level +" + (it.level || 0) + " "
              : "") +
            ((it.q || 1) < q ? "only " + (it.q || 1) + " in the stack " : "");
          if (!bad) usable = true;
          else seen.push(bad.trim());
        }
        if (!usable)
          blocked.push(
            name +
              " x" +
              q +
              " (" +
              (seen.length ? seen.join("; ") : "not in the bag") +
              ")"
          );
      }
      if (blocked.length) {
        say(
          "Crafting " +
            x.item +
            ": the game will not use " +
            blocked.join(", ") +
            ". Locked items need unlocking in the game; bound items cannot be crafted.",
          "#CF575F"
        );
        S.craft_next = now() + CFG.CRAFT_EMPTY_BACKOFF_MS;
        continue;
      }
      for (let k = 0; k < x.times; k++) {
        const before = bag_qty(x.item);
        const res = await call(() => auto_craft(x.item));
        const ok = await call(() =>
          wait_for(() => bag_qty(x.item) > before, 6000)
        );
        if (res.failed || ok.failed) {
          say(
            "Crafting " + x.item + " failed: " + (res.reason || ok.reason),
            "#CF575F"
          );
          S.craft_next = now() + CFG.CRAFT_EMPTY_BACKOFF_MS;
          break;
        }
        say("Crafted a " + x.item + " (" + who + ")", "#5BCB5B");
      }
    }
    return go_home();
  }
