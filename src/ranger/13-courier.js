  // ============================ COURIER TRIP ======================
  // The leader never leaves the fight. When any Ranger runs low (or full), the leader picks the follower with the most potions
  // as the courier. The courier: gives stopgap potions to anyone nearly out, collects junk and spare gold from the others, runs the
  // normal need ladder once for the WHOLE party (one Merchant job), walks back and hands every Ranger his share and his gear.
  function my_status() {
    return {
      hp: quantity(CFG.HP_POTION),
      mp: quantity(CFG.MP_POTION),
      free: free_slots(),
      junk: handoff_slots().length,
      gear: gear_slots().length,
      gold: Math.floor(character.gold),
      map: character.map,
      busy: !!(R.ladder || R.courier),
    };
  }
  function member_status(n) {
    if (n === character.name) return my_status();
    const e = R.levels[n];
    return e && now() - e.at < CFG.STATE_STALE_MS * 2 ? e : null;
  }
  function party_min_potions() {
    let m = Infinity;
    for (const n of party_names()) {
      const st = member_status(n);
      if (st) m = Math.min(m, st.hp, st.mp);
    }
    return m;
  }
  function courier_check() {
    if (!courier_on() || !is_leader()) return;
    if (R.trip) {
      if (now() - R.trip.at > CFG.COURIER_MAX_MS) {
        say(
          "Courier trip by " +
            R.trip.courier +
            " took too long - giving up on it",
          "#CF575F"
        );
        R.trip = null;
        R.courier_next = now() + CFG.COURIER_COOLDOWN_MS;
      }
      return;
    }
    if (now() < R.courier_next) return;
    const members = {};
    let trigger = null;
    const topoff_check = !!(R.boss && !R.boss.topped && now() - R.boss.started > 10000);
    if (topoff_check) R.boss.topped = true; // looked at once per event, whether or not a trip is needed
    const quiet = !R.boss && !R.goal && !(hunt_state() && R.mh && R.mh.verdict && R.mh.verdict.ok); // v5: between events the restock starts early
    for (const n of party_names()) {
      const st = member_status(n);
      if (!st) continue;
      members[n] = { hp: st.hp, mp: st.mp, free: st.free, junk: st.junk, gear: st.gear || 0 };
      if (trigger) continue;
      if (Math.min(st.hp, st.mp) <= (quiet ? Math.max(CFG.COURIER_QUIET_AT, CFG.COURIER_POTION_AT) : R.boss ? Math.max(CFG.BOSS_COURIER_POTION_AT, CFG.COURIER_POTION_AT) : CFG.COURIER_POTION_AT))
        trigger = n + " is low on potions";
      else if (topoff_check && Math.min(st.hp, st.mp) < CFG.BOSS_TOPOFF_BELOW)
        trigger = n + " starts the " + R.boss.name + " fight with " + Math.min(st.hp, st.mp) + " potions - top off first";
      else if (
        CFG.CLEAN_ENABLED &&
        st.free <= CFG.CLEAN_WHEN_FREE_SLOTS &&
        st.junk >= CFG.SELL_MIN_JUNK
      )
        trigger = n + " has a full bag";
      else if (
        quiet &&
        CFG.GEAR_HANDOFF &&
        (st.gear || 0) >= CFG.GEAR_TRIP_MIN &&
        now() - (R.spare_trip_at || 0) > CFG.GEAR_TRIP_EVERY_MS
      ) {
        trigger = n + " carries spare gear for the Merchant to upgrade";
        R.spare_trip_at = now();
      }
    }
    if (R.post_boss && now() - R.post_boss.at > CFG.BOSS_AFTER_WINDOW_MS) R.post_boss = null;
    if (!trigger && R.post_boss && now() - R.post_boss.at >= CFG.BOSS_AFTER_DELAY_MS && !R.boss) {
      const has = Object.keys(members).some((n) => (members[n].junk || 0) + (members[n].gear || 0) >= CFG.BOSS_AFTER_MIN_ITEMS);
      if (has) {
        trigger = "the " + R.post_boss.name + " event is over - everyone's drops go to the Merchant";
        R.post_boss = null;
      } else if (now() - R.post_boss.at > CFG.BOSS_AFTER_DELAY_MS + 60000) R.post_boss = null; // nothing to hand over
    }
    let gear = false;
    if (
      !trigger &&
      R.gear_ready_at &&
      now() - R.gear_ready_at < CFG.GEAR_READY_MAX_MS
    ) {
      trigger = "better gear is waiting at the Merchant";
      gear = true;
    }
    if (!trigger) return;
    let best = null;
    for (const n of CFG.PARTY_MEMBERS) {
      if (n === character.name) continue;
      const st = member_status(n);
      if (!st || st.busy || st.map !== character.map) continue;
      const score = Math.min(st.hp, st.mp);
      if (!best || score > best.score) best = { n, score };
    }
    if (!best && CFG.LEADER_TRIP_WHEN_ALONE && !R.courier && !R.ladder && now() - R.started_at > 120000 && !CFG.PARTY_MEMBERS.some((n) => n !== character.name && R.levels[n] && now() - R.levels[n].at < 180000)) {
      // v5: nobody else can go: the leader makes the trip himself
      const sid = AL.job_id("c");
      R.trip = { id: sid, courier: character.name, at: now(), self: true };
      send_party_state(); // (a trip: the Warrior and the Priest stay and fight)
      say("Courier trip: " + trigger + " - no follower Ranger is online, " + character.name + " goes to town himself", "#51D2E1");
      courier_message(character.name, { type: "courier_go", id: sid, members, gear });
      return;
    }
    if (!best) {
      if (now() - R.courier_warn_at > 60000) {
        R.courier_warn_at = now();
        say(
          "Courier trip needed (" + trigger + ") but no follower is free to go",
          "#CF575F"
        );
      }
      return;
    }
    const id = AL.job_id("c");
    R.trip = { id, courier: best.n, at: now() };
    say(
      "Courier trip: " +
        trigger +
        " - " +
        best.n +
        " goes to town for everyone",
      "#51D2E1"
    );
    call(() => send_cm(best.n, { type: "courier_go", id, members, gear }));
  }
  function courier_message(from, d) {
    if (d.type === "courier_go") {
      const self_trip = from === character.name && is_leader() && !!R.trip && R.trip.self && R.trip.id === d.id;
      if (!self_trip && (!is_follower() || from !== CFG.PARTY_LEADER)) return;
      if (R.courier || R.ladder) {
        call(() =>
          send_cm(from, {
            type: "courier_done",
            id: d.id,
            ok: false,
            reason: "busy",
          })
        );
        return;
      }
      const members = {};
      const n = (v) => Math.max(0, Math.min(1e6, Math.floor(Number(v) || 0)));
      for (const k in d.members || {})
        if (party_names().indexOf(k) !== -1) {
          const m = d.members[k] || {};
          members[k] = {
            hp: n(m.hp),
            mp: n(m.mp),
            free: n(m.free),
            junk: n(m.junk),
            gear: n(m.gear),
          };
        }
      members[character.name] = members[character.name] || {
        hp: 0,
        mp: 0,
        free: 0,
        junk: 0,
        gear: 0,
      };
      R.courier = {
        id: d.id,
        members,
        gear: !!d.gear,
        phase: "queued",
        buy: { hp: 0, mp: 0 },
        goal: { hp: 0, mp: 0 },
        got: {},
        shares: {},
      };
      say(
        "Courier trip for the party: " + Object.keys(members).join(", "),
        "#51D2E1"
      );
    } else if (d.type === "courier_done") {
      if (
        is_leader() &&
        R.trip &&
        R.trip.id === d.id &&
        R.trip.courier === from
      ) {
        say(
          "Courier " +
            from +
            " is back (" +
            (d.ok ? "ok" : "failed: " + (d.reason || "?")) +
            ")",
          d.ok ? "#5BCB5B" : "#CF575F"
        );
        R.trip = null;
        R.gear_ready_at = 0; // the Merchant says again at his next sweep if more is waiting
        R.courier_next = now() + CFG.COURIER_COOLDOWN_MS;
      }
    } else if (d.type === "courier_collect") {
      courier_give(from, d);
    } else if (d.type === "courier_collected") {
      if (R.courier && R.courier.id === d.id)
        R.courier.got[from] = {
          items: Number(d.items) || 0,
          gold: Number(d.gold) || 0,
        };
    }
  }
  const potion_slot = (name) =>
    character.items.findIndex((it) => it && it.name === name);
  async function give_potions(to, name, q) {
    q = Math.min(q, quantity(name));
    if (q <= 0) return 0;
    const i = potion_slot(name);
    if (i < 0) return 0;
    const res = await call_paced("transfer", () => send_item(to, i, q));
    if (res.failed) {
      say(
        "Could not give " + q + " " + name + " to " + to + ": " + res.reason,
        "#CF575F"
      );
      return 0;
    }
    return q;
  }
  // another Ranger (the courier) asks for junk and spare gold
  async function courier_give(to, d) {
    const max = Math.max(
      0,
      Math.min(CFG.COURIER_JUNK_EACH, Math.floor(Number(d.max) || 0))
    );
    let items = 0;
    for (const i of handoff_slots().slice(0, max)) {
      const it = character.items[i];
      if (!it) continue;
      const res = await call_paced("transfer", () => send_item(to, i, it.q || 1));
      if (!res.failed) items++;
      await wait(150);
    }
    let gold = 0;
    const surplus = Math.floor(character.gold - CFG.COURIER_GOLD_KEEP);
    let p = null;
    try {
      p = get_player(to);
    } catch (e) {}
    if (
      surplus >= CFG.SWEEP_MIN &&
      p &&
      p.map === character.map &&
      d2(character, p) <= CFG.PAY_RANGE
    ) {
      const res = await call_paced("transfer", () => send_gold(to, surplus));
      if (!res.failed) gold = surplus;
    }
    await call(() =>
      send_cm(to, { type: "courier_collected", id: d.id, items, gold })
    );
  }
  async function courier_collect(C) {
    const others = Object.keys(C.members).filter((n) => n !== character.name);
    // 1) stopgap potions for whoever is nearly out
    for (const n of others) {
      const m = C.members[n];
      for (const [pot, key] of [
        [CFG.HP_POTION, "hp"],
        [CFG.MP_POTION, "mp"],
      ])
        if (
          m[key] <= CFG.COURIER_POTION_AT &&
          quantity(pot) - CFG.COURIER_STOPGAP >= CFG.COURIER_KEEP
        ) {
          const g = await give_potions(n, pot, CFG.COURIER_STOPGAP);
          if (g) {
            m[key] += g;
            say("Stopgap: " + g + " " + pot + " to " + n);
          }
        }
    }
    // 2) junk and spare gold from the others, as much as my bag can take
    // Sean 2026-11-19: a member with a bag full of junk (the Warrior with 30+ Rings of Joy) must not be held to an equal share: whoever needs less leaves his room to the others
    let room = Math.max(0, free_slots() - 4);
    const shares = {};
    const order = others.slice().sort((x, y) => (((C.members[x] || {}).junk) || CFG.COURIER_JUNK_EACH) - (((C.members[y] || {}).junk) || CFG.COURIER_JUNK_EACH));
    order.forEach((n, k) => {
      const need = ((C.members[n] || {}).junk) || CFG.COURIER_JUNK_EACH;
      const sh = Math.min(CFG.COURIER_JUNK_EACH, need, Math.floor(room / (order.length - k)));
      shares[n] = sh;
      room -= sh;
    });
    for (const n of others)
      call(() => send_cm(n, { type: "courier_collect", id: C.id, max: shares[n] }));
    const t0 = now();
    while (
      others.some((n) => !C.got[n]) &&
      now() - t0 < CFG.COURIER_COLLECT_WAIT_MS
    )
      await wait(500);
    const items = others.reduce(
      (a, n) => a + ((C.got[n] && C.got[n].items) || 0),
      0
    );
    const gold = others.reduce(
      (a, n) => a + ((C.got[n] && C.got[n].gold) || 0),
      0
    );
    say(
      "Collected " +
        items +
        " item(s) and " +
        gold +
        " gold from " +
        others.length +
        " Ranger(s)"
    );
  }
  // what to buy for the whole party, and what each Ranger gets back
  function courier_size(C) {
    const hp = {};
    const mp = {};
    let bhp = 0;
    let bmp = 0;
    for (const n in C.members) {
      const mine = n === character.name;
      const h = mine ? quantity(CFG.HP_POTION) : C.members[n].hp;
      const m = mine ? quantity(CFG.MP_POTION) : C.members[n].mp;
      hp[n] = Math.max(0, potion_target() - h);
      mp[n] = Math.max(0, potion_target() - m);
      bhp += hp[n];
      bmp += mp[n];
    }
    // a gear-only trip still needs a Merchant meeting: order one potion so the normal job exists
    if (C.gear && bhp === 0 && bmp === 0) bhp = 1;
    C.shares = { hp, mp };
    C.buy = { hp: bhp, mp: bmp };
    C.goal = {
      hp: quantity(CFG.HP_POTION) + bhp,
      mp: quantity(CFG.MP_POTION) + bmp,
    };
  }
  async function courier_deliver(C) {
    const others = Object.keys(C.members).filter((n) => n !== character.name);
    const pending = {};
    for (const n of others) pending[n] = true;
    const t0 = now();
    while (
      Object.keys(pending).length &&
      now() - t0 < CFG.COURIER_DELIVER_WAIT_MS &&
      alive()
    ) {
      if (await ladder_tick()) break; // died
      const pos = is_leader() ? R.field || CFG.FARM_SPOT : leader_pos(); // v5: on his own trip the leader walks back to where the Warrior and the Priest stayed
      if (
        pos &&
        (character.map !== pos.map || d2(character, pos) > CFG.FOLLOW_RADIUS)
      ) {
        const r = await travel(
          { map: pos.map, x: pos.x, y: pos.y },
          90000,
          "back to the party"
        );
        if (r.failed) await wait(2000);
      }
      for (const n of Object.keys(pending)) {
        let p = null;
        try {
          p = get_player(n);
        } catch (e) {}
        if (
          !p ||
          p.map !== character.map ||
          d2(character, p) > CFG.PAY_RANGE + 50
        )
          continue;
        // the courier never gives away his own last COURIER_KEEP (the Merchant was busy, or the order came in short)
        const gh = await give_potions(
          n,
          CFG.HP_POTION,
          Math.min(
            C.shares.hp[n] || 0,
            quantity(CFG.HP_POTION) - CFG.COURIER_KEEP
          )
        );
        const gm = await give_potions(
          n,
          CFG.MP_POTION,
          Math.min(
            C.shares.mp[n] || 0,
            quantity(CFG.MP_POTION) - CFG.COURIER_KEEP
          )
        );
        for (const g of R.courier_gear.filter((x) => x.to === n)) {
          const idx = find_gear(g.name, g.level);
          if (idx < 0) continue;
          await call(() =>
            send_cm(n, {
              type: "gear_give",
              name: g.name,
              level: g.level,
              slot: g.slot,
            })
          );
          const res = await call_paced("transfer", () => send_item(n, idx, 1));
          if (!res.failed)
            say(
              "Gave " +
                g.name +
                " +" +
                g.level +
                " to " +
                n +
                " for his " +
                g.slot,
              "#5BCB5B"
            );
        }
        R.courier_gear = R.courier_gear.filter((x) => x.to !== n);
        say(
          "Delivered to " + n + ": " + gh + " HP / " + gm + " MP potions",
          "#5BCB5B"
        );
        delete pending[n];
      }
      await wait(1000);
    }
    return Object.keys(pending);
  }
  async function run_courier() {
    const C = R.courier;
    let ok = false;
    let reason = "";
    // the step loop (and with it leader_tick) waits while I am the courier: when the leader makes the trip himself the party must still hear where he is
    const state_timer = is_leader() ? setInterval(() => alive() && send_party_state(), CFG.STATE_EVERY_MS) : null;
    try {
      C.phase = "collect";
      await courier_collect(C);
      courier_size(C);
      // v5: tell the Merchant before leaving the field what the party needs, so potions and hands are ready when the courier arrives
      try {
        const nt = await AL.send(M, { type: "courier_notice", id: C.id, hp: C.buy.hp, mp: C.buy.mp, items: handoff_slots().length });
        say("Told the Merchant: " + C.buy.hp + " " + CFG.HP_POTION + " + " + C.buy.mp + " " + CFG.MP_POTION + " to pick up, " + handoff_slots().length + " item(s) to sort" + (nt && nt.delivered === false ? " (he did not answer)" : ""), "#51D2E1");
      } catch (e) {}
      C.phase = "trip";
      if (potion_need() || bag_need()) await run_ladder();
      C.phase = "deliver";
      const missed = await courier_deliver(C);
      ok = !missed.length;
      if (!ok) reason = "never met " + missed.join(", ");
    } catch (e) {
      reason = (e && e.message) || String(e);
      say("Courier error: " + reason, "#CF575F");
    } finally {
      if (state_timer) clearInterval(state_timer);
      R.courier = null;
      R.courier_gear = R.courier_gear.filter(() => false);
      R.ladder_next = 0;
      if (R.trip && R.trip.self && R.trip.id === C.id) courier_message(character.name, { type: "courier_done", id: C.id, ok, reason }); // v5: my own trip
      else
        await call(() =>
          send_cm(CFG.PARTY_LEADER, {
            type: "courier_done",
            id: C.id,
            ok,
            reason,
          })
        );
    }
  }

  // Followers tell the leader their level, so he knows when the whole party is ready for the bigger goals
  // v5: party membership without the Merchant. Followers ask the leader to let them in; the leader invites members that are online but not in his party
  const party_has = (n) => {
    try {
      const p = get_party() || {};
      return !!p[n];
    } catch (e) {
      return false;
    }
  };
  // get_active_characters() only lists characters this game window knows about: characters Sean launched himself may be missing from it,
  // so a member also counts as online when we heard from him lately (party_level / party_state) or can see him
  const is_online = (n) => {
    try {
      if (get_active_characters()[n]) return true;
    } catch (e) {
      return true; // cannot tell: try anyway
    }
    try {
      if (n === CFG.PARTY_LEADER && R.leader && now() - R.leader.at < 60000) return true;
      const e = R.levels[n];
      if (e && now() - e.at < 60000) return true;
      if (parent.entities && parent.entities[n]) return true;
    } catch (e2) {}
    return false;
  };
  // the Merchant normally sends the invitations; when he is online the Rangers only step in after a member has been out of the party for a minute
  const party_gap = (n) => {
    if (party_has(n) || !is_online(n)) {
      delete R.party_wait[n];
      return false;
    }
    const since = R.party_wait[n] || (R.party_wait[n] = now());
    return CFG.PARTY_ACCEPT_FROM !== CFG.MERCHANT_NAME || !is_online(CFG.MERCHANT_NAME) || now() - since > 60000;
  };
  function party_join_tick() {
    if (!alive() || character.rip || now() - R.party_join_at < CFG.PARTY_JOIN_MS) return;
    R.party_join_at = now();
    if (is_follower()) {
      if (party_has(CFG.PARTY_LEADER) || !is_online(CFG.PARTY_LEADER)) {
        delete R.party_wait.leader;
        return;
      }
      const since = R.party_wait.leader || (R.party_wait.leader = now());
      if (CFG.PARTY_ACCEPT_FROM === CFG.MERCHANT_NAME && is_online(CFG.MERCHANT_NAME) && now() - since <= 60000) return; // (only when the Merchant leads the party, v5 way)
      say("Not in " + CFG.PARTY_LEADER + "'s party - asking to join", "#51D2E1");
      call(() => send_party_request(CFG.PARTY_LEADER));
    } else if (is_leader() && CFG.PARTY_MEMBERS.length) {
      const head = character.party || character.name;
      if (head !== character.name && head === CFG.MERCHANT_NAME && CFG.PARTY_ACCEPT_FROM === CFG.MERCHANT_NAME) return; // the Merchant leads this party (v5 way): he sends the invites
      for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) {
        if (n === character.name || !party_gap(n)) continue;
        say("Inviting " + n + " to the party", "#51D2E1");
        call(() => send_party_invite(n));
      }
    }
  }
  setInterval(party_join_tick, 5000);
  // v6: hand spare items to the Priest (not while the courier trip is under way: he carries them to the Merchant himself)
  const { share_tick, share_give } = AL.runtime.bag_share({ CFG, S: R, say, alive, slots: () => handoff_slots(), free: () => free_slots(), gate: () => !in_trip() });
  setInterval(share_tick, 5000);
  function follower_tick() {
    if (!is_follower() || now() - R.level_sent_at < CFG.STATE_EVERY_MS) return;
    R.level_sent_at = now();
    call(() =>
      send_cm(
        CFG.PARTY_LEADER,
        Object.assign(
          { type: "party_level", level: character.level },
          my_status()
        )
      )
    );
  }
  // Leader: true while any follower is still below PARTY_BEES_UNTIL_LEVEL (a follower never heard from counts for the first 3 minutes)
  // v5: the first member (besides me) still below `limit`, or null; a member never heard from counts for the first 3 minutes, a silent one (5 min) no longer holds anyone back
  function party_below(limit) {
    if (!is_leader() || !CFG.PARTY_MEMBERS.length || !(limit > 0)) return null;
    for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) {
      if (n === character.name) continue;
      const e = R.levels[n];
      if (e ? now() - e.at < 300000 && e.level < limit : now() - R.started_at < 180000) return n;
    }
    return null;
  }
  function party_bees_only() {
    let low = null;
    if (
      is_leader() &&
      CFG.PARTY_MEMBERS.length &&
      CFG.PARTY_BEES_UNTIL_LEVEL > 0
    )
      for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) {
        if (n === character.name) continue;
        const e = R.levels[n];
        if (
          e
            ? now() - e.at < 300000 && e.level < CFG.PARTY_BEES_UNTIL_LEVEL // v5: a member that has been silent for 5 min (logged off) no longer holds the party back
            : now() - R.started_at < 180000
        ) {
          low = n + (e ? " (level " + e.level + ")" : " (not heard from yet)");
          break;
        }
      }
    if (
      (R.bees_only === null ? false : R.bees_only) !== !!low ||
      R.bees_only === null
    ) {
      if (low)
        say(
          "Party farms bees only: " +
            low +
            " is below level " +
            CFG.PARTY_BEES_UNTIL_LEVEL,
          "#51D2E1"
        );
      else if (R.bees_only !== null)
        say(
          "Everyone is level " +
            CFG.PARTY_BEES_UNTIL_LEVEL +
            "+ - goals and hunts are back on",
          "#5BCB5B"
        );
      R.bees_only = !!low;
    }
    return !!low;
  }
  // Every Ranger accepts the party invitation of the party leader (the Merchant) and nobody else's
  globalThis.on_party_invite = function (name) {
    if (!alive()) return;
    if (name === CFG.PARTY_ACCEPT_FROM || (is_follower() && name === CFG.PARTY_LEADER)) {
      say("Accepting the party invitation from " + name, "#51D2E1");
      accept_party_invite(name);
    }
  };
  // the leader lets his own members in when they ask (only while he heads the party himself)
  globalThis.on_party_request = function (name) {
    if (!alive() || !is_leader()) return;
    if (CFG.PARTY_MEMBERS.indexOf(name) === -1 && CFG.PARTY_SUPPORT.indexOf(name) === -1) return;
    if ((character.party || character.name) !== character.name) return;
    say("Accepting the party request from " + name, "#51D2E1");
    accept_party_request(name);
  };
  // Follower: true = he is on his way to the leader; false = he is close enough to fight (or has no leader news and farms alone)
  async function follower_step() {
    if (LEAD.held()) return; // Hold from the lead
    const pos = leader_pos();
    if (!pos) return false;
    const near =
      character.map === pos.map && d2(character, pos) <= CFG.FOLLOW_FAR_PX;
    if (near) {
      R.follow_fails = 0;
      return false;
    }
    if (smart.moving || is_moving(character)) return true;
    if (CFG.HUNT_DANGER_TYPES.length && now() < (R.danger_until || 0) && danger_server(pos)) {
      if (now() - (R.danger_log || 0) > 120000) {
        R.danger_log = now();
        say("DANGER: the server shows a " + CFG.HUNT_DANGER_TYPES.join("/") + " near " + CFG.PARTY_LEADER + " - staying in town", "#CF575F");
      }
      R.follow_block_until = Math.max(R.follow_block_until, now() + 15000);
    }
    if (now() < R.follow_block_until || now() - R.follow_at < 3000) return true;
    R.follow_at = now();
    const dest = {
      map: pos.map,
      x: pos.x + (Math.random() - 0.5) * 120,
      y: pos.y + (Math.random() - 0.5) * 120,
    };
    log_move(dest, "following " + CFG.PARTY_LEADER);
    call(() => smart_move(dest)).then((r) => {
      if (r && (r.failed || r.success === false)) {
        R.follow_fails++;
        R.follow_block_until = now() + Math.min(60000, 5000 * R.follow_fails);
        say(
          "Cannot reach " +
            CFG.PARTY_LEADER +
            " (" +
            (r.reason || "no path") +
            ") - retrying in " +
            Math.round((R.follow_block_until - now()) / 1000) +
            "s",
          "#CF575F"
        );
      } else R.follow_fails = 0;
    });
    return true;
  }

  async function fight() {
    const target = pick_target();
    if (!target) return tether();

    if (get_target() !== target) change_target(target);
    if (!is_in_range(target)) {
      // Walk toward it - but never hammer the pathfinder. One step per ~1.2s, never while a path search / walk is running,
      // and a target we cannot get closer to (no path: "Path not found!") is ignored for 30s so he picks another one.
      if (!is_moving(character) && !smart.moving && now() - R.xmove_at > 1200) {
        const xl = R.xmove_last;
        if (xl && xl.id === target.id && d2(character, xl) < 5) {
          if (++xl.fails >= 3) {
            R.unreach[target.id] = now() + 30000;
            R.lock = null;
            R.xmove_last = null;
            say(
              "Cannot get closer to " +
                target.mtype +
                " at (" +
                Math.round(target.x) +
                ", " +
                Math.round(target.y) +
                ") - ignoring it for 30s",
              "#CF575F"
            );
            return;
          }
        } else
          R.xmove_last = {
            id: target.id,
            x: character.x,
            y: character.y,
            fails: 0,
          };
        R.xmove_at = now();
        call(() =>
          xmove(
            character.x + (target.x - character.x) / 2,
            character.y + (target.y - character.y) / 2
          )
        );
      }
      return;
    }
    if (is_on_cooldown("attack")) return;
    if (escort_hold(target)) return;
    await shoot(target);
  }
  // the Warrior takes the first hit: while he is here (his heartbeat is fresh), has no focus yet and the monster has no target, hold fire for a few seconds
  function escort_hold(target) {
    const f = R.focus;
    if (!CFG.ESCORT_WAIT_MS || !CFG.FOCUS_TARGET || !f || now() - f.at > CFG.FOCUS_MAX_AGE_MS) return false;
    if (character.hp / character.max_hp < 0.6) return false;
    const fe = f.id ? parent.entities[f.id] : null;
    if (f.id ? !fe || fe.dead || fe.target : target.target) return false; // somebody already has its aggro: fire
    if (!R.hold || R.hold.id !== target.id) R.hold = { id: target.id, since: now() };
    return now() - R.hold.since < CFG.ESCORT_WAIT_MS;
  }

  function next_delay() {
    const t = parent.next_skill && parent.next_skill.attack;
    const ms = t ? +t - now() : 0;
    return Math.min(250, Math.max(25, ms));
  }
