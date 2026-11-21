  // ===== World watch: bosses and events =====
  // The game keeps the server info in S: every live boss is S[monster] = {live, hp, max_hp, map, x, y, target} and
  // the published event lineup is S.schedule.events = [{id, event, at, status}]. Nothing here acts; it only logs.
  // Boss table is kept across reloads in get/set("boss_log"): { monster: {max_hp, last_seen, map, x, y} }.
  const WATCH = { up: {}, warned: {}, report_at: 0, offset: 0, synced: null };
  function boss_table() {
    try {
      return JSON.parse(get("boss_log") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function boss_report() {
    const t = boss_table();
    const rows = Object.keys(t)
      .map((k) => Object.assign({ name: k }, t[k]))
      .sort((a, b) => b.max_hp - a.max_hp);
    if (!rows.length) return "no boss seen yet";
    return rows
      .map((r) => {
        const live = WATCH.up[r.name];
        const ago = Math.round((now() - r.last_seen) / 60000);
        return (
          r.name +
          " (" +
          Math.round(r.max_hp / 1000) +
          "k HP) " +
          (live ? "UP now at " : "last seen " + ago + " min ago at ") +
          r.map +
          " " +
          Math.round(r.x) +
          "," +
          Math.round(r.y)
        );
      })
      .join(" | ");
  }
  function world_watch() {
    if (!CFG.WATCH_ENABLED) return;
    let Sv = null;
    try {
      Sv = parent.S;
    } catch (e) {}
    if (!Sv || typeof Sv !== "object") return;
    const t = boss_table();
    let dirty = false;
    const seen = {};
    for (const k of Object.keys(Sv)) {
      const b = Sv[k];
      if (
        !b ||
        typeof b !== "object" ||
        typeof b.live !== "boolean" ||
        !G.monsters[k]
      )
        continue;
      if (!b.live) continue;
      seen[k] = true;
      const prev = t[k] || {};
      t[k] = {
        max_hp:
          Number(b.max_hp) || Number(G.monsters[k].hp) || prev.max_hp || 0,
        last_seen: now(),
        map: b.map || prev.map,
        x: b.x,
        y: b.y,
      };
      dirty = true;
      if (!WATCH.up[k])
        say(
          "Boss up: " +
            (G.monsters[k].name || k) +
            " (" +
            Math.round(t[k].max_hp / 1000) +
            "k HP, " +
            Math.round(Number(b.hp) / 1000) +
            "k now) at " +
            t[k].map +
            " " +
            Math.round(b.x) +
            "," +
            Math.round(b.y),
          "#E0A040"
        );
    }
    for (const k of Object.keys(WATCH.up))
      if (!seen[k])
        say(
          "Boss gone: " + ((G.monsters[k] && G.monsters[k].name) || k),
          "#E0A040"
        );
    WATCH.up = seen;
    if (dirty) {
      try {
        set("boss_log", JSON.stringify(t));
      } catch (e) {}
    }
    // scheduled events
    const sch = Sv.schedule;
    if (sch && sch.server_time && sch.server_time !== WATCH.synced) {
      WATCH.synced = sch.server_time;
      WATCH.offset = sch.server_time - Date.now();
    }
    const here = Date.now() + WATCH.offset;
    for (const o of (sch && sch.events) || []) {
      if (!o || o.status !== "scheduled" || !(o.at > here)) continue;
      const mins = (o.at - here) / 60000;
      const limits = CFG.WATCH_EVENT_WARN_MIN.filter((w) => mins <= w);
      if (!limits.length) continue;
      const w = Math.min.apply(null, limits); // the closest limit it has passed
      if (WATCH.warned[o.id + ":" + w]) continue;
      for (const w2 of CFG.WATCH_EVENT_WARN_MIN)
        if (w2 >= w) WATCH.warned[o.id + ":" + w2] = true;
      say(
        "Event soon: " +
          ((G.events && G.events[o.event] && G.events[o.event].name) ||
            o.event) +
          " in " +
          Math.ceil(mins) +
          " min",
        "#E0A040"
      );
    }
    if (now() - WATCH.report_at >= CFG.WATCH_REPORT_MS) {
      WATCH.report_at = now();
      say("Bosses (largest first): " + boss_report());
    }
  }