  // ===== budgets survive a reload (compound / upgrade scroll spend), expiring after BUDGET_PERSIST_MS =====
  function load_budgets() {
    try {
      const b = JSON.parse(get("merchant_budgets") || "null");
      if (b && now() - b.at < CFG.BUDGET_PERSIST_MS) {
        S.compound_cap = b.cc;
        S.compound_spent = b.cs || 0;
        S.upgrade_cap = b.uc;
        S.upgrade_spent = b.us || 0;
        say(
          "Restored scroll budgets: compound " +
            b.cs +
            "/" +
            b.cc +
            ", upgrade " +
            b.us +
            "/" +
            b.uc
        );
      }
    } catch (e) {}
  }
  let budgets_json = "";
  function persist_budgets() {
    if (S.compound_cap === null && S.upgrade_cap === null) return;
    const j = JSON.stringify({
      cc: S.compound_cap,
      cs: S.compound_spent,
      uc: S.upgrade_cap,
      us: S.upgrade_spent,
    });
    if (j === budgets_json) return;
    budgets_json = j;
    try {
      set(
        "merchant_budgets",
        JSON.stringify(Object.assign(JSON.parse(j), { at: now() }))
      );
    } catch (e) {}
  }

  // waits at the main-town safe spot for the Ranger after he announced travel_to_main; a new job ends the wait
  async function hold_at_safe() {
    if (!at_spot(CFG.MAIN_SAFE_SPOT, 60)) {
      S.idle_walk = true;
      try {
        const r = await travel(
          CFG.MAIN_SAFE_SPOT,
          0,
          "waiting for the Ranger at the main-town safe spot"
        );
        if (r.failed && r.reason !== "aborted") await wait(2000);
      } finally {
        S.idle_walk = false;
      }
      return;
    }
    await wait(500);
  }

  // ============================ SCHEDULER (v5) ============================
  // The Merchant is ONE sequential loop: a round runs to its next atomic boundary, so two rounds never overlap. What can go
  // wrong is ORDER and STARVATION (a round that is always due ahead of another one). v5 keeps the v4 order in one table, so the
  // order is visible in one place, and records per task: runs, last duration, errors, and how often it was due but had to wait.
  // Order of SCHED.tasks = priority (first due task runs). Ranger jobs, healing, shop, bank stay in the main loop above it.
  const SCHED = { tasks: [], log_at: Date.now() - 25 * 60000, collide_at: 0 };
  function sched_add(t) {
    t.stats = {
      runs: 0,
      deferred: 0,
      errors: 0,
      last_start: 0,
      last_end: 0,
      last_ms: 0,
      last_err: "",
    };
    SCHED.tasks.push(t);
    return t;
  }
  const gear_warn_pre = () => {
    if (
      CFG.UPGRADE_ENABLED &&
      !gear_fresh() &&
      now() - S.gear_warn_at > 10 * 60000
    ) {
      S.gear_warn_at = now();
      say(
        S.ranger_gear
          ? "Upgrade rounds are paused: the last gear report from " +
              CFG.RANGER_NAME +
              " is older than 10 minutes"
          : "Upgrade rounds are waiting for a gear report from " +
              CFG.RANGER_NAME +
              " - is he running the newest AutoRanger v4.js?",
        "#CF575F"
      );
    }
  };
  const bag_warn_pre = () => {
    if (
      free_slots() <= 3 &&
      !tidy_due() &&
      now() - (S.tidy_warn || 0) > 10 * 60000
    ) {
      // the bag is nearly full but the tidy is not starting: say which condition holds it back
      S.tidy_warn = now();
      say(
        "Bag nearly full (" +
          free_slots() +
          " free) but no tidy yet: " +
          (!CFG.BAG_TIDY
            ? "BAG_TIDY is off"
            : has_jobs()
            ? "a Ranger job is queued"
            : is_paused()
            ? "paused (compound_paused is set)"
            : now() < (S.tidy_next || 0)
            ? "next tidy in " +
              Math.round(((S.tidy_next || 0) - now()) / 1000) +
              " s"
            : "unknown"),
        "#CF575F"
      );
    }
  };
  // PRIORITY ORDER (Sean, 2026-11-15): Ranger jobs, healing, shop and bank runs stay in the main loop above this table; then
  //   1 manual test button, 2 bag tidy, 3 gear sweep + copy limit, 4 event exchange (time-limited, needs the space the tidy makes),
  //   5 compound, 6 upgrade, 7 crafting, 8 donation, 9 lottery, 10 Merchant's Luck (off).
  // v4 ran exchange, donation, lottery, crafting and compound BEFORE the tidy and sweep, and a compound chain (3 s between rounds)
  // could starve them. A task that has waited longer than CFG.SCHED_MAX_WAIT_MS while others ran jumps the queue (see main loop).