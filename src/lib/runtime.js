
// ============================== AL.runtime: the code the follower characters share (stage 2 of the refactor, 2026-11-20) ==============================
// The Warrior and the Priest carried the same ~300 lines (party membership, following, boar flight, wiggle, looting, bag hand-over, gear report,
// potions). They are moved here VERBATIM and read their settings through `env`; what differs between the two comes in as `env.hooks`.
// Sections: [core] ev_keep  [party] leader/members/join/boar/far/wiggle/follow  [loot] bag, hand-over, drops, chest diagnostics, loot tick
//           [supply] drink, warn_potions  [report] gear report, gear receive, status line to the leader.
//
//   const R = AL.runtime.create({ CFG, S, say, alive, mover, hooks })
//   env.CFG / env.S   the character's own config and state objects (the same objects the character file keeps using)
//   env.say           the character's log function;  env.alive() is false once a newer copy of the script started
//   env.mover         AL.mover({ say, ... }) of the character (used for the logged moves of follow_step)
//   env.hooks         optional, per class:
//     handoff_pool()                 -> pool passed to kept_extra for one handoff_slots() pass (Warrior: the reserved magic-set pieces)
//     kept_extra(it, pool)           -> true when the item must stay in the bag in addition to the keep list (Warrior: bashers, reserved pieces)
//     tank_pos()                     -> { map, x, y, ... } the tank's position, or null (Priest follows the Warrior when she is close to a monster)
//     boar_extra_names               -> names counted as "the party" for the boar check (Priest: the tank's name)
//     worn(slot)                     -> the item to report as worn in `slot` (Warrior: the main set while the magic set is on)
//     report_extra()                 -> object merged into the gear_report message after `slots` (Warrior: bag, alt)
//     status_extra()                 -> object merged into the party_level message (Warrior: basher)
//     receive_special(slot, name, level, found) -> async; true when handled (Warrior: "alt:<slot>" and "bag" deliveries); `found` = the item is in the bag
//     slot_ok(slot)                  -> true for the delivery slots the class accepts besides the worn ones
//   Every log line, message and decision is the same as in v5; the only addition is the chest diagnostics (R.chest_stats, sent in the gear report).
AL.runtime = (function () {
  const { now, d2, call, wait } = AL;
  const GEAR_SLOTS = ["helmet", "chest", "pants", "gloves", "shoes", "cape", "ring1", "ring2", "earring1", "earring2", "amulet", "belt", "orb", "mainhand", "offhand"];
  // Sean 2026-11-20: the lines that matter for "why did that happen" are also kept in the game's storage (the console scrolls too fast): game_log(get("events")) shows the last 50
  const EVENT_RE = /^(BOAR|RETREAT|ESCORT|NOT WITH|TRY MONSTER|FORCED FARM|Forced farm|NO BASHER|Basher call|Farm rotation|Boss|Grinch|DANGER|Dead|died|Courier|Junk trip|Potion)/;
  function ev_keep(msg) {
    try {
      if (!EVENT_RE.test(String(msg))) return;
      let a = [];
      try { a = JSON.parse(get("events") || "[]"); if (!Array.isArray(a)) a = []; } catch (e) { a = []; }
      let t = "";
      try { t = new Date().toISOString(); } catch (e) { t = String(Date.now()); }
      a.push({ t, m: String(msg).slice(0, 300) });
      set("events", JSON.stringify(a.slice(-50)));
    } catch (e) {}
  }

  function create(env) {
    const { CFG, S, say, alive, mover } = env;
    const hooks = env.hooks || {};
    const R = {};

    // ---------------------------------------------------- [party]
    R.hp_pct = (e) => (e && e.max_hp ? e.hp / e.max_hp : 1);
    R.leader_entity = () => {
      try {
        return get_player(CFG.PARTY_LEADER);
      } catch (e) {
        return null;
      }
    };
    // where the leader is: his entity when he is on screen, otherwise his last report
    R.leader_pos = function () {
      if (CFG.STAY_ON_TRIP && S.leader && S.leader.trip && S.leader.farm && now() - S.leader.at < CFG.STATE_STALE_MS) return { map: S.leader.farm.map, x: S.leader.farm.x, y: S.leader.farm.y, trip: true };
      const e = R.leader_entity();
      if (e && !e.dead && e.visible !== false && e.x !== undefined)
        return { map: character.map, x: e.x, y: e.y, live: true };
      if (S.leader && now() - S.leader.at < CFG.STATE_STALE_MS) return S.leader;
      return null;
    };
    R.party_members = function () {
      let names = [];
      try {
        names = Object.keys(get_party() || {});
      } catch (e) {}
      if (names.indexOf(CFG.PARTY_LEADER) === -1) names.push(CFG.PARTY_LEADER);
      if (names.indexOf(character.name) === -1) names.push(character.name);
      const out = [];
      for (const n of names) {
        const e = n === character.name ? character : parent.entities[n];
        if (e && !e.rip && !e.dead && e.max_hp) out.push(e);
      }
      return out;
    };
    R.in_range = (e) => {
      try {
        return typeof is_in_range === "function" ? is_in_range(e) : d2(character, e) <= (character.range || 120);
      } catch (err) {
        return false;
      }
    };
    R.party_has = (n) => {
      try {
        return !!(get_party() || {})[n];
      } catch (e) {
        return false;
      }
    };
    // characters Sean launched himself may be missing from get_active_characters(): also count the leader as online when his party_state is recent or he is in view
    R.is_online = (n) => {
      try {
        if (get_active_characters()[n]) return true;
      } catch (e) {
        return true;
      }
      try {
        if (n === CFG.PARTY_LEADER && S.leader && now() - S.leader.at < 60000) return true;
        if (parent.entities && parent.entities[n]) return true;
      } catch (e2) {}
      return false;
    };
    R.party_join_tick = function () {
      if (!alive() || character.rip || now() - S.join_at < CFG.PARTY_JOIN_MS) return;
      S.join_at = now();
      if (R.party_has(CFG.PARTY_LEADER) || !R.is_online(CFG.PARTY_LEADER)) {
        S.out_since = 0;
        return;
      }
      if (!S.out_since) S.out_since = now();
      if (R.is_online(CFG.MERCHANT_NAME) && now() - S.out_since <= 60000) return; // the Merchant sends invitations while he is online: give him a minute
      say("Not in " + CFG.PARTY_LEADER + "'s party - asking to join", "#51D2E1");
      call(() => send_party_request(CFG.PARTY_LEADER));
    };

    // ----- v5 (Sean 2026-11-18): Wild Boars in Winterland -----
    // A boar that targets anybody in the party: tell the leader, walk to the portal NPC and take it to the main map; for BOAR_HOLD_MS do not follow anybody back into Winterland.
    R.boar_seen = function () {
      if (!CFG.BOAR_FLEE || CFG.BOAR_MAPS.indexOf(character.map) === -1) return null;
      const names = R.party_members().map((e) => e.name).concat((hooks.boar_extra_names || []).concat(CFG.COURIERS || []));
      for (const id in parent.entities) {
        const e = parent.entities[id];
        if (e && e.type === "monster" && !e.dead && !e.rip && e.visible !== false && CFG.BOAR_TYPES.indexOf(e.mtype) !== -1 && (e.target === character.name || names.indexOf(e.target) !== -1)) return e;
      }
      return null;
    };
    R.boar_leave = async function (why) {
      S.boar_until = now() + CFG.BOAR_HOLD_MS;
      S.boar_next = now() + 5000;
      if (CFG.BOAR_MAPS.indexOf(character.map) === -1) return false;
      const from = character.map;
      say("BOAR: " + why + " - leaving " + from + " for the main map, staying away for " + Math.round(CFG.BOAR_HOLD_MS / 60000) + " min", "#CF575F");
      let npc = null;
      try { npc = find_npc("transporter"); } catch (e) {}
      if (!npc || npc.map !== from) npc = { map: from, x: CFG.BOAR_PORTAL.x, y: CFG.BOAR_PORTAL.y };
      const r = await call(() => smart_move({ map: from, x: npc.x, y: npc.y }));
      if (r && (r.failed || r.success === false)) { say("BOAR: could not reach the portal NPC: " + (r.reason || "no path"), "#CF575F"); return true; }
      const places = (G.npcs && G.npcs.transporter && G.npcs.transporter.places) || {};
      if (places.main !== undefined) {
        await call(() => parent.socket.emit("transport", { to: "main", s: places.main }));
        const ok = await call(() => wait_for(() => character.map === "main", 8000));
        if (!ok.failed) say("BOAR: took the portal to the main map", "#5BCB5B");
      }
      return true;
    };
    R.boar_check = async function () {
      if (!CFG.BOAR_FLEE || now() < (S.boar_next || 0) || CFG.BOAR_MAPS.indexOf(character.map) === -1) return false;
      const b = R.boar_seen();
      if (!b && !S.boar_cm) return false;
      S.boar_cm = false;
      if (b) call(() => send_cm(CFG.PARTY_LEADER, { type: "boar_alert" }));
      await R.boar_leave(b ? (G.monsters[b.mtype] || {}).name + " is on " + b.target : "the leader says a boar is on the party");
      return true;
    };
    // Sean 2026-11-20: when we are NOT with the leader for a minute, say why (the log scrolls away: it also goes to game_log(get("events")))
    R.far_check = function () {
      try {
        if (!alive() || character.rip) { S.far_since = 0; return; }
        const pos = R.leader_pos();
        if (!pos || (character.map === pos.map && d2(character, pos) <= CFG.FAR_NOTE_PX)) { S.far_since = 0; return; }
        if (!S.far_since) S.far_since = now();
        if (now() - S.far_since < 60000 || now() - (S.far_said || 0) < 300000) return;
        S.far_said = now();
        const sec = (t) => Math.max(0, Math.round(((t || 0) - now()) / 1000));
        say("NOT WITH THE LEADER for " + Math.round((now() - S.far_since) / 1000) + " s: " + CFG.PARTY_LEADER + " is on " + pos.map + " " + Math.round(pos.x) + "," + Math.round(pos.y) + ", I am on " + character.map + " " + Math.round(character.x) + "," + Math.round(character.y) + " | boar hold " + sec(S.boar_until) + " s, retreat hold " + sec(S.retreat_until) + " s, follow blocked " + sec(S.follow_block_until) + " s, " + (smart.moving || is_moving(character) ? "moving" : "standing still"), "#CF575F");
      } catch (e) {}
    };
    // true = walking to the leader (do not stand around shooting from far away). With hooks.tank_pos the tank is followed first, closer and with less spread.
    R.follow_step = function () {
      const tp = hooks.tank_pos ? hooks.tank_pos() : null;
      const pos = tp || R.leader_pos();
      if (!pos) return false;
      if (now() < (S.boar_until || 0) && CFG.BOAR_MAPS.indexOf(pos.map) !== -1) return false; // (boars) not back into Winterland yet
      const near = character.map === pos.map && d2(character, pos) <= (tp ? Math.min(CFG.TANK_NEAR_PX, (character.range || 120) * 0.6) : CFG.FOLLOW_FAR_PX);
      if (near) return false;
      if (smart.moving || is_moving(character)) return true;
      if (now() < S.follow_block_until || now() - S.follow_at < CFG.FOLLOW_EVERY_MS) return true;
      S.follow_at = now();
      const spread = tp ? Math.min(CFG.FOLLOW_SPREAD_PX, 30) : CFG.FOLLOW_SPREAD_PX;
      const dest = {
        map: pos.map,
        x: pos.x + (Math.random() - 0.5) * 2 * spread,
        y: pos.y + (Math.random() - 0.5) * 2 * spread,
      };
      mover.log_move(dest, "following " + (tp ? CFG.TANK_NAME : CFG.PARTY_LEADER));
      call(() => smart_move(dest)).then((r) => {
        if (r && (r.failed || r.success === false)) {
          // (Sean 2026-11-18) "Path not found" from a spot where moving a few pixels fixes it: nudge a short random distance (the start point is what is stuck, e.g. against a wall or a town object), then retry soon; back off for 10s only after 3 fails in a row
          S.follow_fails = (S.follow_fails || 0) + 1;
          if (S.follow_fails >= 3) { S.follow_block_until = now() + 10000; S.follow_fails = 0; }
          else {
            S.follow_block_until = now() + 1500;
            const ang = Math.random() * Math.PI * 2, dist = 15 + Math.random() * 25;
            call(() => move(character.x + Math.cos(ang) * dist, character.y + Math.sin(ang) * dist));
          }
        } else S.follow_fails = 0;
      });
      return true;
    };
    // Sean 2026-11-19: the Grinch can be invisible after a teleport; a few steps refresh the view. Circle around the spot where we stand (the fight goes on as usual, only the following pauses)
    R.wiggle_step = function () {
      const fresh = S.leader && now() - S.leader.at < CFG.STATE_STALE_MS && S.leader.wiggle;
      const grinch_in_view = Object.values(parent.entities || {}).some((e) => e && e.type === "monster" && e.mtype === "grinch" && !e.dead && !e.rip && e.visible !== false);
      if (!CFG.GRINCH_CIRCLE || !fresh || grinch_in_view) { S.wig = null; return false; }
      if (!S.wig) S.wig = { x: character.x, y: character.y, a: 0, at: 0, since: now() };
      if (now() - S.wig.since < CFG.GRINCH_CIRCLE_AFTER_MS) return false;
      if (now() - S.wig.at >= CFG.GRINCH_CIRCLE_STEP_MS) {
        S.wig.at = now();
        S.wig.a += Math.PI / 4;
        if (!S.wig.said) { S.wig.said = true; say("The Grinch is not in view - walking a small circle to refresh the view", "#E0A040"); }
        call(() => move(S.wig.x + Math.cos(S.wig.a) * CFG.GRINCH_CIRCLE_RADIUS, S.wig.y + Math.sin(S.wig.a) * CFG.GRINCH_CIRCLE_RADIUS));
      }
      return true;
    };

    // ---------------------------------------------------- [loot]
    R.free_slots = function () {
      let n = 0;
      for (let i = 0; i < character.isize; i++) if (!character.items[i]) n++;
      return n;
    };
    R.kept = (it, pool) => {
      if (CFG.BAG_KEEP.indexOf(it.name) !== -1 || CFG.BAG_KEEP_PREFIXES.some((p) => it.name.indexOf(p) === 0)) return true;
      return hooks.kept_extra ? !!hooks.kept_extra(it, pool) : false;
    };
    // everything the Merchant should sort: unlocked bag items except potions, elixirs, scrolls and the keep list (what is worn is not in the bag)
    R.handoff_slots = function () {
      const out = [];
      if (now() - S.gear_recv_at < CFG.GEAR_HANDOFF_GRACE_MS) return out; // about to wear / just swapped a piece
      const pool = hooks.handoff_pool ? hooks.handoff_pool() : undefined;
      for (let i = 0; i < character.isize; i++) {
        const it = character.items[i];
        if (!it || it.l || R.kept(it, pool)) continue;
        out.push(i);
      }
      return out;
    };
    // the part of it that is equipment (an upgradeable / compoundable, non-stackable item): counted for the "spare gear" courier trip
    R.gear_slots = function () {
      return R.handoff_slots().filter((i) => {
        const def = G.items[character.items[i].name];
        return !!def && !def.s && !!(def.upgrade || def.compound);
      });
    };
    R.courier_give = async function (to, d) {
      const max = Math.max(0, Math.min(CFG.COURIER_JUNK_EACH, Math.floor(Number(d.max) || 0)));
      let items = 0;
      for (const i of R.handoff_slots().slice(0, max)) {
        const it = character.items[i];
        if (!it) continue;
        const res = await call(() => send_item(to, i, it.q || 1));
        if (!res.failed) items++;
        await wait(400);
      }
      let gold = 0;
      const surplus = Math.floor(character.gold - CFG.COURIER_GOLD_KEEP);
      let p = null;
      try {
        p = get_player(to);
      } catch (e) {}
      if (surplus >= CFG.SWEEP_MIN && p && p.map === character.map && d2(character, p) <= CFG.PAY_RANGE) {
        const res = await call(() => send_gold(to, surplus));
        if (!res.failed) gold = surplus;
      }
      say("Gave the courier " + to + " " + items + " item(s) and " + gold + " gold", "#51D2E1");
      await call(() => send_cm(to, { type: "courier_collected", id: d.id, items, gold }));
    };
    // Sean 2026-11-20: every item looted is counted (since the script started) and sent to the Merchant in the gear report (he filters the Christmas items and reports the rest hourly)
    const drops = {};
    R.drops_out = function () {
      const k = Object.keys(drops).sort((a, b) => drops[b] - drops[a]).slice(0, 40);
      const o = {};
      for (const n of k) o[n] = drops[n];
      return o;
    };
    // chest diagnostics (Sean 2026-11-20, "why does the Priest not loot"): chests the character has SEEN on its map, loot() calls made while one was in view,
    // chests actually OPENED (the game's "loot" event), items received, and the calls that failed (with the last reason). Sent in the gear report, shown in the Merchant's hourly line.
    const chest_ids = new Set();
    const chest_stats = (R.chest_stats = { seen: 0, tries: 0, opened: 0, items: 0, fails: 0, last_fail: "" });
    try {
      character.on("loot", (d) => {
        if (!d) return;
        chest_stats.opened++;
        for (const it of d.items || []) if (it && it.name) { const q = it.q || 1; drops[it.name] = (drops[it.name] || 0) + q; chest_stats.items += q; }
      });
    } catch (e) {}
    R.chests_in_view = function () {
      let n = 0;
      try {
        for (const id in parent.chests || {}) {
          n++;
          if (!chest_ids.has(id)) { chest_ids.add(id); chest_stats.seen++; if (chest_ids.size > 400) chest_ids.clear(); }
        }
      } catch (e) {}
      return n;
    };
    // loot is per character: only she can open the chests of what she killed
    R.loot_tick = function () {
      if (!alive() || character.rip || now() - S.loot_at < CFG.LOOT_MS) return;
      S.loot_at = now();
      const in_view = R.chests_in_view();
      const p = call(() => loot());
      if (in_view > 0) {
        chest_stats.tries++;
        try {
          Promise.resolve(p).then((r) => {
            if (r && r.failed) { chest_stats.fails++; chest_stats.last_fail = String(r.reason || "failed").slice(0, 60); }
          });
        } catch (e) {}
      }
    };
    R.chest_text = () => "chests: seen " + chest_stats.seen + ", loot calls " + chest_stats.tries + ", opened " + chest_stats.opened + ", items " + chest_stats.items + ", failed " + chest_stats.fails + (chest_stats.last_fail ? " (" + chest_stats.last_fail + ")" : "");

    // ---------------------------------------------------- [supply]
    R.drink = async function () {
      if (now() - S.drink_at < 1200) return;
      const hp = R.hp_pct(character);
      const mp = character.max_mp ? character.mp / character.max_mp : 1;
      let name = null;
      // v5: with no tier-1 potions left the basic ones (hpot0 / mpot0) are used until the courier restocks
      if (hp < CFG.DRINK_HP_PCT && (quantity(CFG.HP_POTION) > 0 || quantity("hpot0") > 0)) name = quantity(CFG.HP_POTION) > 0 ? CFG.HP_POTION : "hpot0";
      else if (mp < CFG.DRINK_MP_PCT && (quantity(CFG.MP_POTION) > 0 || quantity("mpot0") > 0)) name = quantity(CFG.MP_POTION) > 0 ? CFG.MP_POTION : "mpot0";
      if (!name) return;
      S.drink_at = now();
      await call(() => equip(locate_item(name)));
    };
    R.warn_potions = function () {
      if (now() - S.warn_at < 600000) return;
      const h = quantity(CFG.HP_POTION);
      const m = quantity(CFG.MP_POTION);
      if (h > CFG.LOW_POTION_WARN && m > CFG.LOW_POTION_WARN) return;
      S.warn_at = now();
      say("Low on potions: " + h + " " + CFG.HP_POTION + ", " + m + " " + CFG.MP_POTION + " - the Ranger courier restocks her on the next trip", "#CF575F");
    };

    // ---------------------------------------------------- [report]
    R.find_gear = (name, level) => {
      for (let i = 0; i < character.isize; i++) {
        const it = character.items[i];
        if (it && it.name === name && (it.level || 0) === level) return i;
      }
      return -1;
    };
    R.send_gear_report = function () {
      strip_never_wear(say);
      if (!CFG.GEAR_SHARE) return;
      const slots = {};
      for (const sl of GEAR_SLOTS) {
        const it = hooks.worn ? hooks.worn(sl) : character.slots && character.slots[sl];
        if (it && it.name) {
          slots[sl] = { name: it.name, level: it.level || 0 };
          if (it.stat_type) slots[sl].stat_type = String(it.stat_type);
        }
      }
      const extra = hooks.report_extra ? hooks.report_extra() : {};
      const msg = Object.assign(
        { type: "gear_report", cls: character.ctype, stat: { level: character.level, xp: Math.floor(character.xp || 0), max_xp: Math.floor(character.max_xp || 0), free: R.free_slots(), deaths: S.deaths, drops: R.drops_out(), chests: Object.assign({}, chest_stats), gold: Math.floor(character.gold || 0) }, slots },
        extra,
        { map: character.map, x: Math.round(character.x), y: Math.round(character.y) }
      );
      call(() => send_cm(CFG.MERCHANT_NAME, msg));
    };
    // The Merchant (or the Ranger courier) hands over an item and says where it goes: wait for it, equip it
    R.gear_receive = async function (d) {
      const slot = String(d.slot || "");
      const name = String(d.name || "");
      const level = Number(d.level) || 0;
      if ((GEAR_SLOTS.indexOf(slot) === -1 && !(hooks.slot_ok && hooks.slot_ok(slot))) || !name) return;
      S.gear_recv_at = now();
      const t0 = now();
      while (R.find_gear(name, level) < 0 && now() - t0 < 15000 && alive()) await wait(300);
      if (R.find_gear(name, level) < 0) return say("Gear never arrived: " + name + " +" + level, "#CF575F");
      if (hooks.receive_special && (await hooks.receive_special(slot, name, level))) return;
      const old = character.slots && character.slots[slot];
      const res = await call(() => equip(R.find_gear(name, level), slot));
      if (res.failed) return say("Could not equip " + name + " +" + level + ": " + res.reason, "#CF575F");
      say("Equipped " + name + " +" + level + " in " + slot + (old && old.name ? " (was " + old.name + " +" + (old.level || 0) + ", now in the bag)" : ""), "#5BCB5B");
      S.gear_recv_at = now();
      await wait(1500);
      R.send_gear_report();
    };
    // tell the leader level, potions and free bag slots (the same "party_level" message the Ranger followers send)
    R.status_tick = function () {
      if (!alive() || now() - S.status_at < CFG.STATE_EVERY_MS) return;
      S.status_at = now();
      // Sean 2026-11-19: a full bag that nobody can empty (everything is locked / kept) never starts a junk trip - say so, with the list, so it can be fixed
      try {
        if (R.free_slots() <= 4 && R.handoff_slots().length < 3 && now() - (S.full_said_at || 0) > 600000) {
          S.full_said_at = now();
          const give = {};
          for (const i of R.handoff_slots()) give[i] = 1;
          const held = {};
          for (let i = 0; i < character.isize; i++) {
            const it = character.items[i];
            if (!it || give[i]) continue;
            const k = it.name + (it.level ? "+" + it.level : "") + (it.l ? " (locked)" : "");
            held[k] = (held[k] || 0) + (it.q || 1);
          }
          say("Bag nearly full (" + R.free_slots() + " free) but only " + R.handoff_slots().length + " item(s) can go to the Merchant, so no junk trip starts. Held: " + Object.keys(held).map((k) => k + (held[k] > 1 ? " x" + held[k] : "")).join(", "), "#CF575F");
        }
      } catch (e) {}
      const extra = hooks.status_extra ? hooks.status_extra() : {};
      call(() =>
        send_cm(CFG.PARTY_LEADER, Object.assign({
          type: "party_level",
          level: character.level,
          hp: quantity(CFG.HP_POTION),
          mp: quantity(CFG.MP_POTION),
          free: R.free_slots(),
          junk: R.handoff_slots().length,
          gear: R.gear_slots().length,
          gold: Math.floor(character.gold),
          map: character.map,
          x: Math.round(character.x),
          y: Math.round(character.y),
          busy: false,
        }, extra))
      );
    };
    return R;
  }
  // Sean 2026-11-19 (Warrior -> Priest) and 2026-11-20 (Ranger -> Priest): the Priest has a lot of bag room and heals the Warrior, so she never makes the courier trips.
  // A character with spare items asks her for room when she is close; she answers with how many she takes (bag_room_ok) and they are handed over. The Merchant's
  // junk trips collect them from her bag like from anybody's.
  //   env: CFG (BAG_SHARE, BAG_SHARE_TO, BAG_SHARE_MIN_ITEMS, BAG_SHARE_EVERY_MS, BAG_SHARE_MAX, BAG_SHARE_RANGE), S (share_at), say, alive,
  //        slots() -> bag slots that may go (the character's handoff_slots), free() -> free bag slots, gate() -> optional: false = not now (e.g. on a courier trip)
  function bag_share(env) {
    const { CFG, S, say, alive } = env;
    const gate = env.gate || (() => true);
    function share_tick() {
      if (!CFG.BAG_SHARE || !alive() || character.rip || now() - (S.share_at || 0) < CFG.BAG_SHARE_EVERY_MS) return;
      if (!gate()) return;
      const n = env.slots().length;
      if (n < CFG.BAG_SHARE_MIN_ITEMS) return;
      let p = null;
      try {
        p = get_player(CFG.BAG_SHARE_TO);
      } catch (e) {}
      if (!p || p.map !== character.map || d2(character, p) > CFG.BAG_SHARE_RANGE) return;
      S.share_at = now();
      call(() => send_cm(CFG.BAG_SHARE_TO, { type: "bag_room", want: Math.min(CFG.BAG_SHARE_MAX, n), free: env.free() }));
    }
    async function share_give(to, max) {
      max = Math.max(0, Math.min(CFG.BAG_SHARE_MAX, Math.floor(max)));
      if (!max) return;
      let p = null;
      try {
        p = get_player(to);
      } catch (e) {}
      if (!p || p.map !== character.map || d2(character, p) > CFG.BAG_SHARE_RANGE + 100) return;
      let items = 0;
      for (const i of env.slots().slice(0, max)) {
        const it = character.items[i];
        if (!it) continue;
        const res = await call(() => send_item(to, i, it.q || 1));
        if (!res.failed) items++;
        await wait(400);
      }
      if (items) say("Gave " + items + " spare item(s) to " + to + " (" + env.free() + " bag slots free now)", "#51D2E1");
    }
    return { share_tick, share_give };
  }
  // takes off any worn piece on the never-wear list (Ice Skates). Each report calls it, so a piece worn from before is removed within a report interval; the Merchant then fills the slot.
  function strip_never_wear(say_fn) {
    try {
      const l = AL.config && AL.config.lists && AL.config.lists.never_wear;
      if (!l || !character.slots) return;
      for (const sl of Object.keys(character.slots)) {
        const it = character.slots[sl];
        if (it && l.indexOf(it.name) !== -1) {
          if (say_fn) say_fn("[gear] taking off " + it.name + " (" + sl + "): it is on the never-wear list (it slows the character too much)", "#E0A040");
          AL.call(() => unequip(sl));
        }
      }
    } catch (e) {}
  }
  return { GEAR_SLOTS, EVENT_RE, ev_keep, create, bag_share, strip_never_wear };
})();
