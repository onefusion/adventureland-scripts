  // ---- v5: bank sorting ----
  // The game has no direct "move inside the pack" call (the raw "swap"/"move" socket operations were refused live). Exchanging two bank slots a and b uses
  // the same calls merging uses: bank_retrieve(pack, slot) for each occupied slot, then bank_store(bag_slot, pack, other_slot) into the other slot.
  // Every step is checked; if one is not as expected, what is in the bag goes back into the bank and sorting switches itself off until the next restart.
  const BSORT = { off: false, last_msg: 0, bad: {}, fails: 0, next: 0 }; // bad: "pack:slot" -> true, slots the game would not move (left where they are from then on)
  const bank_key = (it) => {
    if (!it) return "\uffff";
    const def = G.items[it.name] || {};
    return (
      (def.s ? "0" : "1") +
      (def.type || "~") +
      "|" +
      it.name +
      "|" +
      String(99 - (it.level || 0)).padStart(2, "0") +
      "|" +
      (it.q || 1) +
      (it.l ? "L" : "")
    );
  };
  // pins: slot numbers that stay where they are (stackables the bag already holds - a retrieve would merge them into the bag stack - and slots the game refused to move)
  const bank_cap = () => CFG.BANK_PACK_SIZE - (CFG.BANK_SWAP_SLOT ? 1 : 0); // usable slots per pack
  const swap_slot = () => (CFG.BANK_SWAP_SLOT ? CFG.BANK_PACK_SIZE - 1 : -1);
  function bank_sort_plan(arr, pins) {
    const idx = [];
    for (let i = 0; i < bank_cap(); i++) if (!(pins && pins[i])) idx.push(i);
    const cur = idx.map((i) => arr[i] || null);
    const want = cur
      .slice()
      .sort((x, y) =>
        bank_key(x) < bank_key(y) ? -1 : bank_key(x) > bank_key(y) ? 1 : 0
      );
    const swaps = [];
    for (let pos = 0; pos < cur.length; pos++) {
      if (bank_key(cur[pos]) === bank_key(want[pos])) continue;
      let j = -1;
      for (let k = pos + 1; k < cur.length; k++)
        if (bank_key(cur[k]) === bank_key(want[pos])) {
          j = k;
          break;
        }
      if (j < 0) continue;
      swaps.push([idx[pos], idx[j]]);
      const t = cur[pos];
      cur[pos] = cur[j];
      cur[j] = t;
    }
    return swaps;
  }
  function bank_sort_pins(pack, arr) {
    const pins = {};
    arr.forEach((it, i) => {
      if (!it) return;
      const def = G.items[it.name] || {};
      if (BSORT.bad[pack + ":" + i] || it.l || (def.s && quantity(it.name) > 0))
        pins[i] = true;
    });
    return pins;
  }
  // Joins split stacks: the smaller stack is taken into the bag, then stored onto the bigger one (bank_store with the target slot). Checked every time:
  // if the game does not put it onto the stack, merging switches itself off. Items the Merchant uses himself, or already holds in his bag, are left alone.
  const BMERGE = { off: false };
  async function bank_merge_here() {
    if (
      !CFG.BANK_MERGE ||
      BMERGE.off ||
      character.map !== "bank" ||
      !character.bank
    )
      return;
    const by = {};
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank[pack];
      if (!Array.isArray(arr)) continue;
      arr.forEach((it, i) => {
        const def = it && G.items[it.name];
        if (
          !it ||
          it.l ||
          !def ||
          !def.s ||
          !(it.q >= 1) ||
          merge_protected(it.name)
        )
          return;
        if (quantity(it.name) > 0) {
          // a retrieve would merge into the bag stack: left alone, but say so (at most every 30 min per item)
          if (!BMERGE.said) BMERGE.said = {};
          if (now() - (BMERGE.said[it.name] || 0) > 30 * 60000) {
            BMERGE.said[it.name] = now();
            say(
              "Bank merge: " +
                it.name +
                " stacks are not joined while the bag holds " +
                quantity(it.name) +
                " of it",
              "#E1A951"
            );
          }
          return;
        }
        (by[it.name] = by[it.name] || []).push({ pack, i, q: it.q });
      });
    }
    let joined = 0;
    const names = [];
    for (const name of Object.keys(by)) {
      const stacks = by[name].sort((x, y) => y.q - x.q);
      if (stacks.length < 2) continue;
      const cap = typeof G.items[name].s === "number" ? G.items[name].s : 9999;
      for (let si = stacks.length - 1; si >= 1; si--) {
        // v5: the smallest stack joins the BIGGEST stack that it still fits onto (first fit); a stack that would push every other one past the stack size stays split (no partial joins)
        const s = stacks[si];
        if (s.gone) continue;
        const target = stacks.find(
          (t, ti) => ti < si && !t.gone && t.q + s.q <= cap
        );
        if (!target) continue;
        if (
          joined >= CFG.BANK_MERGE_MAX ||
          has_jobs() ||
          !alive() ||
          free_slots() < 1
        )
          return finish();
        const before = quantity(name);
        const got = await call(() => bank_retrieve(s.pack, s.i));
        const ok1 = got.failed
          ? got
          : await call(() =>
              wait_for(() => quantity(name) >= before + s.q, 3000)
            );
        if (ok1.failed) {
          BMERGE.off = true;
          say(
            "Bank merge: could not take " +
              name +
              " out of " +
              s.pack +
              " - merging is switched off until the next restart",
            "#CF575F"
          );
          return finish();
        }
        const bag_i = locate_item(name);
        const sum_before = target.q;
        await call(() => bank_store(bag_i, target.pack)); // v5: pack only (a slot-addressed store onto an occupied slot timed out live)
        const ok2 = await call(() =>
          wait_for(() => quantity(name) === 0, 3000)
        );
        const now_q = (character.bank[target.pack][target.i] || {}).q || 0;
        if (ok2.failed || now_q !== sum_before + s.q) {
          BMERGE.off = true;
          say(
            "Bank merge: " +
              name +
              " was not added onto the stack in " +
              target.pack +
              " slot " +
              target.i +
              " - merging is switched off until the next restart (check the bank)",
            "#CF575F"
          );
          return finish();
        }
        target.q = now_q;
        s.gone = true;
        joined++;
        if (names.indexOf(name) === -1) names.push(name);
        await wait(CFG.BANK_SORT_STEP_MS);
      }
    }
    return finish();
    function finish() {
      if (joined)
        say(
          "Bank merge: " +
            joined +
            " split stack(s) joined (" +
            names.join(", ") +
            ")",
          "#8AB4D0"
        );
    }
  }
  // ---- v5 bank layout: which pack an item belongs in ----
  const BLAY = { off: false, fails: 0, last: "", sets: null };
  function layout_sets() {
    if (BLAY.sets) return BLAY.sets;
    const exch = {};
    const craft = {};
    for (const e of CFG.EXCHANGE_PLAN) exch[e.item] = true;
    const rec = G.craft || {};
    if (rec.xbox) for (const row of rec.xbox.items || []) exch[row[1]] = true; // the Quantum Pieces
    for (const t of CFG.CRAFT_TARGETS.map((x) => x.item))
      if (rec[t]) for (const row of rec[t].items || []) craft[row[1]] = true;
    return (BLAY.sets = { exch, craft });
  }
  function bank_class(it) {
    const def = G.items[it.name];
    const sets = layout_sets();
    if (sets.exch[it.name] || (def && def.e)) return "exchange";
    if (!def) return "excess";
    if (def.compound) return "compound";
    if (def.upgrade) return "upgrade";
    if (def.s || sets.craft[it.name]) return "stack";
    return "excess";
  }
  const bank_pack_exists = (pack) =>
    !!(character.bank && Array.isArray(character.bank[pack]));
  function bank_free_slot(pack, taken) {
    const arr = character.bank[pack];
    for (let i = 0; i < bank_cap(); i++)
      if (!arr[i] && !(taken && taken[pack + ":" + i])) return i;
    return -1;
  }
  // where a deposit goes: the item's own pack(s), then the fallback order (last pack first). null = let the game choose.
  function bank_spot(it, taken) {
    if (!CFG.BANK_LAYOUT || BLAY.off || !character.bank) return null;
    const order = [];
    for (const p of (CFG.BANK_LAYOUT_PACKS[bank_class(it)] || []).concat(
      CFG.BANK_FALLBACK_ORDER,
      CFG.COMPOUND_PACKS
    ))
      if (bank_pack_exists(p) && order.indexOf(p) === -1) order.push(p);
    // v5: a stackable is stored ONTO the fullest stack of the same kind that still has room for it (not as a new single stack); only if none has room does it take an empty slot
    const def = G.items[it.name];
    if (def && def.s && !it.l && !merge_protected(it.name)) {
      const cap = typeof def.s === "number" ? def.s : 9999;
      let best = null;
      for (const pack of order)
        character.bank[pack].forEach((x, i) => {
          if (!x || x.l || x.name !== it.name || !(x.q >= 1)) return;
          const have = x.q + ((taken && taken[pack + ":" + i + ":q"]) || 0);
          if (have + (it.q || 1) <= cap && (!best || have > best.have))
            best = { pack, slot: i, have, onto: true };
        });
      if (best) return best;
    }
    for (const pack of order) {
      const slot = bank_free_slot(pack, taken);
      if (slot >= 0) return { pack, slot };
    }
    return null;
  }
  function layout_failed(what) {
    BLAY.fails++;
    if (BLAY.fails >= CFG.BANK_LAYOUT_MAX_FAILS) BLAY.off = true;
    say(
      "Bank layout: " +
        what +
        (BLAY.off
          ? " - " +
            BLAY.fails +
            " failures: the bank layout is switched off until the next restart"
          : ""),
      "#E1A951"
    );
  }
  // Moves ONE bank item through the bag: bank_retrieve, then bank_store into a named slot. Every step is checked.
  // Returns { ok:true } or { fail: "text", stale: bool, bi: bag slot of an item left in the bag or undefined }.
  async function bank_move_one(from_pack, from, to_pack, to) {
    const it = character.bank[from_pack][from];
    if (!it) return { ok: true };
    const key = bank_key(it);
    const had = {};
    for (let i = 0; i < character.isize; i++)
      if (character.items[i]) had[i] = true;
    const got = await call(() => bank_retrieve(from_pack, from));
    const ok = got.failed
      ? got
      : await call(() =>
          wait_for(
            () =>
              !character.bank[from_pack][from] &&
              Object.keys(character.items).some(
                (i) => character.items[i] && !had[i]
              ),
            3000
          )
        );
    if (ok.failed) {
      const now_bag = [];
      for (let i = 0; i < character.isize; i++)
        if (character.items[i] && !had[i])
          now_bag.push(i + ":" + character.items[i].name);
      const stale = !!(
        got.failed && /no_item/i.test(String(got.reason || JSON.stringify(got)))
      );
      return {
        fail:
          "taking it out of " +
          from_pack +
          " slot " +
          from +
          " [" +
          (got.failed
            ? "bank_retrieve refused: " + (got.reason || JSON.stringify(got))
            : "bank_retrieve was accepted but within 3s the bank slot still shows " +
              JSON.stringify(character.bank[from_pack][from] || null) +
              " and the new bag items are [" +
              now_bag.join(",") +
              "]") +
          "]",
        stale,
      };
    }
    let bi = -1;
    for (let i = 0; i < character.isize; i++)
      if (character.items[i] && !had[i]) bi = i;
    await wait(CFG.BANK_SORT_STEP_MS);
    await call(() => bank_store(bi, to_pack, to));
    const ok2 = await call(() =>
      wait_for(
        () =>
          !character.items[bi] && bank_key(character.bank[to_pack][to]) === key,
        3000
      )
    );
    if (ok2.failed)
      return {
        fail:
          "storing it into " +
          to_pack +
          " slot " +
          to +
          " (bag slot " +
          bi +
          ")",
        bi,
      };
    await wait(CFG.BANK_SORT_STEP_MS);
    return { ok: true };
  }
  // Exchanges two slots of one pack. With one slot empty it is a single move; with both occupied the transit slot (the last slot, or any other empty one) holds the first item, so the bag
  // never holds more than ONE item at a time.
  async function bank_swap(pack, a, b) {
    const arr = character.bank[pack];
    if (!arr[a] && !arr[b]) return { ok: true };
    if (!arr[a] || !arr[b])
      return await bank_move_one(pack, arr[a] ? a : b, pack, arr[a] ? b : a);
    let buf = swap_slot();
    if (buf < 0 || arr[buf] || buf === a || buf === b) {
      buf = -1;
      for (let i = bank_cap() - 1; i >= 0; i--)
        if (!arr[i] && i !== a && i !== b) {
          buf = i;
          break;
        }
    }
    if (buf < 0)
      return { fail: "there is no empty slot in " + pack + " to swap through" };
    let r = await bank_move_one(pack, a, pack, buf);
    if (!r.ok) return r;
    r = await bank_move_one(pack, b, pack, a);
    if (!r.ok) {
      if (r.bi !== undefined && character.items[r.bi])
        await call(() => bank_store(r.bi));
      await bank_move_one(pack, buf, pack, a); // best effort: the first item goes back to where it was
      return r;
    }
    return await bank_move_one(pack, buf, pack, b);
  }
  // Moves the items that sit in the wrong pack into their own pack (only into packs that have room). The target pack is NOT sorted here: its own sort run does that.
  async function bank_route_here() {
    if (
      !CFG.BANK_LAYOUT ||
      !CFG.BANK_ROUTE ||
      BLAY.off ||
      character.map !== "bank" ||
      !character.bank
    )
      return;
    const todo = [];
    const taken = {};
    const stuck = {};
    for (const pack of CFG.COMPOUND_PACKS) {
      const arr = character.bank[pack];
      if (!Array.isArray(arr)) continue;
      const pins = bank_sort_pins(pack, arr);
      for (let i = 0; i < CFG.BANK_PACK_SIZE; i++) {
        const it = arr[i];
        if (!it || pins[i] || it.l) continue;
        const cls = bank_class(it);
        const home = (CFG.BANK_LAYOUT_PACKS[cls] || []).filter(
          bank_pack_exists
        );
        if (!home.length || home.indexOf(pack) !== -1) continue;
        let dst = null;
        for (const p of home) {
          const slot = bank_free_slot(p, taken);
          if (slot >= 0) {
            dst = { pack: p, slot };
            break;
          }
        }
        if (!dst) {
          stuck[cls] = (stuck[cls] || 0) + 1;
          continue;
        }
        taken[dst.pack + ":" + dst.slot] = true;
        todo.push({ from: pack, i, cls, dst, name: it.name });
      }
    }
    let moved = 0;
    const by = {};
    for (const m of todo) {
      if (moved >= CFG.BANK_ROUTE_MAX_MOVES || has_jobs() || !alive()) break;
      if (free_slots() < 1) {
        say(
          "Bank layout: needs 1 empty bag slot to move items with - next visit",
          "#E1A951"
        );
        break;
      }
      const cur = character.bank[m.from][m.i];
      if (!cur || cur.name !== m.name) continue; // changed meanwhile
      const r = await bank_move_one(m.from, m.i, m.dst.pack, m.dst.slot);
      if (!r.ok) {
        if (r.bi !== undefined && character.items[r.bi])
          await call(() => bank_store(r.bi));
        await wait(1000);
        if (r.stale) {
          BSORT.bad[m.from + ":" + m.i] = true;
          say(
            "Bank layout: " +
              r.fail +
              " - the game's bank differs from my copy (out of date); stopping for this visit",
            "#E1A951"
          );
        } else
          layout_failed(
            "could not move " +
              m.name +
              " from " +
              m.from +
              " to " +
              m.dst.pack +
              " (" +
              r.fail +
              ")"
          );
        break;
      }
      moved++;
      by[m.cls] = (by[m.cls] || 0) + 1;
    }
    const left = todo.length - moved;
    const text =
      (moved
        ? moved +
          " item(s) moved to their pack (" +
          Object.keys(by)
            .map((k) => k + " " + by[k])
            .join(", ") +
          ")"
        : "") +
      (left > 0 && moved >= CFG.BANK_ROUTE_MAX_MOVES
        ? ", " + left + " more next visit"
        : "") +
      (Object.keys(stuck).length
        ? "; no room in the pack(s) of: " +
          Object.keys(stuck)
            .map((k) => k + " " + stuck[k])
            .join(", ")
        : "");
    if (text && text !== BLAY.last)
      say("Bank layout: " + text.replace(/^, /, ""), "#8AB4D0");
    if (text) BLAY.last = text;
  }
  async function bank_sort_here() {
    await bank_merge_here();
    await bank_route_here();
    if (
      !CFG.BANK_SORT ||
      BSORT.off ||
      character.map !== "bank" ||
      !character.bank ||
      !parent.socket
    )
      return;
    const packs = CFG.COMPOUND_PACKS.filter((p) =>
      Array.isArray(character.bank[p])
    );
    if (!packs.length) return;
    // every pack has its own swap budget; the visit starts at BSORT.next (a pack that was cut short or failed last time makes the next visit start at the following pack) so later packs get their turn too
    const start = BSORT.next % packs.length;
    const order = packs.slice(start).concat(packs.slice(0, start));
    let done = 0;
    let left = 0;
    let next = 0;
    let stop = false;
    for (const pack of order) {
      if (stop) break;
      const pi = packs.indexOf(pack);
      const arr = character.bank[pack];
      const buf = swap_slot();
      if (buf >= 0 && arr[buf]) {
        // the transit slot must be empty: move whatever sits there into a free slot of the pack
        const free = bank_free_slot(pack);
        if (free < 0) {
          say(
            "Bank sort: " +
              pack +
              " has no free slot to move the item in its last slot out of - the pack is skipped (make some room)",
            "#E1A951"
          );
          continue;
        }
        if (has_jobs() || !alive()) {
          stop = true;
          next = pi;
          break;
        }
        const r0 = await bank_move_one(pack, buf, pack, free);
        if (!r0.ok) {
          if (r0.bi !== undefined && character.items[r0.bi])
            await call(() => bank_store(r0.bi));
          layout_failed(
            "could not empty the last slot of " + pack + " (" + r0.fail + ")"
          );
          continue;
        }
      }
      const swaps = bank_sort_plan(arr, bank_sort_pins(pack, arr));
      let done_p = 0;
      for (let n = 0; n < swaps.length; n++) {
        if (has_jobs() || !alive()) {
          left += swaps.length - n;
          stop = true;
          next = pi;
          break;
        }
        if (done_p >= CFG.BANK_SORT_MAX_SWAPS) {
          left += swaps.length - n;
          break;
        }
        if (free_slots() < 1) {
          say(
            "Bank sort: needs 1 empty bag slot to sort with - next visit",
            "#E1A951"
          );
          stop = true;
          next = (pi + 1) % packs.length;
          break;
        }
        const [a, b] = swaps[n];
        const r = await bank_swap(pack, a, b);
        if (r.ok) {
          done++;
          done_p++;
          continue;
        }
        const fail = r.fail;
        if (r.bi !== undefined && character.items[r.bi])
          await call(() => bank_store(r.bi)); // whatever is still in the bag goes back into the bank (any free slot)
        await wait(1000);
        if (r.stale) {
          // "no_item": the game says that slot is empty while my copy of the bank said it was not - my copy was out of date (not a refused call). Stop for this visit; the next visit starts from the fresh bank.
          // v5: those two slots are left alone from now on (without counting as a failure), so a slot whose copy keeps being wrong cannot stop every visit at the same place
          BSORT.bad[pack + ":" + a] = true;
          BSORT.bad[pack + ":" + b] = true;
          say(
            "Bank sort: " +
              fail +
              " - the game's bank differs from my copy (out of date); stopping for this visit (slots " +
              a +
              " and " +
              b +
              " of " +
              pack +
              " are skipped from now on), the next one plans again from the fresh bank",
            "#E1A951"
          );
          stop = true;
          next = (pi + 1) % packs.length;
          break;
        }
        BSORT.bad[pack + ":" + a] = true; // these two slots stay where they are from now on; the rest of the bank is still sorted
        BSORT.bad[pack + ":" + b] = true;
        BSORT.fails++;
        if (BSORT.fails >= CFG.BANK_SORT_MAX_FAILS) BSORT.off = true;
        say(
          "Bank sort: the game did not do the move " +
            a +
            " <-> " +
            b +
            " in " +
            pack +
            " (failed " +
            fail +
            ") - those two slots are left alone" +
            (BSORT.off
              ? "; " +
                BSORT.fails +
                " failures: bank sorting is switched off until the next restart"
              : ", the rest of the bank is still sorted") +
            ". If an item is in your bag that should be in the bank, it is a leftover of this",
          "#CF575F"
        );
        next = (pi + 1) % packs.length; // this pack's plan is out of date now; the next visit plans it again, starting at the following pack
        break;
      }
    }
    BSORT.next = next;
    if (done || left)
      say(
        "Bank sort: " +
          done +
          " move(s) made" +
          (left ? ", " + left + " more next visit" : ", the bank is in order"),
        "#8AB4D0"
      );
  }
  const go_home = async () => {
    if (has_jobs()) return {};
    try {
      await bank_sort_here();
    } catch (e) {
      say("Bank sort failed: " + ((e && e.message) || e), "#CF575F");
    }
    S.idle_walk = true;
    try {
      return await travel(CFG.STAND_SPOT, 0, "back to the stand");
    } finally {
      S.idle_walk = false;
    }
  };
