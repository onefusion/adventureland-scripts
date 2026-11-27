var AL; // the shared library (code slot "lib"), read once each time this script starts - require_code runs the lib module again on every call, so never call it in a loop
try {
  try {
    AL = require_code("lib");
  } catch (e0) {
    AL = require_code("1"); // Sean 2026-11-21: the lib is also code slot 1 (a name that does not match still finds it by number)
  }
} catch (e) {
  try {
    game_log("[Ranger] [lib] require_code(\"lib\") failed: " + (e && e.message ? e.message : e) + ' - save "AL Libs v6.js" in code slot 1 (named "lib") and restart', "#CF575F");
  } catch (e2) {}
}
(function AutoRangerV5() {
  "use strict";
  if (!AL || AL.VERSION < 4) {
    game_log(
      '[Ranger] shared library missing or old: save "AL Libs v6.js" (version 4+) in code slot 1 (named "lib") and restart',
      "#CF575F"
    );
    return;
  }
  // a newer copy of this script (re-engage / reload) makes this one stop all its loops, timers and handlers
  const GEN = AL.new_generation();
  const alive = () => AL.is_current(GEN);

  // @include ../ranger/01-config.js
  // @include ../ranger/02-helpers.js
  // @include ../ranger/03-state.js
  // @include ../ranger/04-gear.js
  // @include ../ranger/05-merchant-messages.js
  // @include ../ranger/06-survival-inventory.js
  // @include ../ranger/07-need-ladder.js
  // @include ../ranger/08-combat-retreat-luck.js
  // @include ../ranger/08b-safety-fear-breaker.js
  // @include ../ranger/09-monster-hunts.js
  // @include ../ranger/10-farm-goals.js
  // @include ../ranger/11-boss-events.js
  // @include ../ranger/12-party.js
  // @include ../ranger/13-courier.js
  // @include ../ranger/14-paced-support-steps.js
  // ============================== MAIN ============================
  async function brain() {
    say(
      "v5 started (lib v" +
        AL.VERSION +
        ") - priority: " +
        CFG.PRIORITY_TYPES.join(",") +
        "; otherwise difficulty <= " +
        CFG.MAX_DIFFICULTY +
        ", ignoring " +
        CFG.IGNORE_NAMES.join(","),
      "#51D2E1"
    );
    add_boss_buttons();
    LEAD.add_buttons();
    AL.reengage_button({
      say,
      slot: CFG.SELF_CODE_SLOT,
      restart: AutoRangerV5,
      stop: async () => {
        if (R.ladder) await cancel_jobs(R.ladder);
      },
    });
    // restart handshake: tell the Merchant which jobs we hold (none after a reload), so he kills any ghost job of ours
    setTimeout(() => alive() && send_hello(), CFG.HELLO_DELAY_MS);
    for (;;) {
      if (!alive()) return;
      try {
        const out = await run_steps();
        if (out === "now") continue;
        if (out === "wait") {
          await wait(next_delay());
          continue;
        }
      } catch (e) {
        if (STEP.cur) STEP.cur.err++;
        say("ERROR: " + ((e && e.message) || e), "#CF575F");
        await wait(1000);
      }
      await wait(next_delay());
    }
  }

  brain();
})();
