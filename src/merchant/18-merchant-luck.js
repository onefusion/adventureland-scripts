  // ===== Merchant's Luck: buff each Ranger once an hour =====
  const mluck_def = () => (G.skills && G.skills.mluck) || null;
  function mluck_state() {
    try {
      return JSON.parse(get("mluck_at") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  const mluck_save = (st) => {
    try {
      set("mluck_at", JSON.stringify(st));
    } catch (e) {}
  };
  const mluck_on = () => {
    const d = mluck_def();
    return (
      CFG.MLUCK_ENABLED &&
      !!d &&
      character.level >= (Number(d.level) || 0) &&
      character.mp >= (Number(d.mp) || 0)
    );
  };
  // the Rangers whose buff is gone or about to be (leader first), that reported a position lately
  function mluck_wanted() {
    const st = mluck_state();
    return roster().filter(
      (n) =>
        gear_fresh_for(n) &&
        Date.now() - (st[n] || 0) >= CFG.MLUCK_RENEW_MS &&
        Date.now() - ((S.mluck_skip || {})[n] || 0) >= CFG.MLUCK_RETRY_MS
    );
  }
  function mluck_due() {
    if (!mluck_on() || is_paused() || has_jobs() || now() < (S.mluck_next || 0))
      return false;
    S.mluck_next = now() + CFG.MLUCK_CHECK_MS;
    return mluck_wanted().length > 0;
  }
  async function mluck_round() {
    const d = mluck_def();
    const range = Math.max(60, (Number(d.range) || 320) - 40);
    S.mluck_skip = S.mluck_skip || {};
    for (const name of mluck_wanted()) {
      if (!alive() || character.rip || has_jobs() || !mluck_on()) break;
      let g = gear_of(name);
      const req = { from: name, map: g.map, x: g.x, y: g.y };
      act("Merchant's Luck", 60, true);
      const ok = await go_to_ranger(req, "casting Merchant's Luck on " + name);
      let p = get_player(name);
      if (!ok || !p) {
        S.mluck_skip[name] = Date.now();
        say(
          "Merchant's Luck: could not reach " +
            name +
            " (" +
            (req.fail_reason || "not in view") +
            ") - trying again in " +
            Math.round(CFG.MLUCK_RETRY_MS / 60000) +
            " min",
          "#CF575F"
        );
        continue;
      }
      if (d2(character, p) > range) await call(() => xmove(p.x, p.y));
      p = get_player(name) || p;
      const res = await call(() => use_skill("mluck", p));
      await wait(600);
      p = get_player(name) || p;
      const buffed = !!(p && p.s && p.s.mluck);
      if (res.failed || (p && p.s && !buffed)) {
        S.mluck_skip[name] = Date.now();
        say(
          "Merchant's Luck on " +
            name +
            " did not take: " +
            (res.reason || JSON.stringify(res)) +
            (p && p.s ? " (buffs: " + Object.keys(p.s).join(",") + ")" : ""),
          "#CF575F"
        );
        continue;
      }
      const st = mluck_state();
      st[name] = Date.now();
      mluck_save(st);
      say(
        "Merchant's Luck cast on " +
          name +
          " (lasts " +
          Math.round((Number(d.duration) || 3600000) / 60000) +
          " min; renewed in " +
          Math.round(CFG.MLUCK_RENEW_MS / 60000) +
          ")",
        "#5BCB5B"
      );
      await wait(400); // the skill's own cooldown
    }
    return go_home();
  }

  // ===== Merchant's Luck for everybody in town while the Grinch is live =====
  const grinch_live = () => {
    try {
      const g = parent.S && parent.S.grinch;
      return !!(g && g.live);
    } catch (e) {
      return false;
    }
  };
  function mluck_town_on() {
    const d = mluck_def();
    return !!(
      CFG.MLUCK_GRINCH &&
      d &&
      grinch_live() &&
      character.level >= (Number(d.level) || 0) &&
      character.mp >= (Number(d.mp) || 0)
    );
  }
  // player characters in the town area (not NPCs, not dead, not himself) that have no Merchant's Luck (or little left)
  function mluck_town_wanted() {
    const out = [];
    if (character.map !== CFG.STAND_SPOT.map) return out;
    const skip = S.mluck_town_skip || {};
    for (const e of Object.values(parent.entities || {})) {
      if (
        !e ||
        e.type !== "character" ||
        e.npc ||
        e.rip ||
        e.dead ||
        e.name === character.name
      )
        continue;
      if (e.map && e.map !== CFG.STAND_SPOT.map) continue;
      if (e.x === undefined || d2(CFG.STAND_SPOT, e) > CFG.MLUCK_TOWN_RADIUS)
        continue;
      const b = e.s && e.s.mluck;
      if (b && !(Number(b.ms) < CFG.MLUCK_TOWN_MIN_LEFT_MS)) continue; // has it (ms = time left; unknown = assume plenty)
      if (Date.now() - (skip[e.name] || 0) < CFG.MLUCK_TOWN_RETRY_MS) continue;
      out.push(e);
    }
    return out.sort((a, b) => d2(character, a) - d2(character, b));
  }
  function mluck_town_due() {
    if (
      !mluck_town_on() ||
      is_paused() ||
      has_jobs() ||
      now() < (S.mluck_town_next || 0)
    )
      return false;
    S.mluck_town_next = now() + CFG.MLUCK_TOWN_CHECK_MS;
    return mluck_town_wanted().length > 0;
  }
  async function mluck_town_round() {
    const d = mluck_def();
    const range = Math.max(60, (Number(d.range) || 320) - 40);
    S.mluck_town_skip = S.mluck_town_skip || {};
    let done = 0;
    for (const t of mluck_town_wanted()) {
      if (!alive() || character.rip || has_jobs() || !mluck_town_on()) break;
      let p = parent.entities[t.name] || t;
      if (!p || p.rip || d2(CFG.STAND_SPOT, p) > CFG.MLUCK_TOWN_RADIUS)
        continue; // left town meanwhile
      act("Merchant's Luck", 30, true);
      if (d2(character, p) > range) await call(() => xmove(p.x, p.y));
      p = parent.entities[t.name] || p;
      const res = await call(() => use_skill("mluck", p));
      await wait(400);
      if (res.failed) {
        S.mluck_town_skip[t.name] = Date.now();
        say(
          "Merchant's Luck on " +
            t.name +
            " did not take: " +
            (res.reason || JSON.stringify(res)),
          "#CF575F"
        );
        continue;
      }
      done++;
      S.mluck_town_skip[t.name] = Date.now() - CFG.MLUCK_TOWN_RETRY_MS + 30000; // do not recast within 30 s if the buff flag has not shown up yet
      say("Merchant's Luck (Grinch) cast on " + t.name, "#5BCB5B");
    }
    if (done)
      say(
        "Merchant's Luck: buffed " +
          done +
          " player(s) in town while the Grinch is live",
        "#5BCB5B"
      );
    return go_home();
  }

  // v5 (Sean 2026-11-18): the leader stops by before a forced farm / boss and about hourly: cast on the listed players (nearest first), tell him when done
  function mluck_party_due() {
    const q = S.mluck_req;
    if (!q) return false;
    if (now() - q.at > 180000) {
      S.mluck_req = null;
      return false;
    }
    return !is_paused() && !has_jobs();
  }
  async function mluck_party_round() {
    const q = S.mluck_req;
    S.mluck_req = null;
    if (!q) return;
    const d = mluck_def();
    const range = Math.max(60, (Number(d.range) || 320) - 40);
    const cast = [],
      failed = [];
    let pending = q.names.filter((n) => n !== character.name);
    const t0 = now();
    while (
      pending.length &&
      now() - t0 < CFG.MLUCK_PARTY_WAIT_MS &&
      alive() &&
      !character.rip &&
      !has_jobs()
    ) {
      const here = [];
      for (const n of pending) {
        const p = parent.entities[n];
        if (
          !p ||
          p.type !== "character" ||
          p.rip ||
          p.dead ||
          p.x === undefined
        )
          continue; // not here (yet)
        if (p.map && p.map !== CFG.STAND_SPOT.map) continue;
        if (d2(CFG.STAND_SPOT, p) > CFG.MLUCK_TOWN_RADIUS) continue;
        here.push(p);
      }
      here.sort((a, b) => d2(character, a) - d2(character, b));
      for (const t of here) {
        const b = t.s && t.s.mluck;
        if (b && !(Number(b.ms) < CFG.MLUCK_TOWN_MIN_LEFT_MS)) {
          cast.push(t.name);
          pending = pending.filter((n) => n !== t.name);
          continue;
        } // has it already
        if (character.mp < (Number(d.mp) || 0)) {
          failed.push(t.name);
          pending = pending.filter((n) => n !== t.name);
          continue;
        }
        act("Merchant's Luck", 30, true);
        if (d2(character, t) > range) await call(() => xmove(t.x, t.y));
        const p = parent.entities[t.name] || t;
        const res = await call(() => use_skill("mluck", p));
        await wait(400);
        pending = pending.filter((n) => n !== t.name);
        if (res.failed) {
          failed.push(t.name);
          say(
            "Merchant's Luck on " +
              t.name +
              " did not take: " +
              (res.reason || JSON.stringify(res)),
            "#CF575F"
          );
        } else {
          cast.push(t.name);
          say("Merchant's Luck (party stop) cast on " + t.name, "#5BCB5B");
        }
      }
      if (pending.length) await wait(1500);
    }
    for (const n of pending) failed.push(n); // never showed up in town
    reply(q.from, { type: "mluck_done", id: q.id, cast, failed });
    return go_home();
  }
