  // ---- v5: private sale (set("sell_item", "name:level[:price]") in the game console) ----
  function sale_poll() {
    if (S.sale_req) return true;
    try {
      const v = String(get("sell_item") || "").trim();
      if (!v) return false;
      set("sell_item", "");
      const m = v.match(/^([a-z0-9_]+):(\d+)(?::(\d+))?$/i);
      if (!m) {
        say(
          "sell_item: '" +
            v +
            "' is not name:level or name:level:price (example: firebow:4)",
          "#CF575F"
        );
        return false;
      }
      S.sale_req = {
        name: m[1],
        level: Number(m[2]),
        price: m[3] ? Number(m[3]) : 0,
      };
      return true;
    } catch (e) {
      return false;
    }
  }
  async function private_sale() {
    const rq = S.sale_req;
    S.sale_req = null;
    if (!rq) return;
    const label = rq.name + " +" + rq.level;
    const fits = (x) =>
      !!x &&
      x.name === rq.name &&
      (x.level || 0) === rq.level &&
      !x.l &&
      !(x.q > 1);
    const slots = character.slots || {};
    for (let n = 1; n <= 16; n++)
      if (fits(slots["trade" + n])) {
        say("Private sale: " + label + " is already listed on trade" + n);
        return;
      }
    let idx = bag_list(fits)[0];
    if (idx === undefined) {
      if (!(await open_bank_for_compound())) return;
      let found = null;
      for (const pack of CFG.COMPOUND_PACKS) {
        const arr = character.bank && character.bank[pack];
        if (!Array.isArray(arr)) continue;
        const i = arr.findIndex(fits);
        if (i >= 0) {
          found = { pack, i };
          break;
        }
      }
      if (!found) {
        say(
          "Private sale: no unlocked " + label + " in the bag or the bank",
          "#CF575F"
        );
        return;
      }
      const before = bag_list(fits).length;
      const res = await call(() => bank_retrieve(found.pack, found.i));
      const got = await call(() =>
        wait_for(() => bag_list(fits).length > before, 4000)
      );
      if (res.failed || got.failed) {
        say(
          "Private sale: could not take " +
            label +
            " out of the bank: " +
            (res.reason || got.reason),
          "#CF575F"
        );
        return;
      }
      idx = bag_list(fits)[0];
    }
    let price = rq.price;
    if (!price) {
      const val = sell_value(rq.name, rq.level);
      if (!(val > 0)) {
        say(
          'Private sale: this server has no item value function - give a price: set("sell_item", "' +
            rq.name +
            ":" +
            rq.level +
            ':PRICE"). ' +
            label +
            " stays in the bag",
          "#CF575F"
        );
        return;
      }
      price = Math.max(1, Math.round(val - CFG.SALE_BELOW_NPC));
      say(
        "Private sale: Gabriel would pay about " +
          Math.round(val) +
          " for " +
          label +
          " (game value " +
          Math.round(raw_value(rq.name, rq.level)) +
          " x " +
          Math.round(flip_factor() * 100) / 100 +
          "); listing it at " +
          price +
          " (" +
          CFG.SALE_BELOW_NPC +
          " below)"
      );
    }
    const r = await travel(
      CFG.STAND_SPOT,
      0,
      "private sale: back to the stand"
    );
    if (r.failed) {
      say(
        "Private sale: could not reach the stand: " +
          r.reason +
          " - " +
          label +
          " stays in the bag",
        "#CF575F"
      );
      return;
    }
    if (!character.stand) {
      await call(() => open_stand());
      await wait(500);
    }
    let slot = 0;
    const cs = character.slots || {};
    for (let n = CFG.SALE_FIRST_SLOT; n <= 16 && !slot; n++)
      if (!(cs["trade" + n] && cs["trade" + n].name)) slot = n;
    if (!slot) {
      say(
        "Private sale: no free stand slot from trade" +
          CFG.SALE_FIRST_SLOT +
          " up - " +
          label +
          " stays in the bag",
        "#CF575F"
      );
      return;
    }
    const res = await call(() => trade(idx, slot, price, 1));
    const listed = await call(() =>
      wait_for(
        () =>
          !!(
            character.slots["trade" + slot] &&
            character.slots["trade" + slot].name === rq.name
          ),
        4000
      )
    );
    if (res.failed || listed.failed)
      say(
        "Private sale: listing " +
          label +
          " failed: " +
          (res.reason || listed.reason),
        "#CF575F"
      );
    else
      say(
        "Private sale: " +
          label +
          " is on the stand (trade" +
          slot +
          ") for " +
          price +
          " gold",
        "#58CF40"
      );
  }
  // ---- v5 (Sean 2026-11-20): the Warrior has no basher -> bank trip, then hand it over at the stand where the group waits ----
  sched_add({
    name: "kit",
    label: "Basher for the Warrior",
    due: () => !!S.kit_call && now() - S.kit_call.at < 20 * 60000 && !has_jobs(),
    run: async () => {
      const who = S.kit_call.who;
      const waiting = () => S.gear_pending.some((p) => p.kit && p.for === who);
      if (!kit_missing(who)) {
        S.kit_call = null; // his latest report shows one
        return say("Basher call: " + who + " has a basher now", "#5BCB5B");
      }
      if (!waiting()) await gear_sweep(); // takes the basher out of the bank into the bag and marks it as his (the same sweep as always)
      const had = waiting();
      const t0 = now();
      while (alive() && waiting() && now() - t0 < 150000) {
        await give_pending_gear(who); // he is waiting at the meeting spot next to the stand
        if (waiting()) await wait(3000);
      }
      if (had && !waiting()) say("Basher call: handed " + who + " his basher", "#5BCB5B");
      else if (!had) say("Basher call: I have no basher to give " + who + " (none in the bag or the bank): buy a Wooden Basher from Gabriel (about 4,900 g) and put it in my bag", "#CF575F");
      else say("Basher call: could not reach " + who + " to hand over the basher", "#CF575F");
      S.kit_call = null;
    },
  });
  sched_add({
    name: "manual",
    label: "Compound test",
    due: () => !!(S.manual && !has_jobs()),
    run: async () => {
      const m = S.manual;
      S.manual = null;
      await manual_compound_test(m.real);
    },
  });
  // ---- v5: market watch (Ponty) ----
  const market_price = (it) => {
    const f = Number(S.market_factor) > 0 ? S.market_factor : CFG.MARKET_MARKUP;
    return Math.round(raw_value(it.name, it.level || 0) * f);
  };
  function market_due() {
    if (!CFG.MARKET_ENABLED || has_jobs() || is_paused() || !gear_fresh())
      return false;
    try {
      const v = String(get("market_check") || "");
      if (v) {
        set("market_check", "");
        S.market_next = 0;
      }
    } catch (e) {}
    return now() >= (S.market_next || 0);
  }
  async function market_round() {
    S.market_next = now() + CFG.MARKET_EVERY_MS;
    await drain_stand("the market check");
    let npc = find_npc(CFG.MARKET_NPC) || CFG.MARKET_NPC_FALLBACK;
    if (!npc) {
      say(
        "Market watch: cannot place " +
          CFG.MARKET_NPC +
          " (set MARKET_NPC_FALLBACK)",
        "#CF575F"
      );
      return go_home();
    }
    if (
      CFG.MARKET_BUY &&
      character.gold - CFG.MARKET_GOLD_FLOOR < CFG.MARKET_MAX_SPEND &&
      (await open_bank_for_compound())
    ) {
      // he carries little gold: take what a visit may spend out of the spare bank gold (leftovers go back with the normal banking)
      const spare = Math.max(
        0,
        (Number(character.bank && character.bank.gold) || 0) -
          CFG.MARKET_BANK_FLOOR
      );
      const amount = Math.floor(
        Math.min(
          CFG.MARKET_MAX_SPEND + CFG.MARKET_GOLD_FLOOR - character.gold,
          spare
        )
      );
      if (amount >= 100000) {
        const before = character.gold;
        const wd = await call(() => bank_withdraw(amount));
        const done = await call(() =>
          wait_for(() => character.gold >= before + amount - 1, 5000)
        );
        if (wd.failed || done.failed)
          say(
            "Market watch: withdrawal of " +
              amount +
              " failed: " +
              (wd.reason || done.reason),
            "#CF575F"
          );
        else
          say(
            "Market watch: took " +
              amount +
              " spare gold out of the bank for purchases"
          );
      } else
        say(
          "Market watch: no spare bank gold above " +
            CFG.MARKET_BANK_FLOOR +
            " for purchases"
        );
    }
    act("Market watch", 60, true);
    const r = await travel(
      { map: npc.map, x: npc.x, y: npc.y },
      0,
      "market watch at Ponty"
    );
    if (r.failed) {
      say("Market watch: could not reach Ponty: " + r.reason, "#CF575F");
      return go_home();
    }
    const list = await sock_ask("secondhands", undefined, "secondhands", 8000);
    if (!Array.isArray(list)) {
      say("Market watch: Ponty gave no list", "#CF575F");
      return go_home();
    }
    const by = {};
    for (const it of list) {
      const k =
        it.name +
        "|" +
        (it.level || 0) +
        "|" +
        (it.stat_type || "") +
        "|" +
        (it.p || "");
      (by[k] = by[k] || { it, rids: [] }).rids.push(it.rid);
    }
    // 1. wearable pieces: per Ranger and slot type ONE piece, the best real score (what he can wear right now, no Dexterity scroll counted);
    //    among pieces within 5% of the best, the cheapest. Each copy at Ponty goes to one Ranger only.
    const groups = [];
    for (const k in by) {
      const { it, rids } = by[k];
      const def = G.items[it.name];
      if (!def || it.l || !gear_wearable(it)) continue;
      const lvl = it.level || 0;
      const up = !!def.upgrade && lvl < upg_max(it.name);
      groups.push({
        it,
        def,
        left: rids.slice(),
        n: rids.length,
        real: gear_score(it.name, lvl, { stat_type: it.stat_type }),
        at_cap: up
          ? gear_score(it.name, upg_max(it.name), { stat_type: it.stat_type })
          : null, // upgraded to the cap, no scroll
        pot: up
          ? potential_score(it)
          : gear_score(it.name, lvl, {
              stat_type: it.stat_type,
              assume_dex: true,
            }), // upgraded and with a Dexterity scroll
        price: market_price(it),
      });
    }
    const fmt = (v) => Math.round(v * 10) / 10;
    const plan = [];
    for (const who of roster()) {
      if (!gear_fresh_for(who)) continue;
      const types = [...new Set(groups.map((g) => g.def.type))];
      for (const type of types) {
        let cands = groups.filter(
          (g) =>
            g.def.type === type &&
            g.left.length &&
            g.real > worn_floor(g.it, who).score * CFG.GEAR_MARGIN
        );
        if (!cands.length) continue;
        const top = Math.max(...cands.map((g) => g.real));
        cands = cands
          .filter((g) => g.real >= top * 0.95)
          .sort((a, b) => a.price - b.price);
        const g = cands[0];
        plan.push({
          who,
          g,
          rid: g.left.shift(),
          floor: worn_floor(g.it, who).score,
        });
      }
    }
    plan.sort((a, b) => b.g.real - b.floor - (a.g.real - a.floor));
    for (const pl of plan.slice(0, 12))
      say(
        "Market watch: for " +
          pl.who +
          ": " +
          pl.g.it.name +
          " +" +
          (pl.g.it.level || 0) +
          " (x" +
          pl.g.n +
          " at Ponty), score " +
          fmt(pl.g.real) +
          " as it is (" +
          fmt(pl.g.pot) +
          " fully upgraded with a Dexterity scroll), he wears " +
          fmt(pl.floor) +
          ", about " +
          pl.g.price +
          " gold",
        "#58CF40"
      );
    // upgrade projects: not better as they are, but would be at +5 (reported only; the upgrade rounds need two copies)
    const proj = [];
    for (const g of groups) {
      if (g.at_cap === null || plan.some((pl) => pl.g === g)) continue;
      const tg = best_target(g.it, g.at_cap);
      if (tg && !(g.real > tg.f.score * CFG.GEAR_MARGIN)) proj.push({ g, tg });
    }
    for (const pr of proj.slice(0, 4))
      say(
        "Market watch: upgrade project: " +
          pr.g.it.name +
          " +" +
          (pr.g.it.level || 0) +
          " (x" +
          pr.g.n +
          ", about " +
          pr.g.price +
          " each) would score " +
          fmt(pr.g.at_cap) +
          " at +" +
          upg_max(pr.g.it.name) +
          " vs " +
          fmt(pr.tg.f.score) +
          " worn by " +
          pr.tg.who
      );
    // 2. compound sets
    const sets = [];
    for (const k in by) {
      const { it, rids } = by[k];
      if (
        CFG.KEEP_FOR_COMPOUND.indexOf(it.name) === -1 ||
        it.l ||
        wc_done(it.name)
      )
        continue;
      const held = upg_copies({ name: it.name, level: it.level || 0 });
      if (held + rids.length < 3) continue;
      sets.push({ it, rids, held, price: market_price(it) });
    }
    for (const s of sets)
      say(
        "Market watch: Ponty has " +
          s.rids.length +
          "x " +
          s.it.name +
          " +" +
          (s.it.level || 0) +
          ", about " +
          s.price +
          " each; " +
          s.held +
          " held - " +
          Math.floor((s.held + s.rids.length) / 3) +
          " compound(s) possible",
        "#58CF40"
      );
    if (!plan.length && !sets.length)
      say(
        "Market watch: " +
          list.length +
          " item(s) at Ponty, nothing that beats what the Rangers wear and no compound set to complete"
      );
    if (!CFG.MARKET_BUY) {
      if (plan.length || sets.length)
        say("Market watch: report only (MARKET_BUY is false) - nothing bought");
      return go_home();
    }
    // 3. buy within the limits
    let spent = 0;
    const buy = async (it, rid, est, why) => {
      const g0 = character.gold;
      const n0 = bag_list(
        (x) => x.name === it.name && (x.level || 0) === (it.level || 0)
      ).length;
      await sock_ask("sbuy", { rid }, "sbuy", 3000);
      const ok = await call(() =>
        wait_for(
          () =>
            bag_list(
              (x) => x.name === it.name && (x.level || 0) === (it.level || 0)
            ).length > n0,
          4000
        )
      );
      if (ok.failed) {
        say(
          "Market watch: buying " +
            it.name +
            " +" +
            (it.level || 0) +
            " did not work (nothing arrived) - buying is switched off until restart",
          "#CF575F"
        );
        CFG.MARKET_BUY = false;
        return false;
      }
      const paid = g0 - character.gold;
      const raw = raw_value(it.name, it.level || 0);
      if (paid > 0 && raw >= 1000) S.market_factor = paid / raw;
      say(
        "Market watch: bought " +
          it.name +
          " +" +
          (it.level || 0) +
          " for " +
          paid +
          " gold (estimate " +
          est +
          ", game value " +
          Math.round(raw) +
          "; paid/value = " +
          (raw ? Math.round((paid / raw) * 100) / 100 : "?") +
          ") - " +
          why,
        "#58CF40"
      );
      spent += Math.max(0, paid);
      return true;
    };
    for (const pl of plan) {
      const price = pl.g.price;
      const why_not =
        price > CFG.MARKET_MAX_PRICE_EACH
          ? "dearer than MARKET_MAX_PRICE_EACH"
          : spent + price > CFG.MARKET_MAX_SPEND
          ? "over MARKET_MAX_SPEND"
          : character.gold - price < CFG.MARKET_GOLD_FLOOR
          ? "not enough gold in the bag above MARKET_GOLD_FLOOR (" +
            character.gold +
            ")"
          : "";
      if (why_not) {
        say(
          "Market watch: not buying " +
            pl.g.it.name +
            " +" +
            (pl.g.it.level || 0) +
            " for " +
            pl.who +
            ": " +
            why_not
        );
        continue;
      }
      if (!(await buy(pl.g.it, pl.rid, price, "for " + pl.who))) break;
    }
    if (CFG.MARKET_BUY && CFG.MARKET_COMPOUND_BUY) {
      for (const s of sets) {
        if ((s.it.level || 0) > CFG.MARKET_COMPOUND_MAX_LEVEL) {
          say(
            "Market watch: not buying " +
              s.it.name +
              " +" +
              (s.it.level || 0) +
              " for compounding: above MARKET_COMPOUND_MAX_LEVEL (+" +
              CFG.MARKET_COMPOUND_MAX_LEVEL +
              ")"
          );
          continue;
        }
        const want = Math.min(
          s.rids.length,
          CFG.MARKET_COMPOUND_MAX_COPIES,
          Math.max(0, 3 - s.held)
        );
        for (let i = 0; i < want; i++) {
          if (
            s.price > CFG.MARKET_COMPOUND_MAX_EACH ||
            spent + s.price > CFG.MARKET_MAX_SPEND ||
            character.gold - s.price < CFG.MARKET_GOLD_FLOOR
          )
            break;
          if (
            !(await buy(s.it, s.rids[i], s.price, "to complete a compound set"))
          )
            break;
        }
      }
    }
    // 4. v5: ingredients of a CRAFT_TARGETS item (Venom Band: Verdant Core, Poison Sacks, Snake Fangs, Ring of Dexterity +2) - what is missing for this run's crafts
    if (CFG.MARKET_BUY && CFG.MARKET_CRAFT_BUY) {
      for (const nd of craft_needs().filter((x) => x.target)) {
        const rec = G.craft && G.craft[nd.item];
        if (!rec) continue;
        for (const [q, name, lv0] of rec.items) {
          const lv = lv0 || 0;
          let missing = q * nd.n - mats_have(name, lv);
          for (const e of list) {
            if (missing <= 0) break;
            if (!e || e.name !== name || (e.level || 0) !== lv || e.l) continue;
            const units = e.q || 1;
            const price = Math.round(
              raw_value(name, lv) *
                (Number(S.market_factor) > 0
                  ? S.market_factor
                  : CFG.MARKET_MARKUP) *
                units
            );
            if (units > missing + CFG.MARKET_CRAFT_OVERBUY) continue; // a listing far bigger than the need: leave it
            if (
              price > CFG.MARKET_MAX_PRICE_EACH ||
              spent + price > CFG.MARKET_MAX_SPEND ||
              character.gold - price < CFG.MARKET_GOLD_FLOOR
            ) {
              say(
                "Market watch: not buying " +
                  units +
                  "x " +
                  name +
                  (lv ? " +" + lv : "") +
                  " for the " +
                  nd.item +
                  " (about " +
                  price +
                  "): over the price or spending limit"
              );
              continue;
            }
            const g0 = character.gold;
            const n0 = bag_qty(name, lv);
            await sock_ask("sbuy", { rid: e.rid }, "sbuy", 3000);
            const ok = await call(() =>
              wait_for(() => bag_qty(name, lv) > n0, 4000)
            );
            if (ok.failed) {
              say(
                "Market watch: buying " +
                  name +
                  " for the " +
                  nd.item +
                  " did not work (nothing arrived)",
                "#CF575F"
              );
              break;
            }
            const paid = g0 - character.gold;
            spent += Math.max(0, paid);
            missing -= units;
            e.l = true; // taken
            say(
              "Market watch: bought " +
                units +
                "x " +
                name +
                (lv ? " +" + lv : "") +
                " for " +
                paid +
                " gold (estimate " +
                price +
                ") - for the " +
                nd.item,
              "#58CF40"
            );
          }
        }
      }
    }
    return go_home();
  }