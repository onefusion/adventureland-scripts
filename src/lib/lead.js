
// ============================== AL.lead: who leads the party (stage 4 of the refactor, 2026-11-21) ==============================
// Decisions D2, D6, D11, E1-E5 (agent/refactor-decisions-2026-11-20.md):
//  - Every non-Merchant character has a "Lead" button. Pressed while a lead is online: the lead hands over (lead_claim -> lead_change). Pressed with no lead: the character takes it.
//  - No lead news for ELECTION_MS (60 s): the online characters elect one with the SAME rule on the SAME information, so they agree without voting:
//    class order first (roster.lead_order: Ranger, Warrior, Priest), inside a class the higher score (60% level, 40% gear level), then the name. A class that cannot lead
//    (roster.can_lead) is skipped.
//  - The hand-over carries the lead's state (hooks.export_state / import_state) and the new lead tells the others at once (hooks.announce).
//  - The lead has "Stop <name>" / "Hold <name>" buttons for every follower and an all-followers version (D11). Stop code = stop_character (Sean drives it by hand). Hold = the script
//    keeps running but its fight and follow logic pause (L.held()); Resume lifts it. Start (the same slot as the roster) is used by the Merchant auto-start (4c).
// Everything is logged with the tag [lead]. The pure functions (gear_level, score, rank, elect) are tested in tests/lead_unit.js.
AL.lead = (function () {
  const { now } = AL;
  const GEAR_LEVEL_MAX = 150; // 15 slots x item level 10 (raise with the upgrade cap, see the golden test howto)
  const W_LEVEL = 0.6, W_GEAR = 0.4, LEVEL_MAX = 100;
  const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
  // sum of the levels of the worn items
  function gear_level(slots) {
    let n = 0;
    try {
      for (const k of Object.keys(slots || {})) if (slots[k] && typeof slots[k] === "object" && slots[k].name) n += Number(slots[k].level) || 0;
    } catch (e) {}
    return n;
  }
  // D6: 60% character level (out of 100), 40% gear level (out of GEAR_LEVEL_MAX)
  function score(level, gear, gear_max) {
    return W_LEVEL * clamp01((Number(level) || 0) / LEVEL_MAX) + W_GEAR * clamp01((Number(gear) || 0) / (gear_max || GEAR_LEVEL_MAX));
  }
  // cands: [{ name, cls, level, gear }]; order: class names, best first. Best first: class order, then score, then name (so every character gets the same answer)
  function rank(cands, order, gear_max) {
    const ci = (c) => {
      const i = order.indexOf(c.cls);
      return i === -1 ? 99 : i;
    };
    return cands.slice().sort((a, b) => ci(a) - ci(b) || score(b.level, b.gear, gear_max) - score(a.level, a.gear, gear_max) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  // the winner among the candidates whose class may lead, or null
  function elect(cands, order, can_lead, gear_max) {
    return rank(cands.filter((c) => can_lead[c.cls]), order, gear_max)[0] || null;
  }

  // env: { CFG, say, alive, me: { name, cls }, members: [{ name, cls }] (every non-Merchant character, me included), order, can_lead: { cls: bool },
  //        election_ms, hello_ms, hooks: { info() -> { level, gear }, export_state(), import_state(state), on_lead(), on_follow(name), announce(), start(name, slot) } }
  function create(env) {
    const { CFG, say, alive, me } = env;
    const hooks = env.hooks || {};
    const order = env.order || ["ranger", "warrior", "priest"];
    const can_lead = env.can_lead || { ranger: true };
    const election_ms = env.election_ms || 60000;
    const hello_ms = env.hello_ms || 15000;
    const peers = env.members.filter((m) => m.name !== me.name);
    const cls_of = {};
    for (const m of env.members) cls_of[m.name] = m.cls;
    const L = { lead: CFG.PARTY_LEADER, epoch: 0, seen_at: now(), hello_at: 0, hold: false, peers: {}, started: now(), idle_said: 0, reload: null, reload_quiet_since: 0, reload_said: 0, m: { tries: 0, last: 0, done: false } };
    const tell = (name, msg) => call_send(name, msg);
    function call_send(name, msg) {
      AL.call(() => send_cm(name, msg));
    }
    const lead_log = (s, color) => say("[lead] " + s, color || "#E0A040");
    const info = () => {
      try {
        return hooks.info ? hooks.info() : { level: character.level, gear: gear_level(character.slots) };
      } catch (e) {
        return { level: character.level || 0, gear: 0 };
      }
    };
    const i_lead = () => L.lead === me.name;
    // online candidates: me plus every peer heard from lately
    function candidates() {
      const mi = info();
      const out = [{ name: me.name, cls: me.cls, level: mi.level, gear: mi.gear }];
      for (const n of Object.keys(L.peers)) {
        const p = L.peers[n];
        if (now() - p.at < election_ms) out.push({ name: n, cls: cls_of[n] || p.cls, level: p.level, gear: p.gear });
      }
      return out;
    }
    function others_known() {
      return peers.map((p) => p.name);
    }
    // only the lead tells the Merchant (he is outside the election): lead_is carries the epoch, the Merchant keeps the newest
    function tell_merchant() {
      const mn = env.merchant && env.merchant.name;
      if (!mn || !i_lead() || peers.some((p) => p.name === mn)) return;
      tell(mn, { type: "lead_is", epoch: L.epoch, lead: me.name });
    }
    function broadcast(msg) {
      for (const n of others_known()) tell(n, msg);
    }
    function set_lead(name, epoch, why) {
      const was = L.lead;
      L.lead = name;
      CFG.PARTY_LEADER = name; // D2: the rest of the script reads CFG.PARTY_LEADER every time
      L.epoch = epoch;
      L.seen_at = now();
      if (was !== name) lead_log("the party lead is now " + name + " (" + why + ")", "#51D2E1");
    }
    function become_lead(state, why, epoch) {
      set_lead(me.name, epoch || now(), why);
      try {
        if (hooks.on_lead) hooks.on_lead();
        if (state && hooks.import_state) hooks.import_state(state);
      } catch (e) {
        lead_log("taking over failed: " + ((e && e.message) || e), "#CF575F");
      }
      broadcast({ type: "lead_is", epoch: L.epoch });
      tell_merchant();
      try {
        if (hooks.announce) hooks.announce(); // E4: tell the others at once (party_state with the focus / farm spot)
      } catch (e) {}
    }
    function follow(name, epoch, why) {
      const changed = L.lead !== name;
      set_lead(name, epoch, why);
      if (changed || CFG.PARTY_LEADER !== name) {
        try {
          if (hooks.on_follow) hooks.on_follow(name);
        } catch (e) {
          lead_log("following " + name + " failed: " + ((e && e.message) || e), "#CF575F");
        }
      }
    }
    // E5: the button. Lead online -> ask for the hand-over; nobody leads -> take it.
    function claim() {
      if (!can_lead[me.cls]) return lead_log("a " + me.cls + " cannot lead (roster.can_lead): ignoring the Lead button", "#CF575F");
      if (i_lead()) return lead_log("I am the lead already");
      const fresh = now() - L.seen_at < election_ms;
      if (L.lead && fresh && L.lead !== me.name) {
        lead_log("Lead button: asking " + L.lead + " to hand over the lead");
        tell(L.lead, { type: "lead_claim" });
        L.claim_at = now();
        return;
      }
      lead_log("Lead button: no lead is online - taking the lead");
      become_lead(null, "Lead button, nobody led");
    }
    // the lead hands over to `to`: state goes with it
    function hand_over(to) {
      let state = null;
      try {
        state = hooks.export_state ? hooks.export_state() : null;
      } catch (e) {
        lead_log("could not export my state: " + ((e && e.message) || e), "#CF575F");
      }
      const epoch = now();
      lead_log("handing the lead to " + to + (state ? " with my state (" + Object.keys(state).join(", ") + ")" : ""));
      follow(to, epoch, "handed over by me");
      for (const n of others_known()) tell(n, { type: "lead_change", to, epoch, state: n === to ? state : null });
    }
    // E2: nobody has led for ELECTION_MS: everybody computes the same winner
    function election() {
      const cands = candidates();
      const win = elect(cands, order, can_lead, env.gear_max);
      if (!win) {
        if (now() - L.idle_said > 300000) {
          L.idle_said = now();
          lead_log("no lead for " + Math.round((now() - L.seen_at) / 1000) + " s and nobody online can lead (" + cands.map((c) => c.name + "/" + c.cls).join(", ") + ")", "#CF575F");
        }
        return;
      }
      lead_log("ELECTION after " + Math.round((now() - L.seen_at) / 1000) + " s without a lead: " + rank(cands, order, env.gear_max).map((c) => c.name + " " + c.cls + " L" + c.level + " gear " + c.gear + " score " + score(c.level, c.gear, env.gear_max).toFixed(2)).join(" > ") + " -> " + win.name);
      if (win.name === me.name) become_lead(null, "election", now());
      else follow(win.name, now(), "election");
    }
    // returns true when the message was a lead message
    function handle(m) {
      try {
        if (!m || typeof m.name !== "string") return false;
        const from = m.name;
        if (!peers.some((p) => p.name === from)) return false;
        if (from === L.lead) L.seen_at = now(); // any news from the lead
        const d = AL.parse_cm(m, () => true);
        if (!d || typeof d.type !== "string" || d.type.indexOf("lead_") !== 0 && d.type !== "ctl") return false;
        if (d.type === "lead_hello") {
          L.peers[from] = { at: now(), cls: cls_of[from], level: Number(d.level) || 0, gear: Number(d.gear) || 0 };
          check_build(from, d);
          const ep = Number(d.epoch) || 0;
          if (typeof d.lead === "string" && d.lead !== L.lead && ep > L.epoch) follow(d.lead, ep, "told by " + from); // somebody newer knows better (e.g. I just restarted)
          return true;
        }
        if (d.type === "lead_claim") {
          if (i_lead() && can_lead[cls_of[from]]) hand_over(from);
          return true;
        }
        if (d.type === "lead_change") {
          const ep = Number(d.epoch) || now();
          if (ep < L.epoch) return true;
          if (d.to === me.name) {
            lead_log("the lead was handed to me by " + from);
            become_lead(d.state && typeof d.state === "object" ? d.state : null, "handed over by " + from, ep);
          } else if (typeof d.to === "string") follow(d.to, ep, "handed over by " + from);
          return true;
        }
        if (d.type === "lead_is") {
          const ep = Number(d.epoch) || 0;
          if (from === L.lead && ep <= L.epoch) return true;
          if (i_lead() && ep < L.epoch) {
            tell(from, { type: "lead_is", epoch: L.epoch }); // I am newer: it has to follow me
            return true;
          }
          follow(from, ep, "announced by " + from);
          return true;
        }
        if (d.type === "ctl" && from === L.lead) {
          const cmd = String(d.cmd || "");
          if (cmd === "hold") { L.hold = true; lead_log("HOLD from the lead " + from + ": fight and follow logic paused until Resume", "#CF575F"); }
          else if (cmd === "resume") { L.hold = false; lead_log("RESUME from the lead " + from, "#5BCB5B"); }
          else if (cmd === "reload") request_reload("asked by the lead " + from);
          return true;
        }
        return true;
      } catch (e) {
        return false;
      }
    }
    // ---- reload (rule from Sean 2026-11-21): an automatic reload never fires mid-fight. It is only REQUESTED; tick() runs it after QUIET_MS without hunt / goal / boss / forced farm / Try monster
    // (env.busy() returns a reason string while something is going on, "" when quiet). A button press (the Re-engage button) is immediate and does not come through here.
    const QUIET_MS = env.quiet_ms || 10000;
    // ---- automatic reload triggers (Sean 2026-11-21): all three only REQUEST a reload, so it waits for a quiet moment (above); each is switchable and a guard allows the same trigger once per min_gap_ms
    //   build: my script build id differs from the lead's   lib: my lib build id differs from the lead's   idle: no move / xp / gold change for idle_ms while not on Hold
    const AR = Object.assign({ build: true, lib: true, idle: true, idle_ms: 15 * 60000, min_gap_ms: 60 * 60000 }, env.auto_reload || {});
    const my_build = () => String(globalThis.__AL_BUILD || "");
    const my_lib = () => String(globalThis.__AL_LIB_BUILD || "");
    // the guard lives in set()/get(), so it survives the reload it caused: the same cause does not reload again within min_gap_ms (a lead that runs OLDER code than me would otherwise loop)
    function auto_ok(key) {
      try {
        const g = JSON.parse(get("auto_reload_guard") || "{}") || {};
        if (g[key] && now() - g[key] < AR.min_gap_ms) return false;
        g[key] = now();
        set("auto_reload_guard", JSON.stringify(g));
      } catch (e) {}
      return true;
    }
    function check_build(from, d) {
      const mb = my_build(), ml = my_lib();
      const tb = String(d.build || ""), tl = String(d.lib || "");
      const bad_b = mb && tb && mb !== tb, bad_l = ml && tl && ml !== tl;
      if (!bad_b && !bad_l) return;
      const key = from + ":" + mb + ">" + tb + "/" + ml + ">" + tl;
      if (L.mismatch_said !== key) {
        L.mismatch_said = key;
        lead_log("BUILD MISMATCH with " + from + ": script " + mb + " vs " + tb + ", lib " + ml + " vs " + tl + " (one slot was not re-uploaded or not restarted)", "#CF575F");
      }
      if (i_lead() || from !== L.lead) return; // only a follower follows the lead's build; the lead is the reference
      if (bad_b && AR.build && auto_ok("build:" + tb)) request_reload("script build " + mb + " differs from the lead's " + tb);
      else if (bad_l && AR.lib && auto_ok("lib:" + tl)) request_reload("lib build " + ml + " differs from the lead's " + tl);
    }
    function idle_tick() {
      if (!AR.idle || L.hold || !alive() || character.rip) return (L.idle_since = 0);
      const sig = [character.map, Math.round(character.x), Math.round(character.y), character.xp, character.gold].join("|");
      if (sig !== L.idle_sig || !L.idle_since) {
        L.idle_sig = sig;
        L.idle_since = now();
        return;
      }
      if (now() - L.idle_since >= AR.idle_ms && !L.reload && !(env.busy && env.busy()) && auto_ok("idle")) { // a boss / forced-farm wait is not idle
        request_reload("nothing changed (position, xp, gold) for " + Math.round((now() - L.idle_since) / 60000) + " min");
        L.idle_since = now();
      }
    }
    function request_reload(why) {
      if (L.reload) return;
      L.reload = why;
      L.reload_quiet_since = 0;
      lead_log("RELOAD requested (" + why + ") - it waits for a quiet moment (no fight, hunt, goal, boss or forced farm for " + Math.round(QUIET_MS / 1000) + " s)", "#E0A040");
    }
    function reload_tick() {
      if (!L.reload) return;
      const why = env.busy ? String(env.busy() || "") : "";
      if (why) {
        L.reload_quiet_since = 0;
        if (now() - L.reload_said >= 60000) {
          L.reload_said = now();
          lead_log("RELOAD still waiting: " + why);
        }
        return;
      }
      if (!L.reload_quiet_since) L.reload_quiet_since = now();
      if (now() - L.reload_quiet_since < QUIET_MS) return;
      const r = L.reload;
      L.reload = null;
      lead_log("RELOAD now (" + r + "): quiet for " + Math.round((now() - L.reload_quiet_since) / 1000) + " s", "#E0A040");
      try {
        if (hooks.reload) hooks.reload();
      } catch (e) {
        lead_log("reload failed: " + ((e && e.message) || e), "#CF575F");
      }
    }
    // ---- the Merchant auto-start (rule from Sean 2026-11-21): only the lead, only when he is not running, at most max_tries attempts, every attempt logged,
    // and it stops for good when he turns up (somebody logged him in) or a start fails
    function merchant_tick() {
      const M = env.merchant;
      if (!M || !M.enabled || L.m.done || !i_lead()) return;
      let online = false;
      try {
        online = !!M.is_online();
      } catch (e) {}
      if (online) {
        lead_log("Merchant " + M.name + " is running" + (L.m.tries ? " (after " + L.m.tries + " start attempt(s))" : " - nothing to start") + ": auto-start finished");
        L.m.done = true;
        return;
      }
      if (now() - L.started < (M.grace_ms || 30000) || now() - L.m.last < (M.retry_ms || 60000)) return;
      const max = M.max_tries || 3;
      if (L.m.tries >= max) {
        lead_log("Merchant " + M.name + " is still not running after " + max + " attempts - giving up (start him by hand)", "#CF575F");
        L.m.done = true;
        return;
      }
      L.m.tries++;
      L.m.last = now();
      lead_log("Merchant " + M.name + " is not running - start attempt " + L.m.tries + "/" + max + " (code slot " + M.slot + ")");
      Promise.resolve(hooks.start_merchant ? hooks.start_merchant(M.name, M.slot) : AL.call(() => start_character(M.name, M.slot))).then(
        (r) => {
          if (r && r.failed) {
            lead_log("Merchant start FAILED: " + (r.reason || "unknown reason") + " - auto-start stops", "#CF575F");
            L.m.done = true;
          }
        },
        (e) => {
          lead_log("Merchant start threw: " + ((e && e.message) || e) + " - auto-start stops", "#CF575F");
          L.m.done = true;
        }
      );
    }
    // every few seconds: say hello (level, gear, who I think leads), refresh my own lead timer, elect when nobody has led
    function tick() {
      if (!alive()) return;
      if (i_lead()) L.seen_at = now();
      if (now() - L.hello_at >= hello_ms) {
        L.hello_at = now();
        const i = info();
        broadcast({ type: "lead_hello", level: i.level, gear: i.gear, lead: L.lead, epoch: L.epoch, build: my_build(), lib: my_lib() });
        tell_merchant(); // Sean 2026-11-21: the Merchant is not a lead member but learns who leads, so he serves the lead first
      }
      reload_tick();
      idle_tick();
      merchant_tick();
      if (!i_lead() && now() - L.seen_at >= election_ms && now() - L.started >= election_ms) election();
    }
    // ---- the lead's controls over the followers (D11)
    const follower_names = () => peers.map((p) => p.name);
    function ctl(name, cmd) {
      if (!i_lead()) return lead_log("only the lead can " + cmd + " " + name + " (the lead is " + L.lead + ")", "#CF575F");
      tell(name, { type: "ctl", cmd });
      lead_log(cmd.toUpperCase() + " sent to " + name);
    }
    function stop(name) {
      if (!i_lead()) return lead_log("only the lead can stop " + name + " (the lead is " + L.lead + ")", "#CF575F");
      lead_log("STOP CODE: stopping " + name + " - drive it by hand; the lead's Start button starts it again");
      AL.call(() => stop_character(name));
    }
    // Goodies is outside the party and the election but the lead can still stop and start him (Sean 2026-11-21). A stop also ends the auto-start, otherwise it would bring him straight back.
    function stop_merchant() {
      const M = env.merchant;
      if (!M || !M.name) return lead_log("no Merchant in the roster", "#CF575F");
      if (!i_lead()) return lead_log("only the lead can stop " + M.name + " (the lead is " + L.lead + ")", "#CF575F");
      L.m.done = true;
      lead_log("STOP CODE: stopping the Merchant " + M.name + " - the auto-start is off until the Start button; his stand and jobs stop where they are", "#E0A040");
      AL.call(() => stop_character(M.name));
    }
    function start_merchant() {
      const M = env.merchant;
      if (!M || !M.name) return lead_log("no Merchant in the roster", "#CF575F");
      if (!i_lead()) return lead_log("only the lead can start " + M.name + " (the lead is " + L.lead + ")", "#CF575F");
      L.m = { tries: 0, last: 0, done: false };
      lead_log("START: starting the Merchant " + M.name + " in code slot " + M.slot);
      AL.call(() => start_character(M.name, M.slot));
    }
    function start(name) {
      const m = env.members.find((x) => x.name === name);
      if (!m) return lead_log("unknown character " + name, "#CF575F");
      lead_log("START: starting " + name + " in code slot " + m.slot);
      if (hooks.start) hooks.start(name, m.slot);
      else AL.call(() => start_character(name, m.slot));
    }
    function add_buttons(online) {
      const add = (id, label, fn) => {
        try {
          add_top_button(id, label, fn);
        } catch (e) {
          lead_log("could not add the button " + label + ": " + ((e && e.message) || e), "#CF575F");
        }
      };
      add("al_lead", "Lead", () => claim());
      for (const n of follower_names().filter((x) => !online || online(x))) {
        add("al_stop_" + n, "Stop " + n, () => stop(n));
        add("al_hold_" + n, "Hold " + n, () => ctl(n, L.peer_hold && L.peer_hold[n] ? "resume" : "hold"));
      }
      if (env.merchant && env.merchant.name) {
        add("al_stop_merchant", "Stop " + env.merchant.name, () => stop_merchant());
        add("al_start_merchant", "Start " + env.merchant.name, () => start_merchant());
      }
      add("al_hold_all", "Hold all", () => follower_names().forEach((n) => ctl(n, "hold")));
      add("al_resume_all", "Resume all", () => follower_names().forEach((n) => ctl(n, "resume")));
      add("al_stop_all", "Stop all", () => follower_names().forEach((n) => stop(n)));
      add("al_reload_all", "Reload all", () => { follower_names().forEach((n) => ctl(n, "reload")); request_reload("Reload all button"); });
    }
    lead_log("lead module started: lead is " + L.lead + (i_lead() ? " (me)" : "") + ", " + (can_lead[me.cls] ? "I can lead" : "I cannot lead") + ", election after " + Math.round(election_ms / 1000) + " s without news");
    return { L, handle, tick, request_reload, claim, hand_over, election, stop, start, stop_merchant, start_merchant, ctl, add_buttons, held: () => L.hold, is_lead: i_lead, lead: () => L.lead, candidates };
  }
  // a reason string while a monster is on me or on a party member nearby (a fight is going on), "" otherwise. names: party names; radius in px
  function fight_near(names, radius) {
    try {
      const ents = parent.entities || {};
      const mine = (n) => n === character.name || n === character.id || (names || []).indexOf(n) !== -1;
      for (const k of Object.keys(ents)) {
        const e = ents[k];
        if (!e || e.type !== "monster" || e.dead || e.rip || !e.target || !mine(e.target)) continue;
        if (e.map && e.map !== character.map) continue;
        if (Math.hypot((e.x || 0) - character.x, (e.y || 0) - character.y) <= (radius || 500)) return "a " + (e.mtype || "monster") + " is fighting " + e.target;
      }
    } catch (err) {}
    return "";
  }
  return { fight_near, GEAR_LEVEL_MAX, gear_level, score, rank, elect, create };
})();
