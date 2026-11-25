  // ========================== PARTY OF RANGERS ==========================
  // Leader: tells every follower where he is and which monster he is farming; invites them to his party; starts them if they are offline.
  // what the server answered when a character was started (a refusal here is how the running-character limit shows up)
  function start_result(n, r) {
    if (!alive()) return;
    if (r && (r.failed || r.success === false)) {
      if (/character_limit/i.test(JSON.stringify(r))) R.start_block_until = now() + 600000; // the account is at its running-character limit: stop asking for 10 minutes
      say("Could not start " + n + ": " + (r.reason || r.message || JSON.stringify(r.detail || r).slice(0, 160)) + (R.start_block_until > now() ? " (account character limit: not trying again for 10 minutes)" : ""), "#CF575F");
    } else say("Start of " + n + " answered: " + JSON.stringify(r).slice(0, 160), "#51D2E1");
  }
  // Stop code-started characters from the game console of the leader:  set("stop_characters", "followers")  or  set("stop_characters", "SexyLexy,SexyRexy")
  // The leader reads the key once, stops those that are running (stop_character), and clears it so they are not stopped again.
  function stop_requested() {
    let v = "";
    try {
      v = String(get("stop_characters") || "").trim();
    } catch (e) {}
    if (!v) return;
    try {
      set("stop_characters", "");
    } catch (e) {}
    const want = v.toLowerCase() === "followers" ? CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT) : v.split(/[\s,]+/).filter(Boolean);
    let active = {};
    try {
      active = get_active_characters() || {};
    } catch (e) {}
    for (const n of want) {
      if (n === character.name) continue; // never stops himself
      if (!active[n]) {
        say(n + " is not running - nothing to stop", "#E1A951");
        continue;
      }
      say("Stopping " + n + " (stop_characters)", "#E1A951");
      call(() => stop_character(n)).then((r) => {
        if (r && r.failed) say("Could not stop " + n + ": " + (r.reason || JSON.stringify(r.detail || r).slice(0, 120)), "#CF575F");
      });
    }
  }
  // v5: the leader's position / goal message to everybody (also sent while he is away on a courier trip, so the Priest and Warrior follow him to town)
  function send_party_state() {
    R.state_sent_at = now();
    // v5 (Sean 2026-11-18): on a town trip (potions / junk ladder, courier trip of his own) the Warrior and the Priest stay and keep fighting at the last field position instead of following him
    const h = hunt_state();
    const goal = R.boss
      ? R.boss.type
      : R.goal
      ? R.goal.type
      : h && R.mh && R.mh.verdict && R.mh.verdict.ok
      ? h.id
      : null;
    // (Sean 2026-11-18) ...but once the leader has taken a hunt / goal / boss (or a forced farm) on the way, there is nothing to wait for at the old spot: the party follows him to it
    const trip = !!(R.ladder || R.trip) && !goal && !R.force;
    if (!trip && !character.rip) R.field = { map: character.map, x: Math.round(character.x), y: Math.round(character.y) };
    const farm = R.field || { map: CFG.FARM_SPOT.map, x: CFG.FARM_SPOT.x, y: CFG.FARM_SPOT.y };
      for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT))
        if (n !== character.name)
          call(() =>
            send_cm(n, {
              type: "party_state",
              map: character.map,
              x: Math.round(character.x),
              y: Math.round(character.y),
              goal,
              trip,
              farm,
              bees: !!R.bees_only,
              force: R.force ? R.force.type : null,
              visit: !!(R.force && R.force.visit),
              wiggle: !!R.wiggle,
              types: goal || (R.force && R.force.visit) ? [] : (CFG.TARGET_TYPES || []).slice(0, 5), // what the Warrior may pull when nothing is fighting yet
            })
          );
  }
  function leader_tick() {
    if (!is_leader() || !CFG.PARTY_MEMBERS.length) return;
    stop_requested();
    courier_check();
    if (now() - R.state_sent_at >= CFG.STATE_EVERY_MS) send_party_state();
    if (now() - R.party_invite_at >= 20000) {
      R.party_invite_at = now();
      for (const n of CFG.PARTY_MEMBERS) {
        if (n === character.name) continue;
        try {
          if (
            CFG.PARTY_START_MEMBERS &&
            now() >= (R.start_block_until || 0) &&
            !get_active_characters()[n] &&
            CFG.SELF_CODE_SLOT
          ) {
            say("Starting " + n + "...");
            call_paced("start", () => start_character(n, CFG.SELF_CODE_SLOT)).then((r) => start_result(n, r));
          }
        } catch (e) {}
      }
      for (const n of CFG.PARTY_SUPPORT) {
        if (n === character.name) continue;
        try {
          if (
            CFG.PARTY_START_MEMBERS &&
            now() >= (R.start_block_until || 0) &&
            !get_active_characters()[n] &&
            (CFG.PARTY_SUPPORT_SLOTS[n] || CFG.PRIEST_CODE_SLOT)
          ) {
            say(
              "Starting " +
                n +
                " (support, code slot " +
                (CFG.PARTY_SUPPORT_SLOTS[n] || CFG.PRIEST_CODE_SLOT) +
                ")..."
            );
            call_paced("start", () => start_character(n, CFG.PARTY_SUPPORT_SLOTS[n] || CFG.PRIEST_CODE_SLOT)).then((r) => start_result(n, r));
          }
        } catch (e) {}
      }
    }
  }