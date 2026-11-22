  // ===== stat scrolls: ONE path for every character class (decision D5, 2026-11-20) =====
  // The class decides which scroll and stat (Ranger: CFG.DEX_SCROLL_NAME = dex; Warrior / Priest: the scroll in his SUPPORT_GEAR profile = str / int) and
  // CFG.STAT_SCROLL_APPLY switches each class on or off. The process is the same for all: find the piece, check the price, buy the scroll (taking gold
  // from the bank if needed), walk to the upgrade NPC, apply it, verify the item now carries the stat, log what happened (with the full evidence on a failure).
  const stat_scroll_class = (who) => {
    const sup = support_cfg(who);
    return sup ? sup.cls : "ranger";
  };
  const stat_scroll_on = (who) =>
    !!(CFG.STAT_SCROLL_APPLY && CFG.STAT_SCROLL_APPLY[stat_scroll_class(who)]);
  // { name, stat } of the scroll this character uses, or null
  function stat_scroll_of(who) {
    const sup = support_cfg(who);
    const name = sup ? sup.scroll : CFG.DEX_SCROLL_NAME;
    return name && G.items[name]
      ? { name, stat: G.items[name].stat || (sup ? sup.main : "dex") } // the scroll item names its stat (dex / str / int ...); the class's main stat is the fallback
      : null;
  }
  // job: { name, level, who, scroll, stat, budgeted }; returns "done", "skip" (nothing to do for this piece) or "fail" (something is off: the caller stops buying scrolls)
  async function apply_stat_scroll(j, scrollNpc, upNpc) {
    const where = () =>
      bag_list(
        (x) =>
          x.name === j.name &&
          (x.level || 0) === j.level &&
          !x.stat_type &&
          !x.l
      )[0];
    if (where() === undefined) return "skip";
    const price = unit_cost(j.scroll);
    if (price > CFG.STAT_SCROLL_MAX_GOLD) {
      say(
        "No " +
          j.scroll +
          " for " +
          j.name +
          ": it costs " +
          price +
          " (limit " +
          CFG.STAT_SCROLL_MAX_GOLD +
          ")",
        "#CF575F"
      );
      return "skip";
    }
    if (j.budgeted && S.upgrade_spent + price > S.upgrade_cap) {
      say(
        "No " + j.scroll + " for " + j.name + ": upgrade budget used up"
      );
      return "skip";
    }
    if (quantity(j.scroll) < 1) {
      if (character.gold < price) {
        if (!(await open_bank_for_compound())) return "fail";
        const bg = Number(character.bank && character.bank.gold);
        if (bg - price < CFG.COMPOUND_BANK_FLOOR) {
          say(
            "No " +
              j.scroll +
              ": buying one would take the bank below its floor",
            "#CF575F"
          );
          return "fail";
        }
        const before = character.gold;
        await call(() => bank_withdraw(price));
        await call(() =>
          wait_for(() => character.gold >= before + price - 1, 5000)
        );
      }
      if (scrollNpc)
        await travel(
          { map: scrollNpc.map, x: scrollNpc.x, y: scrollNpc.y },
          0,
          "buying " + j.scroll
        );
      const had = quantity(j.scroll);
      const res = await call(() => buy_with_gold(j.scroll, 1));
      const got = await call(() =>
        wait_for(() => quantity(j.scroll) > had, 6000)
      );
      if (res.failed || got.failed) {
        say(
          "Buying " + j.scroll + " failed: " + (res.reason || got.reason),
          "#CF575F"
        );
        return "fail";
      }
      if (j.budgeted) S.upgrade_spent += price;
    }
    if (upNpc)
      await travel(
        { map: upNpc.map, x: upNpc.x, y: upNpc.y },
        0,
        "applying a " + j.scroll
      );
    const idx = where();
    const si = locate_item(j.scroll);
    if (idx === undefined || si < 0) return "skip";
    const it = character.items[idx];
    act(
      j.scroll + " on " + j.name + " for " + j.who,
      P.ETA_S.upgrade_item,
      true
    );
    const res = await call(() => upgrade(idx, si));
    await call(() =>
      wait_for(
        () =>
          !!character.items[idx] && character.items[idx].stat_type === j.stat,
        6000
      )
    );
    await wait(300);
    const done =
      !!character.items[idx] && character.items[idx].stat_type === j.stat;
    say(
      "STAT SCROLL " +
        (done
          ? "applied to "
          : res.failed
          ? "FAILED (" + res.reason + ") on "
          : "did not take on ") +
        upg_label(it) +
        " for " +
        j.who +
        " (" +
        j.scroll +
        ")",
      done ? "#5BCB5B" : "#CF575F"
    );
    if (!done) {
      // full evidence for debugging: the server's answer, the item as it is now, the scroll and its game data
      const js = (o) => {
        try {
          return JSON.stringify(o);
        } catch (e) {
          return String(o);
        }
      };
      say(
        "STAT SCROLL debug: response " +
          js(res) +
          " | item[" +
          idx +
          "] " +
          js(character.items[idx]) +
          " | scroll[" +
          si +
          "] " +
          js(character.items[si]) +
          " | scroll data " +
          js(G.items[j.scroll]) +
          " | item data " +
          js(G.items[it.name]),
        "#CF575F"
      );
      return "fail"; // something is off: do not keep buying scrolls
    }
    return "done";
  }
  // the pieces the sweep just took out for the Priest / Warrior (S.gear_pending): their own stat scroll goes on first
  async function apply_support_scrolls() {
    const jobs = [];
    for (const p of S.gear_pending) {
      const sup = support_cfg(p.for);
      if (!stat_scroll_on(p.for)) continue; // (the Rangers too since 2026-11-21)
      const sc = stat_scroll_of(p.for);
      if (!sc) continue;
      const def = G.items[p.name];
      if (!def || !(Number(def.stat) > 0)) continue;
      const idx = bag_list(
        (x) =>
          x.name === p.name &&
          (x.level || 0) === p.level &&
          !x.stat_type &&
          !x.l
      )[0];
      if (idx === undefined) continue;
      const w = sup
        ? (sup.weights && sup.weights[sc.stat]) || (sup.main === sc.stat ? 1 : 0)
        : 1; // a Ranger: Dexterity is his main stat
      if (!(w > 0)) continue;
      jobs.push({
        name: p.name,
        level: p.level,
        who: p.for,
        scroll: sc.name,
        stat: sc.stat,
        budgeted: false,
      });
    }
    if (!jobs.length) return;
    const scrollNpc = find_npc(CFG.UPGRADE_SCROLL_NPC);
    const upNpc = find_npc(CFG.UPGRADE_NPC);
    for (const j of jobs) {
      const r = await apply_stat_scroll(j, scrollNpc, upNpc);
      if (S.swap && S.swap.name === j.name && S.swap.level === j.level && S.swap.who === j.who) {
        if (r !== "done") S.swap_fail[j.name + "|" + j.level] = now(); // it did not take: the piece goes back as it was and is never taken off again
        S.swap = null;
      }
      if (r === "fail") return;
    }
  }
  // v6 (Sean 2026-11-21): a Ranger's WORN piece with a stat value and no scroll yet. Applying a stat scroll never breaks gear, so the Merchant asks him to take it off (scroll_swap);
  // the courier trip brings it to the Merchant like any spare gear, the gear sweep sees it beat the empty slot, apply_support_scrolls puts the scroll on, and the normal hand-over returns it.
  async function request_scroll_swap() {
    if (!CFG.STAT_SCROLL_WORN || CFG.UPGRADE_DRY_RUN || !stat_scroll_on(CFG.RANGER_NAME)) return;
    if (S.swap && now() - S.swap.at > 2 * CFG.STAT_SCROLL_WORN_GAP_MS) S.swap = null; // the piece never came: forget it (it stays in his bag as spare gear, or he still wears it)
    if (S.swap || now() - S.swap_last < CFG.STAT_SCROLL_WORN_GAP_MS) return;
    const sc = stat_scroll_of(CFG.RANGER_NAME);
    if (!sc || unit_cost(sc.name) > CFG.STAT_SCROLL_MAX_GOLD) return;
    for (const who of roster()) {
      if (!gear_fresh_for(who)) continue;
      const rep = gear_of(who);
      let best = null;
      for (const slot of Object.keys((rep && rep.slots) || {})) {
        const it = rep.slots[slot];
        const def = it && G.items[it.name];
        if (!def || !(Number(def.stat) > 0) || it.stat_type || S.swap_fail[it.name + "|" + (it.level || 0)]) continue;
        if (slot === "mainhand" || slot === "offhand") continue; // weapons are not swapped off in the field
        const v = Number(def.stat) * (1 + (it.level || 0));
        if (!best || v > best.v) best = { slot, name: it.name, level: it.level || 0, v };
      }
      if (!best) continue;
      S.swap = { who, name: best.name, level: best.level, slot: best.slot, at: now() };
      S.swap_last = now();
      say("Stat scroll for the worn " + best.name + " +" + best.level + ": asking " + who + " to take it off and bring it on the next trip (" + sc.name + " does not break gear)", "#8AB4D0");
      await reply(who, { type: "scroll_swap", slot: best.slot, name: best.name, level: best.level });
      return;
    }
  }
  async function gear_sweep() {
    await drain_stand("a gear sweep");
    if (await open_bank_for_compound()) {
      if (CFG.GEAR_SWEEP) await gear_sweep_here();
      if (CFG.SURPLUS_SELL && CFG.SURPLUS_COPIES) await sell_copies();
      await free_bank_space(); // no-op while the bank has enough free item slots
    }
    await apply_support_scrolls();
    await request_scroll_swap();
    return go_home();
  }
  const BOOT_AT = now();
  function sweep_blocked_note() {
    if (now() - BOOT_AT < 300000) return; // the Rangers need a few minutes to report after a restart
    if (now() - (S.sweep_warn || 0) < 30 * 60000) return;
    const missing = roster().filter((w) => !gear_fresh_for(w));
    if (!missing.length) return;
    S.sweep_warn = now();
    say(
      "Gear sweep / bank consolidation is waiting for a fresh gear report from " +
        missing.join(", ") +
        " - are they running the newest AutoRanger v5.js with GEAR_SHARE on? (Rangers silent for 30 min count as offline and are skipped.)",
      "#CF575F"
    );
  }
  // console: set("gear_sweep_now","1") runs a gear sweep at the next chance (also asks for a worn-piece stat scroll swap); the sweep logs why when it cannot
  const sweep_forced = () => {
    try {
      if (String(get("gear_sweep_now") || "") === "1" && !has_jobs() && !is_paused()) {
        set("gear_sweep_now", "");
        S.sweep_last = 0;
        S.swap_last = 0;
        say("Gear sweep requested from the console", "#8AB4D0");
        return true;
      }
    } catch (e) {}
    return false;
  };
  const sweep_due = () =>
    sweep_forced() ||
    (sweep_blocked_note(), false) ||
    ((CFG.GEAR_SWEEP || (CFG.SURPLUS_SELL && CFG.SURPLUS_COPIES)) &&
      !has_jobs() &&
      (now() - S.sweep_last >= CFG.GEAR_SWEEP_STANDALONE_MS ||
        (CFG.SURPLUS_COPIES &&
          now() - (S.copies_last || 0) >= CFG.GEAR_SWEEP_STANDALONE_MS)) &&
      roster().every(gear_fresh_for));
