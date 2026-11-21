  // ===== manual compound test (top buttons). One triple, run from the main loop so it never collides with a job. =====
  async function manual_compound_test(real) {
    const tag = real ? "Compound test" : "Compound odds check";
    await drain_stand("a compound test");
    if (!(await open_bank_for_compound())) return go_home();
    // the cheapest triple: lowest scroll grade, then lowest level, from the bag and the bank
    const pool = {};
    const add = (it, where) => {
      if (!comp_ok(it)) return;
      const k = comp_key(it);
      const e = (pool[k] = pool[k] || { it, bag: [], bank: [] });
      if (where.pack) e.bank.push(where);
      else e.bag.push(where.i);
    };
    for (let i = 0; i < character.isize; i++) add(character.items[i], { i });
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank && character.bank[pack];
      if (Array.isArray(arr)) arr.forEach((it, i) => add(it, { pack, i }));
    }
    let best = null;
    for (const k in pool) {
      const e = pool[k];
      if (e.bag.length + e.bank.length < 3) continue;
      const grade = scroll_grade(e.it);
      if (grade > max_grade_of(e.it.name)) continue;
      const rank = grade * 100 + (e.it.level || 0);
      if (!best || rank < best.rank)
        best = Object.assign(e, { k, rank, grade });
    }
    if (!best) {
      say(
        tag + ": no three identical compoundable items in the bag or bank",
        "#CF575F"
      );
      return go_home();
    }
    const item = best.it;
    for (const b of best.bank.sort((x, y) =>
      x.pack < y.pack ? -1 : x.pack > y.pack ? 1 : y.i - x.i
    )) {
      if (bag_list((x) => comp_ok(x) && comp_key(x) === best.k).length >= 3)
        break;
      const before = bag_list(
        (x) => comp_ok(x) && comp_key(x) === best.k
      ).length;
      const res = await call(() => bank_retrieve(b.pack, b.i));
      await call(() =>
        wait_for(
          () =>
            bag_list((x) => comp_ok(x) && comp_key(x) === best.k).length >
            before,
          4000
        )
      );
      if (res.failed) {
        say(
          tag +
            ": could not take " +
            comp_label(item) +
            " out of the bank: " +
            res.reason,
          "#CF575F"
        );
        break;
      }
    }
    const triple = () => bag_list((x) => comp_ok(x) && comp_key(x) === best.k);
    if (triple().length < 3) {
      say(tag + ": could not gather three " + comp_label(item), "#CF575F");
      if (await open_bank_for_compound())
        await put_back_in_bank((x) => comp_ok(x) && x.name === item.name);
      return go_home();
    }
    // the matching compound scroll: bag, else buy one
    const sname = scroll_for(item);
    if (quantity(sname) < 1) {
      const price = unit_cost(sname);
      if (character.gold < price) {
        const bg = Number(character.bank && character.bank.gold);
        if (!(bg - price >= CFG.COMPOUND_BANK_FLOOR)) {
          say(
            tag + ": not enough gold for a " + sname + " (" + price + ")",
            "#CF575F"
          );
          if (await open_bank_for_compound())
            await put_back_in_bank((x) => comp_ok(x) && x.name === item.name);
          return go_home();
        }
        const before = character.gold;
        await call(() => bank_withdraw(price));
        await call(() =>
          wait_for(() => character.gold >= before + price - 1, 5000)
        );
      }
      const sn = find_npc(CFG.COMPOUND_SCROLL_NPC);
      if (sn)
        await travel({ map: sn.map, x: sn.x, y: sn.y }, 0, "buying " + sname);
      const had = quantity(sname);
      const res = await call(() => buy_with_gold(sname, 1));
      const got = await call(() => wait_for(() => quantity(sname) > had, 6000));
      if (res.failed || got.failed)
        say(
          tag + ": buying " + sname + " failed: " + (res.reason || got.reason),
          "#CF575F"
        );
    }
    const up = find_npc(CFG.COMPOUND_UPGRADE_NPC);
    if (up)
      await travel(
        { map: up.map, x: up.x, y: up.y },
        0,
        "compound test next to the upgrade NPC"
      );
    const [a, b, c] = triple();
    const si = locate_item(sname);
    const oname = CFG.OFFERING_ITEMS.find((n) => quantity(n) > 0);
    const pct = (o) =>
      o.failed || !(Number(o.chance) >= 0)
        ? "no quote (" + JSON.stringify(o.reason || o) + ")"
        : Math.round(o.chance * 1000) / 10 +
          "% (grace " +
          (o.grace === undefined ? "?" : o.grace) +
          ")";
    if (a !== undefined && si >= 0) {
      const q0 = await call(() => compound(a, b, c, si, null, true));
      say(
        tag +
          ": " +
          comp_label(item) +
          " x3 with " +
          sname +
          ", no offering: " +
          pct(q0) +
          " | luck x" +
          character.luckm,
        "#51D2E1"
      );
      let oi = -1;
      if (oname) {
        oi = locate_item(oname);
        const q1 = await call(() => compound(a, b, c, si, oi, true));
        say(tag + ": same compound with " + oname + ": " + pct(q1), "#51D2E1");
      }
      if (real) {
        const use = !!oname && CFG.TEST_USE_OFFERING;
        const lvl_up = (x) =>
          x.name === item.name &&
          (x.level || 0) === (item.level || 0) + 1 &&
          (x.p || "") === (item.p || "");
        const made = bag_list(lvl_up).length;
        say(
          tag +
            ": compounding " +
            comp_label(item) +
            " x3 now" +
            (use ? " WITH " + oname : " without an offering"),
          "#E1A951"
        );
        const res = await call(() =>
          use ? compound(a, b, c, si, oi) : compound(a, b, c, si, null)
        );
        await call(() =>
          wait_for(
            () => bag_list(lvl_up).length > made || triple().length < 3,
            6000
          )
        );
        await wait(300);
        const win = bag_list(lvl_up).length > made;
        say(
          tag +
            ": " +
            (win
              ? "SUCCESS"
              : res.failed
              ? "FAILED (" + (res.reason || "?") + ")"
              : "the items were lost") +
            " - " +
            comp_label(item) +
            " x3",
          win ? "#5BCB5B" : "#CF575F"
        );
      }
    } else say(tag + ": the items or the scroll are not in the bag", "#CF575F");
    if (await open_bank_for_compound()) {
      const n = await put_back_in_bank(
        (x) => !x.l && !(x.q > 1) && x.name === item.name
      );
      if (n) say(tag + ": put " + n + " item(s) back in the bank");
    }
    return go_home();
  }
  function add_test_buttons() {
    try {
      if (typeof add_top_button !== "function") return;
      add_top_button(
        "al_bank_excess",
        "Bank excess",
        () => alive() && (S.bank_excess = true)
      );
      add_top_button(
        "al_hold_release",
        "Release",
        () => alive() && (S.hold = null)
      );
      add_top_button(
        "al_sell_round",
        "Sell round",
        () => alive() && (S.sell_now = true)
      );
    } catch (e) {}
  }
