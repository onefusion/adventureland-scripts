  // ============================== STATE ===========================
  const R = {
    started_at: Date.now(),
    hunt_checked: false,
    mh: null,
    mh_check_at:
      +(function () {
        try {
          return get("hunt_next_at");
        } catch (e) {
          return 0;
        }
      })() || 0,
    last_3shot: 0,
    last_5shot: 0,
    ladder: null, // the need ladder in progress (jobs sent to the Merchant, meeting point...)
    ladder_next: 0, // earliest time the next ladder may start
    gear_busy: false, // a gear item from the Merchant is being equipped
    unreach: {}, // monster id -> time until which it is ignored (no path to get in range)
    xmove_at: 0,
    tether_next: 0,
    xmove_last: null,
    fled_at: 0,
    lock: null,
    goal: null, // the farm goal being worked on
    boss: null, // the boss event being fought {cfg, type, name, started, last_seen, pos, ...}
    boss_check_at: 0,
    boss_end: {},
    follow_goal: null, // follower: monster type the leader is farming
    leader: null, // follower: last party_state from the leader {map,x,y,goal,at}
    follow_at: 0,
    follow_fails: 0,
    follow_block_until: 0,
    party_invite_at: 0,
    party_join_at: 0,
    party_wait: {}, // member name (or "leader") -> since when he has been out of the party (the fallback invites / requests wait a minute while the Merchant is online)
    levels: {}, // leader: follower name -> {level, at, hp, mp, free, junk, gold, map, busy} from their party_level messages
    trip: null, // leader: the courier trip in progress {id, courier, at}
    gear_ready_at: 0, // leader: when the Merchant last said gear is waiting for the party
    courier_next: 0,
    courier_warn_at: 0,
    courier: null, // courier: the trip he is running {id, members, phase, buy, goal, got, shares}
    courier_gear: [], // courier: gear the Merchant gave him for the other Rangers [{to,name,level,slot}]
    bees_only: null, // leader: last announced bees-only state
    force: null, // leader: forced farm {type, started, saved: {FARM_SPOT, TARGET_TYPES}} (set("force_farm", ...))
    force_check_at: 0,
    force_rip: {}, // member name -> was dead at the last look (a death edge drops the forced farm)
    luck_need: null, // leader: {why, at} a Merchant's Luck stop is wanted (forced farm / boss start)
    luck_last: 0,
    luck_retry_at: 0,
    luck_busy: false,
    luck_done: null, // the Merchant's last mluck_done {id, cast, failed}
    luck_boss_key: null,
    level_sent_at: 0,
    state_sent_at: 0,
    goal_check_at: 0,
    goal_cool: {}, // type -> time before which the goal is not tried again
    goal_end: {}, // type -> when its last session ended (rotation)
    goal_start: {}, // type -> when its last session started (every_min)
    goal_bad: {}, // type -> spawn boxes that could not be reached
    goal_logged: {},
    goal_stats: {}, // v5: type -> lifetime results of farm goals this session
    goal_gate_since: 0,
    post_boss: null, // v5: set when a boss event ends; the next courier check starts a hand-over trip
    boss_skip: {}, // v5: type -> time before which a capped boss is not joined again
    hp_hist: [],
    danger_at: 0,
    last_attackers: "",
  };
