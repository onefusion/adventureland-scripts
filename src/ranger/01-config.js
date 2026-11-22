  // ============================ CONFIG ============================
  // names, code slots and the shared item lists come from the one config file (src/lib/config.js); the CFG keys keep their v5 names
  const C = AL.config.for_script("Ranger");
  const CFG = {
    MERCHANT_NAME: C.MERCHANT_NAME, // exact, case-sensitive
    MERCHANT_CODE_SLOT: "", // CODE slot of the Merchant's script (e.g. "3") to let the leader start him when he is offline; "" = never auto-start him (so you can log in with him and update his code)
    SELF_CODE_SLOT: C.SELF_CODE_SLOT, // CODE slot (name or number) THIS script is saved in. The Re-engage button reloads the saved text from it.

    // --- need ladder (v4): low potions or a full bag -> retreat to town, ask the Merchant (60s ETA rule), fall back ---
    RETREAT_NEAR_PX: 250, // on main: farther than this from SAFE_SPOT -> use the town skill first, then walk
    DISENGAGE_STEP_PX: 120, // before using the town skill he steps this far away from monsters that could hit him (a hit interrupts the cast)
    DISENGAGE_MARGIN_PX: 120, // monsters count as a threat when closer than their range + this, or when they are targeting him
    DISENGAGE_MAX_MS: 8000, // give up running after this long and cast anyway
    LADDER_BACKOFF_MS: 120000, // a need that is still unmet after the whole ladder: wait this long before trying again
    HELLO_DELAY_MS: 4000, // restart handshake: send hello this long after start

    // --- party of Rangers: ONE script for all of them. The leader decides (goals, hunts); followers go to him and shoot what he shoots ---
    // Leave PARTY_MEMBERS empty to play solo. Save this same script in the same code slot for every Ranger.
    PARTY_LEADER: C.PARTY_LEADER, // exact, case-sensitive
    PARTY_MEMBERS: C.PARTY_MEMBERS, // the follower Rangers' names, e.g. ["Dexy2", "Dexy3"]
    PARTY_ACCEPT_FROM: C.PARTY_ACCEPT_FROM, // a follower accepts party invitations from this character (the Merchant sends them when he is online) AND from PARTY_LEADER, nobody else
    PARTY_JOIN_MS: 20000, // v5: a follower / the Priest that is not in the leader's party asks to join it this often (the leader accepts requests from his own members only), and the leader invites members that are online but not in his party (only while HE is the party head - when the Merchant leads the party, the Merchant invites)
    PARTY_HUNTS_UNTIL_LEVEL: 50, // v5 (Sean 2026-11-18 16:17): while the party is still in bees-only mode, Daisy hunts are allowed once EVERY member has reached this level, but only the easy ones (HUNT_MAX_DIFFICULTY_BEES_ONLY). Goals and boss events stay off until PARTY_BEES_UNTIL_LEVEL. 0 = off (no hunts while bees-only)
    HUNT_MAX_DIFFICULTY_BEES_ONLY: 0, // v5: difficulty limit for hunts taken in bees-only mode (0 easy / green)
    PARTY_BEES_UNTIL_LEVEL: 0, // (Sean 2026-11-21: off, the Warrior and Priest are past 60; was 60) the whole party only farms bees (no goals, no Daisy hunts) until EVERY follower has reached this level; 0 = off
    TANK_NAME: C.TANK_NAME, // the Warrior: announces the focus target (the biggest monster hitting the party); we mark it and shoot the rest
    FOCUS_TARGET: true,
    FOCUS_MAX_AGE_MS: 5000,
    DEFEND_PARTY: true, // Sean 2026-11-21: a monster is hitting a party member (the Warrior tanking a Hawk while the leader searched for the Phoenix): the leader stops walking and searching, shoots it and stays until it is dead
    DEFEND_RANGE_PX: 700, // ...for monsters within this distance of the leader
    FOCUS_MARK: true,
    ESCORT_WAIT_MS: 6000, // the Warrior is in the party and has not engaged yet (no focus): wait up to this long before opening fire on a monster nobody has aggro'd. 0 = never wait
    PARTY_SUPPORT: C.PARTY_SUPPORT, // Priest SexyHexy (code slot 5) and Warrior SexyWexy (code slot 4). The account allows only 3 running non-merchant characters: with both running, the follower Rangers stay off (an offline member is simply ignored) // non-Ranger helpers (the Priest, running AutoPriest v5.js): part of the party, get party_state, report potions / level / bag to the leader and are served by the courier. Empty = none
    PARTY_SUPPORT_SLOTS: C.PARTY_SUPPORT_SLOTS, // CODE slot of each support character (used to start them when PARTY_START_MEMBERS is on)
    BAG_SHARE: true, // v6 (Sean 2026-11-20): spare items (what would wait for the Merchant) are handed to the Priest when she is close: she has the bag room and never runs the courier trips; the Merchant's junk trips collect them from her bag
    BAG_SHARE_TO: C.BAG_SHARE_TO,
    BAG_SHARE_MIN_ITEMS: 3, // ask only when at least this many items wait for the Merchant
    BAG_SHARE_EVERY_MS: 90000,
    BAG_SHARE_MAX: 12, // items per hand-over
    BAG_SHARE_RANGE: 250, // the Priest must be this close (send_item works within about 400)
    PRIEST_CODE_SLOT: C.PRIEST_CODE_SLOT, // CODE slot AutoPriest v5.js is saved in (used to start the support characters)
    PARTY_START_MEMBERS: false, // the main Ranger starts follower characters that are offline (needs SELF_CODE_SLOT)
    STATE_EVERY_MS: 4000, // the leader tells the followers where he is and what he farms this often
    STATE_STALE_MS: 20000, // no news from the leader for this long: followers farm the bees on their own
    FOLLOW_FAR_PX: 260, // a follower farther than this from the leader walks to him
    FOLLOW_RADIUS: 160, // idle followers stay this close to the leader
    FARM_SPOT: { map: "main", x: 496, y: 1068 }, // bees (best drops and gold). Scorpions (quivers): x 1578, y -168 with TARGET_TYPES ["scorpion"] and MAX_DIFFICULTY 1. Snakes: x -155, y 1852
    FARM_ROTATE_MS: 15 * 60000, // (Sean 2026-11-21) the base farm moves to the next monster of FARM_ROTATION after this long even when no hunt ended (a hunt-less hour used to stay on one monster all day); 0 = only after a hunt
    FARM_ROTATION: ["poisio", "armadillo", "croc", "porcupine", "arcticbee"], // (Sean 2026-11-19) farm in rotation: after every finished hunt the base farm moves to the next monster of this list and stays there until the next hunt ends (Poison Sacks, Armadillo Scales, Croc Scales). [] = no rotation (FARM_MONSTER only). Which one is next is kept in set("farm_rot_idx")
    FARM_MONSTER: "poisio", // v5 (Sean 2026-11-18 23:46): the base farm is now the Poisios (main map, -262..20 x 1198..1522): a Poison Sack sells for about 1,000 gold, a Bee Wing for 25, and they drop less often so they fill the bag and bank more slowly. Set "" for the bees again (FARM_SPOT / TARGET_TYPES below). (older note:)  v5 (Sean 2026-11-17: rats were tried, off again - Rats drop only rattail; the Mansion Gold Earring is a map drop): a monster type (G.monsters key, e.g. "arcticbee", "poisio", "rat") to farm instead of the bees: FARM_SPOT becomes the centre of its nearest spawn box and TARGET_TYPES is set to it. "" = the FARM_SPOT / TARGET_TYPES above. Needs MAX_DIFFICULTY that allows it (poisio hits hard: 1)
    FARM_RADIUS: 100, // idle farther than this from FARM_SPOT -> walk back
    // --- who to attack -------------------------------------------------
    PRIORITY_TYPES: [], // monster types attacked first whenever visible on screen, whatever their difficulty
    MAX_DIFFICULTY: 1, // (v5: 1 for the Mansion Rats; bees are easy anyway) (scorpions need 1)   the game's HP-bar colour: 0 = easy (green), 1 = medium (orange), 2 = hard (red)
    DEATH_RETREAT: true, // Sean 2026-11-20: a party member dies on the base farm (the Porcupines wiped the party: the Warrior died and the others kept fighting) -> everybody leaves for town at once, and that monster is skipped by the farm rotation for DEATH_AVOID_MS
    KIT_WAIT_MS: 600000, // Sean 2026-11-20: the Warrior reports he has no Basher: the group waits in town (next to the Merchant) this long at most for the Merchant to bring one
    DEATH_RETREAT_HOLD_MS: 90000, // stay in town this long (the dead respawn and come back to the leader meanwhile)
    DEATH_AVOID_MS: 2700000, // the rotation does not pick that monster again for this long
    TRY_MONSTER_MS: 360000, // Sean 2026-11-20: "Try monster" button / set("try_monster", "<monster>"): the group goes to its nearest spawn and takes on ONE of them with single-target shots; a kill = success, any death or this much time without a kill = failure; then back to the normal farm
    FORCE_FARM: true, // v5 (Sean 2026-11-18): console command set("force_farm", "<monster>") sends the whole group to that monster's nearest spawn and lets THAT monster past MAX_DIFFICULTY (nothing else). Any death (not during the Grinch fight) drops it and the group goes back to the bees; set it again by hand to retry. set("force_farm", "") ends it
    FORCE_CHECK_MS: 3000,
    LUCK_STOP: true, // v5 (Sean 2026-11-18): the leader walks to the Merchant (SAFE_SPOT) and asks him to cast Merchant's Luck on every party member before a forced farm and before a boss event, and about once an hour while farming (the buff lasts an hour)
    LUCK_STOP_BEES_MS: 60 * 60000, // regular renewal while farming
    LUCK_STOP_TIMEOUT_MS: 120000, // the Merchant has not answered after this long: go on without
    LUCK_STOP_MIN_LEFT_MS: 10 * 60000, // a buff with less than this left counts as missing
    LUCK_STOP_RETRY_MS: 30 * 60000, // no answer (Merchant away / busy): not again for this long
    IGNORE_NAMES: ["Target Automatron", "Fairy"], // by in-game name - covers all 7 'target*' training dummies
    IGNORE_TYPES: [], // extra monster types (G.monsters keys) never to attack
    TARGET_TYPES: ["bee"], // [] = any easy monster; otherwise only these types
    LEASH_RADIUS: 400, // ignore ordinary targets farther than this from FARM_SPOT (0 = no limit)

    HP_POTION: "hpot1", // tier-1 (400 HP / 500 MP) - Poisios hit hard
    MP_POTION: "mpot1",
    POTION_REQUEST_AT: 80, // ask the Merchant when either potion is at/below this
    POTION_CRITICAL: 8, // at/below this, stop waiting and go to the NPC
    // --- Courier trip (party mode): ONE follower fetches potions for the whole party and takes the junk of all three to town ---
    COURIER_ENABLED: true,
    LEADER_TRIP_WHEN_ALONE: true, // v5 (Sean 2026-11-17): no follower Ranger is online -> the leader himself makes the potion / junk / gear trip for the whole party (the Priest and Warrior follow him to town)

    COURIER_QUIET_AT: 120, // v5: while NO boss event, hunt or farm goal is running, a trip starts already at this many potions (and no new farm goal starts below it), so the restock happens between events, not in the middle of one
    COURIER_POTION_AT: 40, // any Ranger at/below this of either potion starts a trip
    BOSS_POTION_TARGET: 600, // v5: during a boss event each trip fills everyone up to this many of each potion (Merchant stock is raised to match)
    BOSS_COURIER_POTION_AT: 80, // v5: while a boss event runs the trip starts this early (a long fight burns potions; the courier is back within a minute because the post is in town)
    BOSS_TOPOFF_BELOW: 200, // v5: once per boss event, right after it starts: anyone below this many of either potion starts a top-off trip (the party waits at the post for the boss anyway)
    COURIER_STOPGAP: 10, // the courier hands this many of a low potion to a Ranger before leaving...
    COURIER_KEEP: 20, // ...but only while he keeps at least this many himself
    COURIER_JUNK_EACH: 30, // junk items each other Ranger / the Warrior / the Priest gives the courier per trip (limited by the courier's free slots; was 12)
    COURIER_GOLD_KEEP: 5000, // the others give the courier gold above this, so it can pay the Merchant
    COURIER_COOLDOWN_MS: 120000, // earliest next trip after one ended
    GEAR_READY_MAX_MS: 1200000, // a "gear is waiting" message from the Merchant starts a trip for this long
    COURIER_MAX_MS: 900000, // the leader gives up on a trip after this long
    COURIER_COLLECT_WAIT_MS: 20000,
    COURIER_DELIVER_WAIT_MS: 150000, // after the town trip: how long the courier looks for the others before giving up
    EMERGENCY_POTIONS: 8, // party mode: a Ranger this low (and no courier coming) runs his own ladder as before
    POTION_TARGET: 250, // how many of each to hold after a restock (long boss fights burn through potions)

    GOLD_KEEP: 5000, // keep this much; the rest is swept to the Merchant
    SWEEP_MIN: 2000, // don't bother sweeping less than this
    PAY_RANGE: 150, // must be this close to the Merchant to send gold

    // Survival
    HP_USE_PCT: 0.8,
    MP_USE_PCT: 0.6,
    FLEE_HP_PCT: 0.45,
    RESPAWN_DELAY_MS: 3000,

    // Skills
    MULTISHOT_MIN_MP_PCT: 0.4, // only use 3shot/5shot above this MP fraction
    TRI_SHOT_MONSTERS: ["bee"], // v5: 3shot/5shot are ONLY used on these monster types (several get hit at once and aggro the Ranger). Every other monster is shot one at a time. Add a type here to allow it.
    SINGLE_TARGET_TYPES: ["scorpion", "minimush", "bbpompom", "pppompom", "snake", "osnake", "cave_snake"], // never 3shot/5shot these: one at a time (scorpions: only one aggros; Pom Poms: the hunt is too hard when several are pulled)
    // --- farm goals: monsters farmed on purpose for the drops that build the DEX gear (see the Merchant's compound priority) ---
    // Goals are tried in rotation (the one visited longest ago first) whenever no accepted Daisy hunt is running; with none available he farms bees.
    // A goal is skipped when the monster is too tough, one kill would take too long, or it has no regular spawn he can walk to.
    // Switch off / on from the game console:  set("farm_goals", "off")  /  set("farm_goals", "")
    GOALS_ENABLED: true,
    GOAL_MAX_HP: 1000000, // never farm monsters with more HP than this
    GOAL_MAX_TTK_S: 900, // skip a goal when one kill would take longer than this (estimated: HP / (attack x frequency x HUNT_EFFICIENCY))
    GOAL_MAX_DIFFICULTY: 1, // the game's HP-bar rating, as for hunts
    GOAL_WAIT_MS: 120000, // at the spawn and none in view for this long: not respawned yet - rest the goal for the monster's respawn time
    GOAL_MAX_PATH_FAILS: 6,
    // v5: a monster with SEVERAL spawn areas (the Phoenix has 5 on this server and picks one at random each respawn, "randomrespawn") is searched area by area:
    // v5: the game log cannot be selected or copied and old lines scroll away, so status lines are ALSO written to the browser console (F12), where they can be copied
    CONSOLE_STATUS: true, // status, report and problem lines (red/amber) also go to console.log; CONSOLE_ALL mirrors everything
    CONSOLE_ALL: false, // true: EVERY line this script writes to the game log also goes to console.log
    GOAL_NOTE_MS: 60000, // v5: "Goal: ..." progress line this often while a farm goal runs (also copied to the console)
    // v5 danger stop-gap: a fast HP drop with several monsters on him is logged, and he casts town at once (the cast takes ~3 s, so it only helps when it starts early)
    DANGER_ENABLED: true,
    DANGER_HP_PCT: 0.35, // HP at/below this fraction...
    DANGER_DROP_PCT: 0.4, // ...after losing at least this fraction of max HP within DANGER_WINDOW_MS...
    DANGER_WINDOW_MS: 4000,
    DANGER_MIN_ATTACKERS: 3, // ...with at least this many monsters targeting him
    DANGER_TOWN: true, // cast town when it triggers
    GOAL_BOX_WAIT_MS: 60000, // patrol each area this long, then go to the next one (single-area monsters keep GOAL_WAIT_MS)
    GOAL_SWEEP_REST_MS: 600000, // every area searched without finding it: rest the goal this long (the monster respawns somewhere else meanwhile)
    GOAL_SWEEP_OTHER_MAPS: false, // false: only areas on the map the monster's spawn entry belongs to (the Phoenix's halloween and cave areas are skipped)
    GOALS: [
      // want = items worth the trip; the drop odds from the game data are logged when a goal starts
      {
        type: "phoenix",
        session_min: 10, // v5: one visit lasts this long (a sweep of its 5 areas takes ~5 min) ...
        every_min: 30, // v5 (Sean 2026-11-17): ... and starts at most this often; the rest of the time he farms bees / does hunts and boss events. 0 / unset = no limit
        want: ["dexearring", "stormfeather"],
        enabled: false, // Sean 2026-11-21: OFF - the search separated the leader from the party (the Warrior died to a Hawk while the leader walked on). Remove this line to search again.
      }, // main map: Earring of Dexterity 12%; Storm Feather (the Wind Belt needs 40) also drops
      // Dracul (Sean 2026-11-21, ON): 240,000 HP, magical 245 at range 120, one target, respawns every 18 min. Drops 10% EACH of the Strength / Intelligence / Dexterity earrings, 3% Dracul's Attire (lifesteal chest), 5% Fire Staff.
      // Only the Cave of Beginnings (batcave) spawn has a box the goal code can walk to; the Cave of Darkness entry has none. The Warrior swaps to his resistance set (magical, 240k HP is above ALT_MIN_HP).
      { type: "mvampire", session_min: 20, every_min: 20, want: ["strearring", "intearring", "dexearring", "mcape", "firestaff"] },
      // // Dracul, Cave of Darkness: respawns every ~18 min
      {
        type: "fireroamer",
        session_min: 60,
        want: ["orbofdex"],
        enabled: false,
      }, // Fire Spirits, desertland: Orb of Dexterity 0.07% - a very long haul, switched off
    ],
    // --- boss events: the whole party drops what it is doing and goes after a server boss while it is up ---
    // The game publishes live bosses in parent.S[type] = {live, hp, max_hp, map, x, y}; he teleports, so the position is chased.
    // Search never stops until lose_ms has passed with no sign of the boss (not in view, S not live): then it is assumed dead. A boss that does not teleport can have a short lose_ms (the server's live flag is the proof); the Grinch keeps 5 min because he teleports in and out.
    // Switch off / on from the game console:  set("boss_events", "off")  /  set("boss_events", "")
    BOSS_EVENTS_ENABLED: true,
    BOSS_WHEN_BEES_ONLY: ["grinch"], // v5 (Sean 2026-11-17): while the party is in bees-only mode (someone is below PARTY_BEES_UNTIL_LEVEL, e.g. the Priest) only these boss events are joined
    BOSS_EVENTS: [
      { type: "grinch", max_ms: 0, lose_ms: 5 * 60000, post: true, post_radius: 600 }, // Grinch: teleports in and out (3M HP on this server). post: true = the party WAITS at SAFE_SPOT (town) and shoots him when he is in range, it does not chase him; he counts as "around" while the server shows him within post_radius of the post
      { type: "snowman", lose_ms: 30000 }, // Snowman: 1 damage per hit, melee only and slow - kite and shoot. v5 (Sean 2026-11-17): he does not teleport, so when the server stops reporting him live (and he is not in view) he counts as dead after 30 s, not 3 min
    ],
    BOSS_STALE_MS: 90000, // during a boss event the followers wait this long for news from the leader (instead of STATE_STALE_MS) before they go back to the bees
    BOSS_MAX_MS: 15 * 60000, // v5: a boss event ends after this long (a boss entry can set its own max_ms; 0 = no cap, the Grinch has none)
    BOSS_CAP_REST_MS: 30 * 60000, // after a capped event the same boss is not joined again for this long
    BOSS_CHECK_MS: 5000,
    BOSS_MOVE_MS: 4000, // re-aim the walk at the boss's reported position this often
    BOSS_LOG_MS: 60000, // progress line (HP left, estimated time) this often
    // --- monster hunts (Daisy, main town) --------------------------------
    // He picks up a hunt, checks whether he can finish it, and either goes after it or lets it expire.
    // Switch off / on from the game console without re-pasting:  set("monster_hunts", "off")  /  set("monster_hunts", "")
    HUNT_ENABLED: true,
    HUNT_NPC: "monsterhunter", // Daisy
    HUNT_NPC_FALLBACK: { map: "main", x: 126, y: -413 }, // used if find_npc cannot place her
    HUNT_MAX_DIFFICULTY: 1, // the game's HP-bar rating: 0 easy (green), 1 medium (orange), 2 hard (red). Harder hunts are skipped
    HUNT_MAX_MONSTER_HP: 250000, // never attempt monsters with more HP than this (bosses)
    HUNT_AVOID_TYPES: [], // monster types (G.monsters keys) to never hunt, even if they look doable
    ESCORT: true, // Sean 2026-11-20: the Warrior or Priest has not been within ESCORT_NEAR_PX of me (or on my map) for ESCORT_AFTER_MS: stop and walk to them (never on my own junk / potion trip, a courier trip, a retreat or a boss event). Twice within 10 min = this farm keeps splitting the party: it is skipped for a while
    ESCORT_AFTER_MS: 60000,
    ESCORT_NEAR_PX: 700,
    ESCORT_FRESH_MS: 20000, // only trust a member's position report younger than this (older = offline or dead: nothing to walk to)
    BOAR_FLEE: true, // v5 (Sean 2026-11-18): a Wild Boar (three at a time in Winterland) that targets anybody in the party: every character leaves through the portal NPC for the main map and the party farms the normal bees for BOAR_HOLD_MS (the forced farm, hunts and goals wait) before going back
    BOAR_MAPS: ["winterland"],
    BOAR_TYPES: ["boar"],
    BOAR_HOLD_MS: 10 * 60000,
    HUNT_DANGER_TYPES: ["greenjr"], // roaming monsters that kill a Ranger in seconds (Green Jr.: attack speed 20). A hunt does not walk to a spawn where the server shows one, and a Ranger who sees one close by runs to town and holds hunts for HUNT_DANGER_HOLD_MS
    HUNT_DANGER_RADIUS: 800, // seen this close to me during a hunt: run (the game does not list him in parent.S, so sight is the only warning; 800 is about a screen)
    HUNT_DANGER_SPOT_RADIUS: 900, // the server shows one this close to the hunt's spawn: do not go there
    HUNT_DANGER_HOLD_MS: 600000,
    HUNT_DANGER_FOLLOW_HOLD_MS: 60000, // v5: a follower who ran stays in town this long before following the leader again (longer while the server shows the monster near the leader)
    HUNT_EFFICIENCY: 0.5, // share of nominal damage that really lands (misses, armor, walking) - used for the time estimate
    HUNT_TRAVEL_BUFFER_S: 120, // extra seconds assumed for getting there
    HUNT_STARTUP_WAIT_MS: 4000, // after a (re)start, wait this long for the character's state before deciding whether a hunt is active
    HUNT_COOLDOWN_MS: 3600000, // after a hunt ends (done or expired) farm normally this long before asking Daisy again (1 hour)
    HUNT_RETRY_MS: 600000, // if Daisy gave nothing, wait this long before asking again
    HUNT_MAX_PATH_FAILS: 6, // this many failed walks toward the monsters ("path not found") -> give the hunt up
    HUNT_ARRIVE_RADIUS: 220, // closer than this to the spawn: stop travelling, look for the monsters
    FIVESHOT_INTERVAL_MS: 30000, // 5shot (level 75+) at most this often - it costs even more MP
    THREESHOT_INTERVAL_MS: 30000, // 3shot at most this often (it costs a lot of MP); plain attacks in between
    SUPERSHOT_TYPES: [], // supershot costs 400 MP - only worth it on big targets
    HUNTERSMARK_TYPES: [],
    BOSS_MARK: true, // boss events: the Rangers use Hunter's Mark (+10% damage taken, 10 s, 240 MP) on the boss in rotation so it never runs out
    BOSS_MARK_REFRESH_MS: 3000, // cast again once the mark has less than this left (whoever sees it first; the others then see a fresh mark and skip)
    BOSS_MARK_MIN_MP_PCT: 0.3, // never below this MP fraction (potions / attacks come first)

    // --- inventory cleaning --------------------------------------------
    CLEAN_ENABLED: true,
    CLEAN_WHEN_FREE_SLOTS: 10, // start cleaning when this few slots (or fewer) are free
    JUNK_ITEMS: C.JUNK_ITEMS, // item keys (G.items) - bee-area gear drops that can only be sold
    // Accessories the Merchant compounds (3 identical -> 1 better). Never sold: when the bag fills up they are
    // handed to the Merchant, who banks them. (Without a Merchant they simply stay in the bag.)
    // v5: spare equipment in the bag (not worn, not locked) that the game lets you upgrade or compound goes to the Merchant too (the Fire Bows the bees drop):
    // he upgrades it, and the gear sweep gives it to whoever it beats. GEAR_KEEP lists item names a Ranger keeps in his bag instead.
    SCROLL_SWAP: true, // 2026-11-21: take a worn piece off when the Merchant asks (stat scroll, comes back scrolled)
    GEAR_HANDOFF: true,
    GEAR_KEEP: [],
    HANDOFF_ALL_ITEMS: true, // v5: EVERY unlocked, unworn item that is not a potion/elixir goes to the Merchant, who sorts it (sells junk, banks the rest). false = only upgradeable gear (see above)
    BAG_KEEP: ["tracker", "jacko", "computer"], // names a Ranger always keeps in his bag (besides potions and elixirs)
    BAG_KEEP_PREFIXES: C.BAG_KEEP_PREFIXES,
    GEAR_HANDOFF_GRACE_MS: 180000, // gear the Merchant just handed him (to be worn) is left alone this long
    GEAR_TRIP_MIN: 1, // a courier trip also starts (between events) when a Ranger carries this many spare gear items...
    GEAR_TRIP_EVERY_MS: 1200000, // ...but not more often than this
    KEEP_FOR_COMPOUND: C.KEEP_FOR_COMPOUND, // orbg (Orb of Beginnings, Sean 2026-11-18): kept and banked for the Merchant's compound focus. The last five (before it): Grinch and Snowman gear drops - kept and banked (never sold) so the gear sweep can hand out what beats the worn gear
    // Stackable loot (materials, drops...) piles up and fills the bag. When the bag is nearly full the Merchant collects it
    // (at SAFE_SPOT, not out in the field) and banks it. Potions and scrolls are never handed over.
    STACK_TO_MERCHANT: true,
    STACK_PICKUP_MIN: 3, // ask for a pickup once this many bag slots hold stackable loot
    STACK_KEEP: [], // extra item keys to always keep on the Ranger
    STACK_KEEP_PREFIXES: C.STACK_KEEP_PREFIXES,
    SAFE_SPOT: { map: "main", x: -110, y: 15 }, // main-town meeting spot next to the Merchant's stand (also where fallback 3 waits)
    GEAR_SHARE: true, // tell the Merchant what is worn (he upgrades items that would beat it and hands them over)
    GEAR_REPORT_MS: 60000,
    JUNK_ACTION: "sell", // "sell" = sell for gold (default) | "destroy" = delete
    SELL_NPC: "basics", // Gabriel (merchant, main town) - walked to if selling in place is refused
    BOSS_DUMP_ENABLED: true, // when a boss event starts (Grinch button / auto), hand ALL junk, keepers and stackables to the Merchant if he is within BOSS_DUMP_RANGE, so he sells it and the bag has room for the drops
    GRINCH_CIRCLE: true, // Sean 2026-11-19: the server lists the Grinch near the post but he is not in view (invisible after a teleport): the Ranger, the Warrior and the Priest each walk a small circle around where they stand until he shows up again, then the circle stops and the fight goes on
    GRINCH_CIRCLE_RADIUS: 60,
    GRINCH_CIRCLE_STEP_MS: 1500,
    GRINCH_CIRCLE_AFTER_MS: 4000, // not in view for this long before the circling starts
    GRINCH_REFRESH: true, // Sean 2026-11-19: a party member takes a normal hit during a boss fight but no monster in view is on him (Grinch invisible after a teleport): step a few pixels to refresh the view
    GRINCH_REFRESH_MS: 15000, // ... at most this often
    BOSS_DUMP_RANGE: 250,
    BOSS_DUMP_RETRY_MS: 20000, // while the event runs and he is not close yet, look again this often (for BOSS_DUMP_WINDOW_MS)
    BOSS_DUMP_WINDOW_MS: 180000,
    BOSS_DUMP_SLOW_MS: 5 * 60000, // after the first window the hand-over looks again every 5 min ...
    BOSS_DUMP_SLOW_AFTER_MS: 30 * 60000, // ... and after this long into the event every 10 min (BOSS_DUMP_SLOWER_MS), until the event is over
    BOSS_DUMP_SLOWER_MS: 10 * 60000,
    BOSS_AFTER_TRIP: true, // when a boss event is over (dead, gone or capped), a courier trip brings every Ranger's drops and leftovers to the Merchant so the bags are empty again
    BOSS_AFTER_DELAY_MS: 20000, // wait this long after the event ends so the last drops are picked up first
    BOSS_AFTER_WINDOW_MS: 10 * 60000, // the post-event trip must start within this long, else it is dropped
    BOSS_AFTER_MIN_ITEMS: 1, // a Ranger with at least this many junk/spare items counts
    PACE_START_MS: 1500, // v5: minimum gap after a start_character request (the account limit answers in bursts), through the shared request queue
    PACE_TRANSFER_MS: 0, // v5: minimum gap between send_item / send_gold requests. 0 = no waiting (v4 behaviour, they are still sent one at a time); raise it if the server ever answers "throttled"
    RANGER_STATUS_MS: 30 * 60000, // v5: how often the status line (which step used the loop, which timers are running) is logged; set("ranger_status","1") prints it now
    JUNK_SEND_RANGE: 60, // hand the items over once the Merchant is this close
    SELL_MIN_JUNK: 3, // only make that walk once at least this many junk items are waiting
    JUNK_MAX_LEVEL: C.JUNK_MAX_LEVEL, // never touch an item upgraded above this level
    JUNK_ANY_LEVEL: C.JUNK_ANY_LEVEL, // ...except Rings of Joy (Sean 2026-11-18): junk at any level
  };
