  // ---- hourly status report (Sean 2026-11-20) ----
  // every character adds a "stat" block to the gear report it sends every minute; the XP gained is summed from the samples (a level-up counts the rest of the old level plus the new XP)
  function stat_note(name, st) {
    if (!st || typeof st !== "object") return;
    const num = (v, lo, hi) =>
      Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.floor(+v))) : 0;
    const cur = {
      level: num(st.level, 0, 200),
      xp: num(st.xp, 0, 1e13),
      max_xp: num(st.max_xp, 0, 1e13),
      free: num(st.free, 0, 200),
      deaths: num(st.deaths, 0, 1e6),
      gold: num(st.gold, 0, 1e13),
      farm: typeof st.farm === "string" ? st.farm.slice(0, 20) : "",
    };
    const dr = {}; // looted items, counted by the character since its script started
    if (st.drops && typeof st.drops === "object")
      for (const n of Object.keys(st.drops).slice(0, 60)) {
        const q = num(st.drops[n], 0, 1e9);
        if (q > 0 && /^[a-z0-9_]{1,40}$/i.test(n)) dr[n] = q;
      }
    // chest diagnostics the Warrior / Priest send (Sean 2026-11-20): chests seen, loot calls made with a chest in view, chests opened, items received, failed calls
    let ch = null;
    if (st.chests && typeof st.chests === "object") {
      ch = {};
      for (const k of ["seen", "tries", "opened", "items", "fails"]) ch[k] = num(st.chests[k], 0, 1e9);
      ch.last_fail = typeof st.chests.last_fail === "string" ? st.chests.last_fail.replace(/[^\w .:,'-]/g, "").slice(0, 40) : "";
    }
    const p =
      S.st[name] ||
      (S.st[name] = {
        gain: 0,
        last: null,
        cur: null,
        deaths0: cur.deaths,
        at: 0,
        drops: {},
        drops_last: null,
      });
    if (ch) {
      // counted per hour from the changes between two reports (a smaller number = the script restarted: count from zero again)
      p.ch = p.ch || { seen: 0, tries: 0, opened: 0, items: 0, fails: 0, last_fail: "" };
      for (const k of ["seen", "tries", "opened", "items", "fails"]) {
        const was = p.ch_last ? p.ch_last[k] : 0;
        p.ch[k] += ch[k] >= was ? ch[k] - was : ch[k];
      }
      if (ch.last_fail) p.ch.last_fail = ch.last_fail;
      p.ch_last = ch;
    }
    if (p.last) {
      if (cur.level === p.last.level) p.gain += Math.max(0, cur.xp - p.last.xp);
      else if (cur.level > p.last.level)
        p.gain += Math.max(0, p.last.max_xp - p.last.xp) + cur.xp;
    }
    if (p.drops_last) {
      // new since the last sample (a smaller count = the character's script restarted: count from zero again)
      for (const n of Object.keys(dr)) {
        const was = p.drops_last[n] || 0;
        const d = dr[n] >= was ? dr[n] - was : dr[n];
        if (d > 0) p.drops[n] = (p.drops[n] || 0) + d;
      }
    }
    p.drops_last = dr;
    if (cur.deaths < p.deaths0) p.deaths0 = cur.deaths; // the script restarted: its counter began again
    p.last = { level: cur.level, xp: cur.xp, max_xp: cur.max_xp };
    p.cur = cur;
    p.at = now();
  }
  function bank_note() {
    try {
      if (character.bank && typeof character.bank.gold === "number")
        S.bank_seen = {
          gold: character.bank.gold,
          free: bank_free_slots(),
          at: now(),
        };
    } catch (e) {}
  }
  setInterval(bank_note, 20000);
  const short_n = (n) => {
    const a = Math.abs(n);
    const t =
      a >= 1e9
        ? (n / 1e9).toFixed(2) + "B"
        : a >= 1e6
        ? (n / 1e6).toFixed(2) + "M"
        : a >= 1e3
        ? (n / 1e3).toFixed(1) + "k"
        : String(Math.round(n));
    return t;
  };
  const signed = (n) => (n >= 0 ? "+" : "-") + short_n(Math.abs(n));
  const iso_now = () => {
    try {
      return new Date().toISOString();
    } catch (e) {
      return String(now());
    }
  };
  // keep the report in the game's storage and post it to the Google Sheet (fire and forget: a no-cors POST cannot be read back)
  function report_out(rows) {
    try {
      let hist = [];
      try {
        hist = JSON.parse(get("status_history") || "[]");
        if (!Array.isArray(hist)) hist = [];
      } catch (e) {
        hist = [];
      }
      hist.push({ at: iso_now(), rows });
      set("status_history", JSON.stringify(hist.slice(-CFG.REPORT_HISTORY)));
    } catch (e) {}
    let url = CFG.REPORT_URL;
    let token = CFG.REPORT_TOKEN;
    try {
      url = String(get("report_url") || url || "");
      token = String(get("report_token") || token || "");
    } catch (e) {}
    if (!url) return say("Report sheet: no URL set (REPORT_URL in the CFG, or set('report_url','...')) - the report stays in the game's storage only", "#E1A951");
    say("Report sheet: sending " + rows.length + " row(s) to " + url.replace(/^https?:\/\//, "").slice(0, 40) + "... (token " + (token ? "set" : "EMPTY") + ")", "#8AB4D0");
    const sent_at = now();
    let answered = false;
    setTimeout(() => {
      if (!answered) say("Report sheet: no answer from the web app after 30 s - the request is still pending (check the network / the web app deployment)", "#E1A951");
    }, 30000);
    try {
      const f =
        typeof fetch === "function"
          ? fetch
          : parent && parent.fetch
          ? parent.fetch.bind(parent)
          : null;
      if (!f)
        return say(
          "Report sheet: this browser has no fetch - the report stays in the game's storage only",
          "#E1A951"
        );
      Promise.resolve(
        f(url, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ token, rows }),
        })
      ).then(
        () => {
          answered = true;
          say(
            "Report sheet: " +
              rows.length +
              " row(s) sent in " + Math.round((now() - sent_at) / 100) / 10 + " s (the answer cannot be read back: check the sheet)",
            "#8AB4D0"
          );
        },
        (e) => {
          answered = true;
          say(
            "Report sheet: sending failed: " + ((e && e.message) || e),
            "#E1A951"
          );
        }
      );
    } catch (e) {
      say(
        "Report sheet: sending failed: " + ((e && e.message) || e),
        "#E1A951"
      );
    }
  }
  // looted items without the Christmas ones, most first: [[name, qty], ...]
  function drops_list(o) {
    const out = [];
    for (const n of Object.keys(o || {})) {
      if ((CFG.DROPS_SKIP || []).indexOf(n) !== -1) continue;
      try {
        if (CFG.DROPS_SKIP_HOLIDAYS && G.items[n] && G.items[n].set === "holidays") continue;
      } catch (e) {}
      if (o[n] > 0) out.push([n, o[n]]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  }
  const drops_text = (l, max) =>
    l
      .slice(0, max || 99)
      .map((x) => x[1] + "x " + x[0])
      .join(", ") + (max && l.length > max ? ", +" + (l.length - max) + " more" : "");
  function status_report() {
    try {
      bank_note();
      const parts = [];
      const rows = []; // one row per character for the sheet: time, who, level, xp gained, % of level, deaths, bag free, farm, gold, bank gold, bank free slots
      const stamp = iso_now();
      let farm = "";
      for (const name of Object.keys(S.st)) {
        const p = S.st[name];
        if (!p.cur) continue;
        const pct = p.cur.max_xp
          ? Math.round((p.gain / p.cur.max_xp) * 1000) / 10
          : 0;
        const dead = p.cur.deaths - p.deaths0;
        const silent = now() - p.at > CFG.STATUS_STALE_MS;
        const dl = drops_list(p.drops);
        if (p.cur.farm) farm = p.cur.farm;
        parts.push(
          name +
            " L" +
            p.cur.level +
            " " +
            signed(p.gain) +
            " xp (" +
            pct +
            "% of a level)" +
            ", " +
            dead +
            " death" +
            (dead === 1 ? "" : "s") +
            ", " +
            p.cur.free +
            " bag slots free" +
            (dl.length ? ", drops: " + drops_text(dl, 8) : "") +
            (p.ch
              ? ", chests: seen " + p.ch.seen + " / loot calls " + p.ch.tries + " / opened " + p.ch.opened + " / items " + p.ch.items + (p.ch.fails ? " / failed " + p.ch.fails + (p.ch.last_fail ? " (" + p.ch.last_fail + ")" : "") : "")
              : "") +
            (silent
              ? " [no report for " +
                Math.round((now() - p.at) / 60000) +
                " min]"
              : "")
        );
        rows.push([
          stamp,
          name,
          p.cur.level,
          p.gain,
          pct,
          dead,
          p.cur.free,
          p.cur.farm,
          p.cur.gold,
          "",
          "",
          drops_text(dl), // column 12: what was looted (Christmas items left out), e.g. "12x beewings, 3x poison"
        ]);
        p.drops = {};
        if (p.ch) p.ch = { seen: 0, tries: 0, opened: 0, items: 0, fails: 0, last_fail: "" };
        p.gain = 0;
        p.deaths0 = p.cur.deaths;
      }
      const gold = Math.floor(character.gold || 0);
      const bank = S.bank_seen;
      const prev = S.rep_prev;
      const mins = S.rep_at ? Math.round((now() - S.rep_at) / 60000) : null;
      const money =
        "Goodies L" +
        character.level +
        " gold " +
        short_n(gold) +
        (prev ? " (" + signed(gold - prev.gold) + ")" : "") +
        ", " +
        free_slots() +
        " bag slots free" +
        (bank
          ? "; bank " +
            short_n(bank.gold) +
            (prev && prev.bank != null
              ? " (" + signed(bank.gold - prev.bank) + ")"
              : "") +
            ", " +
            bank.free +
            " item slots free (seen " +
            Math.max(0, Math.round((now() - bank.at) / 60000)) +
            " min ago)"
          : "; bank not seen yet");
      say(
        "Hourly report" +
          (mins ? " (last " + mins + " min)" : " (since the script started)") +
          (farm ? " - farming " + farm : "") +
          ": " +
          (parts.length ? parts.join(" | ") : "no party reports yet") +
          " | " +
          money,
        "#8AB4D0"
      );
      rows.push([
        stamp,
        "Goodies",
        character.level,
        "",
        "",
        "",
        free_slots(),
        "",
        gold,
        bank ? bank.gold : "",
        bank ? bank.free : "",
      ]);
      S.rep_prev = { gold, bank: bank ? bank.gold : null };
      S.rep_at = now();
      report_out(rows);
    } catch (e) {
      say("Hourly report failed: " + ((e && e.message) || e), "#CF575F");
    }
  }
  S.rep_at = now();
  setInterval(() => {
    if (CFG.STATUS_REPORT && alive()) status_report();
  }, CFG.STATUS_REPORT_MS);
  setInterval(() => {
    try {
      if (String(get("status_report") || "") === "1") {
        set("status_report", "");
        status_report();
      }
    } catch (e) {}
  }, 10000);
  function sched_status() {
    const parts = [];
    for (const t of SCHED.tasks) {
      if (!t.next) continue;
      if (t.on && !t.on()) {
        parts.push(t.name + " off");
        continue;
      }
      const n = t.next();
      let s =
        t.name +
        " " +
        (!Number.isFinite(n) || n <= now()
          ? sched_ready(t) // timer is up: "ready" only if the round would really start now, otherwise "idle" (nothing to do / conditions not met)
            ? "ready"
            : "idle"
          : "in " + sched_min(n - now()));
      const st = t.stats;
      if (st.runs)
        s +=
          " (ran " +
          st.runs +
          "x, last " +
          sched_min(now() - st.last_end) +
          " ago, took " +
          sched_min(st.last_ms) +
          (st.errors ? ", " + st.errors + " errors" : "") +
          ")";
      if (st.deferred) s += " [waited " + st.deferred + "x]";
      parts.push(s);
    }
    if (PACE.n)
      parts.push(
        "paced requests " +
          PACE.n +
          " (held back " +
          Math.round(PACE.held_ms / 1000) +
          "s)"
      );
    say("Schedule: " + parts.join("; "), "#8AB4D0");
  }
  setInterval(() => {
    try {
      if (String(get("sched_status") || "") === "1") {
        set("sched_status", "");
        sched_status();
      }
    } catch (e) {}
  }, 10000);
  async function sched_run(t, sm) {
    // note the tasks whose timers are also up: they wait their turn (data for tuning the order)
    const waiting = SCHED.tasks.filter((o) => o !== t && sched_ready(o));
    for (const o of SCHED.tasks) {
      if (o === t) o.wait_since = 0;
      else if (waiting.includes(o)) {
        o.stats.deferred++;
        if (!o.wait_since) o.wait_since = now();
      } else o.wait_since = 0; // not due any more (paused, job queued, ...): the waiting clock starts again next time
    }
    if (waiting.length && now() - SCHED.collide_at > 10 * 60000) {
      SCHED.collide_at = now();
      say(
        "Also due after " +
          t.label +
          ": " +
          waiting.map((o) => o.name).join(", "),
        "#8AB4D0"
      );
    }
    sm(t.label, P.ETA_S.round_setup);
    ACT.round = true;
    const st = t.stats;
    st.runs++;
    st.last_start = now();
    try {
      await t.run();
    } catch (e) {
      st.errors++;
      st.last_err = String((e && e.message) || e);
      throw e;
    } finally {
      st.last_end = now();
      st.last_ms = st.last_end - st.last_start;
    }
  }
