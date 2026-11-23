// ============================== AL.goo: join and fight the Goo Brawl event (2026-11-23, first version) ==============================
// Sean 2026-11-23: push it now and test it on the live event with the party. Everything about the live shapes is UNVERIFIED (see agent/goo-brawl-event-plan.md): the schedule entry
// (server.status.schedule: { event, at, status }), parent.S.goobrawl, and what join('goobrawl') answers. So the module logs what it sees (a "[goo] ..." line in the game log AND the
// console) and joins liberally: a join that is refused only costs a log line.
// - live(): true when the schedule says goobrawl starts within 90 s / started less than 20 min ago (status not done), or parent.S.goobrawl is a live object, or get("goo_go") === "1".
//   get("goo_go") === "0" switches the module off. Console on each character: set("goo_go", "1") to force the join, set("goo_go", "0") to stop it.
// - join: every 20 s (max 40 tries per event) a character with hp >= 50% outside the event map calls join("goobrawl").
// - inside the event map the class scripts must not walk out: smart_move / town / transport are blocked there (the party scripts would "return to the farm" or "go to town").
// - the fight: priority rgoo > bgoo > goo > anything; the Ranger and the Warrior walk to their target and attack it; the Priest keeps his own script's heals (he only attacks what is in range).
// Pure helpers (parse_at, state_of, pick_target) are tested without the game (tests/goo_unit.js).
AL.goo = (function () {
  "use strict";
  const MAP = "goobrawl";
  const ORDER = ["rgoo", "bgoo", "goo"];
  const parse_at = (at) => {
    if (at === undefined || at === null || at === "") return NaN;
    if (typeof at === "number") return at < 1e11 ? at * 1000 : at;
    const n = Number(at);
    if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n;
    return Date.parse(at);
  };
  // schedule = server.status.schedule (array or object of entries), S = parent.S; returns { live, why }
  function state_of(schedule, S, t) {
    try {
      const g = S && S.goobrawl;
      if (g && typeof g === "object" && g.live !== false && g.live !== 0) return { live: true, why: "parent.S.goobrawl" };
      if (g === true) return { live: true, why: "parent.S.goobrawl" };
    } catch (e) {}
    const list = Array.isArray(schedule) ? schedule : schedule && typeof schedule === "object" ? Object.values(schedule) : [];
    for (const e of list) {
      if (!e || e.event !== "goobrawl") continue;
      const at = parse_at(e.at);
      const st = String(e.status || "");
      if (/done|end|over|finish|clos|cancel/i.test(st)) continue;
      if (Number.isFinite(at) && t >= at - 90000 && t <= at + 20 * 60000) return { live: true, why: "schedule: at " + new Date(at).toISOString() + " status " + (st || "-") };
      if (!Number.isFinite(at) && /live|start|open|run|active|now/i.test(st)) return { live: true, why: "schedule status " + st };
    }
    return { live: false, why: "" };
  }
  // mons = [{ mtype, x, y, hp, dist }]; the first of ORDER that exists (the nearest of that type), else the nearest of anything
  function pick_target(mons) {
    const alive = (mons || []).filter((m) => m && m.hp > 0);
    for (const t of ORDER) {
      const c = alive.filter((m) => m.mtype === t).sort((a, b) => a.dist - b.dist);
      if (c.length) return c[0];
    }
    return alive.sort((a, b) => a.dist - b.dist)[0] || null;
  }

  function start(env) {
    const { say, alive, cls } = env;
    const G0 = globalThis;
    const log = (m, color) => {
      say("[goo] " + m, color || "#CF57CF");
      try { console.log("[goo] " + m); } catch (e) {}
    };
    const inside = () => { try { return character.map === MAP; } catch (e) { return false; } };
    // the party scripts' movers do nothing inside the event map (the goo module moves with move())
    if (!G0.__goo_wrapped) {
      G0.__goo_wrapped = true;
      for (const fn of ["smart_move", "town", "transport"]) {
        const real = G0[fn];
        if (typeof real !== "function") continue;
        (G0.__goo_real = G0.__goo_real || {})[fn] = real;
        G0[fn] = function () {
          if (inside()) return Promise.resolve({ failed: true, reason: "goo brawl: staying inside" });
          return real.apply(this, arguments);
        };
      }
    }
    let empty_since = 0, no_join_until = 0, last_leave = 0;
    // the event is over (no monster left for 60 s): walk to the island's transporter NPC (-347,-483, data: places.main = 9) and ride it back to the main map
    // (Sean 2026-11-23: that NPC is the way out); the game's own "leave" is only the last resort after 40 s
    const NPC = { x: -347, y: -483, to: "main", spawn: 9 };
    let leaving = 0;
    function leave_now(why) {
      if (leaving) return;
      leaving = Date.now();
      no_join_until = Date.now() + 30 * 60000;
      log("leaving the island: " + why + " - walking to the transporter at (" + NPC.x + "," + NPC.y + ")");
    }
    function leave_tick() {
      if (!leaving) return;
      if (!inside()) { leaving = 0; return; }
      if (!alive() || character.rip) return;
      const r = G0.__goo_real || {};
      const d = Math.hypot(character.x - NPC.x, character.y - NPC.y);
      if (d > 120) {
        try { if (Date.now() - last_leave > 3000) { last_leave = Date.now(); if (r.smart_move) r.smart_move({ x: NPC.x, y: NPC.y }); else move(NPC.x, NPC.y); } } catch (e) {}
        return;
      }
      if (Date.now() - last_leave < 4000) return;
      last_leave = Date.now();
      log("at the transporter: transport('" + NPC.to + "', " + NPC.spawn + ")");
      try { (r.transport || G0.transport)(NPC.to, NPC.spawn); } catch (e) { log("transport failed: " + e.message, "#CF575F"); }
      if (Date.now() - leaving > 40000) { try { parent.socket.emit("leave"); } catch (e) {} }
    }
    let tries = 0, last_try = 0, last_sig = "", last_log = 0, was_inside = false, was_live = false;
    const manual = () => { try { return String(get("goo_go") || ""); } catch (e) { return ""; } };
    function join_tick() {
      if (!alive()) return;
      const m = manual();
      if (m === "0") return;
      let sched = null, S = null;
      try { sched = server.status && server.status.schedule; } catch (e) {}
      try { S = parent.S; } catch (e) {}
      const st = m === "1" ? { live: true, why: "manual (goo_go = 1)" } : state_of(sched, S, Date.now());
      // what the server shows about it, once per change (learn the format)
      try {
        const raw = JSON.stringify({ S: S && S.goobrawl, sch: (Array.isArray(sched) ? sched : sched ? Object.values(sched) : []).filter((e) => e && e.event === "goobrawl") });
        if (raw !== last_sig && (st.live || /goobrawl/.test(raw))) {
          last_sig = raw;
          log("event info: " + raw.slice(0, 700));
        }
      } catch (e) {}
      if (st.live !== was_live) { was_live = st.live; log(st.live ? "Goo Brawl looks LIVE (" + st.why + ")" : "Goo Brawl no longer live"); if (st.live) tries = 0; }
      if (inside()) {
        if (!was_inside) { was_inside = true; log("inside the Goo Brawl map at (" + Math.round(character.x) + "," + Math.round(character.y) + ")"); }
        return;
      }
      if (was_inside) { was_inside = false; log("left the Goo Brawl map, now in " + character.map); }
      if (!st.live || tries >= 40 || Date.now() - last_try < 20000 || Date.now() < no_join_until) return;
      if (character.rip || character.hp < character.max_hp * 0.5) return;
      last_try = Date.now();
      tries++;
      let jp;
      try { jp = Promise.resolve(join(MAP)); } catch (e) { jp = Promise.reject(e); }
      jp.then((r) => log("join('" + MAP + "') try " + tries + " -> " + JSON.stringify(r || {}).slice(0, 200)), (e) => log("join('" + MAP + "') try " + tries + " refused: " + JSON.stringify((e && (e.reason || e.message)) || e).slice(0, 200), "#CF575F"));
    }
    function fight_tick() {
      if (!alive() || !inside() || character.rip || leaving) return;
      try {
        const mons = Object.values(parent.entities || {})
          .filter((e) => e && e.type === "monster" && !e.dead && e.hp > 0)
          .map((e) => ({ mtype: e.mtype, x: e.x, y: e.y, hp: e.hp, dist: Math.hypot(e.x - character.x, e.y - character.y), e }));
        if (Date.now() - last_log > 10000) {
          last_log = Date.now();
          const by = {};
          mons.forEach((m) => { const b = (by[m.mtype] = by[m.mtype] || { n: 0, hp: 0, near: 99999 }); b.n++; b.hp += m.hp; b.near = Math.min(b.near, Math.round(m.dist)); });
          const party = (parent.party_list || []).map((n) => { const p = parent.entities[n] || (n === character.name ? character : null); return n + ":" + (p ? Math.round(100 * p.hp / p.max_hp) + "%" + (p.rip ? " DEAD" : "") : "?"); }).join(" ");
          log("(" + Math.round(character.x) + "," + Math.round(character.y) + ") hp " + Math.round(100 * character.hp / character.max_hp) + "% mp " + character.mp + " | " + (Object.keys(by).map((k) => k + " x" + by[k].n + " near " + by[k].near + " hp " + Math.round(by[k].hp)).join(" | ") || "no monsters") + " | " + party);
        }
        const t = pick_target(mons);
        if (!t) {
          if (!empty_since) empty_since = Date.now();
          if (Date.now() - empty_since > 60000) leave_now("no monster in view for 60 s, the event looks over");
          return;
        }
        empty_since = 0;
        const range = character.range || 40;
        if (t.dist > range - 5 && cls !== "priest") {
          // walk to a point just inside attack range, on the line to the target
          const k = Math.max(0, (t.dist - (range - 15)) / t.dist);
          move(character.x + (t.x - character.x) * k, character.y + (t.y - character.y) * k);
        }
        if (t.dist <= range && can_attack(t.e)) {
          if (cls === "priest") return; // the priest's own script heals; his attacks are not the point
          attack(t.e);
        }
      } catch (e) {}
    }
    setInterval(() => { try { join_tick(); } catch (e) {} }, 2000);
    setInterval(() => { try { fight_tick(); } catch (e) {} }, 250);
    setInterval(() => { try { leave_tick(); } catch (e) {} }, 1500);
  }
  return { start, state_of, pick_target, parse_at, MAP };
})();
