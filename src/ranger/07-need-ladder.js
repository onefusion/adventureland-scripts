  // ============================ NEED LADDER =======================
  // A "need" = low potions or a full bag. Ladder (see agent/merchant-ranger-coordination-spec.md):
  //   1 pause the hunt (the hunt record stays; it resumes afterwards) and retreat to the NEAREST TOWN on this map
  //   2 send the job request(s) - the 60s clock starts when the request is SENT
  //   3 wait up to 60s: reply with ETA <= 60s -> wait through the whole delivery; ETA > 60s or no reply -> step 4
  //   4 fallback 1: send travel_to_main, go to the main map, ask again there (same 60s rule)
  //   5 fallback 2: sell junk at Gabriel (BEFORE banking) -> withdraw only the restock gold, buy potions at Ernis -> bank keepers/stackables
  //   6 fallback 3: bank full -> stand at the main-town safe spot, re-ask every ~30s until the Merchant is available
  //   7 need met -> resume the hunt
  const P = AL.proto;
  const M = CFG.MERCHANT_NAME;

  const courier_on = () => CFG.COURIER_ENABLED && CFG.PARTY_MEMBERS.length > 0;
  const in_trip = () => !!R.courier && R.courier.phase === "trip";
  const potion_target = () => (R.boss ? Math.max(CFG.BOSS_POTION_TARGET, CFG.POTION_TARGET) : CFG.POTION_TARGET);
  const potion_goal = (name) =>
    in_trip()
      ? name === CFG.HP_POTION
        ? R.courier.goal.hp
        : R.courier.goal.mp
      : potion_target();
  function potion_need() {
    const hp = quantity(CFG.HP_POTION);
    const mp = quantity(CFG.MP_POTION);
    if (in_trip())
      return hp < R.courier.goal.hp || mp < R.courier.goal.mp
        ? { hp, mp }
        : null;
    const at = courier_on() ? CFG.EMERGENCY_POTIONS : CFG.POTION_REQUEST_AT;
    return hp <= at || mp <= at ? { hp, mp } : null;
  }
  // number of items waiting to be handed over / sold / banked, when the bag is nearly full (else 0)
  function bag_need() {
    if (in_trip()) return handoff_slots().length; // the courier takes everything he carries to the Merchant
    // party mode: the courier handles bags; a Ranger only runs his own ladder when he is almost out of room
    if (
      !CFG.CLEAN_ENABLED ||
      free_slots() > (courier_on() ? 1 : CFG.CLEAN_WHEN_FREE_SLOTS)
    )
      return 0;
    const waiting = handoff_slots().length;
    return waiting >= CFG.SELL_MIN_JUNK ? waiting : 0;
  }
  const have_need = () => !!potion_need() || bag_need() > 0;

  // keeps him alive and tidy while the ladder waits; true = he died (the ladder is abandoned, the need stays)
  async function ladder_tick() {
    if (await survive()) return true;
    call(() => loot());
    return false;
  }

  // The town skill: teleports to the map's spawn (its "nearest town"). No path search, so it also works from a bad spot.
  // monsters that could hit him during the town cast: targeting him, or within their range + a margin
  function threats() {
    const out = [];
    for (const id in parent.entities) {
      const e = parent.entities[id];
      if (!e || e.type !== "monster" || !e.visible || e.dead) continue;
      const def = (G.monsters && G.monsters[e.mtype]) || {};
      const reach =
        (Number(e.range) || Number(def.range) || 40) + CFG.DISENGAGE_MARGIN_PX;
      if (
        e.target === character.name ||
        e.target === character.id ||
        d2(character, e) < reach
      )
        out.push(e);
    }
    return out;
  }
  // run away from whatever is attacking him; town() is a cast and a hit (or moving) cancels it
  async function disengage() {
    const t0 = now();
    let steps = 0;
    while (now() - t0 < CFG.DISENGAGE_MAX_MS) {
      const th = threats();
      if (!th.length) break;
      let cx = 0,
        cy = 0;
      for (const e of th) {
        cx += e.x;
        cy += e.y;
      }
      cx /= th.length;
      cy /= th.length;
      const base = Math.atan2(character.y - cy, character.x - cx);
      let went = false;
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const a = base + off;
        const tx = character.x + Math.cos(a) * CFG.DISENGAGE_STEP_PX;
        const ty = character.y + Math.sin(a) * CFG.DISENGAGE_STEP_PX;
        if (typeof can_move_to === "function" && !can_move_to(tx, ty)) continue;
        const r = await call(() => xmove(tx, ty));
        if (!r.failed) {
          went = true;
          steps++;
          break;
        }
      }
      if (!went) break;
      await ladder_tick();
    }
    try {
      stop();
    } catch (e) {}
    const left = threats().length;
    if (steps)
      say(
        "Moved away from " +
          (left ? "the monsters (still " + left + " close)" : "the monsters") +
          " before using town",
        "#E1A951"
      );
    return !left;
  }
  async function use_town() {
    const from = { map: character.map, x: character.x, y: character.y };
    for (let i = 0; i < 3; i++) {
      await disengage();
      say(
        "Retreating to the nearest town (town skill, try " + (i + 1) + "/3)",
        "#E1A951"
      );
      const res = await call(() => town());
      if (res.failed) say("town() was refused: " + res.reason, "#CF575F");
      const moved = await call(() =>
        wait_for(
          () => character.map !== from.map || d2(character, from) > 150,
          12000
        )
      );
      if (!moved.failed) {
        await wait(800);
        return true;
      }
      say(
        "town() did not move me within 12s (hit while casting? on cooldown?)",
        "#CF575F"
      );
      if (await ladder_tick()) return false;
    }
    return false;
  }
  const here = () => ({
    map: character.map,
    x: Math.round(character.x),
    y: Math.round(character.y),
  });

  // step 1: nearest town on the current map. On main that is the safe spot next to the Merchant's stand.
  // Returns false when he could not get away (then the ladder is abandoned and he goes back to hunting).
  async function retreat_to_town(L) {
    if (character.map === CFG.SAFE_SPOT.map) {
      if (d2(character, CFG.SAFE_SPOT) > CFG.RETREAT_NEAR_PX) {
        if (!(await use_town())) return false; // away from the fight first
      }
      if (d2(character, CFG.SAFE_SPOT) > 60) {
        const r = await travel(
          CFG.SAFE_SPOT,
          90000,
          "waiting for the Merchant at the safe spot"
        );
        if (r.failed)
          say("Could not walk to the safe spot: " + r.reason, "#CF575F");
        if (d2(character, CFG.SAFE_SPOT) > CFG.RETREAT_NEAR_PX * 2)
          return false; // still out in the field
      }
    } else if (!(await use_town())) return false; // another map: its spawn is its town
    L.meet = here();
    return true;
  }

  function make_job(jtype, extra, meet) {
    const j = {
      id: AL.job_id(jtype[0]),
      jtype,
      created_at: now(),
      sent_at: 0,
      reached: true,
      status: null,
      eta: null,
      last_seen: now(),
      ready: false,
      cap: 0,
      handed: false,
      settled: false,
      done: false,
      failed: "",
      cancel_acked: false,
      terminal: false,
      committed: false,
      payload: null,
    };
    j.payload = Object.assign(
      {
        type: "job_request",
        id: j.id,
        jtype,
        map: meet.map,
        x: meet.x,
        y: meet.y,
      },
      extra
    );
    return j;
  }
  async function send_job(j) {
    j.sent_at = now(); // the 60s clock starts when the request is SENT
    j.last_seen = now();
    const r = await AL.send(M, j.payload);
    j.reached = r.delivered;
    return r;
  }
  function build_jobs(L) {
    const jobs = [];
    const pn = potion_need();
    if (pn) {
      const trip = in_trip();
      jobs.push(
        make_job(
          "restock",
          Object.assign(
            trip
              ? {
                  hp: R.courier.buy.hp,
                  mp: R.courier.buy.mp,
                  courier: Object.keys(R.courier.members).filter(
                    (n) => n !== character.name
                  ),
                }
              : {
                  hp: Math.max(0, potion_target() - pn.hp),
                  mp: Math.max(0, potion_target() - pn.mp),
                }
          ),
          L.meet
        )
      );
    }
    const bn = bag_need();
    if (bn) {
      const names = [
        ...new Set(handoff_slots().map((i) => character.items[i].name)),
      ];
      jobs.push(
        make_job(
          junk_slots().length ? "junk" : "stack",
          { count: bn, names },
          L.meet
        )
      );
    }
    return jobs;
  }

  // Cancel what is still open and wait briefly for the cancel_ack (the Merchant turns back if he is already walking over).
  async function cancel_jobs(L) {
    if (!L || !alive()) return;
    const open = L.jobs.filter((j) => !j.terminal);
    if (!open.length) return;
    let reached = false;
    for (const j of open) {
      const r = await AL.send(M, { type: "job_cancel", id: j.id });
      reached = reached || r.delivered;
    }
    const t0 = now();
    let resent = false;
    while (
      reached &&
      now() - t0 < 4000 &&
      open.some((j) => !j.cancel_acked && !j.done && !j.failed)
    ) {
      await wait(250);
      if (!resent && now() - t0 > 2000) {
        resent = true;
        for (const j of open)
          if (!j.cancel_acked) AL.send(M, { type: "job_cancel", id: j.id });
      }
    }
    for (const j of open) if (!j.done) j.terminal = true;
  }

  // Boss event start: empty the bag of everything the Merchant takes (junk, keepers, stackables) while he stands close by
  async function boss_dump_step() {
    if (!CFG.BOSS_DUMP_ENABLED) return;
    const ev = R.boss
      ? R.boss
      : is_follower() && R.leader && CFG.BOSS_EVENTS.some((b) => b.type === R.leader.goal)
      ? R.leader
      : null;
    if (!ev) {
      R.dump_key = null;
      R.dump_first = 0;
      return;
    }
    const key = R.boss ? "b" + R.boss.started : "f" + R.leader.goal + ":" + (R.dump_first || (R.dump_first = now()));
    if (R.dump_key !== key) {
      R.dump_key = key;
      R.dump_start = now();
      R.dump_next = 0;
      R.dump_done = false;
    }
    if (now() < R.dump_next) return;
    // Sean 2026-11-19: the first BOSS_DUMP_WINDOW_MS (3 min) look every BOSS_DUMP_RETRY_MS (20 s); up to 30 min every 5 min; after that every 10 min - until the event is over (new drops are handed over too)
    const el = now() - R.dump_start;
    R.dump_next = now() + (el < CFG.BOSS_DUMP_WINDOW_MS ? CFG.BOSS_DUMP_RETRY_MS : el < CFG.BOSS_DUMP_SLOW_AFTER_MS ? CFG.BOSS_DUMP_SLOW_MS : CFG.BOSS_DUMP_SLOWER_MS);
    const slots = handoff_slots();
    if (!slots.length) return;
    const m = get_player(M);
    if (!m || d2(character, m) > CFG.BOSS_DUMP_RANGE) return;
    const stack_n = [];
    for (const i of stack_slots()) { const x = character.items[i]; if (x && stack_n.indexOf(x.name) === -1) stack_n.push(x.name); }
    if (stack_n.length) await AL.send(M, { type: "boss_handoff", names: stack_n }); // tells him these are stackables to bank, not to sell
    let n = 0;
    for (const i of slots) {
      const it = character.items[i];
      if (!it) continue;
      const name = it.name;
      const res = await call_paced("transfer", () => send_item(M, i, it.q || 1));
      const gone = await call(() =>
        wait_for(() => !character.items[i] || character.items[i].name !== name, 3000)
      );
      if (res.failed || gone.failed) {
        say("Boss hand-over: send_item failed for " + name + ": " + (res.reason || gone.reason || "slot unchanged"), "#CF575F");
        break;
      }
      n++;
      await wait(150);
    }
    if (n) {
      say("Boss hand-over: gave " + n + " item(s) to " + M + " so he can sell them; " + free_slots() + " slots free for the drops", "#E0A040");
    }
  }

  // The Merchant says he is next to us: hand over junk / keepers / stackables (the cap is what his bag can take)
  async function do_handoff(j) {
    j.handed = true;
    const t0 = now();
    for (;;) {
      const m = get_player(M);
      if (m && d2(character, m) <= CFG.JUNK_SEND_RANGE) break;
      if (now() - t0 > 10000) {
        say(
          "Merchant said he is here but I do not see him close by - not handing anything over",
          "#CF575F"
        );
        await AL.send(M, { type: "job_sent", id: j.id, count: 0 });
        return;
      }
      await wait(250);
    }
    let n = 0;
    for (const i of handoff_slots()) {
      if (j.cap && n >= j.cap) break;
      const it = character.items[i];
      if (!it) continue;
      const name = it.name;
      const res = await call_paced("transfer", () => send_item(M, i, it.q || 1));
      const gone = await call(() =>
        wait_for(
          () => !character.items[i] || character.items[i].name !== name,
          3000
        )
      );
      if (res.failed || gone.failed) {
        say(
          "send_item failed for " +
            name +
            ": " +
            (res.reason || gone.reason || "slot unchanged"),
          "#CF575F"
        );
        break;
      }
      n++;
      await wait(150);
    }
    await AL.send(M, { type: "job_sent", id: j.id, count: n });
    say(
      "Handed " + n + " item(s) to " + M + "; " + free_slots() + " slots free"
    );
  }

  // Merchant standing next to us after a delivery: pay him / sweep surplus gold
  async function settle_restock(j) {
    const m = get_player(M);
    const sweep = Math.floor(character.gold - CFG.GOLD_KEEP);
    if (m && sweep >= CFG.SWEEP_MIN && d2(character, m) <= CFG.PAY_RANGE) {
      const res = await call_paced("transfer", () => send_gold(M, sweep));
      if (res.failed) say("send_gold failed: " + res.reason, "#CF575F");
      else
        say(
          "Delivery received (" +
            j.sent_hp +
            " HP / " +
            j.sent_mp +
            " MP). Sent " +
            sweep +
            " gold to " +
            M
        );
    } else
      say("Delivery received (" + j.sent_hp + " HP / " + j.sent_mp + " MP)");
  }

  async function service_job(j) {
    if (j.jtype !== "restock" && j.ready && !j.handed && !j.terminal)
      await do_handoff(j);
    if (j.done && !j.settled) {
      j.settled = true;
      if (j.jtype === "restock") await settle_restock(j);
      else
        say(
          "Merchant took the pickup (" +
            j.got +
            " item(s)); " +
            free_slots() +
            " slots free"
        );
    }
  }

  // Steps 2-3: ask, then wait. Returns "served" | "eta_too_long" | "no_answer" | "lost_contact" | "failed: <why>" | "died" | "stopped" | "no_need"
  //   opts.limit_s    how long to wait for a first reply (default: the 60s rule)
  //   opts.commit_any wait for the Merchant whatever his ETA (fallback 3: nothing else left to try)
  async function ask_and_wait(L, opts) {
    opts = opts || {};
    const limit_ms = (opts.limit_s || P.ETA_LIMIT_S) * 1000;
    const jobs = build_jobs(L);
    if (!jobs.length) return "no_need";
    L.jobs = jobs;
    const primary = jobs[0];
    say(
      "Asking " +
        M +
        " for: " +
        jobs.map((j) => j.jtype).join(" + ") +
        " (meeting at " +
        describe_dest(L.meet) +
        ")"
    );
    for (const j of jobs) await send_job(j);
    for (;;) {
      if (!alive()) return "stopped";
      if (await ladder_tick()) {
        await cancel_jobs(L);
        return "died";
      }
      for (const j of jobs) await service_job(j);
      if (primary.failed) {
        await cancel_jobs(L);
        return "failed: " + primary.failed;
      }
      if (jobs.every((j) => j.terminal)) {
        if (primary.done) {
          await call(() => wait_for(() => !R.gear_busy, 20000)); // gear that rode along is equipped before he goes back to work
          return "served";
        }
        return "failed: cancelled";
      }
      if (!primary.done && !primary.committed) {
        if (primary.status) {
          // the reply: ETA <= 60s -> wait through the whole delivery, otherwise move on to the next step
          if (opts.commit_any || primary.eta <= P.ETA_LIMIT_S) {
            primary.committed = true;
            say(
              M +
                " answered: ETA " +
                primary.eta +
                "s (" +
                (primary.doing || "?") +
                ") - waiting for him"
            );
          } else {
            say(
              M +
                " is busy: ETA " +
                primary.eta +
                "s is over " +
                P.ETA_LIMIT_S +
                "s (" +
                (primary.doing || "?") +
                ")",
              "#CF575F"
            );
            await cancel_jobs(L);
            return "eta_too_long";
          }
        } else if (!primary.reached || now() - primary.sent_at > limit_ms) {
          say(
            primary.reached
              ? M +
                  " did not answer within " +
                  Math.round(limit_ms / 1000) +
                  "s"
              : M + " is not reachable",
            "#CF575F"
          );
          await cancel_jobs(L);
          return "no_answer";
        }
      }
      // liveness, not a stopwatch: the Merchant pings every ~10s while he has a job of ours
      for (const j of jobs)
        if (!j.terminal && j.status && now() - j.last_seen > P.LIVENESS_MS) {
          say(
            "No ping from " +
              M +
              " for " +
              Math.round(P.LIVENESS_MS / 1000) +
              "s - he is gone",
            "#CF575F"
          );
          await cancel_jobs(L);
          return "lost_contact";
        }
      await wait(250);
    }
  }

  // ---- fallback 2 pieces ----
  async function buy_potions_at_ernis() {
    const npc = find_npc("fancypots");
    if (!npc) return say("Cannot locate the potion NPC", "#CF575F");
    const r = await travel(
      { map: npc.map, x: npc.x, y: npc.y },
      90000,
      "buying potions at Ernis (fancypots)"
    );
    if (r.failed) return say("Could not reach the NPC: " + r.reason, "#CF575F");
    for (const name of [CFG.HP_POTION, CFG.MP_POTION]) {
      const have = quantity(name);
      const want = potion_goal(name) - have; // the normal restock amount (the whole party's on a courier trip), nothing more
      if (want <= 0) continue;
      const n = Math.min(want, Math.floor(character.gold / unit_cost(name)));
      if (n <= 0) {
        say(
          "Not enough gold for " + name + " (have " + character.gold + ")",
          "#CF575F"
        );
        continue;
      }
      const res = await call(() => buy_with_gold(name, n));
      const got = await call(() =>
        wait_for(() => quantity(name) >= have + n, 6000)
      );
      if (res.failed || got.failed)
        say(
          "Buying " + name + " failed: " + (res.reason || got.reason),
          "#CF575F"
        );
      else say("Bought " + n + "x " + name);
    }
  }
  const restock_gold = () =>
    [CFG.HP_POTION, CFG.MP_POTION].reduce(
      (sum, n) =>
        sum + Math.max(0, potion_goal(n) - quantity(n)) * unit_cost(n),
      0
    );

  // One visit to the bank: optionally withdraw gold, optionally store keepers + stackables.
  // Sets L.bank_full when something could not be stored and the bag is still full.
  async function bank_visit(L, opts) {
    const r = await travel("bank", 90000, "bank");
    if (r.failed || character.map !== "bank") {
      say("Could not reach the bank: " + (r.reason || "wrong map"), "#CF575F");
      return false;
    }
    const ready = await call(() => wait_for(() => character.bank, 8000));
    if (ready.failed) {
      say("Bank data never loaded", "#CF575F");
      return false;
    }
    if (opts.withdraw > 0) {
      const avail = Number(character.bank && character.bank.gold);
      const amount = Math.floor(
        isFinite(avail) ? Math.min(opts.withdraw, avail) : opts.withdraw
      );
      if (amount > 0) {
        const before = character.gold;
        const wd = await call(() => bank_withdraw(amount));
        const done = await call(() =>
          wait_for(() => character.gold >= before + amount - 1, 5000)
        );
        if (wd.failed || done.failed)
          say("Withdrawal failed: " + (wd.reason || done.reason), "#CF575F");
        else say("Withdrew " + amount + " gold (only what the restock needs)");
      } else
        say(
          "Nothing to withdraw from the bank (balance " + avail + ")",
          "#CF575F"
        );
    }
    if (opts.store) {
      let stored = 0;
      let failed = 0;
      for (const i of keep_slots().concat(stack_slots())) {
        const it = character.items[i];
        if (!it) continue;
        const name = it.name;
        const res = await call(() => bank_store(i));
        const gone = await call(() =>
          wait_for(
            () => !character.items[i] || character.items[i].name !== name,
            3000
          )
        );
        if (res.failed || gone.failed) {
          failed++;
          say(
            "Could not bank " +
              name +
              ": " +
              (res.reason || gone.reason || "slot unchanged"),
            "#CF575F"
          );
          break; // the bank is full: no point trying the rest
        }
        stored++;
      }
      say("Banked " + stored + " item(s); " + free_slots() + " slots free");
      if (failed && bag_need() > 0) L.bank_full = true;
    }
    return true;
  }

  // Fallback 2 (no Merchant at all), in this order: a) sell junk at Gabriel  b) withdraw + buy potions  c) bank what is left
  async function fallback_self_service(L) {
    say(
      "No Merchant available - handling it myself (sell, potions, bank)",
      "#CF575F"
    );
    if (character.map !== "main") {
      const r = await travel(
        CFG.SAFE_SPOT,
        150000,
        "to the main map for self-service"
      );
      if (r.failed)
        return say("Could not get to the main map: " + r.reason, "#CF575F");
    }
    // a) sellable junk first - BEFORE anything goes into the bank
    if (junk_slots().length) {
      let npc = null;
      try {
        npc = find_npc(CFG.SELL_NPC);
      } catch (e) {}
      if (!npc) npc = { map: "main", x: -89, y: -165 }; // Gabriel's spot on main, if find_npc fails
      const r = await travel(
        { map: npc.map || npc.in, x: npc.x, y: npc.y },
        90000,
        "selling junk to Gabriel"
      );
      if (!r.failed) {
        const sold = await dump_junk(
          CFG.JUNK_ACTION === "destroy" ? "destroy" : "sell"
        );
        say(
          "Sold " + sold.done + " junk item(s); " + free_slots() + " slots free"
        );
      } else
        say("Could not reach " + CFG.SELL_NPC + ": " + r.reason, "#CF575F");
    }
    // b) potions: only the gold the normal restock needs, nothing extra
    let stored_at_bank = false;
    if (potion_need()) {
      const short = Math.ceil(restock_gold() - character.gold);
      if (short > 0) {
        // while at the bank anyway, store the keepers / stackables too (selling already happened)
        stored_at_bank = await bank_visit(L, {
          withdraw: short,
          store: bag_need() > 0,
        });
      }
      await buy_potions_at_ernis();
    }
    // c) keepers / stackables into the bank (unless that visit already did it, or the bag is fine now)
    if (bag_need() > 0 && !stored_at_bank) await bank_visit(L, { store: true });
  }

  // Fallback 3: the bank is full too. Full stop at the main-town safe spot, re-ask every ~30s until the Merchant is free.
  async function fallback_wait_for_merchant(L) {
    say(
      "Bank and bag are both full - waiting at the safe spot for the Merchant to make room (asking every ~30s)",
      "#CF575F"
    );
    for (;;) {
      if (!alive() || !bag_need()) return;
      if (await ladder_tick()) return;
      if (
        character.map !== CFG.SAFE_SPOT.map ||
        d2(character, CFG.SAFE_SPOT) > 150
      ) {
        const tr = await travel(
          CFG.SAFE_SPOT,
          150000,
          "waiting for the Merchant at the safe spot"
        );
        if (tr.failed) {
          // no path: do not hammer the pathfinder, and give up after a few tries (the ladder backs off, he hunts)
          say("Cannot reach the safe spot (" + tr.reason + ")", "#CF575F");
          if (++L.walk_fails >= 3) return;
          await wait(10000);
          continue;
        }
      }
      L.meet = here();
      const out = await ask_and_wait(L, { limit_s: 30, commit_any: true });
      if (
        out === "served" ||
        out === "died" ||
        out === "stopped" ||
        out === "no_need"
      )
        return;
      await wait(2000);
    }
  }

  async function run_ladder() {
    const L = (R.ladder = {
      started: now(),
      jobs: [],
      meet: null,
      bank_full: false,
      walk_fails: 0,
    });
    if (is_leader() && CFG.PARTY_MEMBERS.length) send_party_state(); // tell the Warrior and the Priest at once: this is a trip, stay and fight
    const why = [
      potion_need() ? "low potions" : "",
      bag_need() ? "full bag" : "",
    ]
      .filter(Boolean)
      .join(" + ");
    say(
      "Need: " + why + " - pausing the hunt and retreating to town",
      "#E1A951"
    );
    let out = "";
    try {
      if (!(await retreat_to_town(L))) {
        // never stand idle in the field: give the ladder up, keep hunting, try again after the backoff
        out = "retreat_failed";
        say(
          "Could not retreat to town - back to hunting, will retry in " +
            Math.round(CFG.LADDER_BACKOFF_MS / 1000) +
            "s",
          "#CF575F"
        );
        return;
      }
      out = await ask_and_wait(L); // steps 2-3
      if (
        out !== "served" &&
        out !== "died" &&
        out !== "stopped" &&
        out !== "no_need"
      ) {
        say("Merchant not usable here (" + out + ")", "#CF575F");
        if (character.map !== "main") {
          // fallback 1: tell him BEFORE the portal so he stops walking toward our old town
          await AL.send(M, { type: "travel_to_main" });
          const r = await travel(
            CFG.SAFE_SPOT,
            150000,
            "portal to the main map"
          );
          if (r.failed)
            say("Could not get to the main map: " + r.reason, "#CF575F");
          else {
            L.meet = here();
            out = await ask_and_wait(L);
          }
        }
        if (
          out !== "served" &&
          out !== "died" &&
          out !== "stopped" &&
          out !== "no_need"
        ) {
          await fallback_self_service(L); // fallback 2
          if (L.bank_full) await fallback_wait_for_merchant(L); // fallback 3
        }
      }
    } finally {
      await cancel_jobs(L);
      R.ladder = null;
      R.ladder_next =
        out === "died"
          ? now() + 5000
          : have_need()
          ? now() + CFG.LADDER_BACKOFF_MS
          : 0;
      say(
        have_need()
          ? "Ladder finished but a need remains (" +
              (potion_need() ? "potions " : "") +
              (bag_need() ? "bag" : "") +
              ") - trying again in " +
              Math.round((R.ladder_next - now()) / 1000) +
              "s"
          : "Need met - resuming the hunt",
        have_need() ? "#CF575F" : "#5BCB5B"
      );
    }
  }
