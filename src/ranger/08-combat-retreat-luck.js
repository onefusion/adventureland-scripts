  // ============================== COMBAT ==========================
  // The game colours a monster's HP bar with calculate_difficulty():
  // 0 = easy (green), 1 = medium (orange), 2 = hard (red). We ask the game itself and
  // fall back to a copy of its formula if that function is not reachable.
  function difficulty_of(m) {
    try {
      if (typeof parent.calculate_difficulty === "function")
        return parent.calculate_difficulty(m);
    } catch (e) {}
    const c = parent.character || character;
    const mdps = m.attack * m.frequency;
    const dps = c.attack * c.frequency;
    let hp = c.hp;
    let mhp = m.hp;
    for (let i = 0; i < 30; i++) {
      hp -= mdps * 2;
      mhp -= dps * 2;
      hp += 400;
      if (hp < 0 || mhp < 0) break;
    }
    if (hp < 0) return 2;
    if (c.hp - hp > c.max_hp * 0.3) return 1;
    return 0;
  }

  function is_ignored(e) {
    if (CFG.IGNORE_TYPES.indexOf(e.mtype) !== -1) return true;
    const def = G.monsters[e.mtype];
    return !!def && CFG.IGNORE_NAMES.indexOf(def.name) !== -1;
  }
  const is_hunt_monster = (e) => {
    const h = hunt_state();
    return (
      !!h &&
      !!R.mh &&
      !!R.mh.verdict &&
      R.mh.verdict.ok &&
      R.mh.id === h.id &&
      e.mtype === h.id
    );
  };
  const is_leader = () =>
    !CFG.PARTY_MEMBERS.length || character.name === CFG.PARTY_LEADER;
  const is_follower = () =>
    CFG.PARTY_MEMBERS.length > 0 &&
    character.name !== CFG.PARTY_LEADER &&
    CFG.PARTY_MEMBERS.indexOf(character.name) !== -1;
  const party_names = () => [CFG.PARTY_LEADER].concat(CFG.PARTY_MEMBERS, CFG.PARTY_SUPPORT);
  // the leader's last news, only while it is fresh
  const leader_state = () =>
    is_follower() &&
    R.leader &&
    now() - R.leader.at < (CFG.BOSS_EVENTS.some((b) => b.type === R.leader.goal) ? CFG.BOSS_STALE_MS : CFG.STATE_STALE_MS)
      ? R.leader
      : null;
  // where the leader is right now: his live position when he is on screen, otherwise what he last told us
  function leader_pos() {
    const L = leader_state();
    if (!L) return null;
    let lp = null;
    try {
      lp = get_player(CFG.PARTY_LEADER);
    } catch (e) {}
    if (lp && lp.map === character.map && !lp.rip)
      return {
        map: lp.map,
        x: lp.real_x !== undefined ? lp.real_x : lp.x,
        y: lp.real_y !== undefined ? lp.real_y : lp.y,
      };
    return { map: L.map, x: L.x, y: L.y };
  }
  // the monster the leader is shooting (followers shoot it too)
  function leader_target() {
    if (!leader_state()) return null;
    let lp = null;
    try {
      lp = get_player(CFG.PARTY_LEADER);
    } catch (e) {}
    const id = lp && lp.target;
    const e = id && parent.entities[id];
    return e &&
      e.type === "monster" &&
      e.visible &&
      !e.dead &&
      !is_ignored(e) &&
      !(R.unreach[id] > now())
      ? e
      : null;
  }
  // v5: FARM_MONSTER -> FARM_SPOT and TARGET_TYPES, worked out once from the game's spawn data
  // v5: the rotation of the base farm monster (CFG.FARM_ROTATION): advances when a hunt ends
  function rot_idx() {
    if (R.rot_idx === undefined) {
      let v = 0;
      try { v = parseInt(get("farm_rot_idx"), 10) || 0; } catch (e) {}
      R.rot_idx = ((v % CFG.FARM_ROTATION.length) + CFG.FARM_ROTATION.length) % CFG.FARM_ROTATION.length;
    }
    return R.rot_idx;
  }
  const farm_avoided = (t) => !!R.avoid && (R.avoid[t] || 0) > now();
  // (Sean 2026-11-20) during the boar hold the Warrior and Priest do not go into Winterland: the rotation must not send the leader there either
  const boar_held_farm = (t) => {
    if (!CFG.BOAR_FLEE || now() >= (R.boar_until || 0)) return false;
    const sp = nearest_spawn(t);
    return !!sp && CFG.BOAR_MAPS.indexOf(sp.map) !== -1;
  };
  function rotate_farm(force) {
    if (!CFG.FARM_ROTATION.length || !is_leader() || (!force && now() - (R.rot_at || 0) < 300000)) return;
    R.rot_at = now();
    R.farm_since = now();
    rot_idx();
    R.rot_idx = (R.rot_idx + 1) % CFG.FARM_ROTATION.length;
    for (let k = 0; k < CFG.FARM_ROTATION.length && (farm_avoided(CFG.FARM_ROTATION[R.rot_idx]) || boar_held_farm(CFG.FARM_ROTATION[R.rot_idx])); k++) R.rot_idx = (R.rot_idx + 1) % CFG.FARM_ROTATION.length; // (a monster that just killed somebody is skipped for a while)
    try { set("farm_rot_idx", R.rot_idx); } catch (e) {}
    const t = CFG.FARM_ROTATION[R.rot_idx];
    const sp = nearest_spawn(t);
    if (!sp) return say("Farm rotation: no regular spawn found for " + t + " - keeping the old farm spot", "#CF575F");
    const spot = { map: sp.map, x: Math.round(sp.x), y: Math.round(sp.y) };
    if (R.force) R.force.saved = { FARM_SPOT: spot, TARGET_TYPES: [t] }; // (a forced farm is running: the new base comes back when it ends)
    else { CFG.FARM_SPOT = spot; CFG.TARGET_TYPES = [t]; }
    CFG.FARM_MONSTER = t;
    R.farm_applied = true;
    R.state_sent_at = 0;
    say("Farm rotation: " + (R.rot_timed ? "time is up (" + Math.round(CFG.FARM_ROTATE_MS / 60000) + " min), " : "after the hunt, ") + "farming " + ((G.monsters[t] || {}).name || t) + " at " + spot.map + " " + spot.x + "," + spot.y + (R.rot_timed ? " for " + Math.round(CFG.FARM_ROTATE_MS / 60000) + " min" : " until the next hunt is done"), "#51D2E1");
  }
  // ===== v5 (Sean 2026-11-20): death on the base farm -> everybody retreats to town together; that monster is skipped for a while =====
  function death_note(name) {
    if (!CFG.DEATH_RETREAT || !is_leader()) return;
    if (R.boss || grinch_fight() || R.force) return; // the Grinch fight may cost lives; a forced farm has its own rule (force_death)
    if (now() < (R.retreat_next || 0)) return; // one retreat for the whole wipe
    R.retreat_next = now() + CFG.DEATH_RETREAT_HOLD_MS + 30000;
    const on_farm = !R.goal && CFG.FARM_MONSTER && character.map === CFG.FARM_SPOT.map && d2(character, CFG.FARM_SPOT) <= 700;
    const farm = on_farm ? CFG.FARM_MONSTER : "";
    if (farm) (R.avoid = R.avoid || {})[farm] = now() + CFG.DEATH_AVOID_MS;
    R.retreat = { until: now() + CFG.DEATH_RETREAT_HOLD_MS, why: name + " died" + (farm ? " on the " + ((G.monsters[farm] || {}).name || farm) : ""), farm };
    R.retreat_go = true;
    for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) if (n !== character.name) call(() => send_cm(n, { type: "retreat", ms: CFG.DEATH_RETREAT_HOLD_MS }));
  }
  // the Warrior has no basher: everybody waits in the main town next to the Merchant's stand until he has one (or KIT_WAIT_MS passes)
  function kit_note(name) {
    if (!CFG.DEATH_RETREAT || !is_leader() || R.boss || grinch_fight() || R.force) return;
    if (R.retreat && R.retreat.kit) return; // already waiting
    if (now() < (R.kit_next || 0)) return;
    R.kit_next = now() + CFG.KIT_WAIT_MS + 120000;
    R.retreat = { until: now() + CFG.KIT_WAIT_MS, why: name + " has no Basher - waiting in town for the Merchant to bring one", farm: "", kit: name, spot: true };
    R.retreat_go = true;
    for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) if (n !== character.name) call(() => send_cm(n, { type: "retreat", ms: CFG.KIT_WAIT_MS, spot: true }));
  }
  // Sean 2026-11-21: a new build is on GitHub. Instead of waiting for a gap in the farming that never comes, the leader takes the whole party to town (town() has no cooldown), where nothing is fighting, so the reload (his own and then the followers') goes through in seconds. The window ends by itself after ms (or when the reload replaces this script). Not during a boss event, the Grinch, a forced farm or another retreat.
  function update_window(ms) {
    if (!is_leader() || R.retreat || R.retreat_go || R.boss || grinch_fight() || R.force || character.rip) return false;
    R.retreat = { until: now() + ms, why: "a new build is on GitHub - the party waits in town while it updates", farm: "", spot: false, update: true };
    R.retreat_go = true;
    for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) if (n !== character.name) call(() => send_cm(n, { type: "retreat", ms, spot: false }));
    return true;
  }
  async function retreat_step() {
    const r = R.retreat;
    R.retreat_go = false;
    if (!r) return true;
    R.lock = null;
    say("RETREAT: " + r.why + " - everybody to town for " + Math.round((r.until - now()) / 1000) + " s" + (r.farm ? "; the " + ((G.monsters[r.farm] || {}).name || r.farm) + " are skipped for " + Math.round(CFG.DEATH_AVOID_MS / 60000) + " min" : ""), "#CF575F");
    await use_town();
    if (r.spot && character.map === CFG.SAFE_SPOT.map && d2(character, CFG.SAFE_SPOT) > 60) await travel(CFG.SAFE_SPOT, 90000, "town meeting spot");
    const kit_ok = () => !!r.kit && !!R.levels[r.kit] && R.levels[r.kit].basher === true && now() - R.levels[r.kit].at < 15000;
    while (alive() && !character.rip && now() < r.until && !kit_ok()) await wait(1000);
    if (r.kit) {
      say(kit_ok() ? "RETREAT: " + r.kit + " has his Basher now - back to the farm" : "RETREAT: no Basher after " + Math.round(CFG.KIT_WAIT_MS / 60000) + " min - back to the farm anyway (is there a Basher / Wooden Basher in the bank or bag?)", kit_ok() ? "#5BCB5B" : "#CF575F");
      for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) if (n !== character.name) call(() => send_cm(n, { type: "retreat", ms: 0 }));
    }
    if (is_leader() && r.farm && CFG.FARM_ROTATION.length && CFG.FARM_MONSTER === r.farm) rotate_farm(true);
    R.state_sent_at = 0;
    R.retreat = null;
    return true;
  }
  function farm_monster_apply() {
    if (!R.farm_applied && CFG.FARM_ROTATION.length) CFG.FARM_MONSTER = CFG.FARM_ROTATION[rot_idx()];
    if (R.farm_applied || !CFG.FARM_MONSTER) return;
    R.farm_applied = true;
    const sp = nearest_spawn(CFG.FARM_MONSTER);
    if (!sp) return say("FARM_MONSTER " + CFG.FARM_MONSTER + ": no regular spawn found - keeping the old farm spot", "#CF575F");
    CFG.FARM_SPOT = { map: sp.map, x: Math.round(sp.x), y: Math.round(sp.y) };
    CFG.TARGET_TYPES = [CFG.FARM_MONSTER];
    say("Farming " + ((G.monsters[CFG.FARM_MONSTER] || {}).name || CFG.FARM_MONSTER) + " at " + sp.map + " " + CFG.FARM_SPOT.x + "," + CFG.FARM_SPOT.y, "#51D2E1");
  }
  // ===== v5 (Sean 2026-11-18): forced hard-monster farm =====
  // the monster type the group is forced onto: the leader's own override, or what the leader's party_state says (followers)
  const force_type = () => (R.force ? R.force.type : is_follower() && R.leader && R.leader.force && now() - R.leader.at < CFG.STATE_STALE_MS ? R.leader.force : null);
  function force_restore() {
    const f = R.force;
    if (!f) return;
    R.force = null;
    CFG.FARM_SPOT = f.saved.FARM_SPOT;
    CFG.TARGET_TYPES = f.saved.TARGET_TYPES;
    R.state_sent_at = 0; // tell the party now
  }
  function force_drop(why) {
    const f = R.force;
    if (!f) return;
    force_restore();
    try { set("force_farm", ""); } catch (e) {}
    say("Forced farm of " + ((G.monsters[f.type] || {}).name || f.type) + " DROPPED: " + why + " - back to " + (CFG.TARGET_TYPES.join("/") || "the normal targets") + " at " + CFG.FARM_SPOT.map + " " + CFG.FARM_SPOT.x + "," + CFG.FARM_SPOT.y + ". Set force_farm again by hand to retry.", "#CF575F");
  }
  const grinch_fight = () => !!(R.boss && R.boss.type === "grinch") || Object.values(parent.entities || {}).some((e) => e && e.type === "monster" && e.mtype === "grinch" && !e.dead && e.visible !== false);
  function force_death(name) {
    if (!R.force) return;
    if (grinch_fight()) return; // the Grinch fight is allowed to cost lives
    if (R.force.trial) return trial_end(false, name + " died", name);
    force_drop(name + " died");
  }
  function force_apply(type, trial) {
    farm_monster_apply(); // settle the old FARM_MONSTER first so the saved values are the real ones
    const def = G.monsters[type];
    if (!def) { try { set("force_farm", ""); } catch (e) {} return say("force_farm: '" + type + "' is not a monster in the game data", "#CF575F"); }
    const sp = nearest_spawn(type);
    if (!sp) { try { set("force_farm", ""); } catch (e) {} return say("force_farm: no regular spawn found for " + (def.name || type), "#CF575F"); }
    if (R.force) force_restore();
    R.force = { type, started: now(), saved: { FARM_SPOT: CFG.FARM_SPOT, TARGET_TYPES: CFG.TARGET_TYPES }, trial: trial ? { id: null, at: 0, hp: 1, deadline: now() + CFG.TRY_MONSTER_MS } : null };
    CFG.FARM_SPOT = { map: sp.map, x: Math.round(sp.x), y: Math.round(sp.y) };
    CFG.TARGET_TYPES = [type];
    R.force_rip = {};
    for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) { let p = null; try { p = get_player(n); } catch (e) {} if (p) R.force_rip[n] = !!p.rip; }
    R.state_sent_at = 0;
    if (CFG.LUCK_STOP && !trial) R.luck_need = { why: "forced farm", at: now() };
    if (trial) return say("TRY MONSTER: " + (def.name || type) + " at " + sp.map + " " + CFG.FARM_SPOT.x + "," + CFG.FARM_SPOT.y + " - the group takes on ONE of them with single-target shots (success = it dies with nobody dead; failure = a death or " + Math.round(CFG.TRY_MONSTER_MS / 60000) + " min without a kill)", "#E0A040");
    say("FORCED FARM: " + (def.name || type) + " at " + sp.map + " " + CFG.FARM_SPOT.x + "," + CFG.FARM_SPOT.y + " (difficulty limit bypassed for it only; any death drops it)" + (party_bees_only() ? " - the party is still below the bees-only level, forcing anyway" : ""), "#E0A040");
  }
  const trial_other = (e) => !!(R.force && R.force.trial && R.force.trial.id && e.mtype === R.force.type && e.id !== R.force.trial.id);
  // ok: true = success, false = failure, null = cancelled (no verdict)
  function trial_end(ok, why, who) {
    const f = R.force;
    if (!f || !f.trial) return;
    const t = f.trial;
    const name = (G.monsters[f.type] || {}).name || f.type;
    const took = t.at ? Math.round((now() - t.at) / 1000) : null;
    force_restore();
    try { set("force_farm", ""); } catch (e) {}
    say("TRY MONSTER RESULT: " + name + " - " + (ok === true ? "SUCCESS: killed one" + (took !== null ? " in " + took + " s" : "") + ", nobody died" : ok === false ? "FAILED: " + why + (took !== null ? " (" + took + " s after the fight started)" : " (before the fight started)") : "stopped (" + why + ")") + " - back to the normal farm", ok === true ? "#5BCB5B" : "#CF575F");
    if (ok !== null) {
      try {
        const log = JSON.parse(get("try_monster_log") || "[]");
        log.push({ at: Date.now(), type: f.type, ok, why: ok ? "" : why, secs: took });
        set("try_monster_log", JSON.stringify(log.slice(-30)));
      } catch (e) {}
    }
    if (ok === false && who) death_note(who); // somebody died: the whole party goes to town for a moment (the old farm spot is not where we stand, so nothing is blacklisted)
  }
  function trial_watch() {
    const f = R.force;
    if (!f || !f.trial) return;
    const t = f.trial;
    if (!t.id && R.lock) {
      const e = parent.entities[R.lock];
      if (e && e.type === "monster" && e.mtype === f.type && !e.dead) { t.id = e.id; t.at = now(); t.hp = e.max_hp ? e.hp / e.max_hp : 1; say("TRY MONSTER: engaging one " + ((G.monsters[f.type] || {}).name || f.type) + " - the others of its kind are left alone", "#E0A040"); }
    }
    if (t.id) {
      const e = parent.entities[t.id];
      if (e && !e.dead && !e.rip && e.max_hp) t.hp = e.hp / e.max_hp;
      if (!e || e.dead || e.rip) {
        if (e && (e.dead || e.rip) || t.hp <= 0.3) return trial_end(true, "", "");
        t.id = null; // it just left my view with plenty of HP: look for it again
      }
    }
    if (now() > t.deadline) trial_end(false, "no kill within " + Math.round(CFG.TRY_MONSTER_MS / 60000) + " min", "");
  }
  function force_poll() {
    if (now() < (R.boar_until || 0)) return; // (boars) the bees first
    let tv = "";
    try { tv = String(get("try_monster") || "").trim().toLowerCase(); } catch (e) {}
    if (tv) {
      try { set("try_monster", ""); } catch (e) {}
      if (R.force && R.force.trial) { if (R.force.type === tv) return; trial_end(null, "replaced by a new trial", ""); }
      else if (R.force) return say("TRY MONSTER: a forced farm of " + ((G.monsters[R.force.type] || {}).name || R.force.type) + " is running - stop it first", "#CF575F");
      return force_apply(tv, true);
    }
    if (R.force && R.force.trial) return; // (the trial runs on its own; the forced-farm key is not looked at meanwhile)
    let v = "";
    try { v = String(get("force_farm") || "").trim().toLowerCase(); } catch (e) {}
    if (!v) {
      if (R.force) { force_restore(); say("Forced farm ended by hand - back to " + (CFG.TARGET_TYPES.join("/") || "the normal targets"), "#51D2E1"); }
      return;
    }
    if (R.force && R.force.type === v) return;
    force_apply(v);
  }
  function force_watch() {
    if (!R.force) return;
    if (character.rip) return force_death(character.name);
    for (const n of CFG.PARTY_MEMBERS.concat(CFG.PARTY_SUPPORT)) {
      if (n === character.name) continue;
      let p = null;
      try { p = get_player(n); } catch (e) {}
      if (!p) continue;
      const was = !!R.force_rip[n];
      R.force_rip[n] = !!p.rip;
      if (p.rip && !was) force_death(n);
    }
  }
  function force_tick() {
    if (!CFG.FORCE_FARM || !is_leader() || !alive()) return;
    if (now() >= R.force_check_at) { R.force_check_at = now() + CFG.FORCE_CHECK_MS; force_poll(); }
    force_watch();
    trial_watch();
    farm_button_refresh(false);
    try_button_refresh(false);
  }

  // ===== v5 (Sean 2026-11-18): Merchant's Luck stop =====
  // everyone the Merchant should buff: me and the members that have reported in the last 5 minutes (offline ones are skipped)
  function luck_names() {
    return party_names().filter((n) => n === character.name || (R.levels[n] && now() - R.levels[n].at < 300000));
  }
  function luck_all_buffed() {
    for (const n of luck_names()) {
      let p = null;
      try { p = n === character.name ? character : get_player(n); } catch (e) {}
      const b = p && p.s && p.s.mluck;
      if (!(b && Number(b.ms) >= CFG.LUCK_STOP_MIN_LEFT_MS)) return false;
    }
    return true;
  }
  function luck_due() {
    if (!CFG.LUCK_STOP || !is_leader() || R.luck_busy || !alive() || character.rip) return false;
    if (!CFG.PARTY_MEMBERS.length && !CFG.PARTY_SUPPORT.length) return false;
    if (now() < R.luck_retry_at || R.courier || R.ladder || R.trip) return false;
    if (character.map !== CFG.SAFE_SPOT.map) return false;
    if (R.luck_need && now() - R.luck_need.at > 600000) R.luck_need = null;
    if (R.luck_need) return true;
    return !R.boss && !R.goal && now() - R.started_at > 120000 && luck_names().length > 1 && now() - R.luck_last >= CFG.LUCK_STOP_BEES_MS; // (regular renewal: only once somebody besides me has reported in, so the first stop does not leave the party out)
  }
  async function luck_stop() {
    const why = R.luck_need ? R.luck_need.why : "hourly renewal";
    R.luck_need = null;
    if (luck_all_buffed()) { R.luck_last = now(); return say("Merchant's Luck stop (" + why + ") skipped: everyone still has the buff", "#51D2E1"); }
    const names = luck_names();
    const id = "l" + now();
    R.luck_busy = true;
    R.luck_done = null;
    try {
      say("Merchant's Luck stop (" + why + "): going to the Merchant with " + names.join(", "), "#E0A040");
      if (d2(character, CFG.SAFE_SPOT) > 60) {
        const r = await travel(CFG.SAFE_SPOT, 90000, "Merchant's Luck stop");
        if (r.failed) { R.luck_retry_at = now() + 10 * 60000; return say("Merchant's Luck stop: could not walk to the Merchant (" + r.reason + ") - going on", "#CF575F"); }
      }
      await AL.send(M, { type: "mluck_request", id, names });
      const t0 = now();
      while (now() - t0 < CFG.LUCK_STOP_TIMEOUT_MS && !(R.luck_done && R.luck_done.id === id) && alive() && !character.rip) await wait(500);
      const d = R.luck_done;
      if (d && d.id === id) say("Merchant's Luck stop done: cast on " + (d.cast.join(", ") || "nobody") + (d.failed.length ? "; not cast on " + d.failed.join(", ") : "") + (d.off ? " (the Merchant cannot cast it yet)" : ""), "#5BCB5B");
      else { R.luck_retry_at = now() + CFG.LUCK_STOP_RETRY_MS; say("Merchant's Luck stop: no answer from " + M + " in " + Math.round(CFG.LUCK_STOP_TIMEOUT_MS / 1000) + " s - going on, not again for " + Math.round(CFG.LUCK_STOP_RETRY_MS / 60000) + " min", "#CF575F"); }
    } finally {
      R.luck_last = now();
      R.luck_busy = false;
    }
  }
  // where idle fighters hang around: the bee spot, or the leader for followers
  function anchor() {
    farm_monster_apply();
    const lp = leader_pos();
    return lp
      ? { spot: lp, radius: CFG.FOLLOW_RADIUS, leash: 0 }
      : {
          spot: CFG.FARM_SPOT,
          radius: CFG.FARM_RADIUS,
          leash: CFG.LEASH_RADIUS,
        };
  }
  const is_goal_monster = (e) =>
    (!!R.goal && e.mtype === R.goal.type) ||
    (!!R.boss && e.mtype === R.boss.type) ||
    (!!R.follow_goal && is_follower() && e.mtype === R.follow_goal);
  const is_priority = (e) =>
    CFG.PRIORITY_TYPES.indexOf(e.mtype) !== -1 ||
    is_hunt_monster(e) ||
    is_goal_monster(e);

  function visible_monsters() {
    const out = [];
    for (const id in parent.entities) {
      const e = parent.entities[id];
      if (
        e &&
        e.type === "monster" &&
        e.visible &&
        !e.dead &&
        !(R.unreach[id] > now())
      )
        out.push(e);
    }
    out.sort((a, b) => d2(character, a) - d2(character, b));
    return out;
  }

  function priority_targets() {
    return visible_monsters().filter(is_priority);
  }

  function easy_targets() {
    return visible_monsters().filter((e) => {
      if (is_priority(e) || is_ignored(e)) return false;
      const ft = force_type();
      if (ft ? e.mtype !== ft : CFG.TARGET_TYPES.length && CFG.TARGET_TYPES.indexOf(e.mtype) === -1)
        return false;
      if (
        e.target &&
        e.target !== character.name &&
        party_names().concat(CFG.PARTY_SUPPORT).indexOf(e.target) === -1
      )
        return false; // someone else's fight
      const an = anchor();
      if (
        an.leash &&
        (character.map !== an.spot.map || d2(e, an.spot) > an.leash)
      )
        return false;
      if (!an.leash && d2(e, an.spot) > CFG.FOLLOW_FAR_PX + 200) return false; // follower: stay in the leader's neighbourhood
      return !trial_other(e) && (difficulty_of(e) <= CFG.MAX_DIFFICULTY || (!!ft && e.mtype === ft) || (CFG.FARM_ROTATION.length > 0 && e.mtype === CFG.FARM_MONSTER && CFG.FARM_ROTATION.indexOf(e.mtype) !== -1)); // v5: the forced farm monster and the current rotation monster (the porcupine can rate harder than MAX_DIFFICULTY) are the exceptions to the limit
    });
  }

  // the monster the Warrior says is the biggest threat (fresh message, alive, in shooting range)
  function focus_entity() {
    const f = R.focus;
    if (!CFG.FOCUS_TARGET || !f || !f.id || now() - f.at > CFG.FOCUS_MAX_AGE_MS) return null;
    const e = parent.entities[f.id];
    if (!e || e.type !== "monster" || e.dead || e.rip || e.visible === false) return null;
    return is_in_range(e) ? e : null;
  }
  // Sean 2026-11-21: monsters that are attacking a party member (the leader included), close to the leader. A search walk (Phoenix goal, Daisy hunt) stops for them and combat shoots them first.
  function defend_targets() {
    if (!CFG.DEFEND_PARTY) return [];
    const names = party_names().concat(CFG.PARTY_SUPPORT);
    return visible_monsters().filter((e) => e.target && names.indexOf(e.target) !== -1 && d2(character, e) <= CFG.DEFEND_RANGE_PX);
  }
  // true while the party is in a fight the leader should be in: cancels a walk in progress (owner = the goal / hunt state, so a cancelled walk is not counted as a path failure)
  function party_fight_pause(owner) {
    if (!CFG.DEFEND_PARTY) return false;
    const t = defend_targets();
    const f = R.focus;
    const fe = f && f.id && now() - f.at <= CFG.FOCUS_MAX_AGE_MS ? parent.entities[f.id] : null;
    const focus_live = !!fe && fe.type === "monster" && !fe.dead && !fe.rip && fe.visible !== false && d2(character, fe) <= CFG.DEFEND_RANGE_PX;
    if (!t.length && !focus_live) return false;
    if ((smart.moving || is_moving(character)) && owner) {
      owner.aborted = true;
      call(() => {
        try { smart.moving = false; } catch (e) {}
        try { stop(); } catch (e) {}
      });
    }
    if (now() - (R.defend_say || 0) > 10000) {
      R.defend_say = now();
      const m = t[0] || fe;
      say("Party fight: " + (m.target || "the Warrior's focus") + " is being attacked by " + m.mtype + " - stopping the search to help", "#E1A951");
    }
    return true;
  }
  function pick_target() {
    const fe = focus_entity();
    if (fe) {
      R.lock = fe.id;
      return fe;
    }
    const pri = priority_targets();
    if (pri.length) {
      R.lock = null;
      return pri[0];
    }
    const df = defend_targets();
    if (df.length) {
      R.lock = df[0].id;
      return df[0];
    }
    // Finish what we already chose: the rating depends on our HP and the monster's HP,
    // so it can flip mid-fight and we don't want to dither between targets.
    const lt = leader_target();
    if (lt) {
      R.lock = lt.id;
      return lt;
    }
    const locked = R.lock && parent.entities[R.lock];
    if (
      locked &&
      locked.type === "monster" &&
      locked.visible &&
      !locked.dead &&
      !is_ignored(locked)
    )
      return locked;
    const next = easy_targets()[0] || null;
    R.lock = next ? next.id : null;
    return next;
  }

  async function shoot(target) {
    const level = character.level;
    const mp_ok = character.mp / character.max_mp >= CFG.MULTISHOT_MIN_MP_PCT;
    let in_range =
      is_hunt_monster(target) || is_goal_monster(target)
        ? priority_targets().filter(
            (m) => (is_hunt_monster(m) || is_goal_monster(m)) && is_in_range(m)
          )
        : is_priority(target)
        ? [target]
        : easy_targets().filter((m) => is_in_range(m));
    const fe = focus_entity();
    const tank_mode = !!fe && fe.id === target.id;
    let tank_others = [];
    if (tank_mode) {
      const names = party_names();
      tank_others = Object.values(parent.entities).filter(
        (e) => e && e !== target && e.type === "monster" && !e.dead && !e.rip && e.visible !== false && e.target && names.indexOf(e.target) !== -1 && is_in_range(e)
      );
    }
    const single0 = CFG.TRI_SHOT_MONSTERS.indexOf(target.mtype) === -1 || CFG.SINGLE_TARGET_TYPES.indexOf(target.mtype) !== -1 || !!boss_cfg(target.mtype) || !!(R.force && R.force.trial && target.mtype === R.force.type); // boss events and the Try monster trial: one target, so 3shot/5shot only waste MP
    const single = tank_mode ? tank_others.length < 2 : single0;
    if (tank_mode && !single) in_range = [target].concat(tank_others);
    let res;

    // the mark is the condition "marked" (skill huntersmark, 10 s, cooldown 10 s)
    const mark = target.s && (target.s.marked || target.s.huntersmark);
    const mark_left = mark ? Number(mark.ms) || 0 : 0;
    const boss_mark = CFG.BOSS_MARK && !!boss_cfg(target.mtype) && character.mp / character.max_mp >= CFG.BOSS_MARK_MIN_MP_PCT;
    const focus_mark = tank_mode && CFG.FOCUS_MARK;
    if (
      (CFG.HUNTERSMARK_TYPES.indexOf(target.mtype) !== -1 || boss_mark || focus_mark) &&
      (!mark || (boss_mark && mark_left < CFG.BOSS_MARK_REFRESH_MS)) &&
      !is_on_cooldown("huntersmark") &&
      character.mp >= 240
    ) {
      call(() => use_skill("huntersmark", target));
    }
    if (
      CFG.SUPERSHOT_TYPES.indexOf(target.mtype) !== -1 &&
      !is_on_cooldown("supershot") &&
      character.mp >= 400
    ) {
      res = await call(() => use_skill("supershot", target));
    } else if (
      mp_ok &&
      !single &&
      level >= 75 &&
      in_range.length >= 5 &&
      character.mp >= 320 &&
      now() - R.last_5shot >= CFG.FIVESHOT_INTERVAL_MS
    ) {
      res = await call(() => use_skill("5shot", in_range.slice(0, 5)));
      if (!res.failed) R.last_5shot = now();
    } else if (
      mp_ok &&
      !single &&
      level >= 60 &&
      in_range.length >= 3 &&
      character.mp >= 200 &&
      now() - R.last_3shot >= CFG.THREESHOT_INTERVAL_MS
    ) {
      res = await call(() => use_skill("3shot", in_range.slice(0, 3)));
      if (!res.failed) R.last_3shot = now();
    } else {
      res = await call(() => attack(target));
    }
    if (!res.failed) reduce_cooldown("attack", (character.ping || 0) * 0.95); // doc idiom: compensate for ping
  }

  function tether() {
    if (is_moving(character) || smart.moving || now() < R.tether_next) return; // smart.moving is true while a path is still being searched
    // hurt and out of potions: stay put in town instead of walking back into the bees
    if (character.hp / character.max_hp < 0.5 && quantity(CFG.HP_POTION) === 0)
      return;
    const an = anchor();
    const far =
      character.map !== an.spot.map || d2(character, an.spot) > an.radius;
    if (far) {
      log_move(
        an.spot,
        "drifted " +
          Math.round(d2(character, an.spot)) +
          "px from the " +
          (an.leash ? "farm spot" : "leader")
      );
      // at most one attempt per 3s; when there is no path ("Path not found!") wait 20s instead of retrying every tick
      R.tether_next = now() + 3000;
      const tgt = an.leash
        ? an.spot
        : {
            map: an.spot.map,
            x: an.spot.x + (Math.random() - 0.5) * 100,
            y: an.spot.y + (Math.random() - 0.5) * 100,
          };
      call(() => smart_move(tgt)).then((r) => {
        if (r && (r.failed || r.success === false)) {
          R.tether_next = now() + 20000;
          say(
            "No path back to the farm spot (" +
              (r.reason || "no path") +
              ") - trying again in 20s",
            "#CF575F"
          );
        }
      });
    }
  }
