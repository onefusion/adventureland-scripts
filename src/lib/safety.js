// ============================== AL.safety: fear pressure, death post-mortem and the death circuit-breaker (2026-11-27) ==============================
// Sean 2026-11-27: "fear-aware targeting and the death circuit-breaker". Everything here is PURE (no game calls): the class scripts feed it parent.entities, the character and
// the death log, and print what it returns. Tested without the game in tests/safety_unit.js.
//
// FEAR (stock Adventure Land rule, from agent/progression-deep-dive-2026-11-25.md; the live server may differ, so the game's own character.fear is reported next to ours):
//   a character that more monsters target than its courage (character.courage for physical attackers, character.mcourage for magical ones; Ranger 2/2, Warrior 10/2,
//   Priest 2/10 measured 2026-11-25) is "feared": damage x0.6 for 1 over, x0.4 for 2 over, x0.2 for 3 or more over, and it moves slower. "Pure" damage monsters do not count.
// DEATHS: every death is recorded with where / what / who was on whom (post-mortem line); several death INCIDENTS in a short time trip the breaker (safe mode in the Ranger glue).
AL.safety = (function () {
  "use strict";
  const DEFAULT_COURAGE = 2;
  const FEAR_DMG = [1, 0.6, 0.4, 0.2]; // estimated damage multiplier by the number of monsters over the courage (0, 1, 2, 3+)
  const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  function courage_of(ch, magical) {
    const v = ch && finite(magical ? ch.mcourage : ch.courage) ? Number(magical ? ch.mcourage : ch.courage) : NaN;
    return v >= 0 ? v : DEFAULT_COURAGE;
  }
  const dmg_est = (excess) => FEAR_DMG[Math.max(0, Math.min(FEAR_DMG.length - 1, excess))];
  const types_text = (types) =>
    Object.keys(types || {})
      .sort((a, b) => types[b] - types[a] || (a < b ? -1 : 1))
      .map((t) => t + " x" + types[t])
      .join(", ");

  // entities: parent.entities (id -> entity); name: the character whose pressure we want; G: game data (G.monsters[type].damage_type); ch: that character's object (for courage)
  function pressure(entities, name, G, ch) {
    let n_phys = 0, n_mag = 0, hp_sum = 0;
    const types = {}, ids = [];
    const mons = (G && G.monsters) || {};
    for (const id in entities || {}) {
      const e = entities[id];
      if (!e || e.type !== "monster" || e.dead || e.rip || e.visible === false || e.target !== name) continue;
      const dt = (mons[e.mtype] || {}).damage_type;
      if (dt === "pure") continue; // pure damage ignores courage
      if (dt === "magical") n_mag++;
      else n_phys++;
      types[e.mtype] = (types[e.mtype] || 0) + 1;
      ids.push(e.id || id);
      hp_sum += Number(e.hp) || 0;
    }
    const courage = courage_of(ch, false), mcourage = courage_of(ch, true);
    const excess = Math.max(0, n_phys - courage) + Math.max(0, n_mag - mcourage);
    return {
      name, n_phys, n_mag, courage, mcourage, excess, over: excess > 0, types, ids, hp_sum,
      dmg_est: dmg_est(excess),
      game_fear: ch && finite(ch.fear) ? Number(ch.fear) : null, // what the game itself says (logged for comparison with our count)
    };
  }
  // true when a multishot (3shot / 5shot pulls up to 3-5 monsters at once) must not be used: already feared, or `at` physical monsters are on him
  const block_multishot = (p, at) => !!p && (p.over || p.n_phys + p.n_mag >= (finite(at) ? Number(at) : DEFAULT_COURAGE));
  // from the monsters that target me (and are in range): the one that dies fastest (lowest HP), so the pressure drops soonest
  function relief_target(list) {
    let best = null;
    for (const e of list || []) {
      if (!e || e.dead || e.rip) continue;
      if (!best || (Number(e.hp) || 0) < (Number(best.hp) || 0)) best = e;
    }
    return best;
  }
  // the tracker state st ({}) lives with the caller; returns the lines to print (start of a feared period, every repeat_ms while it lasts, the end with the worst count)
  function fear_note(st, p, t, hold_ms, repeat_ms) {
    hold_ms = finite(hold_ms) ? hold_ms : 3000;
    repeat_ms = finite(repeat_ms) ? repeat_ms : 30000;
    const out = [];
    if (p && p.over) {
      const on = p.n_phys + p.n_mag;
      const txt = on + " monsters on " + p.name + " (" + types_text(p.types) + "), courage " + p.courage + (p.n_mag ? "/" + p.mcourage + " magical" : "") + ", " + p.excess + " over: damage ~x" + p.dmg_est + (p.game_fear !== null ? ", the game says fear " + p.game_fear : "");
      st.last_over = t;
      if (!st.since) {
        st.since = t; st.noted = t; st.peak = p.excess; st.peak_on = on; st.peak_types = types_text(p.types);
        out.push("FEAR: " + txt);
      } else {
        if (p.excess >= st.peak) { st.peak = p.excess; st.peak_on = on; st.peak_types = types_text(p.types); }
        if (t - st.noted >= repeat_ms) { st.noted = t; out.push("FEAR (still, " + Math.round((t - st.since) / 1000) + " s): " + txt); }
      }
    } else if (st.since && t - st.last_over >= hold_ms) {
      out.push("FEAR over after " + Math.round((st.last_over - st.since) / 1000) + " s; worst: " + st.peak_on + " monsters (" + st.peak_types + "), damage ~x" + dmg_est(st.peak));
      st.since = 0;
    }
    return out;
  }

  // ---------------------------------------------------------------- deaths ----------------------------------------------------------------
  // snaps: { name: [ { t, hp, on, types } ... ] } (newest last); the caller pushes one every ~2 s per party member
  function snap_push(snaps, name, s, keep) {
    const l = (snaps[name] = snaps[name] || []);
    l.push(s);
    while (l.length > (keep || 8)) l.shift();
  }
  // the line printed for a death: where, what it was doing, and what was on him in the last seconds
  function post_mortem(snaps, name, info, t, look_ms) {
    look_ms = look_ms || 15000;
    const l = (snaps[name] || []).filter((s) => t - s.t <= look_ms);
    let txt = "DEAD: " + name + (info && info.where ? " at " + info.where : "") + (info && info.ctx ? " [" + info.ctx + (info.farm ? ": " + info.farm : "") + "]" : "");
    if (l.length) {
      const first = l[0], last = l[l.length - 1];
      const worst = l.reduce((a, s) => (s.on > a.on ? s : a), l[0]);
      txt += ". Last " + Math.round((last.t - first.t) / 1000) + " s: HP " + Math.round(100 * first.hp) + "% -> " + Math.round(100 * last.hp) + "%, up to " + worst.on + " monsters on him" + (worst.types ? " (" + worst.types + ")" : "");
    } else txt += ". No snapshot of the last " + Math.round(look_ms / 1000) + " s";
    return txt;
  }
  // log: array of { t, name, ctx, farm, counted }; adds the entry unless the same name was already logged within dedupe_ms (the death notice arrives from several places); returns { log, added }
  function record(log, entry, keep, dedupe_ms) {
    dedupe_ms = finite(dedupe_ms) ? dedupe_ms : 60000;
    const l = (log || []).slice();
    if (l.some((x) => x.name === entry.name && Math.abs(entry.t - x.t) < dedupe_ms)) return { log: l, added: false };
    l.push(entry);
    l.sort((a, b) => a.t - b.t);
    while (l.length > (keep || 30)) l.shift();
    return { log: l, added: true };
  }
  // an INCIDENT is a cluster of deaths with gaps shorter than cluster_ms (a wipe is one incident); only entries newer than `since` and with counted !== false count
  function breaker(log, t, o) {
    const window_ms = o.window_ms || 3600000, cluster_ms = o.cluster_ms || 120000, since = o.since || 0;
    const l = (log || []).filter((x) => x.counted !== false && t - x.t <= window_ms && x.t > since).sort((a, b) => a.t - b.t);
    let incidents = 0, prev = null;
    for (const x of l) {
      if (prev === null || x.t - prev > cluster_ms) incidents++;
      prev = x.t;
    }
    return { tripped: incidents >= (o.max_incidents || 3), incidents, deaths: l.length, who: l.map((x) => x.name + (x.farm ? "@" + x.farm : "")) };
  }
  // the rotation monster with the fewest recorded deaths in the window (ties: rotation order); `skip(type)` excludes ones that must not be chosen right now
  function safest(rotation, log, t, window_ms, skip) {
    let best = null, best_n = Infinity;
    for (const type of rotation || []) {
      if (skip && skip(type)) continue;
      const n = (log || []).filter((x) => x.farm === type && t - x.t <= (window_ms || 3600000)).length;
      if (n < best_n) { best = type; best_n = n; }
    }
    return best;
  }
  return { pressure, block_multishot, relief_target, fear_note, snap_push, post_mortem, record, breaker, safest, courage_of, types_text, dmg_est };
})();
