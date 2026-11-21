  // ---- flipping ----
  // the game's own item value function; without it flipping is switched off (no guessing about prices)
  const value_fn = () => {
    try {
      if (typeof calculate_item_value === "function")
        return calculate_item_value;
      if (parent && typeof parent.calculate_item_value === "function")
        return parent.calculate_item_value;
    } catch (e) {}
    return null;
  };
  const flip_factor = () => {
    try {
      const v = Number(get("flip_factor"));
      if (v > 0 && v < 2) return v;
    } catch (e) {}
    return CFG.FLIP_SELL_FACTOR;
  };
  const raw_value = (name, level) => {
    const fn = value_fn();
    if (!fn) return 0;
    try {
      return Number(fn({ name, level: level || 0 })) || 0;
    } catch (e) {
      return 0;
    }
  };
  const sell_value = (name, level) => raw_value(name, level) * flip_factor();
  const step_scroll = (name, level) => "scroll" + scroll_grade({ name, level });
  // best expected value of an item standing at `level`, selling or upgrading on (optimal stopping up to FLIP_MAX_LEVEL)
  function chain_value(name, level, first_chance) {
    let E = sell_value(name, CFG.FLIP_MAX_LEVEL);
    for (let L = CFG.FLIP_MAX_LEVEL - 1; L >= level; L--) {
      const p =
        L === level && first_chance !== undefined && first_chance !== null
          ? first_chance
          : CFG.FLIP_ASSUMED_CHANCE[L] !== undefined
          ? CFG.FLIP_ASSUMED_CHANCE[L]
          : 0.5;
      E = Math.max(
        sell_value(name, L),
        p * E - unit_cost(step_scroll(name, L))
      );
    }
    return E;
  }
  // go on from `level` with this quoted chance? (true = expected to earn more than selling as is)
  function flip_step_ok(name, level, chance) {
    const stay = sell_value(name, level);
    const go =
      chance * chain_value(name, level + 1) -
      unit_cost(step_scroll(name, level));
    return { ok: go > stay * (1 + CFG.FLIP_MIN_GAIN), stay, go };
  }
  const flip_ok = (it) =>
    CFG.FLIP_ENABLED &&
    !!value_fn() &&
    !!it &&
    !it.l &&
    !(it.q > 1) &&
    !!G.items[it.name] &&
    !!G.items[it.name].upgrade &&
    CFG.FLIP_KEEP_NAMES.indexOf(it.name) === -1 &&
    (it.level || 0) < CFG.FLIP_MAX_LEVEL &&
    scroll_grade(it) <= CFG.UPGRADE_MAX_SCROLL_GRADE &&
    !(gear_wearable(it) && !!best_target(it, potential_score(it)));
  // every piece in the bag and the bank packs, with where it is (nulls included: the planners skip them)
  function upg_items() {
    const items = [];
    for (let i = 0; i < character.isize; i++)
      items.push({ it: character.items[i], where: { bag: i } });
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr))
        arr.forEach((it, i) => items.push({ it, where: { pack, i } }));
    }
    return items;
  }
  function flip_candidates() {
    return AL.planners.flips({
      items: upg_items(),
      cfg: CFG,
      fn: { flip_ok, sell_value, chain_value },
    });
  }

  const upg_paused = () => {
    try {
      const v = get("upgrade_paused");
      return v === true || v === "true";
    } catch (e) {
      return false;
    }
  };
  function upg_stats() {
    try {
      const st = JSON.parse(get("upgrade_stats") || "null");
      if (st && typeof st.n === "number") return st;
    } catch (e) {}
    return { n: 0, wins: 0, exp: 0, var: 0 };
  }
  function upg_honesty(st) {
    if (st.n < CFG.UPGRADE_PAUSE_MIN_ATTEMPTS) return;
    if (st.wins < st.exp - 2.5 * Math.sqrt(st.var)) {
      try {
        set("upgrade_paused", true);
      } catch (e) {}
      say(
        "UPGRADES PAUSED: " +
          st.wins +
          " wins in " +
          st.n +
          " tries but the server quoted ~" +
          st.exp.toFixed(1) +
          ". Resume with set('upgrade_paused', false)",
        "#CF575F"
      );
    }
  }
  const upg_label = (it) => it.name + " +" + (it.level || 0);
  const upg_ok = (it) =>
    !!it &&
    !it.l &&
    !(it.q > 1) &&
    !!G.items[it.name] &&
    !!G.items[it.name].upgrade &&
    (gear_wearable(it) || support_names().some((w) => gear_wearable(it, w))) &&
    (it.level || 0) < upg_max(it.name) &&
    gamble_mode(it) !== "aside" &&
    scroll_grade(it) <= CFG.UPGRADE_MAX_SCROLL_GRADE;
  // copies of this exact item (name + level) in the bag and bank; waiting-for-a-Ranger items and locked ones are not spares
  function upg_copies(it) {
    const key = (x) => x.name + "|" + (x.level || 0);
    const k = key(it);
    let n = 0;
    const pend = S.gear_pending.slice();
    const add = (x, in_bag) => {
      if (!x || x.l || x.q > 1 || key(x) !== k) return;
      if (in_bag) {
        const j = pend.findIndex(
          (g) => g.name === x.name && g.level === (x.level || 0)
        );
        if (j >= 0) {
          pend.splice(j, 1);
          return;
        }
      }
      n++;
    };
    for (let i = 0; i < character.isize; i++) add(character.items[i], true);
    for (const pack of CFG.UPGRADE_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach((x) => add(x, false));
    }
    return n;
  }
  // "" = not a gamble item (or no fresh report from the leader), "aside" = already beats what SexyDexy wears, "fodder" = does not (and he still wears less than the cap)
  const gamble_mode = (it) =>
    AL.planners.gamble_mode(
      {
        cfg: CFG,
        fresh: gear_fresh(),
        ranger_gear: S.ranger_gear,
        fn: { beats_worn, upg_max },
      },
      it
    );
  const upg_has_spare = (it) =>
    gamble_mode(it) === "fodder" || upg_copies(it) >= CFG.UPGRADE_MIN_COPIES;
  const upg_scroll = (it) => "scroll" + scroll_grade(it);

  // the planner's input: the Merchant's own helpers (they read his live state)
  const upg_env = () => ({
    cfg: CFG,
    G_items: G.items,
    fn: {
      upg_ok,
      has_spare: upg_has_spare,
      potential: potential_score,
      best_target,
      support_target: support_upgrade_target,
      support_names,
      wearable: gear_wearable,
      upg_max,
      scroll_ok: (it) => scroll_grade(it) <= CFG.UPGRADE_MAX_SCROLL_GRADE,
      roster,
      fresh_for: gear_fresh_for,
      worn_floor,
      score: gear_score,
      label: upg_label,
      support_cfg,
    },
  });
  // v5: a listed stop-gap piece that would beat what a support character (Warrior / Priest) wears once upgraded to the limit
  const support_upgrade_target = (it) =>
    AL.planners.support_target(upg_env(), it);
  // everything upgradable that could beat what the Ranger wears, best first (bag + bank)
  function upgrade_candidates() {
    const plan = AL.planners.upgrade(Object.assign(upg_env(), { items: upg_items() }));
    S.upg_diag = plan.diag;
    for (const n of plan.notes) {
      const k = n.it.name + ":dexpot";
      if (!S.dexpot_logged) S.dexpot_logged = {};
      if (!S.dexpot_logged[k]) {
        S.dexpot_logged[k] = 1;
        say(
          "[upgrade] " + upg_label(n.it) + " would beat what " + n.who + " wears once a Dexterity scroll is applied"
        );
      }
    }
    return plan.cands;
  }
  const upg_due = () =>
    CFG.UPGRADE_ENABLED &&
    !upg_paused() &&
    !has_jobs() &&
    now() >= S.upgrade_next &&
    gear_fresh();

  // A finished piece that is going to a Ranger: his stat scroll (dex) goes on when the piece takes one (stat value > 0, none applied yet) and would beat what he
  // wears with it. The shared apply_stat_scroll does the work. Returns true when applied. (Support characters get theirs in the gear sweep: apply_support_scrolls.)
  async function apply_ranger_scroll(w, scrollNpc, upNpc) {
    if (
      stat_scroll_class(w.for) !== "ranger" ||
      !stat_scroll_on(w.for) ||
      !CFG.DEX_SCROLL_POTENTIAL
    )
      return false;
    const sc = stat_scroll_of(w.for);
    if (!sc) return false;
    const idx = bag_list(
      (x) => x.name === w.name && (x.level || 0) === w.level
    )[0];
    if (idx === undefined) return false;
    const it = character.items[idx];
    const def = G.items[it.name];
    if (!def || !(Number(def.stat) > 0) || it.stat_type || it.l) return false;
    const f = worn_floor(it, w.for);
    const with_dex = gear_score(it.name, w.level, { assume_dex: true });
    if (!(with_dex > f.score * CFG.GEAR_MARGIN)) return false;
    const r = await apply_stat_scroll(
      {
        name: w.name,
        level: w.level,
        who: w.for || CFG.RANGER_NAME,
        scroll: sc.name,
        stat: sc.stat,
        budgeted: true,
      },
      scrollNpc,
      upNpc
    );
    return r === "done";
  }

  async function upgrade_round() {
    S.upgrade_next = now() + CFG.UPGRADE_EVERY_MS;
    S.upgrade_attempts = 0;
    await drain_stand("an upgrade round");
    if (!(await open_bank_for_compound())) return go_home();
    const bank_gold = Number(character.bank && character.bank.gold);
    if (!(bank_gold >= CFG.COMPOUND_BANK_FLOOR)) {
      say(
        "Upgrades stopped: bank holds " +
          bank_gold +
          " gold, below the " +
          CFG.COMPOUND_BANK_FLOOR +
          " floor",
        "#CF575F"
      );
      return go_home();
    }
    if (S.upgrade_cap === null) {
      S.upgrade_cap = Math.floor(bank_gold * CFG.UPGRADE_SESSION_PCT);
      say(
        "Upgrade budget for this session: " +
          S.upgrade_cap +
          " gold (" +
          Math.round(CFG.UPGRADE_SESSION_PCT * 100) +
          "% of the bank)"
      );
    }
    const ranger_cands = upgrade_candidates();
    const d0 = S.upg_diag;
    say(
      "Upgrade round: looked at the bag and bank - " +
        d0.upgradable +
        " upgradable item(s), " +
        d0.ranger_kind +
        " of a kind the Rangers, the Warrior or the Priest can wear (" +
        d0.support_kind +
        " of those fit the Warrior / Priest), " +
        d0.level_ok +
        " below +" +
        CFG.UPGRADE_MAX_LEVEL +
        ", " +
        d0.scroll_ok +
        " within the scroll tier limit, " +
        d0.better +
        " that could beat what their wearer has on" +
        (d0.no_spare
          ? "; " +
            d0.no_spare +
            " skipped because no second copy of the same level exists (" +
            Object.keys(d0.no_spare_names).join(", ") +
            ")"
          : "") +
        (d0.not_better
          ? "; " +
            d0.not_better +
            " would not beat what the Rangers / Warrior / Priest wear (" +
            d0.why +
            ")"
          : "")
    );
    const cands = ranger_cands.concat(flip_candidates());
    if (!cands.length) {
      say(
        "Upgrade round: nothing could beat what " +
          roster()
            .concat(
              support_names().filter((n) => gear_fresh_for(n) && !/\+$/.test(n))
            )
            .join(", ") +
          " wear, and nothing is worth flipping" +
          (CFG.FLIP_ENABLED && !value_fn()
            ? " (flipping is off: this server has no item value function)"
            : "")
      );
      return go_home();
    }
    const room = Math.max(0, free_slots() - 3);
    const chosen = cands.slice(0, Math.min(CFG.UPGRADE_MAX_ITEMS, room));
    if (!chosen.length) {
      say("Upgrade round skipped: no free bag slots", "#CF575F");
      return go_home();
    }
    // take them out of the bank (highest index first within a pack, slots shift)
    const bank_ones = chosen
      .filter((c) => c.pack)
      .sort((a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : b.i - a.i));
    const names = {};
    for (const c of chosen) names[c.it.name] = true;
    for (const c of bank_ones) {
      const before = bag_list(
        (x) => x.name === c.it.name && (x.level || 0) === (c.it.level || 0)
      ).length;
      const res = await call(() => bank_retrieve(c.pack, c.i));
      const got = await call(() =>
        wait_for(
          () =>
            bag_list(
              (x) =>
                x.name === c.it.name && (x.level || 0) === (c.it.level || 0)
            ).length > before,
          4000
        )
      );
      if (res.failed || got.failed) {
        say(
          "Could not take " +
            upg_label(c.it) +
            " out of the bank: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        c.skip = true;
      }
    }
    // go to the upgrade NPC; scrolls are bought one at a time right before each attempt
    const work = chosen
      .filter((c) => !c.skip)
      .map((c) => ({
        name: c.it.name,
        level: c.it.level || 0,
        start: c.it.level || 0,
        flip: !!c.flip,
        for: c.for || CFG.RANGER_NAME,
      }));
    const scrollNpc = find_npc(CFG.UPGRADE_SCROLL_NPC);
    const upNpc = find_npc(CFG.UPGRADE_NPC);
    const keep_for_ranger = [];
    let yielded = false;
    for (const w of work) {
      for (;;) {
        if (upg_paused()) break;
        // yield point: one upgrade attempt is one atomic action; a waiting job goes first. The next round re-plans from the bank.
        if (yield_now()) {
          say("Upgrade round: a job is waiting - stopping at an item boundary");
          yielded = true;
          w.stop_all = true;
          S.upgrade_next = now() + 3000;
          break;
        }
        act("Upgrade " + w.name + " +" + w.level, P.ETA_S.upgrade_item, true);
        const slot0 = bag_list(
          (x) => x.name === w.name && (x.level || 0) === w.level
        )[0];
        if (slot0 === undefined) break;
        const it = character.items[slot0];
        if (w.level >= (w.flip ? CFG.FLIP_MAX_LEVEL : upg_max(w.name))) break;
        if (!w.flip && gamble_mode(it) === "aside") {
          say(
            "Upgrade: " +
              w.name +
              " +" +
              w.level +
              " is better than what " +
              CFG.RANGER_NAME +
              " wears - set aside for him, not upgraded further",
            "#8AB4D0"
          );
          break;
        }
        if (!w.flip && !upg_has_spare(it)) {
          say(
            "Upgrade: stopping at " +
              upg_label(it) +
              " - no second copy to fall back on if it breaks"
          );
          break;
        }
        const sname = upg_scroll(it);
        const price = unit_cost(sname);
        if (S.upgrade_spent + price > S.upgrade_cap) {
          say(
            "Upgrade budget used up (" +
              S.upgrade_spent +
              " / " +
              S.upgrade_cap +
              ")"
          );
          w.stop_all = true;
          break;
        }
        // scroll in the bag? else buy one (withdraw gold from the bank first when short)
        if (quantity(sname) < 1) {
          if (character.gold < price) {
            if (!(await open_bank_for_compound())) {
              w.stop_all = true;
              break;
            }
            const bg = Number(character.bank && character.bank.gold);
            if (bg - price < CFG.COMPOUND_BANK_FLOOR) {
              say(
                "Upgrades stopped: buying a scroll would take the bank below its floor",
                "#CF575F"
              );
              w.stop_all = true;
              break;
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
              "buying " + sname
            );
          const had = quantity(sname);
          const res = await call(() => buy_with_gold(sname, 1));
          const got = await call(() =>
            wait_for(() => quantity(sname) > had, 6000)
          );
          if (res.failed || got.failed) {
            say(
              "Buying " + sname + " failed: " + (res.reason || got.reason),
              "#CF575F"
            );
            w.stop_all = true;
            break;
          }
          S.upgrade_spent += price;
        }
        if (upNpc)
          await travel(
            { map: upNpc.map, x: upNpc.x, y: upNpc.y },
            0,
            "upgrading next to the upgrade NPC"
          );
        const i2 = bag_list(
          (x) => x.name === w.name && (x.level || 0) === w.level
        )[0];
        const si = locate_item(sname);
        if (i2 === undefined || si < 0) break;
        const odds = await call(() => upgrade(i2, si, null, true));
        const chance = Number(odds.chance);
        if (odds.failed || !(chance >= 0)) {
          say(
            "No odds for " +
              w.name +
              " +" +
              w.level +
              ": " +
              JSON.stringify(odds.failed ? odds.reason : odds),
            "#CF575F"
          );
          break;
        }
        let tag =
          w.name +
          " +" +
          w.level +
          " -> +" +
          (w.level + 1) +
          " with " +
          sname +
          ": " +
          Math.round(chance * 1000) / 10 +
          "% (grace " +
          (odds.grace === undefined ? "?" : odds.grace) +
          ")";
        if (chance < upg_min_chance(w.name, it)) {
          say(
            "UPGRADE skipped (below " +
              Math.round(upg_min_chance(w.name, it) * 100) +
              "%): " +
              tag
          );
          break;
        }
        if (w.flip) {
          const fs = flip_step_ok(w.name, w.level, chance);
          const money =
            " [flip: selling now ~" +
            Math.round(fs.stay) +
            "g, expected if I go on ~" +
            Math.round(fs.go) +
            "g]";
          if (!fs.ok) {
            say("FLIP not worth it: " + tag + money);
            break;
          }
          tag += money;
        }
        S.upgrade_attempts++;
        const lvl_now = w.level;
        const res = await call(() => upgrade(i2, si));
        await call(() =>
          wait_for(
            () =>
              !character.items[i2] ||
              (character.items[i2].name === w.name &&
                (character.items[i2].level || 0) !== lvl_now),
            6000
          )
        );
        await wait(300);
        const win =
          !!character.items[i2] &&
          character.items[i2].name === w.name &&
          (character.items[i2].level || 0) === lvl_now + 1;
        const st = upg_stats();
        st.n++;
        st.exp += chance;
        st.var += chance * (1 - chance);
        if (win) st.wins++;
        try {
          set("upgrade_stats", JSON.stringify(st));
        } catch (e) {}
        say(
          "UPGRADE " +
            (win
              ? "SUCCESS"
              : res.failed && character.items[i2]
              ? "FAILED (" + res.reason + ")"
              : "LOST the item") +
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
        upg_honesty(st);
        if (!win) break;
        w.level = lvl_now + 1;
      }
      if (w.stop_all) break;
    }
    // flipped items: sell them (or bank them) now, at Gabriel
    if (!yielded && CFG.FLIP_RESULT_ACTION === "sell") {
      const flipped = work.filter((w) => w.flip);
      const is_flipped = (x) =>
        flipped.some((w) => w.name === x.name && (x.level || 0) === w.level) &&
        !x.l;
      if (bag_list(is_flipped).length) {
        const npc = find_npc(CFG.JUNK_SELL_NPC);
        const r =
          npc &&
          (await travel(
            { map: npc.map, x: npc.x, y: npc.y },
            0,
            "selling flipped items"
          ));
        if (npc && !r.failed) {
          const res = await sell_junk_here(() => bag_list(is_flipped));
          say(
            "Sold " +
              res.sold +
              " flipped item(s); gold is now " +
              character.gold
          );
        }
      }
    }
    // what is done: better than what is worn -> keep in the bag for the Ranger, the rest back to the bank
    for (const w of work) {
      if (w.flip) continue;
      const idx = bag_list(
        (x) => x.name === w.name && (x.level || 0) === w.level
      )[0];
      if (idx === undefined) continue;
      if (!yielded && w.level > w.start)
        await apply_ranger_scroll(w, scrollNpc, upNpc);
      const idx2 = bag_list(
        (x) => x.name === w.name && (x.level || 0) === w.level
      )[0];
      if (idx2 === undefined) continue;
      const it = character.items[idx2];
      if (w.level > w.start && beats_worn(it, w.level, w.for)) {
        S.gear_pending.push({
          name: w.name,
          level: w.level,
          for: w.for || CFG.RANGER_NAME,
        });
        say(
          "Keeping " +
            upg_label(it) +
            " for " +
            (w.for || CFG.RANGER_NAME) +
            " (better than what he wears)",
          "#5BCB5B"
        );
      }
    }
    if (await open_bank_for_compound()) {
      const n_back = await put_back_in_bank(
        (x) =>
          !!names[x.name] &&
          !x.l &&
          !(x.q > 1) &&
          !S.gear_pending.some(
            (g) => g.name === x.name && g.level === (x.level || 0)
          )
      );
      if (n_back) say("Put " + n_back + " item(s) back in the bank");
    }
    return go_home();
  }
