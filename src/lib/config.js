
// ============================== AL.config: the settings the four scripts share (stage 3 of the refactor, 2026-11-20) ==============================
// ONE place for who is who (names, classes, code slots) and for the item lists the Merchant and the Rangers must agree on. Before this the same names and
// lists were typed into four files and had already drifted apart (see `lists.junk`). Each script asks for its own view:
//
//     const C = AL.config.for_script("Ranger");     // "Merchant" | "Ranger" | "Warrior" | "Priest"
//     const CFG = { PARTY_LEADER: C.PARTY_LEADER, ... };   // the CFG keys keep their v5 names and values; only where they come from changed
//
// for_script() returns FRESH arrays and objects every call (a script may change its CFG; nothing is shared by reference).
// To change a name, a code slot or a list: edit this file (src/lib/config.js), `node build/build.js`, save "AL Libs v6.js" in the lib slot, restart the characters.
// tests/config_equiv.js proves every CFG value equals the v5 one (tests/golden/config_allowed_diffs.json lists the deliberate changes).
AL.config = (function () {
  // ---------------------------------------------------- roster (D13: the harness can replace it; the game uses this one)
  const roster = {
    merchant: { name: "Goodies", cls: "merchant", slot: "2" }, // not in the game party, does not follow the lead (D14)
    leader: { name: "SexyDexy", cls: "ranger", slot: "3" }, // the Ranger that leads the party and does the courier trips when no follower Ranger is online
    followers: [
      { name: "SexyLexy", cls: "ranger", slot: "3" }, // follower Rangers (the account runs 3 non-merchant characters: with the Warrior and the Priest on, they stay off)
      { name: "SexyRexy", cls: "ranger", slot: "3" },
    ],
    warrior: { name: "SexyWexy", cls: "warrior", slot: "4" }, // the tank
    priest: { name: "SexyHexy", cls: "priest", slot: "5" },
    lead_order: ["ranger", "warrior", "priest"], // E1 (stage 4): who is preferred when the party elects a lead
    merchant_in_party: false, // D14: the Merchant is not in the game party, does not lead it and does not invite; the lead Ranger invites the others. true = the v5 way (he leads and invites)
    update: { enabled: true, repo: "onefusion/adventureland-scripts", branch: "main", check_ms: 5 * 60000, min_gap_ms: 30 * 60000, window_ms: 5 * 60000 }, // GitHub auto-update (2026-11-21): the lead and the Merchant read dist/version.json every check_ms and reload when the build differs
    auto_reload: { build: true, lib: true, idle: true, idle_ms: 15 * 60000, min_gap_ms: 60 * 60000 }, // Sean 2026-11-21: reload requests (never mid-fight): build / lib id differs from the lead's, or nothing changed for idle_ms. The same cause fires at most once per min_gap_ms
    merchant_autostart: { enabled: true, max_tries: 3, retry_ms: 60000, grace_ms: 30000 }, // the lead starts the Merchant if he is not running: at most max_tries attempts, stops for good when he is up or a start fails
    can_lead: { ranger: true, warrior: false, priest: false }, // the Warrior and the Priest lead only after the focus/activities logic is shared (later stage)
  };
  const names = (a) => a.map((x) => x.name);

  // ---------------------------------------------------- item lists
  // NEVER WEAR (Sean 2026-11-21): no character may wear these. Ice Skates (speed -10) leave the character far behind the group on long walks. The scorers rate them far below an empty slot, so the
  // Merchant never hands them out and gives any other piece for the slot; a character that already wears one takes it off (AL.runtime.strip_never_wear).
  const never_wear = ["iceskates"];
  // JUNK: the Merchant sells these (JUNK_SELLABLE); the Rangers hand them over (JUNK_ITEMS), plus the support gear below that is handed over but never sold:
  const junk_both = [
    "hbow", // Hunting Bow (Sean 2026-11-19 16:00)
    "rednose", // Rudolph's Red Nose (Sean 2026-11-19 16:00)
    "beewings", // Bee Wings (Sean 2026-11-18 23:44): what they can be crafted into is not worth it; stacks are sold whole, in the bag and in the bank
    "wattire", // Wanderer's Attire (Sean 2026-11-18)
    "ringsj", // Ring of Joy (Sean 2026-11-18): junk at ANY level (junk_any_level); Strength/Intelligence rings from the arctic bees serve the Warrior and Priest better
    "wcap",
    "wshoes",
    "stinger",
    "sstinger",
    "warmscarf",
    "iceskates",
    "gcape",
    "mushroomstaff",
    "ornamentstaff",
    "wbookhs",
    "vitearring",
    "wbreeches",
    "mittens",
    "xmashat",
    "xmasshoes",
    "glolipop",
    "ololipop",
    "bow",
    "helmet",
    "shoes",
    "slimestaff",
    "candycanesword",
    "cclaw", // Crab Claw (fist weapon)
    "crabclaw", // Crab Claw (material)
  ];
  // only the MERCHANT sells these (they pile up in HIS bag / bank, the Rangers never carry them as junk)
  const junk_merchant_only = [
    "snowball", // Snowball (Sean 2026-11-19): worth 1 gold, only takes bank item slots; stacks are sold whole, in the bag and in the bank
    "merry", // Bow of The Merry Ranger (Sean 2026-11-18): piles up in the Merchant's bag, never worn
  ];
  // NOT junk (Sean 2026-11-21): the Rangers hand these over with the junk (the Ranger's JUNK_ITEMS carries them so they leave his bag), but the Merchant must NEVER sell them
  // (so they are not in his JUNK_SELLABLE): Strength / Intelligence earrings and amulets, staffs and blades can be compounded or upgraded into very good gear for the Warrior and the Priest.
  const handover_support_gear = ["strearring", "intearring", "firestaff", "stramulet", "intamulet", "fireblade"];

  // accessories the Merchant compounds (3 identical -> 1 better); received from the Ranger but NOT sold: banked
  const compound_core = ["strring", "intring", "dexring", "dexearring", "dexamulet", "hpamulet", "hpbelt"];
  // Grinch / Snowman gear drops: the Merchant sells the surplus or banks it for the gear sweep (BOSS_GEAR); the Rangers keep and bank them the same way
  const boss_gear = ["ringhs", "northstar", "dkey", "xmace"];
  // orbg (Orb of Beginnings, Sean 2026-11-18): kept and banked for the Merchant's compound focus
  const orb = "orbg";

  const prefixes_consumables = ["hpot", "mpot", "elixir"]; // never handed over by any class
  const prefixes_scrolls = ["scroll", "cscroll", "xscroll", "uscroll"]; // the Warrior, the Priest and the Rangers' stackables keep scrolls too
  const junk_any_level = ["ringsj"]; // junk whatever their level (still never a locked one)
  const junk_max_level = 0; // nothing upgraded above this level is junk

  // ---------------------------------------------------- per-script views (the CFG keys keep their v5 names)
  const view = {
    Merchant() {
      return Object.assign(gear_settings(), {
        RANGER_NAME: roster.leader.name,
        SUPPORT_NAMES: [roster.priest.name, roster.warrior.name],
        TRUSTED_NAMES: names(roster.followers),
        SELF_CODE_SLOT: roster.merchant.slot,
        PARTY_ENABLED: roster.merchant_in_party,
        JUNK_SELLABLE: junk_merchant_only.concat(junk_both), // (v5 listed them in a different order; only membership matters)
        KEEP_FOR_COMPOUND: compound_core.concat([orb]),
        BOSS_GEAR: boss_gear.slice(),
        JUNK_ANY_LEVEL: junk_any_level.slice(),
        JUNK_SELL_MAX_LEVEL: junk_max_level,
      });
    },
    Ranger() {
      return {
        MERCHANT_NAME: roster.merchant.name,
        PARTY_LEADER: roster.leader.name,
        PARTY_MEMBERS: names(roster.followers),
        PARTY_ACCEPT_FROM: roster.merchant_in_party ? roster.merchant.name : roster.leader.name,
        TANK_NAME: roster.warrior.name,
        PARTY_SUPPORT: [roster.priest.name, roster.warrior.name],
        PARTY_SUPPORT_SLOTS: { [roster.priest.name]: roster.priest.slot, [roster.warrior.name]: roster.warrior.slot },
        PRIEST_CODE_SLOT: roster.priest.slot,
        SELF_CODE_SLOT: roster.leader.slot,
        BAG_SHARE_TO: roster.priest.name,
        JUNK_ITEMS: junk_both.concat(handover_support_gear),
        JUNK_ANY_LEVEL: junk_any_level.slice(),
        JUNK_MAX_LEVEL: junk_max_level,
        KEEP_FOR_COMPOUND: compound_core.concat(boss_gear, [orb]),
        BAG_KEEP_PREFIXES: prefixes_consumables.slice(),
        STACK_KEEP_PREFIXES: prefixes_consumables.concat(prefixes_scrolls),
      };
    },
    Warrior() {
      return Object.assign(support_view(roster.warrior.slot), {
        BAG_SHARE_TO: roster.priest.name,
        FOCUS_TO: [roster.leader.name].concat(names(roster.followers), [roster.priest.name]), // who hears which monster is the focus target
      });
    },
    Priest() {
      return Object.assign(support_view(roster.priest.slot), {
        TANK_NAME: roster.warrior.name,
        BAG_SHARE_FROM: [roster.warrior.name, roster.leader.name],
      });
    },
  };
  // ---------------------------------------------------- gear settings (stage 5, 2026-11-21): the Merchant's per-class gear rules
  // Compound focuses, the Warrior's / Ranger's compound sets, the gear profiles of the support classes, the scoring weights and the bank packs.
  // They were Merchant-only, so moving them removed no duplication; they live here so every class setting is in one file and the names come from the roster.
  // A function: every call returns fresh objects (the Merchant may change its CFG).
  function gear_settings() {
    return {
      // Items pushed up the compound ladder on their own terms (ignores the Rangers' demand ladder and the preferred-kind rule):
      // target = highest level, keep = copies that stay behind (0 = funnel everything), max_grade = highest scroll tier to buy,
      // min_chance = lowest odds accepted, budget = scroll budget per round for this item (overrides the session share)
      COMPOUND_FOCUS: {
        /* OFF: Rangers cannot wear Books of Cheer (live). To re-enable: wbookhs: { target: 3, keep: 0, max_grade: 2, min_chance: 0.3, budget: 30000000 } */
      },
      // v5 (Sean 2026-11-17): the Warrior's compound set. Compound these (everything funnels up to `level`) until the Warrior has `count` of each at that level
      // (worn, handed over, or held in the bag / bank); from then on no more are compounded or bought, and every other copy is SOLD as it is, whatever its level.
      // The Rangers get nothing from the HP items (a +3 Amulet of HP is worth 0.6 points to them against 13 for a +3 Amulet of Dexterity).
      WARRIOR_COMPOUND: {
        who: roster.warrior.name,
        items: {
          strring: { count: 2, level: 3 },
          hpamulet: { count: 1, level: 3 },
          hpbelt: { count: 1, level: 3 },
        },
      }, // strring (Sean 2026-11-18): Rings of Strength from the arctic bees replace the Rings of Joy;
      // v5 (Sean 2026-11-18 17:28): the Ranger's compound focus. Rings of Dexterity (arctic bees drop them) are pushed up the ladder on their own terms (everything funnels to `level`,
      // ahead of the demand ladder) until `who` has `count` of them at that level or better (worn, on the way to him, or held in the bag / bank). Then the focus ends and the normal ladder takes over
      // (nothing is sold, nothing is blocked). Empty {} turns it off.
      RANGER_COMPOUND: {
        who: roster.leader.name,
        items: {
          dexring: { count: 2, level: 3 },
          orbg: { count: 1, level: 3 },
          intring: { count: 2, level: 3, who: roster.priest.name },
        },
      }, // intring: for the Priest (a per-item "who" overrides the Ranger default); // orbg: the Ranger wears ONE orb
      COMPOUND_PACKS: [
        "items0",
        "items1",
        "items2",
        "items3",
        "items4",
        "items5",
        "items6",
        "items7",
      ], // bank packs to take items from (v5: all 8 packs of the main Bank; a pack that is not unlocked yet has no item array and is skipped)
      UPGRADE_PACKS: [
        "items0",
        "items1",
        "items2",
        "items3",
        "items4",
        "items5",
        "items6",
        "items7",
      ], // (same list as COMPOUND_PACKS)
      // v5 (Sean 2026-11-17): support characters that run AutoPriest v5 (or a later Warrior script) report what they wear (gear_report) and get gear handed over like the Rangers do.
      // The sweep gives them what beats their worn slot (Rangers are served first); items they would wear are never sold. UNVERIFIED defaults: tune the weights with Sean (like the Ranger ranking).
      // main = the class's attack stat: its weight is raised to (attack weight x weapon attack / 20) from the worn weapon, as for the Ranger's dex.
      // weapon_types: weapon kinds she can use (an item whose class list names her class always counts). Offhand: books (source) and shields.
      // Not covered yet for them: upgrade / compound rounds, copy limits and demand counts (those only count the Rangers).
      SUPPORT_GEAR: {
        // v5 (Sean 2026-11-17): the Warrior TANK: vitality, armor, resistance and max hp first (his weapon matters little). Class rules from data/classes.json: mainhand spear / short_sword / sword / fist / mace,
        // two-handed rapier / bow / axe / scythe / basher / great_sword, offhand shield or a second one-hander (no Books). Targets and sources: warrior-priest-upgradeable-gear-targets.md.
        // SexyWexy = the Warrior (confirmed by Sean 2026-11-17), code slot 8. Needs AutoWarrior (not written yet) so he reports gear. No report = no effect.
        // v5 (Sean 2026-11-18): the Warrior wears the best SWORD (main hand) and the best SHIELD (off hand), both ranked by: vitality, hp, courage (the game's aggro stats: courage / pcourage / mcourage),
        // armor, resistance, in that order. A basher stays in his BAG (never worn): Stomp needs one, and he swaps it in for the stun and back (AutoWarrior with_basher). One Wooden Basher is enough
        // (the Merchant hands one over and never sells bashers while he has none; a Basher works too). Two-handed types (two_hand_types) replace the shield, so they are compared against sword + shield.
        [roster.warrior.name]: {
          cls: "warrior",
          main: "str",
          main_from_weapon: false,
          skip_types: ["source"],
          scroll: "strscroll", // Strength is now his main stat (Sean 2026-11-18); use "vitscroll" for Vitality
          weapon_types: ["sword", "short_sword"], // 2026-11-21: + short_sword (Fiery Blade; classes.json: a Warrior main hand)
          two_hand_types: [
            "rapier",
            "bow",
            "axe",
            "scythe",
            "basher",
            "great_sword",
          ],
          bag_kit: ["wbasher", "basher"], // kept in his bag: the first listed is preferred
          // Sean's order (2026-11-18): strength (hp, armor, speed), vitality (hp by level), evasion (physical attacks miss: only helps against physical monsters), armor, damage return (dreturn), lifesteal, courage (aggro). UNVERIFIED numbers.
          weights: {
            str: 6,
            vit: 5.5,
            evasion: 5,
            armor: 0.6,
            dreturn: 1.5,
            lifesteal: 1,
            courage: 0.5,
            pcourage: 0.5,
            mcourage: 0.5,
            hp: 0.04,
            resistance: 0.4,
            attack: 0.05,
            range: 0,
            dex: 0.02,
            int: 0,
            speed: 0.05,
            frequency: 0.1,
            crit: 0.01,
            reflection: 0.02,
            manasteal: 0.01,
            mp: 0.0002,
          },
        },
        // v5 (Sean 2026-11-18): the Warrior's SECOND set for MAGICAL bosses (Grinch, Franky, Dragold, Rudolph ...): resistance first. It is a pseudo character "SexyWexy+": his gear_report lists what he
        // carries in his bag for it (report.alt, slot -> item), the sweep fills every empty / weaker slot and hands the pieces over like the basher (they stay in his bag; AutoWarrior swaps the set in
        // when the focus target is a big magical monster and back afterwards). No weapon (his sword stays). Needs more bank space long-term (Sean accepts). UNVERIFIED weights.
        [roster.warrior.name + "+"]: {
          cls: "warrior",
          main: "resistance",
          main_from_weapon: false,
          skip_types: ["source", "weapon"],
          scroll: "strscroll",
          weapon_types: [],
          weights: {
            resistance: 4,
            vit: 3,
            str: 6,
            hp: 0.08,
            reflection: 1,
            armor: 0.2,
            lifesteal: 0.5,
            courage: 0.5,
            pcourage: 0.5,
            mcourage: 0.5,
            speed: 0.05,
            mp: 0.0002,
          },
        },
        // v5 (Sean 2026-11-18): the Priest wants the best MACE or STAFF (ranked: attack = damage, intelligence, MP cost per attack (mp_cost, negative = cheaper heals: the Ornament Staff has -40), max MP).
        // Heal is based on the attack value. Game data (classes.json): staff and pmace are one-handed (a Book / shield fits the off hand); the WAND is two-handed for the Priest (frequency +40), so it
        // is compared against weapon + off hand together (two_hand_types). UNVERIFIED weights: tune with Sean.
        [roster.priest.name]: {
          cls: "priest",
          main: "int",
          scroll: "intscroll", // stat scroll applied to her gear before it is handed over (adds the item's "stat" value as Intelligence)
          weapon_types: ["staff", "pmace", "wand"],
          two_hand_types: ["wand"],
          weights: {
            attack: 3,
            int: 1,
            mp_cost: -1.2,
            mp: 0.002,
            mp_reduction: 0.2,
            range: 0.3,
            vit: 0.1,
            str: 0.05,
            dex: 0.1,
            speed: 0.02,
            crit: 0.04,
            hp: 0.0006,
            armor: 0.05,
            resistance: 0.05,
            evasion: 0.01,
            reflection: 0.006,
            lifesteal: 0.02,
            manasteal: 0.02,
            frequency: 0,
          },
        },
      },
      GEAR_WEIGHTS: {
        dex: 1,
        attack: 3,
        range: 0.5,
        int: 0.2,
        vit: 0.2,
        str: 0.2,
        speed: 0.02,
        crit: 0.04,
        apiercing: 0.01,
        rpiercing: 0.01,
        hp: 0.0006,
        mp: 0.0002,
        armor: 0.05,
        resistance: 0.05,
        evasion: 0.01,
        reflection: 0.006,
        lifesteal: 0.02,
        manasteal: 0.01,
      },
      SET_WEIGHTS: { phresistance: 0.05, stresistance: 0.05 }, // weights for set-bonus stats that GEAR_WEIGHTS does not list (dex, speed, apiercing, resistance... use GEAR_WEIGHTS)
    };
  }
  // the Warrior and the Priest see the party the same way
  function support_view(slot) {
    return {
      PARTY_LEADER: roster.leader.name,
      PARTY_ACCEPT_FROM: roster.merchant_in_party ? [roster.merchant.name, roster.leader.name] : [roster.leader.name],
      MERCHANT_NAME: roster.merchant.name,
      COURIERS: names(roster.followers).concat([roster.leader.name]), // the Rangers: whichever is the courier asks for junk and delivers potions (the leader when no follower Ranger is online)
      SELF_CODE_SLOT: slot,
      BAG_KEEP_PREFIXES: prefixes_consumables.concat(prefixes_scrolls),
    };
  }
  function for_script(tag) {
    if (!view[tag]) throw new Error("AL.config.for_script: unknown script " + tag);
    return view[tag]();
  }
  // everything AL.lead.create needs about the roster for the character called `name` (the Merchant is not in it, D14)
  function lead_env(name, cls) {
    const all = [roster.leader].concat(roster.followers, [roster.warrior, roster.priest]);
    const me = all.find((x) => x.name === name);
    // a character that is not in the roster (a spare Ranger, a test character) is still a party member of the class its script says
    const members = all.map((x) => ({ name: x.name, cls: x.cls, slot: x.slot }));
    if (!me) members.push({ name, cls, slot: "" });
    return { me: { name, cls: me ? me.cls : cls }, members: members.map((x) => ({ name: x.name, cls: x.cls, slot: x.slot })), order: roster.lead_order.slice(), can_lead: Object.assign({}, roster.can_lead), merchant: Object.assign({ name: roster.merchant.name, slot: roster.merchant.slot }, roster.merchant_autostart), auto_reload: Object.assign({}, roster.auto_reload), update: Object.assign({}, roster.update) };
  }
  return { lead_env, roster, lists: { never_wear, junk_both, junk_merchant_only, handover_support_gear, compound_core, boss_gear, orb, prefixes_consumables, prefixes_scrolls, junk_any_level, junk_max_level }, for_script };
})();
