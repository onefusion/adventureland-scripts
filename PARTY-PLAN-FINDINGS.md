# Party plan - server findings (checked against play.coreforgedev.com client code and data)

## Shared code
- `load_code("slot")` runs another code slot at top level (functions become global). `require_code("slot")` runs it in its own scope and returns exports. Both fetch the slot's SAVED text when the character starts -> save the slot, restart characters.

## Classes (G.skills)
- Warrior: taunt (40mp, 3s cd, range 200), agitate (L68, 420mp, 2.2s, range 320, taunts all nearby), hardshell (L60, 480mp, 16s), cleave (L52, 720mp, 1.2s, range 160), stomp (L52, stun, 24s), charge (speed buff, 40s), dash, warcry (L70, party buff).
- Paladin: selfheal (20mp, 1.2s), mshield toggle, cleansing_light (L30), guardians_oath (L50, takes 35% of an ally's damage 8s), beacon_of_resolve (L70, party buff), paladin_aura (L60), purify (L60), shield_slam (L60, 2000mp!), smash (L10). No taunt in the list I found -> weaker pure tank than Warrior; better self-sustain.
- Priest: heal (basic, no mp/cd listed), partyheal (400mp, 200ms cd), absorb (L55, pulls ALL targets off a friendly: 200mp, 400ms, range 240), curse (400mp, 5s, +20% dmg taken), darkblessing (L70, +25% dmg, party, 60s), revive (500mp, needs Essence of Life), phaseout (L64).
- Paladin/Warrior/Priest each can use only some weapons: 5 / 5 / 8 weapon-type items on this server.

## Server messages / restart notice
- Server broadcasts arrive on socket "server_message" and are only drawn into the chat/log UI. They are NOT delivered to scripts as game events. Events scripts get: death, new_map, pvp_list, event, chat (player chat only), sbuy, fbuy, trade, sale, level_up, ccreport, action, hit, api_response.
- Workaround to verify live: wrap `parent.add_chat` / `parent.add_log` (scripts already use `parent.*`) and match text; or read `#chatlog` DOM. Fallback: manual button.

## Guilds
- No guild API in client code. `character.guild` is only used for friendly-fire checks and name colouring. Use parties + `send_cm` instead. Party API: send_party_invite, accept_party_invite, get_party, leave_party, kick_party_member, party_say.

## UI buttons
- `add_top_button(id, value, fn)` exists (top bar).

## Upgrade / compound / bank
- `upgrade(item, scroll, offering, only_calculate)` and `compound(i0,i1,i2, scroll, offering, only_calculate)` send `calculate:true` to the server -> the server can report the success chance for the exact items. Check live what the promise resolves with.
- Scrolls: cscroll0 6,400g / cscroll1 240,000g / cscroll2 9.2M; scroll0 1,000g / scroll1 40,000g / scroll2 1.6M. Items carry `grades` (e.g. ringsj [3,5,6,7]) = levels where the needed scroll grade steps up.
- Bank: map "bank" holds items0-7 (+goldnpc), "bank_b" items8-23, "bank_u" items24-47. Your 3 packs (items0-2) are all on "bank". `bank_store(num, pack, pack_num)`, `bank_retrieve(pack, pack_num, num)`, must be standing in that map (`character.bank` exists only there).

## Town NPCs / transport
- main town NPCs: newupgrade (Cue), exchange, scrolls, fancypots, basics, craftsman, transporter, monsterhunter, secondhands, standmerchant, ...
- Transporter ("Alia") exists in: main, winterland, desertland, halloween (+ test/d_e/goobrawl). So there are 4 towns, not 3.
- Monster drop tables: G.drops.monsters (per monster type).

## Live test results (2026-11-12)
- Chat hook works: wrapping `parent.add_chat` and buffering messages whose owner is "" shows server messages to a script. NEVER call game_log (which calls add_log) from inside a hook - it recursed and froze the browser. Print from a timer instead (the v2 script).
- Odds check works and is a dry run: `upgrade(item_slot, scroll_slot, null, true)` resolved with
  `{"calculate":true,"chance":0.99999999,"item":{"name":"mushroomstaff","level":0},"grace":0,"scroll":"scroll0","success":true,"response":"upgrade_chance","place":"upgrade"}`.
  Item and scroll stayed in the bag afterwards. Still untested: higher item levels, compound, and the real wording of an admin restart notice.
