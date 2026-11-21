  // ===================== MESSAGES FROM THE MERCHANT ===============
  // v4 job protocol (AL.proto): job_status {id,state,eta,doing} (the first one is the ack), job_ready, job_done, job_failed,
  // cancel_ack, hello, gear_give. Messages for jobs we do not hold are ignored.
  const ladder_job = (id) =>
    R.ladder ? R.ladder.jobs.find((j) => j.id === id) : null;
  function send_hello() {
    const ids = R.ladder
      ? R.ladder.jobs.filter((j) => !j.terminal).map((j) => j.id)
      : [];
    AL.send(CFG.MERCHANT_NAME, { type: "hello", jobs: ids, want_reply: true });
  }
  // Sean 2026-11-19: the Grinch can be invisible for a moment after a teleport and still hit somebody. When a party member (a player, not an NPC) loses HP to a normal hit
  // (not a condition like burn / poison) and no visible monster is targeting him, a few steps sideways make the game refresh the view and the Grinch shows up again.
  function unseen_hit(d) {
    try {
      if (!d || !CFG.GRINCH_REFRESH || !alive() || !(R.boss || grinch_fight())) return;
      if (!(Number(d.damage) > 0)) return;
      const src = d.source;
      if (src && src !== "attack" && src !== "monster") return; // a condition (burn, poison, ...), not a monster's hit
      const ents = parent.entities || {};
      const tid = d.id || (d.target && d.target.id) || d.tid;
      const tg = d.target && typeof d.target === "object" ? d.target : tid === character.id || tid === character.name ? character : ents[tid];
      if (!tg || tg.type !== "character" || tg.npc) return;
      if (tg.name !== character.name && party_names().indexOf(tg.name) === -1) return;
      const seen = (e) => e && e.type === "monster" && !e.dead && !e.rip && e.visible !== false;
      const hid = d.hid || (d.actor && d.actor.id);
      if (hid && seen(ents[hid])) return; // the attacker is in view
      if (Object.values(ents).some((e) => seen(e) && (e.target === tg.name || e.target === tg.id))) return; // somebody visible is on him
      if (now() - (R.refresh_at || 0) < CFG.GRINCH_REFRESH_MS) return;
      R.refresh_at = now();
      R.refresh_n = (R.refresh_n || 0) + 1;
      const dx = R.refresh_n % 2 ? 40 : -40;
      say("Hit on " + tg.name + " but no monster in view (the Grinch is probably invisible after a teleport) - stepping aside to refresh the view", "#E0A040");
      call(() => move(character.x + dx, character.y));
    } catch (e) {}
  }
  try { game.on("hit", unseen_hit); } catch (e) {}
  const LEAD_ENV = AL.config.lead_env(character.name, "ranger");
  LEAD_ENV.merchant.is_online = () => !!(get_active_characters() || {})[CFG.MERCHANT_NAME] || is_online(CFG.MERCHANT_NAME);
  const LEAD = AL.lead.create(Object.assign(LEAD_ENV, { CFG, say, alive,
    busy: () => (R.boss ? "boss event" : grinch_fight() ? "Grinch fight" : R.force ? (R.force.trial ? "Try monster" : "forced farm") + " of " + R.force.type : R.goal ? "farm goal " + R.goal.type : R.ladder || R.courier || R.trip || R.retreat_go ? "a trip / job is running" : AL.lead.fight_near(party_names(), 500)),
    hooks: { update_window: (ms) => update_window(ms), start_merchant: (n, slot) => call_paced("start", () => start_character(n, slot)), announce: () => { if (CFG.PARTY_MEMBERS.length) send_party_state(); }, reload: () => AL.reengage({ say, slot: CFG.SELF_CODE_SLOT, restart: AutoRangerV5 }) } })); // stage 4
  setInterval(() => { try { LEAD.tick(); } catch (e) {} }, 5000);
  character.on("cm", function (m) {
    if (!alive()) return;
    try {
      if (LEAD.handle(m)) return;
      const d = AL.parse_job(
        m,
        (n) =>
          n === CFG.MERCHANT_NAME ||
          (CFG.FOCUS_TARGET && n === CFG.TANK_NAME) ||
          (is_follower() && n === CFG.PARTY_LEADER) ||
          (is_leader() &&
            n !== character.name &&
            (CFG.PARTY_MEMBERS.indexOf(n) !== -1 || CFG.PARTY_SUPPORT.indexOf(n) !== -1)) ||
          (courier_on() &&
            n !== character.name &&
            party_names().indexOf(n) !== -1)
      );
      if (!d) return;
      if (d.type === "bag_room_ok" && CFG.BAG_SHARE && m.name === CFG.BAG_SHARE_TO) {
        share_give(m.name, Number(d.max) || 0);
        return;
      }
      if (d.type === "boar_alert" || d.type === "boar_flee") {
        if ((d.type === "boar_alert" && is_leader()) || (d.type === "boar_flee" && m.name === CFG.PARTY_LEADER)) R.boar_cm = now();
        return;
      }
      if (d.type === "focus") {
        if (m.name === CFG.TANK_NAME && CFG.FOCUS_TARGET)
          R.focus = { id: typeof d.tid === "string" || typeof d.tid === "number" ? String(d.tid) : null, at: now() };
        return;
      }
      if (d.type === "gear_ready") {
        if (is_leader() && m.name === CFG.MERCHANT_NAME && courier_on())
          R.gear_ready_at = now();
        return;
      }
      if (
        d.type === "courier_go" ||
        d.type === "courier_collect" ||
        d.type === "courier_collected" ||
        d.type === "courier_done"
      ) {
        courier_message(m.name, d);
        return;
      }
      if (d.type === "party_level") {
        if (is_leader() && (CFG.PARTY_MEMBERS.indexOf(m.name) !== -1 || CFG.PARTY_SUPPORT.indexOf(m.name) !== -1)) {
          const n = (v) => Math.max(0, Math.min(1e9, Number(v) || 0));
          R.levels[m.name] = {
            level: n(d.level),
            at: now(),
            hp: n(d.hp),
            mp: n(d.mp),
            free: n(d.free),
            junk: n(d.junk),
            gear: n(d.gear),
            gold: n(d.gold),
            map: typeof d.map === "string" ? d.map.slice(0, 40) : "",
            x: Number.isFinite(+d.x) ? +d.x : undefined,
            y: Number.isFinite(+d.y) ? +d.y : undefined,
            busy: !!d.busy,
            basher: d.basher === true,
          };
        }
        return;
      }
      if (d.type === "died") {
        if (is_leader() && (CFG.PARTY_MEMBERS.indexOf(m.name) !== -1 || CFG.PARTY_SUPPORT.indexOf(m.name) !== -1)) { force_death(m.name); death_note(m.name); }
        return;
      }
      if (d.type === "retreat" && is_follower() && m.name === CFG.PARTY_LEADER) {
        const ms = Math.max(0, Math.min(900000, Number(d.ms) || 0));
        if (!ms) { if (R.retreat) R.retreat.until = now(); return; } // the leader ends the retreat
        R.retreat = { until: now() + ms, why: "the leader retreats", farm: "", spot: !!d.spot };
        R.retreat_go = true;
        return;
      }
      if (d.type === "need_basher" && is_leader() && CFG.PARTY_SUPPORT.indexOf(m.name) !== -1) { kit_note(m.name); return; }
      if (d.type === "mluck_done" && m.name === CFG.MERCHANT_NAME) {
        const l = (v) => (Array.isArray(v) ? v.slice(0, 12).map((x) => String(x).slice(0, 30)) : []);
        R.luck_done = { id: String(d.id || "").slice(0, 30), cast: l(d.cast), failed: l(d.failed), off: !!d.off };
        return;
      }
      if (d.type === "party_state") {
        if (!is_follower() || m.name !== CFG.PARTY_LEADER) return;
        const str = (v) => (typeof v === "string" && v.length <= 40 ? v : null);
        R.leader = {
          map: str(d.map) || "main",
          x: Number(d.x) || 0,
          y: Number(d.y) || 0,
          goal: str(d.goal) && G.monsters[d.goal] ? d.goal : null,
          bees: !!d.bees,
          force: str(d.force) && G.monsters[d.force] ? d.force : null,
          at: now(),
        };
        R.follow_goal = R.leader.goal;
        return;
      }
      if (m.name === CFG.PARTY_LEADER && d.type !== "gear_give") return; // the leader only sends party_state and hand-me-downs
      if (d.type === "gear_give") {
        // the Merchant gives the courier gear for the others too: it is carried until he meets them
        if (m.name === CFG.MERCHANT_NAME && d.to && d.to !== character.name) {
          if (party_names().indexOf(d.to) !== -1 && R.courier_gear.length < 12)
            R.courier_gear.push({
              to: d.to,
              name: String(d.name || ""),
              level: Number(d.level) || 0,
              slot: String(d.slot || ""),
            });
          return;
        }
        gear_receive(d);
        return;
      }
      if (m.name !== CFG.MERCHANT_NAME) return; // everything below is Merchant traffic
      if (d.type === "scroll_swap") {
        scroll_swap(d);
        return;
      }
      if (d.type === "gear_pass") {
        if (m.name === CFG.MERCHANT_NAME) gear_pass(d);
        return;
      }
      if (d.type === "hello") {
        // the Merchant restarted and lost his queue: re-send every job of ours he does not list (resume, no ghosts)
        const theirs = Array.isArray(d.jobs) ? d.jobs : [];
        if (R.ladder)
          for (const j of R.ladder.jobs)
            if (!j.terminal && theirs.indexOf(j.id) === -1) {
              say(
                "Merchant restarted - re-sending my " + j.jtype + " request",
                "#51D2E1"
              );
              j.last_seen = now();
              AL.send(CFG.MERCHANT_NAME, j.payload);
            }
        if (d.want_reply)
          AL.send(CFG.MERCHANT_NAME, {
            type: "hello",
            jobs: R.ladder
              ? R.ladder.jobs.filter((j) => !j.terminal).map((j) => j.id)
              : [],
            want_reply: false,
          });
        return;
      }
      const j = ladder_job(d.id);
      if (!j) return;
      j.last_seen = now();
      if (d.type === "job_status") {
        j.status = String(d.state || "");
        j.eta = Number(d.eta);
        j.doing = String(d.doing || "").slice(0, 80);
      } else if (d.type === "job_ready") {
        j.ready = true;
        if (Number(d.cap) > 0) j.cap = Number(d.cap);
      } else if (d.type === "job_done") {
        j.done = true;
        j.terminal = true;
        j.sent_hp = Number(d.hp) || 0;
        j.sent_mp = Number(d.mp) || 0;
        j.got = Number(d.got) || 0;
      } else if (d.type === "job_failed") {
        j.failed = String(d.reason || "failed");
        j.terminal = true;
        say(
          "Merchant could not do the " + j.jtype + " job: " + j.failed,
          "#CF575F"
        );
      } else if (d.type === "cancel_ack") {
        j.cancel_acked = true;
      }
    } catch (e) {}
  });
