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
    watch_events_raw(sch);
    witch_watch();
  }
  // 2026-11-21 (Goo Brawl / Witch's Cipher plan): learn the live shapes. Everything below only logs, to the game log and the console (copyable).
  const out = (m) => {
    say(m, "#E0A040");
    try {
      console.log("[watch] " + m);
    } catch (e) {}
  };
  const short = (v, n) => {
    let t = "";
    try {
      t = typeof v === "string" ? v : JSON.stringify(v);
    } catch (e) {
      t = String(v);
    }
    return t && t.length > (n || 700) ? t.slice(0, n || 700) + "...(" + t.length + " chars)" : t;
  };
  WATCH.raw = {};
  function watch_events_raw(sch) {
    for (const o of (sch && sch.events) || []) {
      if (!o || (CFG.WATCH_EVENTS_LOG || []).indexOf(o.event) === -1) continue;
      const key = o.id + "|" + o.status + "|" + o.at;
      if (WATCH.raw[o.id] === key) continue;
      WATCH.raw[o.id] = key;
      const mins = Math.round((o.at - (Date.now() + WATCH.offset)) / 60000);
      out("Event entry: " + short(o) + " (starts in " + mins + " min; server clock offset " + Math.round(WATCH.offset / 1000) + " s)");
    }
  }
  const WITCH_ITEMS = ["verdantspore", "frostscale", "embercoal", "gloomfeather", "witchparcel", "cipherdraught"];
  WATCH.witch = { sig: {}, bag: "", asked_at: 0 };
  function witch_watch() {
    if (!CFG.WATCH_WITCH) return;
    const changed = (k, v) => {
      const t = short(v, 4000);
      if (WATCH.witch.sig[k] === t) return false;
      WATCH.witch.sig[k] = t;
      return true;
    };
    try {
      if (typeof character !== "undefined" && character.witchcipher !== undefined && changed("char", character.witchcipher)) out("Witch's Cipher, this account (character.witchcipher): " + short(character.witchcipher));
    } catch (e) {}
    try {
      const b = parent.server && parent.server.status && parent.server.status.witchcipher;
      if (b !== undefined && changed("board", b)) out("Witch's Cipher, shared board (server.status.witchcipher): " + short(b, 1500) + (AL.witch && AL.witch.parse_board(b) ? " -> " + AL.witch.candidates(AL.witch.parse_board(b)).length + " recipes still fit" : " -> board shape not read by AL.witch.parse_board"));
    } catch (e) {}
    try {
      const sv = typeof server !== "undefined" ? server : null;
      const b = sv && sv.status && sv.status.witchcipher;
      if (b !== undefined && changed("board", b)) out("Witch's Cipher, shared board (server.status.witchcipher): " + short(b, 1500));
    } catch (e) {}
    if (typeof witch_cipher_info === "function" && now() - WATCH.witch.asked_at >= 30 * 60000) {
      WATCH.witch.asked_at = now();
      Promise.resolve()
        .then(() => witch_cipher_info())
        .then((r) => {
          if (changed("info", r)) out("witch_cipher_info(): " + short(r));
        })
        .catch((e) => out("witch_cipher_info() failed: " + ((e && e.message) || e)));
    }
    const have = {};
    for (const it of character.items || []) if (it && WITCH_ITEMS.indexOf(it.name) !== -1) have[it.name] = (have[it.name] || 0) + (it.q || 1);
    const sig = WITCH_ITEMS.map((k) => k + " " + (have[k] || 0)).join(", ");
    if (sig !== WATCH.witch.bag) {
      const first = WATCH.witch.bag === "";
      WATCH.witch.bag = sig;
      if (!first || Object.keys(have).length) out("Witch ingredients in the Merchant's bag: " + sig);
    }
  }