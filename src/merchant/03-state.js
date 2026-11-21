  // ============================== STATE ===========================
  const S = {
    last_sale: 0,
    stand_guard_at: 0,
    jobs: [], // the job queue (see JOB QUEUE): every job from request to its final state
    cur: null, // the job being served right now
    finished: {}, // id -> {state, at}: lets a re-sent request be answered without doing it twice
    idle_walk: false, // true while he is only walking home: a new job pre-empts that
    hold_until: 0, // after travel_to_main: wait at the main safe spot until then
    ranger_to_main_at: 0,
    last_poor: 0,
    last_shop_fail: 0,
    last_bank_fail: 0,
    last_withdraw_fail: 0,
    last_heal_fail: 0,
    junk_sent: {}, // request id -> number of items the Ranger says he sent
    last_list_try: 0,
    fled_at: 0,
    compound_next: 0,
    upgrade_next: 0,
    exch_next: now() + 90000,
    exch2_next: now() + 150000,
    exch2_empty_until: 0,
    craft_next: now() + 150000,
    lottery_next: now() + 240000,
    donate_next: now() + 300000,
    market_next: now() + 420000,
    craft_sig: "",
    manual: null, // set by the top buttons: { real: bool }
    exch_empty_until: 0,
    gear_warn_at: now() - 510000, // first "waiting for the Ranger" notice after ~90s
    upg_diag: null,
    upgrade_cap: null,
    upgrade_spent: 0,
    upgrade_attempts: 0,
    ranger_gear: null, // last gear_report from the leader Ranger {slots, map, x, y, at}
    gears: {}, // name -> last gear_report of each follower Ranger
    st: {}, // name -> hourly report data {gain, cur, last, deaths0, at}
    rep_prev: null, // gold / bank gold at the last hourly report
    bank_seen: null, // {gold, free, at}: the bank as last seen (character.bank only exists at the bank)
    rep_at: 0,
    party_at: 0, // last party check
    swap: null, // a worn piece taken off for a stat scroll: { who, name, level, slot, at }
    swap_fail: {}, // name|level of pieces that did not take a scroll: never asked for again
    swap_last: 0,
    gear_pending: [], // upgraded items kept in the bag for the Ranger
    sweep_last: 0,
    sweep_sig: "",
    gear_next_try: 0,
    compound_cap: null, // gold budget for scrolls this session (set at the first round)
    compound_spent: 0,
    compound_made: {}, // item names this session produced
  };
