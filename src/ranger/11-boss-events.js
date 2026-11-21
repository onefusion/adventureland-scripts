  // ========================== BOSS EVENTS ==========================
  const boss_on = () => {
    if (!CFG.BOSS_EVENTS_ENABLED) return false;
    try {
      const v = String(get("boss_events") || "").toLowerCase();
      if (v === "off" || v === "none" || v === "false" || v === "0") return false;
    } catch (e) {}
    return true;
  };
  const dur_text = (ms) => (ms >= 90000 ? Math.round(ms / 60000) + " min" : Math.round(ms / 1000) + " s");
  const boss_cfg = (type) => CFG.BOSS_EVENTS.find((b) => b.type === type && b.enabled !== false);
  function server_boss(type) {
    try {
      const b = parent.S && parent.S[type];
      return b && typeof b === "object" && b.live ? b : null;
    } catch (e) {
      return null;
    }
  }
  function end_boss(why, preempted) {
    const b = R.boss;
    if (!b) return;
    say("Boss event " + b.name + " ended: " + why, "#51D2E1");
    R.boss_end[b.type] = now();
    if (preempted) R.boss_check_at = 0; // look for the higher-priority boss at once
    if (CFG.BOSS_AFTER_TRIP && why !== "switched off" && !preempted) R.post_boss = { at: now(), name: b.name };
    R.boss = null;
    R.lock = null;
    R.goal_check_at = now() + 5000;
  }
  // true = he is walking to / waiting for the boss (the party follows him); false = nothing to do here, or the boss is in view -> normal combat
  // a boss with a post is not chased: the party waits there. post: true = CFG.SAFE_SPOT, or {map,x,y}
  const boss_post = (cfg) => (cfg && cfg.post ? (cfg.post === true ? CFG.SAFE_SPOT : cfg.post) : null);
  // does the server's report count as "he is around"? (a boss without a post: any live report; with a post: only when he is near it)
  function boss_near(cfg, sb) {
    if (!sb) return false;
    const post = boss_post(cfg);
    if (!post) return true;
    return sb.map === post.map && Number.isFinite(Number(sb.x)) && d2({ x: Number(sb.x), y: Number(sb.y) }, post) <= (cfg.post_radius || 600);
  }
  // v5: is the party in bees-only mode? the leader knows (party_bees_only), followers are told in party_state
  const bees_mode = () => (is_leader() ? !!party_bees_only() : !!(R.leader && R.leader.bees && now() - R.leader.at < CFG.STATE_STALE_MS));
  async function boss_step() {
    if (!boss_on()) {
      if (R.boss) end_boss("switched off");
      return false;
    }
    if (!R.boss) {
      if (now() < R.boss_check_at) return false;
      R.boss_check_at = now() + CFG.BOSS_CHECK_MS;
      // manual start from the game console:  set("boss_force", "grinch")  or  set("boss_force", "grinch:main,120,-80")  (map,x,y when the server shows no position)
      let forced = null;
      try {
        const fv = String(get("boss_force") || "");
        if (fv) {
          set("boss_force", "");
          const m = fv.match(/^([a-z0-9_]+)(?::([a-z0-9_]+),(-?\d+),(-?\d+))?$/i);
          const fc = m && CFG.BOSS_EVENTS.find((b) => b.type === m[1]);
          if (!fc) say("boss_force: '" + fv + "' is not one of " + CFG.BOSS_EVENTS.map((b) => b.type).join("/") + " (format: grinch or grinch:map,x,y)", "#CF575F");
          else forced = { cfg: fc, pos: m[2] ? { map: m[2], x: Number(m[3]), y: Number(m[4]) } : null };
        }
      } catch (e) {}
      if (forced) {
        const cfg = forced.cfg;
        const sb0 = server_boss(cfg.type);
        const def0 = G.monsters[cfg.type] || {};
        R.boss = { cfg, type: cfg.type, name: def0.name || cfg.type, started: now(), last_seen: now(), pos: forced.pos, busy: false, move_at: 0, log_at: 0, hp0: Number((sb0 && sb0.hp) || def0.hp) || 0 };
        R.lock = null;
        say("Boss event started by hand: " + R.boss.name + (forced.pos ? " at " + forced.pos.map + " " + forced.pos.x + "," + forced.pos.y : sb0 ? " (server position)" : " - no position known, searching the spawn / waiting for him to show") + ". Staying on him until he has been gone " + dur_text(cfg.lose_ms) + ".", "#E0A040");
      }
      for (const cfg of forced ? [] : CFG.BOSS_EVENTS) {
        if (cfg.enabled === false || now() - (R.boss_end[cfg.type] || 0) < 60000 || now() < (R.boss_skip[cfg.type] || 0)) continue;
        if (bees_mode() && CFG.BOSS_WHEN_BEES_ONLY.indexOf(cfg.type) === -1) continue; // v5: a weak party (the Priest is still low level) only joins the listed events
        const sb = server_boss(cfg.type);
        const seen = visible_monsters().filter((e) => e.mtype === cfg.type);
        if (!boss_near(cfg, sb) && !seen.length) continue;
        const def = G.monsters[cfg.type] || {};
        const hp = Number((sb && sb.hp) || (seen[0] && seen[0].hp) || def.hp) || 0;
        const size = 1 + CFG.PARTY_MEMBERS.length;
        const dps = Math.max(1, character.attack * character.frequency * CFG.HUNT_EFFICIENCY * size);
        R.boss = { cfg, type: cfg.type, name: def.name || cfg.type, started: now(), last_seen: now(), pos: null, busy: false, move_at: 0, log_at: 0, hp0: hp };
        R.lock = null;
        say(
          "Boss event: " + R.boss.name + " is up" + (sb && sb.map ? " at " + sb.map + " " + Math.round(sb.x) + "," + Math.round(sb.y) : "") + (boss_post(cfg) ? "; the party waits at the post (" + boss_post(cfg).map + " " + boss_post(cfg).x + "," + boss_post(cfg).y + ") and shoots him when he is in range" : "") + ". HP now " + Math.round(hp / 1000) + "k (game data says " + Math.round((def.hp || 0) / 1000) + "k); the party of " + size + " needs about " + Math.round(hp / dps / 60) + " min at ~" + Math.round(dps) + " damage/s. Staying on him until he has been gone " + dur_text(cfg.lose_ms) + ".",
          "#E0A040"
        );
        break;
      }
      if (!R.boss) return false;
    }
    if (R.luck_boss_key !== R.boss.started) {
      R.luck_boss_key = R.boss.started;
      if (CFG.LUCK_STOP && !boss_post(R.boss.cfg)) { R.luck_need = { why: "boss " + R.boss.name, at: now() }; return true; } // the post bosses (Grinch) are fought in town next to the Merchant, who buffs everybody there
    }
    const b = R.boss;
    const sb = server_boss(b.type);
    const seen = visible_monsters().filter((e) => e.mtype === b.type);
    R.wiggle = !!(CFG.GRINCH_CIRCLE && b.type === "grinch" && boss_post(b.cfg) && sb && boss_near(b.cfg, sb) && character.map === boss_post(b.cfg).map && d2(character, boss_post(b.cfg)) <= 300); // (only once he stands at the post) told to the Warrior and the Priest: they circle too while they cannot see him
    if (!R.wiggle || seen.length) R.wig = null;
    if (seen.length) {
      b.last_seen = now();
      b.pos = { map: character.map, x: seen[0].x, y: seen[0].y };
    } else if (boss_near(b.cfg, sb)) b.last_seen = now();
    if (boss_post(b.cfg)) b.pos = boss_post(b.cfg); // never chase: the post is the destination
    else if (sb && sb.map && Number.isFinite(Number(sb.x))) b.pos = { map: sb.map, x: Number(sb.x), y: Number(sb.y) };
    // v5: BOSS_EVENTS is in priority order (Grinch first). A lower-priority event (Snowman) gives way when a higher one turns up.
    const bi = CFG.BOSS_EVENTS.indexOf(b.cfg);
    for (let k = 0; k < bi; k++) {
      const c = CFG.BOSS_EVENTS[k];
      if (c.enabled === false || now() < (R.boss_skip[c.type] || 0) || now() - (R.boss_end[c.type] || 0) < 60000) continue;
      if (boss_near(c, server_boss(c.type)) || visible_monsters().some((e) => e.mtype === c.type)) {
        end_boss("a higher-priority boss (" + ((G.monsters[c.type] && G.monsters[c.type].name) || c.type) + ") is up", true);
        return false;
      }
    }
    const cap = b.cfg.max_ms !== undefined ? b.cfg.max_ms : CFG.BOSS_MAX_MS;
    if (cap > 0 && now() - b.started > cap) {
      R.boss_skip[b.type] = now() + CFG.BOSS_CAP_REST_MS;
      end_boss("time cap of " + Math.round(cap / 60000) + " min reached - back to the bees (not joining " + b.name + " again for " + Math.round(CFG.BOSS_CAP_REST_MS / 60000) + " min)");
      return false;
    }
    if (now() - b.last_seen > b.cfg.lose_ms) {
      end_boss((b.cfg.lose_ms < 90000 && !sb ? "the server no longer lists him as live and he has not been seen for " : "not seen for ") + dur_text(b.cfg.lose_ms) + " - assuming he is dead");
      return false;
    }
    if (now() - b.log_at >= CFG.BOSS_LOG_MS) {
      b.log_at = now();
      const hp = Number((sb && sb.hp) || (seen[0] && seen[0].hp)) || 0;
      const mx = Number((sb && sb.max_hp) || (seen[0] && seen[0].max_hp) || (G.monsters[b.type] && G.monsters[b.type].hp)) || 0;
      if (hp)
        say("Boss " + b.name + ": " + Math.round(hp / 1000) + "k / " + Math.round(mx / 1000) + "k HP" + (mx ? " (" + Math.round((hp / mx) * 100) + "%)" : "") + (seen.length ? ", in view" : ", not in view") + (() => { try { const ps = party_names().map((n) => { const st = member_status(n); return st ? n + " " + st.hp + "/" + st.mp : null; }).filter(Boolean); return ps.length ? "; potions (hp/mp): " + ps.join(", ") : ""; } catch (e) { return ""; } })(), "#E0A040");
      else say("Boss " + b.name + ": " + (seen.length ? "in view" : "not in view") + ", last sign " + Math.round((now() - b.last_seen) / 1000) + "s ago", "#E0A040");
    }
    if (seen.length && boss_post(b.cfg)) {
      // waiting at the post: shoot him while he is in range, otherwise stay put (no chasing)
      const t = seen[0];
      if (get_target() !== t) change_target(t);
      if (is_in_range(t) && !is_on_cooldown("attack")) await shoot(t);
      return true;
    }
    if (seen.length) return false; // in view: normal combat (he is the priority target)
    if (R.wiggle) {
      if (!R.wig) R.wig = { x: character.x, y: character.y, a: 0, at: 0, since: now() };
      if (now() - R.wig.since >= CFG.GRINCH_CIRCLE_AFTER_MS) {
        if (now() - R.wig.at >= CFG.GRINCH_CIRCLE_STEP_MS) {
          R.wig.at = now();
          R.wig.a += Math.PI / 4;
          if (!R.wig.said) { R.wig.said = true; say("The Grinch is listed near the post but not in view - walking a small circle to refresh the view", "#E0A040"); }
          call(() => move(R.wig.x + Math.cos(R.wig.a) * CFG.GRINCH_CIRCLE_RADIUS, R.wig.y + Math.sin(R.wig.a) * CFG.GRINCH_CIRCLE_RADIUS));
        }
        return true;
      }
    }
    if (b.busy || smart.moving) return true;
    const sp = b.pos ? null : nearest_spawn(b.type, {});
    const dest = b.pos || (sp && { map: sp.map, x: sp.x, y: sp.y });
    if (!dest) return true; // no position known: wait for the server info or for him to show up
    if (character.map === dest.map && d2(character, dest) <= 120) return true; // there already: hold, he teleports in and out
    if (now() - b.move_at < CFG.BOSS_MOVE_MS) return true;
    b.move_at = now();
    b.busy = true;
    log_move(dest, "going after " + b.name);
    call(() => smart_move(dest)).then((r) => {
      b.busy = false;
      if (r.failed || r.success === false) say("Could not walk to " + describe_dest(dest) + " (" + (r.reason || "no path") + ") - trying again", "#CF575F");
    });
    return true;
  }
