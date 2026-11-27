  // ============================== FEAR, DEATH POST-MORTEM, DEATH CIRCUIT-BREAKER (2026-11-27) ==============================
  // Sean 2026-11-27: fear-aware targeting and a death circuit-breaker. AL.safety (lib/safety.js) does the counting and is unit-tested; this is the Ranger's part.
  // - FEAR: more monsters on a character than its courage (Ranger 2) = damage x0.6 / x0.4 / x0.2 and slower (stock rule). Every Ranger counts the monsters that target him
  //   every 2 s and prints "FEAR: ..." when it starts, every 30 s while it lasts and when it ends (with the worst count). While more than FEAR_BLOCK_MULTISHOT_AT monsters are on him
  //   3shot/5shot are not used (they pull 3-5 more), and while he is over his courage he shoots the weakest monster that is on him first (the pressure drops soonest);
  //   the Warrior's focus target and boss / priority targets still come first.
  // - POST-MORTEM: the leader prints a "DEAD: ..." line for every death: where, what the party was doing, how many monsters were on the dead one and his HP in the last seconds.
  // - BREAKER: BREAKER_MAX_INCIDENTS death incidents (a wipe is one) inside BREAKER_WINDOW_MS (boss-event and forced-farm deaths do not count) start SAFE MODE for BREAKER_HOLD_MS:
  //   no hunts, no farm goals, the base farm moves to the rotation monster with the fewest recorded deaths and stays there. Boss events (the Grinch) are unchanged.
  //   By hand (leader's console):  set("safe_mode", "45")  starts it for 45 minutes (empty / a number),  set("safe_mode", "off")  ends it.
  const SAFETY = AL.safety;
  R.fear = {}; // fear tracker state (AL.safety.fear_note)
  R.snaps = {}; // party member -> the last few pressure snapshots {t, hp, on, types} (the post-mortem reads them)
  R.safe_until = +(function () { try { return get("safe_until"); } catch (e) { return 0; } })() || 0;
  R.safe_trip_at = +(function () { try { return get("safe_trip_at"); } catch (e) { return 0; } })() || 0;
  const safe_mode = () => now() < (R.safe_until || 0);
  function fear_now() {
    if (!CFG.FEAR_AWARE) return null;
    try {
      return SAFETY.pressure(parent.entities, character.name, G, character);
    } catch (e) {
      return null;
    }
  }
  // every 2 s: my own pressure (printed when it changes) and, for the leader, a snapshot of every party member in view
  const snap_timer = setInterval(() => {
    if (!alive()) return clearInterval(snap_timer);
    try {
      const t = now();
      const mine = fear_now();
      if (mine) for (const line of SAFETY.fear_note(R.fear, mine, t)) say(line, "#CF575F");
      if (!is_leader()) return;
      const names = party_names().concat(character.name).filter((n, i, a) => n && a.indexOf(n) === i);
      for (const n of names) {
        const ch = n === character.name ? character : parent.entities[n];
        if (!ch || !ch.max_hp) continue;
        const p = n === character.name && mine ? mine : SAFETY.pressure(parent.entities, n, G, ch);
        SAFETY.snap_push(R.snaps, n, { t, hp: ch.hp / ch.max_hp, on: p.n_phys + p.n_mag, types: SAFETY.types_text(p.types) });
      }
    } catch (e) {}
  }, 2000);
  const death_log = () => {
    try {
      const v = JSON.parse(get("death_log") || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  };
  const death_ctx = () => (R.boss || grinch_fight() ? "boss" : R.force ? "forced farm" : R.goal ? "goal" : R.mh ? "hunt" : "farm");
  // leader: log the death, print the post-mortem; returns { b, log } when this death trips the breaker (applied by death_note after its own retreat is set up)
  function death_mark(name) {
    if (!is_leader()) return null;
    const t = now();
    const ch = name === character.name ? character : parent.entities[name];
    const ctx = death_ctx();
    const farm = ctx === "farm" ? CFG.FARM_MONSTER || "" : "";
    const counted = ctx === "farm" || ctx === "goal" || ctx === "hunt";
    const rec = SAFETY.record(death_log(), { t, name, ctx, farm, counted }, 30);
    if (!rec.added) return null; // the same death was already noted (the notice arrives from several places)
    try { set("death_log", JSON.stringify(rec.log)); } catch (e) {}
    const where = ch && ch.map ? ch.map + " " + Math.round(ch.x) + "," + Math.round(ch.y) : "";
    say(SAFETY.post_mortem(R.snaps, name, { where, ctx, farm }, t), "#CF575F");
    if (!CFG.BREAKER_ENABLED || safe_mode() || !counted) return null;
    const b = SAFETY.breaker(rec.log, t, { window_ms: CFG.BREAKER_WINDOW_MS, max_incidents: CFG.BREAKER_MAX_INCIDENTS, cluster_ms: CFG.BREAKER_CLUSTER_MS, since: R.safe_trip_at });
    return b.tripped ? { b, log: rec.log } : null;
  }
  function safe_trip(b, log, minutes, why) {
    const t = now();
    const hold = minutes ? minutes * 60000 : CFG.BREAKER_HOLD_MS;
    R.safe_until = t + hold;
    R.safe_trip_at = t;
    try { set("safe_until", R.safe_until); set("safe_trip_at", t); } catch (e) {}
    if (R.goal) end_goal("safe mode", hold);
    if (CFG.FARM_ROTATION.length && !R.force) {
      const n = CFG.FARM_ROTATION.length;
      const fm = SAFETY.safest(CFG.FARM_ROTATION, log || death_log(), t, CFG.BREAKER_WINDOW_MS, (x) => farm_avoided(x) || boar_held_farm(x));
      if (fm && fm !== CFG.FARM_MONSTER) {
        rot_idx();
        R.rot_idx = (CFG.FARM_ROTATION.indexOf(fm) - 1 + n) % n; // rotate_farm steps one forward: onto fm
        rotate_farm(true);
      }
    }
    const farm = CFG.FARM_MONSTER ? (G.monsters[CFG.FARM_MONSTER] || {}).name || CFG.FARM_MONSTER : "the current farm";
    say("CIRCUIT BREAKER: " + (why || b.incidents + " death incidents (" + b.deaths + " deaths: " + b.who.join(", ") + ") in the last " + Math.round(CFG.BREAKER_WINDOW_MS / 60000) + " min") + " - SAFE MODE for " + Math.round(hold / 60000) + " min: no hunts, no farm goals, farming " + farm + "; boss events unchanged. set(\"safe_mode\", \"off\") ends it.", "#CF575F");
  }
  // the old death_note (retreat to town, skip the monster) is death_note_core in 08; this wraps it with the post-mortem and the breaker
  function death_note(name) {
    let trip = null;
    try { trip = death_mark(name); } catch (e) { say("ERROR death post-mortem: " + ((e && e.message) || e), "#CF575F"); }
    try {
      death_note_core(name);
    } finally {
      if (trip) {
        try { safe_trip(trip.b, trip.log); } catch (e) { say("ERROR circuit breaker: " + ((e && e.message) || e), "#CF575F"); }
      }
    }
  }
  // every 5 s: the hand switch, and the end of safe mode
  const safe_timer = setInterval(() => {
    if (!alive()) return clearInterval(safe_timer);
    try {
      if (is_leader()) {
        const raw = get("safe_mode");
        const cmd = raw ? String(raw).trim().toLowerCase() : "";
        if (cmd) {
          set("safe_mode", "");
          if (cmd === "off" || cmd === "0") {
            if (safe_mode()) {
              R.safe_until = 0;
              set("safe_until", 0);
              say("SAFE MODE ended by hand - hunts and goals resume", "#5BCB5B");
            }
          } else {
            const m = Number(cmd);
            safe_trip({ incidents: 0, deaths: 0, who: [] }, null, m > 0 ? m : 0, "started by hand");
          }
        }
      }
      if (R.safe_until && now() >= R.safe_until) {
        R.safe_until = 0;
        try { set("safe_until", 0); } catch (e) {}
        if (is_leader()) say("SAFE MODE over - hunts and goals resume", "#5BCB5B");
      }
    } catch (e) {}
  }, 5000);
