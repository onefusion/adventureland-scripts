
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
    merchant: { name: "Goodies", cls: "merchant", slot: "3" }, // not in the game party, does not follow the lead (D14)
    leader: { name: "SexyDexy", cls: "ranger", slot: "2" }, // the Ranger that leads the party and does the courier trips when no follower Ranger is online
    followers: [
      { name: "SexyLexy", cls: "ranger", slot: "2" }, // follower Rangers (the account runs 3 non-merchant characters: with the Warrior and the Priest on, they stay off)
      { name: "SexyRexy", cls: "ranger", slot: "2" },
    ],
    warrior: { name: "SexyWexy", cls: "warrior", slot: "8" }, // the tank
    priest: { name: "SexyHexy", cls: "priest", slot: "7" },
    lead_order: ["ranger", "warrior", "priest"], // E1 (stage 4): who is preferred when the party elects a lead
    merchant_in_party: false, // D14: the Merchant is not in the game party, does not lead it and does not invite; the lead Ranger invites the others. true = the v5 way (he leads and invites)
    merchant_autostart: { enabled: true, max_tries: 3, retry_ms: 60000, grace_ms: 30000 }, // the lead starts the Merchant if he is not running: at most max_tries attempts, stops for good when he is up or a start fails
    can_lead: { ranger: true, warrior: false, priest: false }, // the Warrior and the Priest lead only after the focus/activities logic is shared (later stage)
  };
  const names = (a) => a.map((x) => x.name);

  // ---------------------------------------------------- item lists
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
      return {
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
      };
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
    return { me: { name, cls: me ? me.cls : cls }, members: members.map((x) => ({ name: x.name, cls: x.cls, slot: x.slot })), order: roster.lead_order.slice(), can_lead: Object.assign({}, roster.can_lead), merchant: Object.assign({ name: roster.merchant.name, slot: roster.merchant.slot }, roster.merchant_autostart) };
  }
  return { lead_env, roster, lists: { junk_both, junk_merchant_only, handover_support_gear, compound_core, boss_gear, orb, prefixes_consumables, prefixes_scrolls, junk_any_level, junk_max_level }, for_script };
})();
