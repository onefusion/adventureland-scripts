  // ============================ CONFIG ============================
  // names, code slots and the shared item lists come from the one config file (src/lib/config.js); the CFG keys keep their v5 names
  const C = AL.config.for_script("Merchant");
  const CFG = {
    RANGER_NAME: C.RANGER_NAME, // exact, case-sensitive
    // The Merchant is the PARTY LEADER: he invites every Ranger (RANGER_NAME + TRUSTED_NAMES) who is online and not in his party yet.
    // The Rangers accept invitations from the Merchant only.
    PARTY_ENABLED: C.PARTY_ENABLED, // D14 (stage 4): false = the Merchant is not in the game party and never invites (roster.merchant_in_party)
    PARTY_INVITE_MS: 20000, // how often he checks the party and re-invites missing Rangers
    SUPPORT_NAMES: C.SUPPORT_NAMES, // (the account runs only 3 non-merchant characters: with the Priest on, one follower Ranger is logged off; an offline name is skipped) // non-Ranger party helpers (the Priest): invited to the party only - no gear, no deliveries, no courier
    TRUSTED_NAMES: C.TRUSTED_NAMES, // the follower Rangers' names (and anyone else allowed to request deliveries). Their gear reports are tracked too: RANGER_NAME gets first call on gear, then these, in order.
    SELF_CODE_SLOT: C.SELF_CODE_SLOT, // CODE slot (name or number) THIS script is saved in. The Re-engage button reloads the saved text from it.

    // --- job queue (v4) ---
    MAIN_SAFE_SPOT: { map: "main", x: -110, y: 15 }, // where he waits for the Ranger after travel_to_main (same spot as the Ranger's SAFE_SPOT)
    NO_SHOW_WAIT_MS: 15000, // arrived and nobody there: wait this long, then job_failed(no_show) and go home
    HOLD_AT_SAFE_MS: 90000, // after travel_to_main wait at the safe spot this long for the Ranger to ask again
    MAX_QUEUE: 6, // more waiting jobs than this are refused (job_failed queue_full)
    BUDGET_PERSIST_MS: 6 * 3600000, // scroll budgets survive a reload for this long
    HELLO_DELAY_MS: 4000, // restart handshake: send hello this long after start

    HP_POTION: "hpot1", // delivery potions for the Ranger (tier-1)
    MP_POTION: "mpot1",

    STAND_SPOT: { map: "main", x: -115, y: -5 }, // moved here by Sean (main map)
    STAND_SPOT_RADIUS: 40, // smart_move stops ~20px short of its target

    // Potions kept in the INVENTORY for deliveries to the Ranger
    // The Merchant stays in town, so he keeps a big surplus for the courier Ranger (up to 3 x 250 per type on a full party refill).
    STOCK_TARGET: 1000, // buy up to this many of each tier-1 delivery potion (100g each)
    STOCK_LOW: 500, // go shopping (and withdraw gold first when short) when either tier-1 potion drops below this
    BOSS_STOCK_TARGET: 2400, // v5: while a boss event is live (Grinch/Snowman on the server) the delivery stock is raised to this (the Rangers burn potions in a long fight; Goodies stands next to the post)
    BOSS_STOCK_LOW: 1800, // ...and he goes shopping below this
    POTION_BANK_CAP_PCT: 0.05, // one potion-funding withdrawal never takes more than this share of the bank's gold
    MAX_REQUEST: 1500, // refuse absurd delivery requests

    // Potions offered on the stand to other players (taken from stock above STOCK_LOW)
    // v5: one-off private sale from the console:  set("sell_item", "firebow:4")  or  set("sell_item", "firebow:4:2500000")  (name:level[:price])
    // He takes ONE unlocked copy of that item and level from the bag or the bank and lists it on a free stand slot (trade5 and up).
    // Without a price: what Gabriel would pay (the game's item value x the learned Gabriel rate, see flip_factor) minus SALE_BELOW_NPC.
    SALE_BELOW_NPC: 500000,
    // v5: market watch - Ponty (secondhands, main town) resells what merchants put up, at a small markup. Every MARKET_EVERY_MS he asks Ponty for the list,
    // scores every piece the Rangers can wear against what each Ranger wears now (upgradable items at their +5 potential), and counts compound sets
    // (KEEP_FOR_COMPOUND items: ringsj, hpamulet, hpbelt) that the stock plus his own copies would complete. Everything is logged ("Market watch: ...").
    // He only BUYS when MARKET_BUY is true. The list carries no price: the price is estimated as game item value x MARKET_MARKUP and corrected from the first real purchase.
    // Console: set("market_check", "1") runs a check at the next chance.
    MARKET_ENABLED: true,
    MARKET_EVERY_MS: 3 * 3600000,
    MARKET_NPC: "secondhands",
    MARKET_NPC_FALLBACK: null, // { map: "main", x: 0, y: 0 } if find_npc cannot place Ponty
    MARKET_BUY: true, // v5: ON since 2026-11-16 17:15 (Sean). The first purchase verifies the sbuy call and learns the real price; a failed buy switches it off until restart
    MARKET_MARKUP: 2.0, // measured live 2026-11-16: Ponty charges twice the game value (paid/value = 2.00 on 3 different items), not 5%
    MARKET_MAX_PRICE_EACH: 3000000, // never buy anything dearer (estimated)
    MARKET_MAX_SPEND: 10000000, // per visit
    MARKET_GOLD_FLOOR: 1000000, // gold in the bag that stays
    MARKET_BANK_FLOOR: 15000000, // buying only takes spare gold: the bank keeps at least this much (same floor as the donations)
    MARKET_COMPOUND_BUY: true, // v5: ON since 2026-11-16 17:15 (Sean). Also buy copies that complete a compound set (needs MARKET_BUY)
    MARKET_COMPOUND_MAX_EACH: 500000, // per copy; Ponty charges 2x the game value, so a ringsj +2 costs about 333k
    MARKET_COMPOUND_MAX_LEVEL: 2, // only copies up to this level are bought for compounding (three +2 make a +3; Sean 2026-11-16: compounds are worth it up to +3, dearer than that waits for a bigger gold surplus)
    MARKET_COMPOUND_MAX_COPIES: 3,
    // Sean 2026-11-24: Ron the Goblin (Lost and Found) sells rare monster drops and gear for fair prices. The same visit as Ponty's, every RON_EVERY_MS: up to RON_BANK_PCT of the bank gold is taken out first
    // (the donation amount is not touched), then everything that is a target gear piece (even one that still needs an upgrade / compound) or a craft ingredient (Venom Band) is bought within the limits below.
    RON_ENABLED: true,
    RON_EVERY_MS: 4 * 3600000,
    RON_BANK_PCT: 0.1, // spending budget per visit = this share of the bank gold
    RON_MAX_PRICE_EACH: 15000000, // never buy anything dearer (estimated)
    RON_MARKUP: 2.0, // price estimate = game value x this until the first real purchase tells the real factor
    MARKET_CRAFT_BUY: true, // v5: also buy the missing ingredients of a CRAFT_TARGETS item (Venom Band) at Ponty, within the limits above (needs MARKET_BUY)
    MARKET_CRAFT_OVERBUY: 10, // ...a listing may exceed what is missing by at most this many units
    SALE_FIRST_SLOT: 5, // trade slots 1-4 belong to the potion listings
    STAND_LISTINGS: [
      // tier-0 is stand-only stock now (the Ranger uses tier-1), so no delivery reserve
      { name: "hpot0", slot: 1, qty: 50, price: 25, reserve: 0 },
      { name: "mpot0", slot: 2, qty: 50, price: 25, reserve: 0 },
      // tier-1 is the Ranger's delivery stock: only the spare above STOCK_LOW is listed
      { name: "hpot1", slot: 3, qty: 50, price: 150 },
      { name: "mpot1", slot: 4, qty: 50, price: 150 },
    ],

    // Tier-0 potions: also kept at 1,000 each (courier surplus; part of the stand listing). Bought with gold above the floor below,
    // after the tier-1 stock, and funded by the same priced bank withdrawal.
    STAND_STOCK: [
      { name: "hpot0", target: 1000, low: 500 },
      { name: "mpot0", target: 1000, low: 500 },
    ],
    STAND_STOCK_GOLD_FLOOR: 5000, // never spend gold below this on stand stock
    LIST_RETRY_MS: 30000,

    // Gold handling
    GOLD_KEEP: 20000, // never bank below this (restock money)
    BANK_THRESHOLD: 60000, // do a bank run when gold reaches this
    BANK_MIN_DEPOSIT: 10000,
    BANK_RETRY_MS: 120000,
    // Too poor to refill the Ranger's potions? Fetch gold from the bank first.
    WITHDRAW_BUFFER: 50000, // withdraw (shortfall + this) so the next few restocks need no bank trip
    WITHDRAW_RETRY_MS: 120000, // after a failed bank withdrawal, wait this long before trying again
    SHOP_RETRY_MS: 60000,

    // drain_stand(): wait for other players' purchases before leaving
    SALE_QUIET_MS: 2500, // no sale for this long = nothing in flight
    CUSTOMER_RADIUS: 120, // a non-owned player this close counts as a customer
    DRAIN_SOFT_MS: 12000, // after this long, close the stand to stop NEW purchases
    DRAIN_MAX_MS: 30000, // never wait longer than this in total

    // Delivery
    HANDOFF_RANGE: 60, // how close to get before send_item
    APPROACH_MAX_MS: 25000,
    GOLD_WAIT_MS: 6000, // stay near the Ranger this long for his gold payment
    TRAVEL_TIMEOUT_MS: 90000,

    // Junk pickup from the Ranger (he sends a message when his bag is full of drops)
    JUNK_SELLABLE: C.JUNK_SELLABLE, // only ever sells these (bag AND bank: see BANK_JUNK_SWEEP)
    BANK_JUNK_SWEEP: true, // junk sitting in the bank is taken out and sold at Gabriel, whatever the free bank space
    NEVER_SELL: [
      "offeringp",
      "offering",
      "offeringx",
      "ascale",
      "pleather",
      "cscale",
      "bfur",
      "orbg",
    ], // v5 (Sean 2026-11-18): + the Orb of Beginnings ingredients (Armadillo Scale, Porcupine Leather, Croc Scale, Bee Fur) and the orb itself; // never sold, junked or dropped by any sale path: the offerings (Primling, Primordial Essence, Primordial X) that raise compound / upgrade odds
    COMPOUND_FOCUS: C.COMPOUND_FOCUS,
    WARRIOR_COMPOUND: C.WARRIOR_COMPOUND,
    RANGER_COMPOUND: C.RANGER_COMPOUND,
    KEEP_FOR_COMPOUND: C.KEEP_FOR_COMPOUND, // received from the Ranger but NOT sold: banked for compounding
    // Grinch / Snowman gear drops (the Rangers hand them over: their KEEP_FOR_COMPOUND has the same keys). At level 0, not locked, worth at most
    // SURPLUS_MAX_VALUE_EACH and NOT better than what any Ranger wears (all three gear reports fresh) they are SOLD at Gabriel;
    // anything else is kept and banked for the gear sweep. The bank is often full, so selling is the normal way out.
    BOSS_GEAR: C.BOSS_GEAR,
    JUNK_SELL_NPC: "basics", // Gabriel
    JUNK_SELL_MAX_LEVEL: C.JUNK_SELL_MAX_LEVEL, // never sells upgraded items
    STACK_RESERVE: { poison: "full" }, // (Sean 2026-11-19) stackable loot that is SOLD above a reserve: keep this many (a number, or "full" = one full stack, the item's own `s`) in the bag and bank together and sell the rest, whole stacks only. Poison Sacks (about 1,000 gold each) are also the Venom Band ingredient
    JUNK_STACKS: ["beewings", "snowball"], // stackable junk: the bank sweep takes whole stacks out and sells them (other stacks are never swept: they are crafting stock)
    JUNK_ANY_LEVEL: C.JUNK_ANY_LEVEL, // ...except these: sold whatever their level (still never a locked one)
    JUNK_RECEIVE_WAIT_MS: 20000, // after arriving, wait this long for the Ranger to hand the items over

    // Safety
    HP_USE_PCT: 0.7, // below this fraction of max HP: drink a potion (or go buy one)
    FLEE_HP_PCT: 0.25,
    // The Grinch (and other event mobs) can teleport to and hit the Merchant too.
    SELF_HEAL_POTION: "hpot0", // what he buys at Ernis for himself when he has no HP potion at all
    SELF_HEAL_BUY: 5, // how many to buy on such a trip (a few, since hits tend to come in bursts)

    // --- Compounding accessories (3 identical items + a compound scroll -> 1 item one level higher) ---
    // A failed compound destroys all three items. Every attempt is logged; see COMPOUND notes in the log.
    COMPOUND_ENABLED: true,
    COMPOUND_DRY_RUN: false, // true = only look: fetch triples, ask the server for the odds, log them, put everything back. Set to false to really compound
    // Need-driven compounding ("ladder"): accessories are compounded for the Rangers, tier by tier. Every Ranger slot (2 rings, 2 earrings,
    // 1 of each other accessory per Ranger) gets a +1 first, then the surplus is compounded to +2 for all slots, then +3, up to the target.
    // Only the best accessory of each kind is compounded; the rest is surplus (sold when the bank is nearly full).
    COMPOUND_TARGET_LEVEL: 5, // the ladder stops here (the scroll grade limit and the session budget stop it earlier when scrolls get dear)
    COMPOUND_KEEP_COPIES: 0, // Sean 2026-11-24: 0 = a triple is compounded as soon as 3 copies are held (worn gear is high enough that no spare triple is needed). It was 3: a compound only ran while this many copies of the same item and level stayed behind (6 held = 1 triple)
    COMPOUND_MIN_CHANCE: 0.4, // never attempt below this success chance (asked from the server for the exact items)
    COMPOUND_MAX_SCROLL_GRADE: 1, // highest scroll tier to buy (0 = cscroll0 only, 1 = cscroll1 at 240k each...); higher-grade items are skipped
    COMPOUND_SCROLL_NPC: "scrolls", // sells the scrolls (main town)
    COMPOUND_UPGRADE_NPC: "newupgrade", // compounds are done standing next to this NPC (Cue)
    COMPOUND_SESSION_PCT: 0.1, // scroll budget per session = this share of the bank's gold when the first round starts
    COMPOUND_BANK_FLOOR: 5000000, // hard stop: no compounding while the bank holds less gold than this
    COMPOUND_PACKS: C.COMPOUND_PACKS,
    BANKFULL_SELL: true, // when the bank is nearly full, sell the low-value compoundable items to make room
    BANKFULL_TRIGGER_FREE: 10, // "full" = fewer free slots than this in COMPOUND_PACKS
    BANKFULL_TARGET_FREE: 12, // sell until about this many slots are free
    BANKFULL_KEEP_GRADE: 1, // items of this grade (1 = high) or better are never auto-sold
    BANKFULL_DRY_RUN: false, // true = only log what would be sold (independent of COMPOUND_DRY_RUN)
    // --- Surplus: finished items (at their approved max level) in the bank that none of the Rangers needs ---
    // When the bank is nearly full and nothing cheap is left to sell, the Merchant looks at every finished item in the bank.
    // An item is kept if it would beat what a Ranger wears (SexyDexy first, then the others; each kept item "uses up" the slot
    // it would fill, so a second identical ring is surplus unless a Ranger still has a weaker ring). Everything else is sold.
    // --- Gear sweep: finished (or stuck) gear in the bag or bank that beats what a Ranger WEARS goes to that Ranger ---
    // Upgrade rounds only hand over what they just upgraded; this also covers compounded accessories and anything already
    // finished that sits in the bank or the Merchant's bag. Assignment: best items first, SexyDexy first, each item uses up the slot it fills.
    GEAR_SWEEP: true,
    GEAR_SWEEP_EVERY_MS: 600000, // while a compound round has the bank open anyway
    GEAR_SWEEP_STANDALONE_MS: 1800000, // otherwise the Merchant makes the bank trip himself this often
    GEAR_SWEEP_BAG_RESERVE: 6, // keep this many bag slots free when taking items out of the bank
    // Consolidate bank and inventory (runs only when the bank has fewer than BANKFULL_TRIGGER_FREE free ITEM slots):
    // 1) copy limit below, 2) then the bank-full seller (cheap compoundables, finished items no Ranger needs).
    // Copy limit: at the cap level, only as many copies of one item as the Rangers can wear (1 per slot per Ranger) are kept in total
    // (worn + bag + bank). Extra copies are sold whether or not the bank is full. Earrings and rings have two slots per Ranger.
    // Bag tidy: the Merchant's own bag is nearly full (items he took out for rounds could not go back, junk, extra copies).
    BAG_TIDY: true,
    // Merchant's Luck (G.skills.mluck: level 40, 10 mana, range 320, lasts 1 h, target = a player; the buffed player's loot can drop twice for the Merchant)
    MLUCK_ENABLED: true, // needs the skill in G.skills and the Merchant's level to reach it
    MLUCK_RENEW_MS: 50 * 60000, // cast again this long after the last cast (the buff lasts 60 min)
    MLUCK_CHECK_MS: 30000, // how often he looks whether a Ranger needs it
    // v5 (Sean 2026-11-17): while the Grinch is live he buffs EVERY player character in the town area (any player, not only ours): a Merchant's Luck buffed killer can drop extra loot.
    // One round, then a look every minute for new characters without the buff; he walks to those out of range (inside the town area only).
    MLUCK_GRINCH: true,
    // Sean 2026-11-21: the same town round runs ALL THE TIME, not only while the Grinch is live (the cooldown is low and the extra drops are worth it). Set false to go back to Grinch-only.
    MLUCK_TOWN_ALWAYS: true,
    MLUCK_TOWN_RADIUS: 450, // town area = this far from the stand (main map)
    MLUCK_TOWN_CHECK_MS: 60000,
    MLUCK_TOWN_MIN_LEFT_MS: 10 * 60000, // a buff with less than this left counts as missing (renewed)
    MLUCK_PARTY: true, // v5 (Sean 2026-11-18): the leader asks (mluck_request) for Merchant's Luck on his party before a forced farm / boss and about hourly: cast on each listed player who stands in town
    MLUCK_PARTY_WAIT_MS: 45000, // players that have not arrived yet are waited for this long
    MLUCK_TOWN_RETRY_MS: 3 * 60000, // after a refused cast leave that player alone this long
    MLUCK_RETRY_MS: 5 * 60000, // after a failed visit (nobody there / cast refused) leave that Ranger alone this long
    BAG_TIDY_JUNK: 5, // also tidy (sell the junk at Gabriel) as soon as this many sellable junk items sit in the bag, however empty it is
    BAG_TIDY_FORCE_FREE: 4, // still this few free after selling: bank every item he does not need on him (boss drops pile up)
    BAG_TIDY_FREE: 8, // tidy when this few bag slots (or fewer) are free and he is idle
    BAG_TIDY_EVERY_MS: 600000,
    SURPLUS_COPIES: true,
    KEEP_BEST_COPIES: {
      sweaterhs: 3,
      xmassweater: 3,
      gcape: 0, // Sean 2026-11-23: none of these is worth keeping any more: every copy is sold, whatever its level
      xmashat: 0, // Sean 2026-11-23: none of these is worth keeping any more: every copy is sold, whatever its level
      xmasshoes: 0, // Sean 2026-11-23: none of these is worth keeping any more: every copy is sold, whatever its level
      fireblade: 0, // Sean 2026-11-22: the Warrior will not use Fiery Blades: every one is sold, upgraded or not
    }, // Sean 2026-11-19: keep only this many of the item (the highest levels), sell every other copy at any level, also while the bank still has room. Super Sweater and Xmas Sweater: the 3 best of each; Grinch Cape, Xmas Hat, Xmas Shoes too (Sean 2026-11-19 16:02 / 16:03). The +0 ones are also on the junk list
    GEAR_MAX_COPIES: 2, // Sean 2026-11-22: of every WEAPON and ARMOR piece (the item types in GEAR_COPY_TYPES; accessories are not touched) the Merchant keeps at most this many copies in his bag and the bank, the highest levels first, and sells the rest at any level, also while the bank has room. Two is the upgrade pair (one is upgraded, the other stays as the fallback). Names listed in KEEP_BEST_COPIES keep their own number. 0 = off. Only items the game lets you upgrade or compound count; locked, stacked and special items are never sold; an item worth more than SURPLUS_MAX_VALUE_EACH is only listed.
    GEAR_COPY_TYPES: ["weapon", "shield", "source", "quiver", "misc_offhand", "helmet", "chest", "pants", "gloves", "shoes", "cape"],
    SURPLUS_COPY_LEVEL: 5,
    SURPLUS_COPIES_PER_RANGER: { earring: 2, ring: 2 }, // default 1 per Ranger
    SURPLUS_SELL: true,
    SURPLUS_MAX_VALUE_EACH: 3000000, // an item worth more than this (expected sale price) is never sold automatically, only listed
    SURPLUS_KEEP_SPARE: 0, // extra finished items to keep per gear slot type beyond what the Rangers can use
    BANK_PACK_SIZE: 42,
    BANK_SORT: true, // v5: when he leaves the bank, items inside each pack are put in order (stackables first, then by type, name, highest level first) and the free slots end up last. Packs are sorted on their own: items never change pack.
    BANK_SORT_MAX_FAILS: 5, // v5: failed moves per session before sorting switches itself off (each failure only pins its two slots)
    BANK_SORT_MAX_SWAPS: 30, // v5: per PACK per bank visit (every pack has its own budget; the rest follows next time)
    BANK_SWAP_SLOT: true, // v5 (Sean 2026-11-18): the LAST slot of every pack (slot 41) stays empty: it is the transit slot of a sort swap, so a swap needs only 1 free bag slot (not 2). Nothing is deposited or routed into it; an item found there is moved out first.
    BANK_LAYOUT: true, // v5 (Sean 2026-11-18): every kind of item has its own pack(s) (BANK_LAYOUT_PACKS). Deposits go to the item's pack; the router moves existing items there. Order inside a pack is the sort's job.
    BANK_LAYOUT_PACKS: {
      stack: ["items0", "items6"],
      exchange: ["items1"],
      upgrade: ["items2", "items4"],
      compound: ["items3", "items5"],
      excess: ["items7"],
    }, // stack = stackables and crafting materials, exchange = event items (G.items e / EXCHANGE_PLAN / Xmas Box pieces), upgrade = upgradable gear, compound = compoundable gear, excess = anything else
    BANK_FALLBACK_ORDER: [
      "items7",
      "items6",
      "items5",
      "items4",
      "items3",
      "items2",
      "items1",
      "items0",
    ], // a deposit whose own pack(s) are full goes to the first pack in this list that has room (the last pack is the "spares" pack)
    BANK_ROUTE: true, // v5: move existing items that sit in the wrong pack into their pack (only into packs that have room; the target pack is sorted at its own sort run)
    BANK_ROUTE_MAX_MOVES: 20, // per bank visit
    BANK_LAYOUT_MAX_FAILS: 3, // failed layout moves/deposits per session before the layout switches itself off (deposits then use the game's own slot choice)
    BANK_SORT_STEP_MS: 350, // pause between two moves
    BANK_MERGE: true, // v5: before sorting, stackables of the same kind that sit in several bank slots are joined into one stack (when the total fits the game's stack size)
    BANK_MERGE_MAX: 40, // joins per bank visit
    COMPOUND_MAX_INPUT_BY_ITEM: { dexring: 1 }, // Sean 2026-11-24: Rings of Dexterity +2 are NOT compounded into +3: the Venom Band recipe needs a +2 ring each, so that would be a loss. Item name -> highest level that may be used as compound input (+0 and +1 still go up to +2)
    COMPOUND_SKIP: [], // item names never compounded (e.g. ["ringsj"] if you would rather sell those)
    // Triples (3 items -> 1) per round. 8 = 24 items picked up and compounded per run, to clear a bank that is full of
    // excess compoundable gear. Once the bank is tidy (everything compounded and sold) 3 per run is enough: set this back to 3.
    COMPOUND_MAX_GROUPS: 8,
    COMPOUND_EVERY_MS: 600000, // idle wait between rounds when there was nothing (more) to compound
    COMPOUND_MAX_CHAIN_ROUNDS: 100, // safety cap on back-to-back rounds (they stop on their own when out of items or budget)
    COMPOUND_RESULT_ACTION: "bank", // what to do with items that reach COMPOUND_SELL_AT_LEVEL: "bank" (keep) or "sell" (to Gabriel)
    COMPOUND_SELL_AT_LEVEL: 3,
    COMPOUND_PAUSE_MIN_ATTEMPTS: 30, // after this many real attempts, pause if results are far below the quoted odds
    // --- Gear upgrades (1 item + an upgrade scroll -> +1). Only gear the Ranger would actually wear. ---
    // Failed upgrades destroy the item. The Ranger reports what he wears; the Merchant upgrades items that could beat it,
    // then walks to the Ranger and hands over anything better than what is equipped (he equips it himself).
    UPGRADE_ENABLED: true,
    UPGRADE_MAX_LEVEL: 7, // never upgrade an item above this level
    UPGRADE_MAX_LEVEL_BY_ITEM: { t2quiver: 5, firebow: 8, firestaff: 8, mwhelmet: 7, mwarmor: 7, mwpants: 7, mwgloves: 7, mwboots: 7 }, // Sean 2026-11-21: Fire Bow, Fiery Staff (Priest) and Fiery Blade (Warrior) go to +8 (+7 -> +8 needs scroll2, 1.6M g, allowed by UPGRADE_MAX_SCROLL_GRADE 2; copies that do not beat SexyDexy are fodder and need no spare). v5 (Sean 2026-11-18): items listed here are upgraded up to this level instead of UPGRADE_MAX_LEVEL (and count as finished only there). Fire Bow: scroll1 (40,000 g) is enough up to +7 (its grade changes at +8), so no dearer scroll is bought. Every upgrade can destroy the item: UPGRADE_MIN_COPIES still keeps a spare copy.
    UPGRADE_MIN_CHANCE_BY_ITEM: {}, // v5: per-item success-chance floor instead of UPGRADE_MIN_CHANCE, e.g. { firebow: 0.3 }. The round logs "UPGRADE skipped (below 40%): firebow +6 -> +7 ... NN%" when the floor stops it.
    UPGRADE_GAMBLE_NAMES: ["firebow", "firestaff"], // 2026-11-21: the wearer is the Ranger (bow), the Priest (staff) or the Warrior (blade). v5 (Sean 2026-11-18 14:04): for these items a copy that does NOT beat what SexyDexy wears is "fodder": it is upgraded even at a low success chance (UPGRADE_GAMBLE_MIN_CHANCE) and without a spare copy (losing it costs nothing he wears). A copy that DOES beat his worn one is SET ASIDE for him (never upgraded further, the gear sweep hands it over). Once he wears the cap level (UPGRADE_MAX_LEVEL_BY_ITEM) nothing is gambled any more.
    UPGRADE_GAMBLE_MIN_CHANCE: 0.1, // lowest success chance a fodder copy is tried at
    UPGRADE_NO_SPARE_NAMES: ["mwhelmet", "mwarmor", "mwpants", "mwgloves", "mwboots", "t2quiver", "mcape"], // Sean 2026-11-22: Hunter Warrior pieces are upgraded to +7 without a spare copy (a few will break on the way, he accepts it)
    TOKEN_BUY_ENABLED: true, // Sean 2026-11-22: Monster Tokens in the bank are spent at Daisy on Hunter Warrior gear (round 2 of the exchange runs)
    TOKEN_BUY_ITEM: "monstertoken",
    TOKEN_NPC: "monsterhunter",
    TOKEN_NPC_FALLBACK: { map: "main", x: 126, y: -413 },
    TOKEN_BUY_LIST: ["mwarmor", "mwpants", "mwhelmet", "mwgloves", "mwboots"], // bought ONE piece at a time in this order: the next piece is only bought when the one before has reached TOKEN_BUY_UNTIL_LEVEL (a piece that breaks on the way is simply bought again). Prices from G.tokens.monstertoken (chest 12, pants 11, helmet 7, gloves 8, boots 15)
    TOKEN_BUY_UNTIL_LEVEL: 7,
    UPGRADE_MIN_COPIES: 2, // an upgrade is only tried while another copy of the same item and level sits in the bag/bank (worn gear never counts). 1 = old behaviour
    UPGRADE_MIN_CHANCE: 0.25, // never attempt below this success chance (asked from the server for the exact item)
    UPGRADE_MAX_SCROLL_GRADE: 2, // highest scroll tier to buy (0 = scroll0 1,000g | 1 = scroll1 40,000g | 2 = scroll2 1.6M)
    UPGRADE_SESSION_PCT: 0.1, // separate scroll budget: this share of the bank's gold when the first upgrade round starts
    UPGRADE_SCROLL_NPC: "scrolls",
    UPGRADE_NPC: "newupgrade",
    UPGRADE_PACKS: C.UPGRADE_PACKS,
    SUPPORT_UPGRADE_ANY: true, // (Sean 2026-11-18) the upgrade round matches ANY upgradable item against what the Warrior and the Priest wear too (not only SUPPORT_UPGRADE_NAMES); false = only the names below
    SUPPORT_UPGRADE_NAMES: ["sweaterhs", "xmassweater", "xmaspants"], // v5 (Sean 2026-11-18): Super Sweater / Xmas Sweater / Xmas Pants ("Winter Pants") are no longer junk: stop-gap chests and legs for the Warrior (and Priest) until Heavy Armor / Rugged Coat turn up. The upgrade round also upgrades these (up to UPGRADE_MAX_LEVEL, same two-copies and scroll rules as for the Rangers) when the piece would beat what a support character wears
    UPGRADE_MAX_ITEMS: 4, // items taken out of the bank per round
    UPGRADE_EVERY_MS: 600000,
    UPGRADE_PAUSE_MIN_ATTEMPTS: 30,
    // --- Flipping: upgrade gear the Ranger does NOT need when selling it higher is worth more than the scrolls cost ---
    // Per step he compares  chance * (best value from the next level on) - scroll price  with just selling the item now.
    // Failed upgrades destroy the item, so the odds matter. Uses the same budget as the Ranger-gear upgrades.
    FLIP_ENABLED: true,
    FLIP_MAX_LEVEL: 3, // flip chains stop here (the result is sold)
    FLIP_MIN_GAIN: 0.1, // a step must be expected to earn 10% more than selling the item as it is
    FLIP_ASSUMED_CHANCE: [0.99, 0.95, 0.85, 0.7, 0.5], // success chance assumed for LATER steps (index = level being upgraded); the real quote replaces it for the current step
    FLIP_SELL_FACTOR: 0.5, // starting guess: Gabriel pays this share of the game's item value. Corrected automatically from real sales
    FLIP_RESULT_ACTION: "sell", // "sell" (Gabriel) or "bank" for the finished items
    FLIP_KEEP_NAMES: [], // item names never flipped (e.g. gear you plan for the Priest/Warrior)
    GEAR_CLASS: "ranger", // whose gear this is (items restricted to other classes are ignored)
    GEAR_WEAPON_TYPES: ["bow"], // weapon kinds the Ranger can use
    SUPPORT_GEAR: C.SUPPORT_GEAR,
    // --- Christmas event exchange (items turned in at their quest NPCs; each exchange gives a random reward) ---
    // --- manual compound test (top buttons "Compound odds" / "Compound test") ---
    OFFERING_ITEMS: ["offeringp", "offering"], // an offering / Primling in the bag is shown in the odds check and used by the real test
    TEST_USE_OFFERING: true, // the real "Compound test" uses an offering when one is in the bag (set false to only quote with it)
    // ---- world watch: live bosses and scheduled events, read from the server info the game publishes (read only, no actions) ----
    WATCH_ENABLED: true,
    WATCH_EVERY_MS: 30000,
    EVENT_QUIET_MIN: 5, // Sean 2026-11-24: this many minutes before a scheduled event the Merchant takes no new round except the ones in EVENT_QUIET_ALLOW (0 = off)
    EVENT_QUIET_ALLOW: ["hold", "kit", "bankxs", "sellnow", "tidy", "sweep"], // hold = manual hold, kit = the Warrior's Basher, bankxs / sellnow = junk and bank excess sale, tidy = bag tidy, sweep = gear sweep (hands over upgraded / compounded pieces)
    WATCH_EVENT_WARN_MIN: [60, 15, 5], // log a scheduled event this many minutes before it starts
    WATCH_EVENTS_LOG: ["witchcipher", "goobrawl", "gigacrab", "abtesting"], // 2026-11-21: the schedule entries of these events are logged raw (console too) once per change, so the live shape and the join window can be read
    WATCH_WITCH: true, // 2026-11-21: log the Witch's Cipher info (witch_cipher_info(), character.witchcipher, the shared board server.status.witchcipher) when it changes and the Witch ingredients in the Merchant's bag
    WATCH_REPORT_MS: 30 * 60000, // every so often: the boss table (largest first, with when each was last seen)
    // ---- Rose's lotteries (Item Lottery ticket + Money Lottery tickets). Spare gold only, never above the daily cap. ----
    // Switch off without editing: set("lottery_off", true) in the game console (false = on again).
    LOTTERY_ENABLED: true,
    LOTTERY_DAILY_CAP: 4500000, // most gold spent on tickets per UTC day (item tickets + money tickets together). Sean 2026-11-23: an account may buy 2 Item Lottery tickets a day now (2 x 2M) + 5 money tickets (5 x 100k) = 4.5M; it was 2.5M for ONE item ticket
    LOTTERY_BANK_FLOOR_PCT: 0.05, // Sean 2026-11-24: the lottery leaves 5% of the bank gold untouched; spare gold = the rest (it replaced a fixed 10M floor, so room for more money tickets grows with the bank)
    LOTTERY_EVERY_MS: 60 * 60000, // how often a purchase trip is considered
    LOTTERY_ITEM: true, // buy the Item Lottery ticket
    LOTTERY_MONEY_TICKETS: 5, // Money Lottery tickets per draw (quick pick numbers)
    LOTTERY_NPC_FALLBACK: { map: "main", x: -341, y: 168 }, // Rose, from the game data
    // ---- Lost and Found donations (gold -> Merchant XP; the NPC may hand something back for a big donation) ----
    // Off by default: the first run is a small probe that logs the exact answer and the XP it gave. Switch on after reading that log.
    // Quick switch in the game console: set("donate_off", true) stops it, false lets it run (CFG must have DONATE_ENABLED true).
    DONATE_ENABLED: true,
    DONATE_BANK_FLOOR: 15000000, // spare gold = bank gold above this (above the lottery floor, so tickets come first)
    DONATE_PROBE_GOLD: 100000, // the first donation only
    DONATE_STEP: 5000000, // gold per visit after the probe worked
    DONATE_DAILY_CAP: 10000000, // the STARTING daily cap; with DONATE_CAP_ADAPT it is re-set once per UTC day from the gold earned
    DONATE_CAP_ADAPT: true,
    DONATE_EARN_SHARE: 0.3, // the day's cap aims at this share of the gold earned per 24h (earned = change in bank+bag gold + donations + lottery spending)
    DONATE_CAP_MIN: 5000000,
    DONATE_CAP_MAX: 50000000, // the cap moves at most one DONATE_STEP per day, inside these limits
    DONATE_EVERY_MS: 2 * 3600000,
    DONATE_MIN_FREE_SLOTS: 10, // anything handed back lands in the bag: no visit without this much room
    DONATE_NPC_FALLBACK: { map: "woffice", x: -24, y: -178 }, // Lost and Found (Finders keepers), from the game data
    // ---- crafting at Leo (the craftsman): gear the Rangers lack, made from materials in the bag and bank ----
    CRAFT_ENABLED: true,
    CRAFT_EVERY_MS: 20 * 60000, // how often a missing quiver is checked for
    CRAFT_EMPTY_BACKOFF_MS: 90 * 60000, // materials are missing: look again after this long
    CRAFT_MIN_FREE_SLOTS: 8,
    CRAFT_MAX_PER_RUN: 5, // Sean 2026-11-23: was 3 (30 cores in hand)
    // each recipe names the NPC that makes it (quest field in the game data); none = Leo the craftsman. Quiver, w* gear, rings: Cole (mcollector)
    CRAFT_NPC_FALLBACK: {
      craftsman: { map: "main", x: 92, y: 670 },
      mcollector: { map: "main", x: 81, y: -283 },
    },
    CRAFT_TARGETS: [
      { item: "venomband", total: 30 }, // Sean 2026-11-23: 30 Verdant Cores bought (Ron the Goblin): craft up to 30 and compound the first 27 to a +3
      { item: "orbg", total: 27 },
    ], // orbg (Orb of Beginnings, Sean 2026-11-18 17:31): Cole makes it from 1 Armadillo Scale + 1 Porcupine Leather + 1 Croc Scale + 1 Bee Fur (no gold). total 27 = enough for ONE +3 (three of a level make one of the next); counted as 3^level copies each, and crafting stops once RANGER_COMPOUND has its +3 orb; // v5 (Sean 2026-11-17): make this item until this many exist in total (worn + bag + bank). Venom Band: 1 Ring of Dexterity +2, 1 Verdant Core, 12 Poison Sack, 4 Snake Fang, 240k gold (Leo); more Dex at +0 than a +2 Ring of Dexterity, and it compounds
    EXCHANGE_ENABLED: true,
    EXCHANGE_EVERY_MS: 30 * 60000,
    EXCHANGE_END: "", // e.g. "2027-01-10": no runs after this date. Empty = keep going while there are items
    EXCHANGE_BANK_FIRST: true, // Sean 2026-11-22: when the bag has fewer than EXCHANGE_MIN_FREE_SLOTS free slots, an exchange run first stores everything it does not need in the bank (potions + the stand stay) instead of skipping
    EXCHANGE_MIN_FREE_SLOTS: 30, // the run only starts with this much bag space AFTER the stacks it takes from the bank: up to 30 non-stackable rewards can land in the bag at once, and a full bag breaks the run
    EXCHANGE_EMPTY_BACKOFF_MS: 60 * 60000, // nothing to exchange in the bank/bag: look again after this long
    // order = walking order (Jayson, then the inn, then Santa far away). times = number of exchanges; each uses
    // G.items[item].e of the item (ornament 20, mistletoe 1, candy cane 1).
    EXCHANGE_PLAN: [
      { item: "ornament", npc: "ornaments", times: 1 },
      { item: "mistletoe", npc: "mistletoe", times: 10, big_times: 30, big_every_ms: 12 * 3600000 }, // Sean 2026-11-22: once every 12 h one run exchanges 30 instead of 10 (6800 mistletoes are piling up in the bank)
      { item: "candycane", npc: "santa", times: 10 },
      // v5 ROUND 2 (round: 2 = its own scheduler task, "exchange2", so a potion request or junk sale in the middle only breaks half of the exchanges):
      // everything at Xyn. npc id "exchange" = Xyn; check with find_npc("exchange") in the console. The Xmas Box crafting (XBOX_*) runs at the start of round 2.
      // Market Parcels (from Merrit): 10 at most once an hour (every_ms)
      {
        item: "marketparcel",
        npc: "exchange",
        times: 10,
        every_ms: 60 * 60000,
        round: 2,
      },
      // Xmas Boxes (crafted from the quantum pieces)
      { item: "xbox", npc: "exchange", times: 15, round: 2 }, // Sean 2026-11-22: 15 per run (36 sets of pieces in the bank). Before: 3 per round 2 run; Sean 2026-11-19: 3 per round 2 run (3 are crafted per run, XBOX_PER_RUN)
      // Sean 2026-11-17: Raw Emerald, Armor Box and Weapon Box, 5 per round each (the whole round takes a while)
      { item: "gem0", npc: "exchange", times: 5, round: 2 },
      { item: "armorbox", npc: "exchange", times: 15, round: 2 },
      { item: "weaponbox", npc: "exchange", times: 5, round: 2 },
      { item: "5bucks", npc: "exchange", times: 10, round: 2 }, // Sean 2026-11-22: Old Paper Money at Xyn gives either more Old Paper Money or 800 shells (the cosmetics currency)
    ],
    EXCHANGE2_EVERY_MS: 30 * 60000, // round 2 (Xyn)
    XBOX_ENABLED: true, // v5: at the start of an exchange run take one of each Quantum Piece (recipe G.craft.xbox) out of the bank and craft a Xmas Box at Leo (craftsman, main map)
    XBOX_PER_RUN: 15, // Xmas Boxes crafted per exchange run (needs a full set of pieces for each)
    // used when find_npc cannot place the NPC (positions from the game data)
    EXCHANGE_NPC_FALLBACK: {
      ornaments: { map: "winterland", x: -137, y: -193 },
      mistletoe: { map: "winter_inn", x: 94, y: -181 },
      santa: { map: "winterland", x: 1242, y: -1631 },
    },
    EXCHANGE_SELL: [
      "snowball",
      "rednose",
      "candycanesword",
      "ornamentstaff",
      "merry",
      "snowflakes",
    ], // rewards sold at Gabriel; gear the Ranger cannot use or that would not beat his is sold too
    DEX_SCROLL_POTENTIAL: true, // when judging what is worth upgrading, count the Dexterity a stat scroll could add (items with a "stat" value and no scroll applied yet)
    STAT_SCROLL_APPLY: { ranger: true, warrior: true, priest: true }, // Sean 2026-11-21: the Ranger is ON now (a stat scroll does not break gear, so it may also go on worn gear: STAT_SCROLL_WORN). v6 (D5, replaces DEX_SCROLL_APPLY and SUPPORT_SCROLL_APPLY): apply the character's own stat scroll (Ranger dex, Warrior str, Priest int: from his class profile) to a piece that has a "stat" value and no scroll yet, before the piece goes to him. One path for every class, one switch per class. The Ranger is OFF until a live test shows a Dexterity scroll takes (it did not on Mittens at Cue). Honors UPGRADE_DRY_RUN.
    STAT_SCROLL_WORN: true, // Sean 2026-11-21: a Ranger's WORN piece that has a stat value but no stat scroll yet is taken off, handed to the Merchant on the next courier trip, scrolled, and handed back. Needs STAT_SCROLL_APPLY.ranger. One piece at a time, at most every STAT_SCROLL_WORN_GAP_MS.
    STAT_SCROLL_WORN_GAP_MS: 20 * 60000, // minimum time between two worn-piece swaps (also the time the Merchant waits for the piece to arrive)
    GEAR_TRACE: false, // v6: true = log every set credit and every stat scroll the gear scorer counts ([gear] lines); turn it on (edit here, re-upload) when a score looks wrong
    STAT_SCROLL_MAX_GOLD: 40000, // never pay more than this for one stat scroll, any class (they cost 8,000)
    DEX_SCROLL_NAME: "dexscroll", // the Ranger's stat scroll item (the Warrior and Priest use SUPPORT_GEAR.<name>.scroll); bought at UPGRADE_SCROLL_NPC; counts against the upgrade budget when it goes to a Ranger
    DEX_AUTO_WEIGHT: true, // one dex point is worth (worn weapon attack / 20) attack in the game; use that when it is more than the dex weight below
    DEX_WEIGHT_MULT: 1.3, // v5 (Sean 2026-11-18 17:22): Dexterity is the main driver of the Ranger's damage: the dex weight (the configured one or the weapon-attack/20 value, whichever is higher) is multiplied by this. 1 = as before
    STAT_SCROLL_MULT: 1, // dex gained from a scroll = the item's "stat" value x this (unverified on this server; tune it)
    GEAR_MARGIN: 1.05, // an item must beat what is worn by this factor to be worth upgrading / handing over
    // How much each stat is worth when comparing two items for the Ranger (tune freely)
    // the Ranger lives on attack: it dominates, armor and resistance barely matter
    // Sean's order of importance (2026-11-15): weapon = attack, dex bonus, attack speed, ability, range;
    // armor and accessories = the same five, then armor, resistance, then the other stats.
    // Attack, dex and attack speed (the item stat "frequency") are all converted to damage; see gear_score().
    FREQ_PCT_PER_POINT: 1.25, // v5 (Sean 2026-11-18 17:22): was 1; attack speed counts a bit more. // UNVERIFIED: how many percent faster he attacks per point of "frequency" (check character.frequency before/after equipping a glove)
    // Ability value = weight x attr0 (the proc chance, in %) x 1% of his damage. Ranked with Sean 2026-11-15 (burn first: it deals damage).
    // Abilities that need a cast (frenzy, power, charm, ...) are worth nothing: the Rangers never cast them.
    ABILITY_IGNORE_ITEMS: ["test_orb"], // Sean 2026-11-19: the Orb of Testing's 50% poison proc is not worth the Orb of Beginnings' stats: its ability counts for nothing
    ABILITY_WEIGHTS: {
      burn: 2,
      sunder: 1,
      freeze: 0.5,
      hex: 0.5,
      weave: 0.3,
      poison: 0.2,
      petrify: 0.2,
      poke: 0.1,
      restore_mp: 0.1,
      shatter: 0.1,
      secondchance: 0.05,
    },
    GEAR_WEIGHTS: C.GEAR_WEIGHTS,
    STAT_AS_MAIN: true, // Sean 2026-11-20: stat scrolls are cheap, so an item's stat counts as applied: Dexterity for the Ranger, Strength for the Warrior, Intelligence for the Priest
    SET_BONUS: true, // Sean 2026-11-20: item set bonuses (G.sets, e.g. the Hunter Ranger set: dex +3 at 2 pieces, +6 and speed at 3, armor piercing at 4, resistance at 5) count in the Ranger's gear score: a piece is worth what it adds to the set bonus of the pieces already worn in the other slots
    SET_WEIGHTS: C.SET_WEIGHTS,
    SELF_HEAL_UNTIL_PCT: 0.7, // keep drinking until at least this fraction of max HP
    HEAL_RETRY_MS: 60000, // after a failed heal attempt (no gold, unreachable shop), wait this long
    TICK_MS: 400,
    SCHED_MAX_WAIT_MS: 20 * 60000, // v5: a round that was due but kept waiting behind others this long runs next, whatever its place in the order
    // v5: the game log cannot be selected or copied and old lines scroll away, so status lines are ALSO written to the browser console (F12), where they can be copied
    STATUS_REPORT: true, // Sean 2026-11-20: once an hour one "Hourly report" line per character (XP gained, deaths, free bag slots) plus gold and bank space; set('status_report','1') in the console for one now
    STATUS_REPORT_MS: 3600000,
    REPORT_URL:
      "https://script.google.com/macros/s/AKfycbyxfAnj2R0-TZlK93Qos9jeaXNKREdADnjnt-94oP3bB6slu4LAGM8aMLTe416QXUjCag/exec", // Sean 2026-11-20: Google Apps Script web app that appends the hourly report rows to a Google Sheet (see agent/hourly-status-report-as-built.md); easier: set('report_url','https://script.google.com/macros/s/.../exec') in the Merchant's console
    REPORT_TOKEN: "fennec", // the same token as in the Apps Script (or set('report_token','...'))
    REPORT_HISTORY: 72, // the last N hourly reports are also kept in the game's storage: game_log(get('status_history'))
    DROPS_SKIP: ["ornament", "mistletoe", "candycane", "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "orbofsc"], // Sean 2026-11-20: the hourly report lists what the characters looted, except these Christmas items (and anything in the game's "holidays" set, see DROPS_SKIP_HOLIDAYS)
    DROPS_SKIP_HOLIDAYS: true,
    STATUS_STALE_MS: 300000, // a character whose last report is older than this is marked as silent
    CONSOLE_STATUS: true, // status, report and problem lines (red/amber) also go to console.log; CONSOLE_ALL mirrors everything
    CONSOLE_ALL: false, // true: EVERY line this script writes to the game log also goes to console.log
    COURIER_NOTICE_MS: 240000, // v5: after a courier's notice ("I need X potions, bringing N items") no new round starts and the potions are made ready, for at most this long
    PACE_MS: 1500, // v5: minimum gap between two requests to the server that the game rate-limits (lottery sockets, donation, exchange). One queue for all of them.
    SCHED_STATUS_MS: 30 * 60000, // v5: how often the schedule line (what runs when, how often rounds were deferred) is logged; set("sched_status","1") prints it now
  };
