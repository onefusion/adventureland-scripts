  // ========================== MONSTER HUNTS =======================
  // Daisy (main town) hands out a hunt: kill N of one monster type before time runs out.
  // Flow: ask Daisy -> judge the hunt -> go to the monster's spawn and kill them -> turn in -> repeat.
  // A hunt judged too hard / too slow is simply left to expire while he farms as usual.
  // v5: the hunt difficulty limit; while the party is in bees-only mode (only hunts, not goals, are let through) the lower BEES_ONLY limit applies
  const hunt_max_diff = () => (R.bees_only ? Math.min(CFG.HUNT_MAX_DIFFICULTY, CFG.HUNT_MAX_DIFFICULTY_BEES_ONLY) : CFG.HUNT_MAX_DIFFICULTY);
  const hunts_on = () => {
    if (!CFG.HUNT_ENABLED) return false;
    try {
      const v = String(get("monster_hunts") || "").toLowerCase();
      if (v === "off" || v === "none" || v === "false" || v === "0")
        return false;
    } catch (e) {}
    return true;
  };
  function hunt_state() {
    const h = character.s && character.s.monsterhunt;
    return h && h.id ? h : null;
  }

  // Nearest normal spawn of a monster type (skips instances / ignored maps, like smart_move does)
  function nearest_spawn(type, bad, skip) {
    let best = null;
    for (const map in G.maps) {
      const m = G.maps[map];
      if (!m || m.ignore || m.instance || !m.monsters) continue;
      for (const pack of m.monsters) {
        if (pack.type !== type) continue;
        const boxes = pack.boundaries
          ? pack.boundaries
          : pack.boundary
          ? [[map].concat(pack.boundary)]
          : [];
        for (const b of boxes) {
          const bm = b[0];
          const gm = G.maps[bm];
          if (!gm || gm.ignore || gm.instance) continue;
          if (skip && !CFG.GOAL_SWEEP_OTHER_MAPS && bm !== map) continue; // sweeping: stay on the spawn entry's own map
          const c = {
            map: bm,
            x: (b[1] + b[3]) / 2,
            y: (b[2] + b[4]) / 2,
            box: b,
          };
          if (bad && bad[bm + ":" + b.slice(1).join(",")]) continue; // a box we could not reach
          if (skip && skip[bm + ":" + b.slice(1).join(",")]) continue; // a box already searched in this sweep
          const score =
            (bm === character.map ? 0 : 1e6) +
            (bm === character.map ? d2(character, c) : 0);
          if (!best || score < best.score) best = { dest: c, score };
        }
      }
    }
    return best && best.dest;
  }

  // how many spawn areas a monster has (only the ones a sweep would visit)
  function spawn_area_count(type) {
    let n = 0;
    for (const map in G.maps) {
      const m = G.maps[map];
      if (!m || m.ignore || m.instance || !m.monsters) continue;
      for (const pack of m.monsters) {
        if (pack.type !== type) continue;
        const boxes = pack.boundaries ? pack.boundaries : pack.boundary ? [[map].concat(pack.boundary)] : [];
        for (const b of boxes) {
          const gm = G.maps[b[0]];
          if (!gm || gm.ignore || gm.instance) continue;
          if (!CFG.GOAL_SWEEP_OTHER_MAPS && b[0] !== map) continue;
          n++;
        }
      }
    }
    return n;
  }
  // dangerous roaming monsters (HUNT_DANGER_TYPES): one in view close to me, or the server reports one near a spot
  function danger_seen() {
    for (const id in parent.entities) {
      const e = parent.entities[id];
      if (e && e.type === "monster" && e.visible && !e.dead && CFG.HUNT_DANGER_TYPES.indexOf(e.mtype) !== -1 && d2(character, e) <= CFG.HUNT_DANGER_RADIUS) return e;
    }
    return null;
  }
  // v5: a danger run applies to EVERY Ranger (leader and followers). `town` from another map only goes to THAT map's town (the
  // Halloween Town for the Phoenix areas), so from there he walks to the portal NPC and takes it back to the main map.
  async function return_to_main() {
    if (character.map === "main") return true;
    const from = character.map;
    let npc = null;
    try {
      npc = find_npc("transporter");
    } catch (e) {}
    if (npc && npc.map === character.map) {
      const r = await travel({ map: npc.map, x: npc.x, y: npc.y }, 60000, "portal NPC in " + from + " (back to the main map)");
      if (r.failed) say("Could not reach the portal NPC in " + from + ": " + r.reason, "#CF575F");
      else {
        const places = (G.npcs && G.npcs.transporter && G.npcs.transporter.places) || {};
        if (places.main !== undefined) {
          await call(() => parent.socket.emit("transport", { to: "main", s: places.main }));
          const ok = await call(() => wait_for(() => character.map === "main", 8000));
          if (!ok.failed) {
            say("Took the portal from " + from + " to the main map", "#5BCB5B");
            return true;
          }
          say("The portal did not take me to the main map - trying a normal walk", "#CF575F");
        }
      }
    }
    const r = await travel(CFG.SAFE_SPOT, 150000, "back to the main map");
    if (r.failed || character.map !== "main") {
      say("Could not get back to the main map from " + from + ": " + (r.reason || "wrong map"), "#CF575F");
      return false;
    }
    return true;
  }
  // v5 (Sean 2026-11-18): Wild Boars in Winterland. Whoever sees one target a party member leaves (and tells the leader); the leader pulls everybody out, pauses the forced farm,
  // and for BOAR_HOLD_MS the party only farms the normal bees (hunts, goals and the forced farm wait).
  function boar_seen() {
    if (!CFG.BOAR_FLEE || CFG.BOAR_MAPS.indexOf(character.map) === -1) return null;
    const names = party_names().concat([character.name]);
    for (const id in parent.entities) {
      const e = parent.entities[id];
      if (e && e.type === "monster" && !e.dead && !e.rip && e.visible !== false && CFG.BOAR_TYPES.indexOf(e.mtype) !== -1 && names.indexOf(e.target) !== -1) return e;
    }
    return null;
  }
  const boar_due = () => CFG.BOAR_FLEE && now() >= (R.boar_next || 0) && CFG.BOAR_MAPS.indexOf(character.map) !== -1 && (!!boar_seen() || now() - (R.boar_cm || 0) < 30000);
  async function boar_step() {
    const b = boar_seen();
    const told = !b && now() - (R.boar_cm || 0) < 30000;
    R.boar_cm = 0;
    R.boar_until = now() + CFG.BOAR_HOLD_MS;
    R.danger_until = Math.max(R.danger_until || 0, R.boar_until);
    R.boar_next = now() + 5000;
    R.lock = null;
    say("BOAR: " + (b ? ((G.monsters[b.mtype] || {}).name || b.mtype) + " is on " + b.target : "the " + (is_leader() ? "party" : "leader") + " reports one") + " - leaving " + character.map + " for the main map; the party farms the normal bees for " + Math.round(CFG.BOAR_HOLD_MS / 60000) + " min", "#CF575F");
    if (is_leader()) {
      if (R.force) { R.force_resumed = R.force.type; force_restore(); } // (force_poll puts it back once the hold is over)
      R.state_sent_at = 0;
      for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) if (n !== character.name) call(() => send_cm(n, { type: "boar_flee" }));
    } else if (b) call(() => send_cm(CFG.PARTY_LEADER, { type: "boar_alert" }));
    await use_town();
    if (character.map !== "main") await return_to_main();
    return true;
  }
  async function danger_step() {
    const dz = danger_seen();
    if (!dz) return false;
    R.danger_until = now() + CFG.HUNT_DANGER_HOLD_MS;
    say("DANGER: " + ((G.monsters[dz.mtype] || {}).name || dz.mtype) + " is close (" + Math.round(d2(character, dz)) + " px) - retreating to town" + (is_follower() ? ", staying back for " + Math.round(CFG.HUNT_DANGER_FOLLOW_HOLD_MS / 1000) + " s" : ", no hunts for " + Math.round(CFG.HUNT_DANGER_HOLD_MS / 60000) + " min"), "#CF575F");
    R.lock = null;
    if (is_follower()) R.follow_block_until = now() + CFG.HUNT_DANGER_FOLLOW_HOLD_MS;
    await use_town();
    if (character.map !== "main") await return_to_main();
    R.danger_next = now() + 3000;
    return true;
  }
  function danger_server(spot) {
    for (const t of CFG.HUNT_DANGER_TYPES) {
      const sb = server_boss(t);
      if (sb && sb.map === spot.map && Number.isFinite(Number(sb.x)) && d2({ x: Number(sb.x), y: Number(sb.y) }, spot) <= CFG.HUNT_DANGER_SPOT_RADIUS) return t;
    }
    return null;
  }

  // Can I finish this hunt? Returns {ok, why, difficulty, est_s}
  function assess_hunt(h) {
    const def = G.monsters[h.id];
    if (!def) return { ok: false, why: "unknown monster type " + h.id };
    const name = def.name || h.id;
    if (CFG.HUNT_AVOID_TYPES.indexOf(h.id) !== -1)
      return { ok: false, why: name + " is on the avoid list" };
    if (def.hp > CFG.HUNT_MAX_MONSTER_HP)
      return {
        ok: false,
        why:
          name +
          " has " +
          def.hp +
          " HP (limit " +
          CFG.HUNT_MAX_MONSTER_HP +
          ")",
      };
    const spawn = nearest_spawn(h.id);
    if (!spawn)
      return { ok: false, why: name + " has no regular spawn I can walk to" };
    const difficulty = difficulty_of({
      attack: def.attack,
      frequency: def.frequency,
      hp: def.hp,
    });
    if (difficulty > hunt_max_diff())
      return {
        ok: false,
        difficulty,
        why:
          name +
          " is too dangerous (difficulty " +
          difficulty +
          ", limit " +
          hunt_max_diff() +
          ")",
      };
    const dps = Math.max(
      1,
      character.attack * character.frequency * CFG.HUNT_EFFICIENCY
    );
    const count = Math.max(0, +h.c || 0);
    const est_s = Math.round((count * def.hp) / dps + CFG.HUNT_TRAVEL_BUFFER_S);
    const left_s =
      h.ms !== undefined && isFinite(+h.ms) ? Math.round(+h.ms / 1000) : null;
    if (left_s !== null && est_s > left_s)
      return {
        ok: false,
        difficulty,
        est_s,
        why:
          count +
          "x " +
          name +
          " needs ~" +
          est_s +
          "s but only " +
          left_s +
          "s are left",
      };
    return { ok: true, difficulty, est_s, why: "doable" };
  }

  // Between hunts he farms normally. Stored with set() so a restart does not skip the wait.
  function start_cooldown() {
    R.mh = null;
    rotate_farm();
    R.mh_check_at = now() + CFG.HUNT_COOLDOWN_MS;
    try {
      set("hunt_next_at", R.mh_check_at);
    } catch (e) {}
    say(
      "Next monster hunt in " +
        Math.round(CFG.HUNT_COOLDOWN_MS / 60000) +
        " min - farming meanwhile",
      "#51D2E1"
    );
  }

  async function visit_daisy(why) {
    const npc = (() => {
      try {
        return find_npc(CFG.HUNT_NPC);
      } catch (e) {
        return null;
      }
    })();
    const dest =
      npc && npc.x !== undefined
        ? { map: npc.map || "main", x: npc.x, y: npc.y }
        : CFG.HUNT_NPC_FALLBACK;
    if (character.map !== dest.map || d2(character, dest) > 80) {
      const r = await travel(dest, 120000, why);
      if (r.failed) {
        say("Could not reach Daisy (" + (r.reason || "?") + ")", "#CF575F");
        return { failed: true };
      }
    }
    return call(() => interact("monsterhunt"));
  }

  async function monster_hunt_step() {
    if (!hunts_on()) return false;
    const h = hunt_state();

    // noticed the end of a hunt (done, expired or abandoned)
    if (!h && R.mh) {
      say("Monster hunt ended: " + R.mh.name, "#51D2E1");
      R.mh = null;
      start_cooldown();
    }

    // just (re)started: look at the character's state first. An unfinished hunt is resumed, never replaced.
    if (!R.hunt_checked) {
      if (!character.s || now() - R.started_at < CFG.HUNT_STARTUP_WAIT_MS)
        return false; // state may not have arrived yet
      R.hunt_checked = true;
      say(
        h
          ? "Found an unfinished monster hunt: " +
              h.c +
              "x " +
              ((G.monsters[h.id] || {}).name || h.id) +
              (h.ms !== undefined && isFinite(+h.ms)
                ? ", " + Math.round(+h.ms / 60000) + " min left"
                : "") +
              " - resuming it"
          : "No active monster hunt",
        "#51D2E1"
      );
    }

    // --- no hunt: ask Daisy for one ---
    if (!h) {
      if (now() < R.mh_check_at) return false;
      const res = await visit_daisy("asking Daisy for a monster hunt");
      if (res.completed) {
        say("Monster hunt completed - reward collected!", "#5BCB5B");
        start_cooldown();
      } else if (res.started || hunt_state()) {
        R.mh_check_at = now() + 2000;
      } else {
        say(
          "Daisy had no hunt for me (" +
            (res.reason || "no answer") +
            ") - trying again later",
          "#CF575F"
        );
        R.mh_check_at = now() + CFG.HUNT_RETRY_MS;
      }
      return true;
    }

    // --- a hunt is active: judge it once per hunt ---
    if (!R.mh || R.mh.id !== h.id) {
      const def = G.monsters[h.id] || {};
      const verdict = assess_hunt(h);
      R.mh = {
        id: h.id,
        name: def.name || h.id,
        verdict,
        heading: null,
        move_at: 0,
        patrol_at: 0,
        busy: false,
        fails: 0,
        bad: {},
        box_fails: 0,
      };
      say(
        "Monster hunt: " +
          h.c +
          "x " +
          R.mh.name +
          " - " +
          (verdict.ok
            ? "taking it (difficulty " +
              verdict.difficulty +
              ", ~" +
              verdict.est_s +
              "s)"
            : "skipping, " + verdict.why),
        verdict.ok ? "#5BCB5B" : "#CF575F"
      );
    }
    if (!R.mh.verdict.ok) { hunt_why("judged not doable: " + R.mh.verdict.why); return false; } // leave it to expire, keep farming

    // all killed: hand it in
    if (+h.c <= 0) {
      const res = await visit_daisy("turning in the monster hunt");
      if (res.completed)
        say("Monster hunt completed - reward collected!", "#5BCB5B");
      else if (!res.failed)
        say("Turn-in answered: " + JSON.stringify(res), "#CF575F");
      start_cooldown();
      if (res.failed) await wait(3000);
      return true;
    }

    // dangerous roamers (Green Jr.): never walk into one, run when one is close, hold hunts for a while afterwards
    if (CFG.HUNT_DANGER_TYPES.length) {
      const dz = danger_seen();
      if (dz) {
        R.danger_until = now() + CFG.HUNT_DANGER_HOLD_MS;
        say("DANGER: " + ((G.monsters[dz.mtype] || {}).name || dz.mtype) + " is close (" + Math.round(d2(character, dz)) + " px) - retreating to town, no hunts for " + Math.round(CFG.HUNT_DANGER_HOLD_MS / 60000) + " min", "#CF575F");
        R.lock = null;
        await use_town();
        return true;
      }
      if (now() < (R.danger_until || 0)) { hunt_why("danger hold for another " + Math.round((R.danger_until - now()) / 60000) + " min"); return false; } // farm the bees meanwhile
      const sp0 = nearest_spawn(h.id, R.mh.bad);
      const dt = sp0 && danger_server(sp0);
      if (dt) {
        if (now() - (R.danger_log || 0) > 120000) {
          R.danger_log = now();
          say("Monster hunt on hold: " + ((G.monsters[dt] || {}).name || dt) + " is near the " + R.mh.name + " spawn - farming until he is gone", "#CF575F");
        }
        return false;
      }
    }

    // the stored stats can understate a monster: judge the real ones the moment they are in view
    // (only while healthy - the rating drops as our HP drops)
    const seen = priority_targets().filter(is_hunt_monster);
    if (seen.length && character.hp >= character.max_hp * 0.7) {
      const worst = Math.max.apply(null, seen.map(difficulty_of));
      if (worst > hunt_max_diff()) {
        R.mh.verdict = {
          ok: false,
          why:
            R.mh.name +
            " is rated " +
            (worst >= 2 ? "hard" : "difficulty " + worst) +
            " up close",
        };
        R.lock = null;
        say(
          "Monster hunt skipped: " + R.mh.verdict.why + " - back to farming",
          "#CF575F"
        );
        return false;
      }
    }

    // targets in view: normal combat handles them (they are priority targets)
    if (priority_targets().some(is_hunt_monster)) {
      R.mh.last_seen = now();
      R.mh.heading = null;
      return false;
    }

    // not in view: go to the spawn, then patrol its area.
    // Never interrupt a walk or a path search in progress (smart_move restarts the search every time it is called).
    if (party_fight_pause(R.mh)) return false; // a party member is under attack: combat helps first
    if (R.mh.busy || smart.moving || is_moving(character)) return true;
    const spawn = nearest_spawn(h.id, R.mh.bad);
    if (!spawn) {
      R.mh.verdict = {
        ok: false,
        why: "no reachable " + R.mh.name + " spawn left",
      };
      say("Monster hunt abandoned: " + R.mh.verdict.why, "#CF575F");
      return false;
    }
    const near =
      character.map === spawn.map &&
      d2(character, spawn) <= CFG.HUNT_ARRIVE_RADIUS;
    let dest = spawn;
    if (near) {
      if (now() - R.mh.patrol_at < 6000) return true;
      R.mh.patrol_at = now();
    }
    if (near || R.mh.box_fails > 0) {
      // patrol inside the box (or, after a failed walk, try another point of it instead of the centre)
      const bx = spawn.box;
      dest = {
        map: spawn.map,
        x: bx[1] + Math.random() * (bx[3] - bx[1]),
        y: bx[2] + Math.random() * (bx[4] - bx[2]),
      };
      log_move(dest, "searching for " + R.mh.name);
    } else {
      log_move(dest, "heading to " + R.mh.name + " for the monster hunt");
    }
    R.mh.heading = dest;
    R.mh.move_at = now();
    R.mh.busy = true;
    const mh = R.mh;
    mh.aborted = false;
    call(() => smart_move(dest)).then((r) => {
      mh.busy = false;
      if (mh.aborted) return void (mh.aborted = false); // cancelled by a party fight, not a path failure
      if (r.failed || r.success === false) {
        mh.fails++;
        mh.box_fails++;
        say(
          "Could not walk to " +
            describe_dest(dest) +
            " (" +
            (r.reason || "no path") +
            ") - failure " +
            mh.fails +
            "/" +
            CFG.HUNT_MAX_PATH_FAILS,
          "#CF575F"
        );
        if (mh.box_fails >= 2) {
          // this spawn box looks unreachable: remember it and try the next one
          mh.bad[spawn.map + ":" + spawn.box.slice(1).join(",")] = true;
          mh.box_fails = 0;
        }
        if (mh.fails >= CFG.HUNT_MAX_PATH_FAILS) {
          mh.verdict = { ok: false, why: "no path to " + mh.name };
          say(
            "Monster hunt abandoned: could not find a path to " +
              mh.name +
              " - farming instead",
            "#CF575F"
          );
        }
      } else {
        mh.fails = 0;
        mh.box_fails = 0;
      }
    });
    return true;
  }

  // v5 (Sean 2026-11-18 16:51): the "Boss events" button became a FARM button: one button, click = type a monster name and the group farms it (the forced farm, same as
  // set("force_farm", "<monster>")); click again = stop. It only replaces the baseline farm, so the Grinch event, boss events, Daisy hunts and goals still take priority and the farm resumes after them.
  // Boss events can still be switched off / on from the console: set("boss_events", "off") / set("boss_events", "")
  const monster_key = (txt) => {
    const t = String(txt || "").trim().toLowerCase();
    if (!t) return null;
    if (G.monsters[t]) return t;
    const keys = Object.keys(G.monsters);
    const exact = keys.filter((k) => String(G.monsters[k].name || "").toLowerCase() === t);
    if (exact.length) return exact[0];
    const part = keys.filter((k) => String(G.monsters[k].name || "").toLowerCase().indexOf(t) !== -1);
    return part.length === 1 ? part[0] : null;
  };
  function try_button_refresh(force) {
    try {
      if (typeof add_top_button !== "function" || !is_leader()) return;
      const on = !!(R.force && R.force.trial);
      const label = on ? "Trying: " + ((G.monsters[R.force.type] || {}).name || R.force.type) + " (stop)" : "Try monster";
      if (!force && R.try_label === label) return;
      R.try_label = label;
      add_top_button("al_try_monster", label, () => {
        if (!alive()) return;
        if (R.force && R.force.trial) { trial_end(null, "stopped by hand", ""); return; }
        let ans = null;
        try { ans = typeof prompt === "function" ? prompt("Monster to TRY (one single-target fight; name or game id, e.g. Fire Spirit or fireroamer):", "") : parent.prompt("Monster to TRY (one single-target fight; name or game id)", ""); } catch (e) {}
        if (ans === null || ans === undefined || !String(ans).trim()) return say("Try button: no monster entered", "#E0A040");
        const key = monster_key(ans);
        if (!key) return say("Try button: '" + String(ans).trim() + "' is not a monster name or id in the game data (or the name matches several)", "#CF575F");
        try { set("try_monster", key); } catch (e) {}
        R.force_check_at = 0;
        say("Try button: the group goes to try one " + ((G.monsters[key] || {}).name || key) + " (click again to stop)", "#E0A040");
      });
    } catch (e) {}
  }
  // Sean 2026-11-25: "Pink Goblins" button: the group walks to the Pink Goblin spawn and stands there; nobody shoots one unless it attacks the party first (the Priest keeps everybody alive); click again to leave
  const VISIT_MONSTER = "pinkgoblin";
  function visit_button_refresh(force) {
    try {
      if (typeof add_top_button !== "function" || !is_leader()) return;
      const on = !!(R.force && R.force.visit);
      const label = on ? "Visiting: " + ((G.monsters[R.force.type] || {}).name || R.force.type) + " (stop)" : "Pink Goblins";
      if (!force && R.visit_label === label) return;
      R.visit_label = label;
      add_top_button("al_visit_pink", label, () => {
        if (!alive()) return;
        if (R.force && R.force.visit) {
          force_restore();
          R.force_check_at = 0;
          say("Visit button: visit ended - back to the normal farm", "#E0A040");
          return;
        }
        if (R.force) return say("Visit button: a forced farm / trial is running - stop it first", "#CF575F");
        force_apply(VISIT_MONSTER, false, true);
        R.force_check_at = 0;
        visit_button_refresh(false);
      });
    } catch (e) {}
  }
  function farm_button_refresh(force) {
    try {
      if (typeof add_top_button !== "function" || !is_leader()) return;
      const label = R.force ? "Farm: " + ((G.monsters[R.force.type] || {}).name || R.force.type) + " (stop)" : "Farm monster";
      if (!force && R.farm_label === label) return;
      R.farm_label = label;
      add_top_button("al_farm_monster", label, () => {
        if (!alive()) return;
        if (R.force) {
          try { set("force_farm", ""); } catch (e) {}
          R.force_check_at = 0;
          say("Farm button: forced farm stopped", "#E0A040");
          return;
        }
        let ans = null;
        try { ans = typeof prompt === "function" ? prompt("Monster for the group to farm (name or game id, e.g. Fire Spirit or fireroamer):", "") : parent.prompt("Monster for the group to farm (name or game id):", ""); } catch (e) { try { ans = parent.prompt("Monster for the group to farm (name or game id):", ""); } catch (e2) {} }
        if (ans === null || ans === undefined || !String(ans).trim()) return say("Farm button: no monster entered", "#E0A040");
        const key = monster_key(ans);
        if (!key) return say("Farm button: '" + String(ans).trim() + "' is not a monster name or id in the game data (or the name matches several)", "#CF575F");
        try { set("force_farm", key); } catch (e) {}
        R.force_check_at = 0;
        say("Farm button: the group goes to farm " + ((G.monsters[key] || {}).name || key) + " (Grinch, boss events, hunts and goals still come first; click again to stop)", "#E0A040");
      });
    } catch (e) {}
  }
  // Buttons on the leader's game window (the same switches as the console commands set("boss_force", ...) / set("boss_events", ...)):
  //   "Grinch"        = start the Grinch event now (the party goes to the post and waits for him)
  //   "Farm monster"  = type a monster name: the group farms it (forced farm); click again to stop (see farm_button_refresh)
  function add_boss_buttons() {
    try {
      if (typeof add_top_button !== "function" || !is_leader()) return;
      add_top_button("al_boss_grinch", "Grinch", () => {
        if (!alive()) return;
        try {
          set("boss_force", "grinch");
        } catch (e) {}
        say("Grinch button: starting the Grinch event (the party goes to the post)", "#E0A040");
      });
      farm_button_refresh(true);
      try_button_refresh(true);
      visit_button_refresh(true);
    } catch (e) {}
  }
