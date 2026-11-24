var AL; // the shared library (code slot "lib"), read once each time this script starts - require_code runs the lib module again on every call, so never call it in a loop
try {
  try {
    AL = require_code("lib");
  } catch (e0) {
    AL = require_code("1"); // Sean 2026-11-21: the lib is also code slot 1 (a name that does not match still finds it by number)
  }
} catch (e) {
  try {
    game_log("[Merchant] [lib] require_code(\"lib\") failed: " + (e && e.message ? e.message : e) + ' - save "AL Libs v6.js" in code slot 1 (named "lib") and restart', "#CF575F");
  } catch (e2) {}
}
(function AutoMerchantV5() {
  "use strict";
  if (!AL || AL.VERSION < 4 || !AL.gear) {
    game_log(
      '[Merchant] shared library missing or old: save "AL Libs v6.js" (version 4+) in code slot 1 (named "lib") and restart',
      "#CF575F"
    );
    return;
  }
  // a newer copy of this script (re-engage / reload) makes this one stop all its loops, timers and handlers
  const GEN = AL.new_generation();
  const alive = () => AL.is_current(GEN);

  // @include ../merchant/01-config.js
  // @include ../merchant/02-helpers.js
  // @include ../merchant/03-state.js
  // @include ../merchant/04-job-queue.js
  // @include ../merchant/05-ranger-messages.js
  // @include ../merchant/06-safety-lead-stand.js
  // @include ../merchant/07-bank-sort-layout.js
  // @include ../merchant/08-shopping-healing-delivery.js
  // @include ../merchant/09-junk-stacks.js
  // @include ../merchant/10-compound.js
  // @include ../merchant/11-surplus-copies-sweep.js
  // @include ../merchant/12-stat-scrolls.js
  // @include ../merchant/13-bag-tidy.js
  // @include ../merchant/14-gear-upgrades.js
  // @include ../merchant/15-flipping.js
  // @include ../merchant/16-manual-compound-test.js
  // @include ../merchant/17-world-watch.js
  // @include ../merchant/18-merchant-luck.js
  // @include ../merchant/19-craft-report.js
  // @include ../merchant/20-lottery-paced.js
  // @include ../merchant/21-donations.js
  // @include ../merchant/22-crafting.js
  // @include ../merchant/23-exchange.js
  // @include ../merchant/24-budgets-scheduler.js
  // @include ../merchant/25-sale-basher-market.js
  // @include ../merchant/26-sell-round-hold-bank-excess.js
  // @include ../merchant/28-gear-goals.js
  // @include ../merchant/27-status-report.js
  async function main() {
    say(
      "v5 started (lib v" +
        AL.VERSION +
        ")" +
        (CFG.RANGER_NAME.indexOf("REPLACE") === 0
          ? " - RANGER_NAME is not set, deliveries are disabled!"
          : ""),
      "#51D2E1"
    );
    load_budgets();
    add_test_buttons();
    // what a restart must do first: tell the requesters their job failed (they ask again), stop what he is doing, close the stand
    const restart_stop = async () => {
      for (const j of S.jobs.slice()) {
        AL.send(j.from, {
          type: "job_failed",
          id: j.id,
          reason: "merchant_restarting",
        });
      }
      abort();
      if (character.stand) await call(() => close_stand());
    };
    // GitHub auto-update: the Merchant polls version.json himself. He reloads when idle (no job, not in a round, 60 s of quiet); a job or round that keeps him busy for
    // roster.update.merchant_force_ms (3 min) after the new build is seen is stopped so the update does not wait for hours (Sean 2026-11-21). Not during a boss event (Grinch / Snowman live).
    if (AL.update && AL.config.roster.update && AL.config.roster.update.enabled !== false) {
      let quiet_since = 0;
      let busy_since = 0;
      const UPD = AL.update.create({
        say,
        cfg: AL.config.roster.update,
        current: () => String(globalThis.__AL_BUILD || ""),
        can_reload: () => {
          const busy = S.cur ? "a job is running" : has_jobs() ? "a job is queued" : ACT.label !== IDLE_LABEL ? "busy: " + ACT.label : "";
          if (busy) {
            quiet_since = 0;
            if (!busy_since) busy_since = Date.now();
            const force = AL.config.roster.update.merchant_force_ms;
            if (force && Date.now() - busy_since >= force && !boss_live()) {
              say("UPDATE: stopping '" + busy + "' for the new build (busy for " + Math.round((Date.now() - busy_since) / 1000) + " s)", "#E0A040");
              return ""; // the reload below stops the job first (restart_stop)
            }
            return busy;
          }
          busy_since = 0;
          if (!quiet_since) quiet_since = Date.now();
          return Date.now() - quiet_since < 60000 ? "waiting for 60 s of quiet" : "";
        },
        reload: () => AL.reengage({ say, slot: CFG.SELF_CODE_SLOT, restart: AutoMerchantV5, stop: restart_stop }),
      });
      const upd_timer = setInterval(() => (alive() ? UPD.tick() : clearInterval(upd_timer)), 15000);
    }
    AL.reengage_button({
      say,
      slot: CFG.SELF_CODE_SLOT,
      restart: AutoMerchantV5,
      stop: restart_stop,
    });
    const sm = (t, est) => {
      if (ACT.label !== t || est !== undefined) act(t, est || 0);
      set_message(t);
    };
    // restart handshake: tell the Ranger which jobs we hold; he re-sends the ones we lost, we kill the ghosts he does not know
    setTimeout(() => alive() && send_hello(), CFG.HELLO_DELAY_MS);
    // status ping while a job is waiting or running: {job, state, eta, doing}
    const ping = setInterval(() => {
      if (!alive()) return clearInterval(ping);
      try {
        for (const j of S.jobs) if (P.ACTIVE[j.state]) send_status(j);
      } catch (e) {}
    }, P.PING_MS);
    // watchdog: a job that sits unserved for 20s+ reports what the Merchant is stuck on
    const dog = setInterval(() => {
      if (!alive()) return clearInterval(dog);
      try {
        const r = queued_jobs()[0];
        if (
          r &&
          Date.now() - ACT.at > 20000 &&
          Date.now() - r.created_at > 20000
        )
          say_raw(
            busy_report(
              "Job still waiting " +
                Math.round((Date.now() - r.created_at) / 1000) +
                "s"
            ),
            "#CF575F"
          );
      } catch (e) {}
    }, 20000);
    for (;;) {
      if (!alive()) return;
      try {
        if (await survive()) continue;
        persist_budgets();

        if (needs_heal()) {
          sm("Healing up", P.ETA_S.heal);
          await heal_up();
          continue;
        }

        // next job: restock first, then junk/stackables, FIFO inside a type. Gear rides along at the next meeting.
        const job = queued_jobs()[0];
        if (job) {
          S.cur = job;
          sm(
            (job.jtype === "restock" ? "Delivering to " : "Collecting from ") +
              job.from,
            job_est(job)
          );
          try {
            if (job.jtype === "restock") await serve_request(job);
            else await serve_junk(job);
          } finally {
            if (job.jtype !== "restock") S.tidy_next = 0; // he just took a load from a Ranger: tidy the bag as soon as the queue is empty (no waiting for the 10 min timer)
            if (!job.ended_at) {
              if (job.cancelled) end_job(job, "CANCELLED");
              else {
                job.reason = job.reason || "aborted";
                end_job(job, "FAILED");
              }
            }
            S.cur = null;
          }
          continue;
        }
        if (now() < S.hold_until) {
          sm("Waiting for the Ranger at the main safe spot");
          await hold_at_safe();
          continue;
        }
        if (too_poor_to_restock()) {
          sm(
            "Fetching gold from the bank",
            P.ETA_S.bank_run + P.ETA_S.shop_run
          );
          await withdraw_and_shop();
          continue;
        }
        if (
          stock_low() &&
          now() - S.last_poor > CFG.SHOP_RETRY_MS &&
          now() - S.last_shop_fail > CFG.SHOP_RETRY_MS
        ) {
          sm("Restocking potions", P.ETA_S.shop_run);
          await shop();
          await go_home();
          continue;
        }
        if (needs_bank()) {
          sm("Banking", P.ETA_S.bank_run);
          await bank_run();
          continue;
        }
        if (courier_note_live() && !queued_jobs().length) {
          // v5: the courier is on his way: no new round (they take minutes), wait at the stand with the potions ready
          sm("Waiting for the courier");
          await ensure_stand();
          await wait(CFG.TICK_MS);
          continue;
        }
        if (now() - SCHED.log_at > CFG.SCHED_STATUS_MS) {
          SCHED.log_at = now();
          sched_status();
        }
        let ran = false;
        // a round that has waited too long (see SCHED_MAX_WAIT_MS) goes first, if it is really due
        const starved = SCHED.tasks.filter(
          (t) => t.wait_since && now() - t.wait_since > CFG.SCHED_MAX_WAIT_MS
        );
        for (const t of starved) {
          if (quiet_blocks(t) || !t.due()) continue;
          say(
            "Schedule: " +
              t.label +
              " has waited " +
              sched_min(now() - t.wait_since) +
              " behind other rounds - running it now",
            "#8AB4D0"
          );
          await sched_run(t, sm);
          ran = true;
          break;
        }
        if (ran) continue;
        for (const t of SCHED.tasks) {
          if (t.pre) t.pre();
          if (quiet_blocks(t) || !t.due()) continue;
          await sched_run(t, sm);
          ran = true;
          break;
        }
        if (ran) continue;
        sm(IDLE_LABEL);
        await ensure_stand();
      } catch (e) {
        say("ERROR: " + ((e && e.message) || e), "#CF575F");
        await wait(2000);
      }
      await wait(CFG.TICK_MS);
    }
  }

  main();
})();
