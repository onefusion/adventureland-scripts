  // ========================== FARM GOALS ==========================
  const goals_on = () => {
    if (!CFG.GOALS_ENABLED) return false;
    try {
      const v = String(get("farm_goals") || "").toLowerCase();
      if (v === "off" || v === "none" || v === "false" || v === "0")
        return false;
    } catch (e) {}
    return true;
  };
  const pct = (c) =>
    (c * 100 < 1 ? (c * 100).toFixed(2) : Math.round(c * 1000) / 10) + "%";
  // kill time and the odds of what the goal is after, from the game data
  function goal_estimate(def, g) {
    const dps = Math.max(
      1,
      character.attack * character.frequency * CFG.HUNT_EFFICIENCY
    );
    const ttk = def.hp / dps;
    const table = G.drops && G.drops.monsters && G.drops.monsters[g.type];
    const notes = [];
    for (const w of g.want || []) {
      const e = Array.isArray(table) && table.find((x) => x && x[1] === w);
      if (e && e[0] > 0) {
        const kills = Math.ceil(1 / e[0]);
        notes.push(
          ((G.items[w] && G.items[w].name) || w) +
            " " +
            pct(e[0]) +
            " (~" +
            kills +
            " kills, ~" +
            Math.round((kills * ttk) / 60) +
            " min at my speed)"
        );
      }
    }
    return { ttk, notes };
  }
  function goal_assess(g) {
    const def = G.monsters[g.type];
    if (!def) return { ok: false, why: "unknown monster type " + g.type };
    const name = def.name || g.type;
    if (def.hp > CFG.GOAL_MAX_HP)
      return {
        ok: false,
        why: name + " has " + def.hp + " HP (limit " + CFG.GOAL_MAX_HP + ")",
      };
    if (!nearest_spawn(g.type, R.goal_bad[g.type]))
      return { ok: false, why: name + " has no regular spawn I can walk to" };
    const difficulty = difficulty_of({
      attack: def.attack,
      frequency: def.frequency,
      hp: def.hp,
    });
    if (difficulty > CFG.GOAL_MAX_DIFFICULTY)
      return {
        ok: false,
        why: name + " is too dangerous (difficulty " + difficulty + ")",
      };
    const est = goal_estimate(def, g);
    if (est.ttk > CFG.GOAL_MAX_TTK_S)
      return {
        ok: false,
        why:
          "one " +
          name +
          " would take ~" +
          Math.round(est.ttk) +
          "s (limit " +
          CFG.GOAL_MAX_TTK_S +
          "s)",
      };
    return { ok: true, name, est, difficulty };
  }
  function goal_pick() {
    let best = null;
    for (const g of CFG.GOALS) {
      if (g.enabled === false || (R.goal_cool[g.type] || 0) > now()) continue;
      if (g.every_min && now() < (R.goal_start[g.type] || 0) + g.every_min * 60000) continue; // v5: at most one visit per every_min
      const v = goal_assess(g);
      if (!v.ok) {
        if (now() - (R.goal_logged[g.type] || 0) > 1800000) {
          R.goal_logged[g.type] = now();
          say("Farm goal " + g.type + " skipped: " + v.why, "#CF575F");
        }
        continue;
      }
      const last = R.goal_end[g.type] || 0;
      if (!best || last < best.last) best = { g, v, last };
    }
    return best;
  }
  const loot_text = (o) => {
    const k = Object.keys(o);
    return k.length ? k.map((n) => o[n] + "x " + n).join(", ") : "nothing";
  };
  // Sean 2026-11-20: every item this character loots is counted (since the script started) and sent to the Merchant in the gear report; he filters out the Christmas items and puts the rest in the hourly report / sheet
  var drops = {}; // (var + the guard: the gear report can run before this line is reached)
  function drops_out() {
    if (!drops) return {};
    const k = Object.keys(drops).sort((a, b) => drops[b] - drops[a]).slice(0, 40);
    const o = {};
    for (const n of k) o[n] = drops[n];
    return o;
  }
  try {
    // v5: what dropped while a goal was running (and the all-time drop count above; one hook for both)
    character.on("loot", (d) => {
      if (d) for (const it of d.items || []) if (it && it.name) drops[it.name] = (drops[it.name] || 0) + (it.q || 1);
      const g = R.goal;
      if (!g || !d) return;
      for (const it of d.items || []) if (it && it.name) g.loot[it.name] = (g.loot[it.name] || 0) + (it.q || 1);
    });
  } catch (e) {}
  function end_goal(why, cool_ms) {
    const g = R.goal;
    if (!g) return;
    say("Farm goal " + g.name + " ended: " + why, "#51D2E1");
    {
      // v5: result of this session, and the running total for this type
      const mins = Math.round((now() - g.started) / 60000);
      const st = (R.goal_stats[g.type] = R.goal_stats[g.type] || { runs: 0, seen_runs: 0, kills: 0, ms: 0, loot: {} });
      st.runs++;
      if (g.first_seen) st.seen_runs++;
      st.kills += g.kills;
      st.ms += now() - g.started;
      for (const n in g.loot) st.loot[n] = (st.loot[n] || 0) + g.loot[n];
      say(
        "Farm goal " + g.name + " result: " + mins + " min, " + (g.first_seen ? "seen (first after " + Math.round(g.first_seen / 60000) + " min)" : "never seen") + ", kills ~" + g.kills + ", " + Object.keys(g.visited).length + " of " + g.areas + " areas searched, loot: " + loot_text(g.loot) +
          " | all sessions so far: " + st.runs + " (seen in " + st.seen_runs + "), " + st.kills + " kills, " + Math.round(st.ms / 60000) + " min, loot: " + loot_text(st.loot),
        "#51D2E1"
      );
    }
    R.goal_end[g.type] = now();
    // Sean 2026-11-23: a persistent tally per goal type (CFG.GOAL_TALLY) that survives reloads: one row per session {at, min, kills, loot}. Read it in the game console:  console.log(get("al_tally_frog"))
    try {
      if ((CFG.GOAL_TALLY || []).indexOf(g.type) !== -1) {
        const key = "al_tally_" + g.type;
        const t = JSON.parse(get(key) || "null") || { rows: [] };
        t.rows.push({ at: new Date().toISOString(), min: Math.round((now() - g.started) / 60000), kills: g.kills, loot: g.loot });
        if (t.rows.length > 300) t.rows = t.rows.slice(-300);
        set(key, JSON.stringify(t));
        // Sean 2026-11-23: also post the row to a Google Sheet (a tiny Apps Script web app, see agent/drop-tally-google-sheet.md) so server restarts / a cleared browser never lose it.
        // CFG.TALLY_URL "" = off. Posted with fetch (no-cors, fire and forget); a failure only costs one console line.
        const tally_url = (() => { try { return String(get("tally_url") || "") || CFG.TALLY_URL; } catch (e) { return CFG.TALLY_URL; } })();
        if (tally_url) {
          try {
            const row = { who: character.name, type: g.type, at: new Date().toISOString(), min: Math.round((now() - g.started) / 60000), kills: g.kills, loot: g.loot };
            fetch(tally_url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(row) }).then(() => console.log("[tally] sent to the sheet"), (e) => console.log("[tally] sheet post failed: " + ((e && e.message) || e)));
          } catch (e) {}
        }
        const tot = { min: 0, kills: 0, loot: {} };
        for (const r of t.rows) { tot.min += r.min; tot.kills += r.kills; for (const n in r.loot) tot.loot[n] = (tot.loot[n] || 0) + r.loot[n]; }
        const line = "TALLY " + g.type + ": " + t.rows.length + " sessions, " + tot.min + " min, " + tot.kills + " kills, loot " + loot_text(tot.loot) + (tot.kills && tot.loot["5bucks"] ? " - Old Paper Money 1 per " + Math.round(tot.kills / tot.loot["5bucks"]) + " kills" : "") + "  (full list: console.log(get(\"" + key + "\")))";
        say(line, "#51D2E1");
        try { console.log(line); } catch (e) {}
      }
    } catch (e) {}
    if (cool_ms) R.goal_cool[g.type] = now() + cool_ms;
    R.goal = null;
    R.lock = null;
    R.goal_check_at = now() + 5000;
  }
  // true = he is walking / waiting for the goal monster; false = nothing to do here (monster in view -> normal combat, or no goal)
  async function goal_step() {
    if (!goals_on()) {
      if (R.goal) end_goal("switched off", 0);
      return false;
    }
    if (hunt_state() && R.mh && R.mh.verdict && R.mh.verdict.ok) return false; // an accepted Daisy hunt wins
    let g = R.goal;
    if (!g) {
      if (now() < R.goal_check_at) return false;
      R.goal_check_at = now() + 20000;
      const pick = goal_pick();
      if (!pick) return false;
      if (courier_on() && is_leader() && party_min_potions() <= CFG.COURIER_QUIET_AT && now() - (R.goal_gate_since || (R.goal_gate_since = now())) < 600000) {
        if (now() - (R.goal_gate_note || 0) > 300000) {
          R.goal_gate_note = now();
          say("Farm goal " + pick.v.name + " waits for a potion restock first (someone is at " + party_min_potions() + ")", "#E1A951");
        }
        return false;
      }
      R.goal_gate_since = 0;
      R.goal_start[pick.g.type] = now();
      g = R.goal = {
        cfg: pick.g,
        type: pick.g.type,
        name: pick.v.name,
        started: now(),
        near_since: 0,
        patrol_at: 0,
        busy: false,
        fails: 0,
        box_fails: 0,
        visited: {}, // v5: areas already searched in this goal's sweep
        areas: spawn_area_count(pick.g.type), // v5: counted once per goal (the loop runs this step many times a second)
        ids: {}, // v5: goal monsters in view (id -> last hp fraction), to estimate kills
        kills: 0,
        first_seen: 0, // ms after the start when one was first in view
        loot: {},
        note_at: 0,
        bad: (R.goal_bad[pick.g.type] = R.goal_bad[pick.g.type] || {}),
      };
      say(
        "Farm goal: " +
          g.name +
          " for " +
          (pick.g.session_min || 30) +
          " min. One kill ~" +
          Math.round(pick.v.est.ttk) +
          "s. " +
          (pick.v.est.notes.join("; ") || "no listed drops"),
        "#5BCB5B"
      );
    }
    const def = G.monsters[g.type] || {};
    if (now() - g.started > (g.cfg.session_min || 30) * 60000) {
      end_goal("session time is up", 0);
      return false;
    }
    const seen = visible_monsters().filter((e) => e.mtype === g.type);
    {
      // v5: kill estimate (a goal monster that vanished at low HP), first sighting, and the 1-minute progress line
      const here = {};
      for (const e of seen) {
        here[e.id] = true;
        g.ids[e.id] = { hp: e.max_hp ? e.hp / e.max_hp : 1, at: now() };
      }
      for (const id in g.ids)
        if (!here[id] && now() - g.ids[id].at > 1500) {
          if (g.ids[id].hp < 0.35) g.kills++;
          delete g.ids[id];
        }
      if (seen.length && !g.first_seen) g.first_seen = now() - g.started || 1;
      if (now() - g.note_at >= CFG.GOAL_NOTE_MS) {
        g.note_at = now();
        const where = seen.length
          ? seen.length + " in view (" + Math.round((seen[0].max_hp ? seen[0].hp / seen[0].max_hp : 1) * 100) + "% HP)"
          : g.near_since
          ? "searching area " + (Object.keys(g.visited).length + 1) + " of " + g.areas + " (" + Math.round((now() - g.near_since) / 1000) + "s there)"
          : "walking to " + (g.areas > 1 ? "area " + (Object.keys(g.visited).length + 1) + " of " + g.areas : "the spawn");
        say(
          "Goal: " + g.name + " - " + Math.round((now() - g.started) / 60000) + " of " + (g.cfg.session_min || 30) + " min | " + where + " | at " + character.map + " " + Math.round(character.x) + "," + Math.round(character.y) + " | kills ~" + g.kills + ", loot: " + loot_text(g.loot),
          "#5BCB5B"
        );
      }
    }
    if (seen.length) {
      g.near_since = g.near_since || now();
      g.seen_at = now();
      if (character.hp >= character.max_hp * 0.7) {
        const worst = Math.max.apply(null, seen.map(difficulty_of));
        if (worst > CFG.GOAL_MAX_DIFFICULTY) {
          end_goal(
            "rated " +
              (worst >= 2 ? "hard" : "difficulty " + worst) +
              " up close",
            30 * 60000
          );
          return false;
        }
      }
      return false; // in view: normal combat (it is a priority target)
    }
    if (party_fight_pause(g)) return false; // a party member is under attack: no walking on, combat helps first
    if (g.busy || smart.moving || is_moving(character)) return true;
    const sweep = g.areas > 1;
    const spawn = nearest_spawn(g.type, g.bad, sweep ? g.visited : null);
    if (!spawn) {
      if (sweep && Object.keys(g.visited).length) {
        end_goal("searched every " + g.name + " spawn area without seeing it", CFG.GOAL_SWEEP_REST_MS);
        return false;
      }
      end_goal("no reachable " + g.name + " spawn left", 30 * 60000);
      return false;
    }
    const bx0 = spawn.box;
    const near =
      character.map === spawn.map &&
      (d2(character, spawn) <= CFG.HUNT_ARRIVE_RADIUS ||
        (character.x >= bx0[1] - 80 &&
          character.x <= bx0[3] + 80 &&
          character.y >= bx0[2] - 80 &&
          character.y <= bx0[4] + 80));
    if (!near) g.near_since = 0;
    let dest = spawn;
    if (near) {
      g.near_since = g.near_since || now();
      if (sweep && now() - g.near_since > CFG.GOAL_BOX_WAIT_MS) {
        g.visited[spawn.map + ":" + spawn.box.slice(1).join(",")] = now();
        g.near_since = 0;
        g.box_fails = 0;
        say("Not here (" + Object.keys(g.visited).length + " of " + g.areas + " " + g.name + " spawn areas searched) - trying the next one", "#E1A951");
        return true;
      }
      if (!sweep && now() - g.near_since > CFG.GOAL_WAIT_MS) {
        end_goal(
          "not in view after " +
            Math.round(CFG.GOAL_WAIT_MS / 1000) +
            "s (respawning)",
          def.respawn > 0 ? def.respawn * 1000 : 600000
        );
        return false;
      }
      if (now() - g.patrol_at < 6000) return true;
      g.patrol_at = now();
    }
    if (near || g.box_fails > 0) {
      const bx = spawn.box;
      dest = {
        map: spawn.map,
        x: bx[1] + Math.random() * (bx[3] - bx[1]),
        y: bx[2] + Math.random() * (bx[4] - bx[2]),
      };
      log_move(dest, "searching for " + g.name);
    } else log_move(dest, "heading to " + g.name + " (farm goal)");
    g.busy = true;
    g.aborted = false;
    call(() => smart_move(dest)).then((r) => {
      g.busy = false;
      if (g.aborted) return void (g.aborted = false); // cancelled by a party fight, not a path failure
      if (r.failed || r.success === false) {
        g.fails++;
        g.box_fails++;
        say(
          "Could not walk to " +
            describe_dest(dest) +
            " (" +
            (r.reason || "no path") +
            ") - failure " +
            g.fails +
            "/" +
            CFG.GOAL_MAX_PATH_FAILS,
          "#CF575F"
        );
        if (g.box_fails >= 2) {
          g.bad[spawn.map + ":" + spawn.box.slice(1).join(",")] = true;
          g.box_fails = 0;
        }
        if (g.fails >= CFG.GOAL_MAX_PATH_FAILS && R.goal === g)
          end_goal("no path to " + g.name, 30 * 60000);
      } else {
        g.fails = 0;
        g.box_fails = 0;
      }
    });
    return true;
  }
