var AL = (function () {
  "use strict";
  const VERSION = 4; // bump when the API changes; scripts refuse to run on an older library (3: adds AL.gear, the shared gear scorer; 4: delivered through require_code, exports AL)

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const unit_cost = (name) => (G.items[name] && G.items[name].g) || 20;
  const clamp_int = (v, lo, hi) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
  const at_spot = (spot, r) =>
    character.map === spot.map && d2(character, spot) <= r;

  // Never throws: always resolves to an object, {failed:true,...} on error.
  function safe(p) {
    return Promise.resolve(p).then(
      (r) => (r === undefined || r === null ? {} : r),
      (e) => ({
        failed: true,
        reason: (e && (e.reason || e.message)) || String(e),
        detail: e,
      })
    );
  }
  function call(fn) {
    try {
      return safe(fn());
    } catch (e) {
      return Promise.resolve({
        failed: true,
        reason: String((e && e.message) || e),
      });
    }
  }

  // say = game_log with the character's tag:  const say = AL.logger("Ranger");
  function logger(tag) {
    return (msg, color) => game_log("[" + tag + "] " + msg, color);
  }

  // Human-readable destination for the move log ("Searching for a path..." does not say where to)
  function describe_dest(dest) {
    if (typeof dest === "string") return dest;
    if (dest && typeof dest === "object" && dest.x !== undefined)
      return (
        (dest.map || character.map) +
        " (" +
        Math.round(dest.x) +
        ", " +
        Math.round(dest.y) +
        ")"
      );
    return JSON.stringify(dest);
  }

  // Movement with logging and a timeout, so a stuck path can never freeze a main loop.
  //   opts.say        logger from AL.logger()
  //   opts.default_ms timeout used when travel() is given none
  //   opts.before     optional async function(dest) run before every move (the Merchant closes his stand here)
  // v2: travel() resolves {failed:true, reason:"aborted"} as soon as abort() is called.
  function mover(opts) {
    const say = opts.say;
    const last = { key: "", at: 0 };
    let abort_now = null; // resolver for the walk in progress (null = not walking through travel())
    function log_move(dest, why) {
      const key = describe_dest(dest);
      // idle/respawn walks re-issue every tick; only log a destination again after 15s
      if (last.key === key && now() - last.at < 15000) return;
      last.key = key;
      last.at = now();
      say("Moving to " + key + (why ? " - " + why : ""), "#51D2E1");
    }
    async function travel(dest, max_ms, why) {
      if (opts.before) await opts.before(dest);
      log_move(dest, why);
      const aborted = new Promise((res) => {
        abort_now = res;
      });
      const r = await Promise.race([
        call(() => smart_move(dest)),
        wait(max_ms || opts.default_ms || 90000).then(() => ({
          failed: true,
          reason: "travel_timeout",
        })),
        aborted.then(() => ({ failed: true, reason: "aborted" })),
      ]);
      abort_now = null;
      if (r.failed) {
        try {
          smart.moving = false; // abandon the path in progress
        } catch (e) {}
      }
      return r;
    }
    // Stop walking NOW. Returns true if a travel() was in progress.
    function abort() {
      const had = !!abort_now;
      if (abort_now) abort_now();
      try {
        smart.moving = false;
      } catch (e) {}
      try {
        stop(); // stop("move")
      } catch (e) {}
      return had;
    }
    const traveling = () => !!abort_now;
    return { describe_dest, log_move, travel, abort, traveling };
  }

  // Validate an incoming code message. cm's can come from anyone, so check who and what shape.
  //   is_allowed(name) -> true for senders we accept.  Returns the message object, or null to ignore it.
  function parse_cm(m, is_allowed) {
    try {
      if (!m || typeof m.name !== "string" || !is_allowed(m.name)) return null;
      let d = m.message;
      if (typeof d === "string") {
        if (d.length > 4000) return null;
        d = JSON.parse(d);
      }
      if (!d || typeof d !== "object" || Array.isArray(d)) return null;
      if (typeof d.type !== "string" || d.type.length > 40) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  // ====================================================================
  // JOB PROTOCOL (Merchant <-> Ranger)  - see agent/merchant-ranger-coordination-spec.md
  // ====================================================================
  //   Job: { id, jtype, requester, pri, created_at, map, x, y, state, ... }
  //   Lifecycle: REQUESTED -> QUEUED(eta) -> EN_ROUTE -> ARRIVED -> TRANSFERRING -> DONE
  //              any state can end CANCELLED or FAILED(reason)
  //
  //   Ranger -> Merchant                      Merchant -> Ranger
  //   job_request {id,jtype,map,x,y,...}      job_status  {id,state,eta,doing}   (ack = first status; ping every ~10s)
  //   job_cancel  {id}                        job_ready   {id,cap}               (arrived, send the items now)
  //   job_sent    {id,count}                  job_done    {id,got,hp,mp}
  //   travel_to_main {}                       job_failed  {id,reason}
  //   hello {jobs:[ids], want_reply}          cancel_ack  {id}
  //   gear_report {...}                       hello {jobs:[ids], want_reply}
  //                                           gear_give {...}
  const proto = {
    TYPES: ["restock", "junk", "stack", "gear"],
    // queue order: restock first, then junk/stackables, then gear. FIFO inside a type.
    PRIORITY: { restock: 0, junk: 1, stack: 1, gear: 2 },
    STATES: [
      "REQUESTED",
      "QUEUED",
      "EN_ROUTE",
      "ARRIVED",
      "TRANSFERRING",
      "DONE",
      "CANCELLED",
      "FAILED",
    ],
    ACTIVE: {
      REQUESTED: 1,
      QUEUED: 1,
      EN_ROUTE: 1,
      ARRIVED: 1,
      TRANSFERRING: 1,
    },
    ETA_LIMIT_S: 60, // the Ranger waits through a delivery only if the Merchant's ETA is at most this
    PING_MS: 10000, // Merchant status ping interval while a job is active
    LIVENESS_MS: 35000, // Ranger: no ping this long = the Merchant is gone
    // Fixed per-action estimates in seconds (NOT live measurement). The Merchant's ETA is built from these.
    ETA_S: {
      compound_group: 15, // one compound (3 items)            ~10-20s
      upgrade_item: 15, // one upgrade attempt                 ~10-20s
      round_setup: 45, // bank take-out + scroll shopping before the first compound/upgrade
      round_yield_cleanup: 25, // a compound/upgrade round that yields still walks the items back to the bank
      bank_run: 30, // one bank run                           ~20-40s
      shop_run: 25, // one shop run                           ~20-30s
      heal: 20,
      restock_job: 60, // go, handoff, (shop if needed)       ~30-90s
      junk_job: 70, // go, handoff, sell/bank                  ~30-90s
      stack_job: 70,
    },
    WALK_S_SAME_MAP_MIN: 5,
    WALK_S_OTHER_MAP: 40, // different map: doors / transporter on top of the walk
    id_ok: (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id),
  };
  const job_id = (prefix) =>
    (prefix || "j") +
    now().toString(36) +
    Math.floor(Math.random() * 46656).toString(36);

  // send_cm that says whether the receiver was reached ({delivered, res})
  async function send(to, msg) {
    const res = await call(() => send_cm(to, msg));
    const delivered = res.receivers
      ? res.receivers.indexOf(to) !== -1
      : !res.failed;
    return { delivered, res };
  }
  // parse_cm + a sane job id when the message carries one
  function parse_job(m, is_allowed) {
    const d = parse_cm(m, is_allowed);
    if (!d) return null;
    if (d.id !== undefined && !proto.id_ok(d.id)) return null;
    return d;
  }

  // ====================================================================
  // GENERATIONS + RE-ENGAGE
  // ====================================================================
  // Every script instance takes a generation number at start. Loops, timers and message handlers check is_current(gen)
  // and stop when a newer instance (a re-engage, or load_code of the same script) has started.
  function new_generation() {
    const g = (globalThis.__AL_GEN = (globalThis.__AL_GEN || 0) + 1);
    return g;
  }
  const is_current = (gen) => globalThis.__AL_GEN === gen;

  // Drops the running code and restarts the character from its SAVED script.
  //   opts.say     logger
  //   opts.slot    CODE slot (name or number) this script is saved in. Re-read from the saved text via load_code().
  //   opts.restart function that re-runs this script in-process; used when no slot is configured
  //                (does NOT re-read the saved text - set the slot for that)
  //   opts.stop    optional function that stops movement / closes things before the restart
  async function reengage(opts) {
    const say = opts.say;
    say("RE-ENGAGE: dropping the running code", "#E1A951");
    try {
      if (opts.stop) await opts.stop();
    } catch (e) {}
    try {
      smart.moving = false;
    } catch (e) {}
    try {
      stop();
    } catch (e) {}
    if (opts.slot) {
      say(
        "RE-ENGAGE: reloading the saved script from code slot '" +
          opts.slot +
          "'",
        "#E1A951"
      );
      const r = await call(() => load_code(opts.slot));
      if (r.failed) say("RE-ENGAGE: load_code failed: " + r.reason, "#CF575F");
      return;
    }
    if (opts.restart) {
      say(
        "RE-ENGAGE: no CODE slot configured - restarting from the code already loaded (set SELF_CODE_SLOT to reload the saved text)",
        "#E1A951"
      );
      setTimeout(() => {
        try {
          opts.restart();
        } catch (e) {
          say("RE-ENGAGE failed: " + ((e && e.message) || e), "#CF575F");
        }
      }, 200);
    }
  }
  function reengage_button(opts) {
    try {
      add_top_button("al_reengage", "Re-engage", () => reengage(opts));
    } catch (e) {
      opts.say(
        "Could not add the re-engage button: " + ((e && e.message) || e),
        "#CF575F"
      );
    }
  }

  return {
    VERSION,
    wait,
    now,
    d2,
    unit_cost,
    clamp_int,
    at_spot,
    safe,
    call,
    logger,
    describe_dest,
    mover,
    parse_cm,
    proto,
    job_id,
    send,
    parse_job,
    new_generation,
    is_current,
    reengage,
    reengage_button,
  };
})();
