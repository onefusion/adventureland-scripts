  // ============================== PACED REQUESTS (v5) ============================
  // start_character, send_item and send_gold go through ONE queue: one at a time, each at least a configured gap after the previous
  // request of its kind finished (CFG.PACE_START_MS, CFG.PACE_TRANSFER_MS). Chat messages (send_cm), skills and loot are not queued.
  const PACE = { chain: Promise.resolve(), last: { start: 0, transfer: 0 }, n: 0, held_ms: 0 };
  function paced(kind, fn) {
    const job = PACE.chain.then(async () => {
      const gap = (kind === "start" ? CFG.PACE_START_MS : CFG.PACE_TRANSFER_MS) - (Date.now() - PACE.last[kind]);
      if (gap > 0) {
        PACE.held_ms += gap;
        await wait(gap);
      }
      PACE.n++;
      try {
        return await fn();
      } finally {
        PACE.last[kind] = Date.now();
      }
    });
    PACE.chain = job.catch(() => {});
    return job;
  }
  const call_paced = (kind, fn) => paced(kind, () => call(fn));

  // ===== v5 (Sean 2026-11-20): the support (Warrior, Priest) must be with the leader; if they are not for a minute, the leader goes to them =====
  function escort_missing() {
    const out = [];
    for (const n of CFG.PARTY_SUPPORT) {
      if (n === character.name) continue;
      const e = R.levels[n];
      if (!e || now() - e.at > CFG.ESCORT_FRESH_MS || e.x === undefined || e.y === undefined || !e.map) continue; // no fresh news (offline, dead): nothing to walk to
      if (e.map === character.map && Math.hypot(e.x - character.x, e.y - character.y) <= CFG.ESCORT_NEAR_PX) continue;
      out.push({ n, map: e.map, x: e.x, y: e.y });
    }
    return out;
  }
  const escort_off = () => !CFG.ESCORT || !is_leader() || character.rip || !!(R.ladder || R.courier || R.retreat_go || R.boss || R.trip && R.trip.self) || grinch_fight() || now() - R.started_at < 120000; // (a junk / potion trip of my own, a courier trip, a retreat, a boss event: not now)
  function escort_due() {
    if (escort_off()) { R.escort_since = 0; return false; }
    const miss = escort_missing();
    if (!miss.length) { R.escort_since = 0; R.escort_prev = null; return false; }
    if (!R.escort_since) R.escort_since = now();
    // they are on their way (the leader just left on a hunt / goal / boss and they follow): coming closer or changing map every few seconds = still travelling, the clock restarts
    if (now() - (R.escort_chk || 0) >= 5000) {
      R.escort_chk = now();
      const cur = {};
      for (const m of miss) cur[m.n] = { map: m.map, d: m.map === character.map ? Math.hypot(m.x - character.x, m.y - character.y) : 1e9 };
      for (const n of Object.keys(cur)) {
        const p0 = R.escort_prev && R.escort_prev[n];
        if (p0 && (p0.map !== cur[n].map || cur[n].d < p0.d - 80)) R.escort_since = now();
      }
      R.escort_prev = cur;
    }
    return now() - R.escort_since >= CFG.ESCORT_AFTER_MS;
  }
  async function escort_step() {
    const miss = escort_missing();
    if (!miss.length) { R.escort_since = 0; return; }
    const m = miss[0];
    say("ESCORT: " + miss.map((x) => x.n).join(" and ") + " not with me for " + Math.round((now() - R.escort_since) / 1000) + " s (" + m.n + " is on " + m.map + " " + Math.round(m.x) + "," + Math.round(m.y) + ", I am on " + character.map + " " + Math.round(character.x) + "," + Math.round(character.y) + ") - going to them", "#CF575F");
    R.escort_hist = (R.escort_hist || []).filter((t) => now() - t < 600000);
    R.escort_hist.push(now());
    const fm = CFG.FARM_MONSTER || (CFG.TARGET_TYPES || [])[0] || "";
    if (R.escort_hist.length >= 2 && fm) {
      (R.avoid = R.avoid || {})[fm] = now() + CFG.DEATH_AVOID_MS;
      R.escort_hist = [];
      say("ESCORT: the party keeps splitting on " + fm + " - skipping it for " + Math.round(CFG.DEATH_AVOID_MS / 60000) + " min", "#CF575F");
      rotate_farm(true);
    }
    R.escort_since = now(); // give them time to settle before looking again
    await travel({ map: m.map, x: Math.round(m.x), y: Math.round(m.y) }, 60000, "to " + m.n);
  }
  // ============================== STEP TABLE (v5) ============================
  // The brain loop (`brain`) is ONE sequential loop that runs every 25-250 ms (the attack cooldown). Each pass runs these steps in
  // this order; the first "gate" step that handles the pass ends it. The order is exactly v4's:
  //   survive > junk destroy > courier trip > need ladder > [housekeeping: loot, party ticks, boss hand-over]
  //   > follower: follow the leader | leader: boss event > monster hunt > farm goal > fight (fallback, always runs)
  // kind "gate": true ends the pass at once (no pause); "gate_wait": true ends it after the usual attack-cooldown pause;
  // "always": runs on every pass it is reached; "end": the fallback (fight).
  // Per step v5 counts how many passes it handled and how long it took, so the status line shows what the loop is really spending
  // its time on (for example whether a hunt or a goal keeps the party away from the bees).
  const STEP = { ctx: {}, tick: 0, started: Date.now(), prev: null, log_at: Date.now(), cur: null, busy: null, busy_at: 0 };
  const STEPS = [];
  const step_add = (s) => (s.n = 0, s.ms = 0, s.err = 0, STEPS.push(s), s);
  step_add({ name: "survive", kind: "gate", run: () => survive() });
  // v5: a dangerous roamer (Green Jr.) close to ANY Ranger: run to town (and from another map's town back to the main map)
  step_add({ name: "boar", kind: "gate", due: () => boar_due(), run: () => boar_step() });
  step_add({ name: "retreat", kind: "gate", due: () => !!R.retreat_go, run: () => retreat_step() });
  step_add({ name: "danger", kind: "gate", due: () => CFG.HUNT_DANGER_TYPES.length > 0 && now() >= (R.danger_next || 0) && !!danger_seen(), run: () => danger_step() });
  step_add({ name: "destroy", kind: "always", run: async () => {
    // junk set to "destroy" never needs the Merchant or a trip
    if (CFG.JUNK_ACTION === "destroy" && now() - (R.destroy_at || 0) > 4000 && free_slots() <= CFG.CLEAN_WHEN_FREE_SLOTS && junk_slots().length >= CFG.SELL_MIN_JUNK) {
      R.destroy_at = now();
      const r = await dump_junk("destroy");
      if (r.done) say("Destroyed " + r.done + " junk item(s); " + free_slots() + " slots free");
    }
    return false;
  } });
  // the leader asked us to be the courier: collect, town trip, hand everything out
  step_add({ name: "courier", kind: "gate", due: () => !!(R.courier && R.courier.phase === "queued"), run: async () => { await run_courier(); return true; } });
  // a need (low potions / full bag) pauses the hunt and runs the ladder
  step_add({ name: "ladder", kind: "gate", due: () => now() >= R.ladder_next && have_need(), run: async () => { await run_ladder(); return true; } });
  step_add({ name: "housekeeping", kind: "always", run: async () => {
    call(() => loot()); // throttled by the game's safeties, unlike raw open_chest
    leader_tick();
    follower_tick();
    await boss_dump_step();
    return false;
  } });
  step_add({ name: "luck", kind: "gate", due: () => luck_due(), run: async () => { await luck_stop(); return true; } });
  step_add({ name: "escort", kind: "gate", due: () => escort_due(), run: async () => { await escort_step(); return true; } });
  step_add({ name: "follower", kind: "gate_wait", due: () => is_follower(), run: () => follower_step() });
  step_add({ name: "boss", kind: "gate_wait", due: () => !is_follower(), run: () => boss_step() });
  // (while a boss event runs and he is in view boss_step returns false so that fight() shoots him; hunts and goals must not take over then)
  // v5: an active hunt that is not being worked on says why (at most once every 2 minutes)
  const hunt_why = (why) => {
    if (!hunt_state() || now() - (R.hunt_why_at || 0) < 120000) return;
    R.hunt_why_at = now();
    const h = hunt_state();
    say("Monster hunt " + h.c + "x " + ((G.monsters[h.id] || {}).name || h.id) + " is active but not being worked on: " + why, "#CF575F");
  };
  step_add({ name: "hunt", kind: "gate_wait", due: () => {
    const f = is_follower(), b = !!R.boss, o = !f && !b && party_bees_only();
    STEP.ctx.hg = !f && !b && !o;
    // v5: bees-only, but everyone has reached PARTY_HUNTS_UNTIL_LEVEL: hunts (easy ones) go on, goals stay off
    const easy = o && CFG.PARTY_HUNTS_UNTIL_LEVEL > 0 && !party_below(CFG.PARTY_HUNTS_UNTIL_LEVEL);
    if (!STEP.ctx.hg && !easy) hunt_why(f ? "I am a follower (the leader does the hunt)" : b ? "a boss event is running" : "party is farming bees only");
    if (now() < (R.boar_until || 0)) return false; // (boars) 10 minutes of bees first
    return STEP.ctx.hg || easy;
  }, run: () => monster_hunt_step() });
  step_add({ name: "goal", kind: "gate_wait", due: () => STEP.ctx.hg && now() >= (R.boar_until || 0), run: () => goal_step() });
  step_add({ name: "fight", kind: "end", run: () => fight() });

  const step_snapshot = () => STEPS.map((s) => [s.n, s.ms]);
  function step_status() {
    const prev = STEP.prev || STEPS.map(() => [0, 0]);
    const cur = step_snapshot();
    const total = cur.reduce((a, c, i) => a + c[0] - prev[i][0], 0) || 1;
    const parts = STEPS.map((s, i) => {
      const dn = cur[i][0] - prev[i][0];
      const dms = cur[i][1] - prev[i][1];
      return s.name + " " + Math.round((100 * dn) / total) + "% x" + dn + (dn ? " (" + Math.round(dms / dn) + "ms)" : "") + (s.err ? " [" + s.err + " errors]" : "");
    });
    const timers = [];
    const t = (label, at) => {
      if (Number.isFinite(at) && at > now()) timers.push(label + " in " + (at - now() < 60000 ? Math.round((at - now()) / 1000) + "s" : Math.round((at - now()) / 60000) + "m"));
    };
    t("ladder", R.ladder_next); t("courier", R.courier_next); t("hunt check", R.mh_check_at); t("goal check", R.goal_check_at);
    t("boss check", R.boss_check_at); t("hunt danger hold", R.danger_until); t("start block", R.start_block_until); t("follow block", R.follow_block_until);
    t("boss hand-over", R.dump_next);
    STEP.prev = cur;
    (PACE.n ? parts.push("paced requests " + PACE.n + " (held back " + Math.round(PACE.held_ms / 1000) + "s)") : 0), say("Loop since last status (" + total + " passes, " + Math.round((Date.now() - STEP.log_at) / 1000) + "s): " + parts.join("; ") + (STEP.busy ? " | now in " + STEP.busy.name + " for " + Math.round((Date.now() - STEP.busy_at) / 1000) + "s" : "") + (timers.length ? " | timers: " + timers.join(", ") : ""), "#8AB4D0");
    STEP.log_at = Date.now();
  }
  // v5: the leader keeps telling the party where he is, also while the loop is busy with a town trip (the Warrior and the Priest need the 'trip' flag and the field position)
  const state_always = setInterval(() => {
    if (!alive()) return clearInterval(state_always);
    try {
      if (is_leader() && CFG.PARTY_MEMBERS.length && now() - R.state_sent_at >= CFG.STATE_EVERY_MS) send_party_state();
    } catch (e) {}
  }, 2000);
  const force_timer = setInterval(() => {
    if (!alive()) return clearInterval(force_timer);
    try { force_tick(); } catch (e) {}
  }, 1500);
  const status_timer = setInterval(() => {
    if (!alive()) return clearInterval(status_timer);
    try {
      if (String(get("ranger_status") || "") === "1") {
        set("ranger_status", "");
        step_status();
      } else if (Date.now() - STEP.log_at >= CFG.RANGER_STATUS_MS) step_status();
    } catch (e) {}
  }, 10000);
  // one pass of the loop; returns "now" (start the next pass at once), "wait" (pause for the attack cooldown first) or "end"
  async function run_steps() {
    STEP.ctx = {};
    STEP.busy = null;
    for (const s of STEPS) {
      if (s.due && !s.due()) continue;
      STEP.cur = s;
      if (s.kind === "end") s.n++; // the fallback is counted when it starts: one fight() call can last a long time
      const t0 = Date.now();
      STEP.busy = s;
      STEP.busy_at = t0;
      const r = await s.run();
      STEP.busy = null;
      s.ms += Date.now() - t0;
      if (s.kind === "always") continue;
      if (s.kind === "end") return "end";
      if (r) { s.n++; return s.kind === "gate" ? "now" : "wait"; }
    }
    return "end";
  }
