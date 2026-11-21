// Unit tests for the pure planners (src/lib/planners.js): no game, no mock world.
const fs = require("fs"), vm = require("vm"), path = require("path");
const ctx = vm.createContext({ console, setTimeout, Date, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "dist", "AL Libs v6.js"), "utf8") + "\nthis.AL = AL;", ctx);
const AL = ctx.AL;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };

// a world with one Ranger wearing a weak ring and a finished +3 ring in the bank; one second Ranger wearing a better ring
const G_items = { ring: { type: "ring", compound: 1 } };
const fn = (worn) => ({
  comp_key: (it) => it.name + "+" + (it.level || 0), target_of: () => 3, keep_of: () => 0, comp_ok: () => true, scroll_grade: () => 0,
  max_grade_of: () => 1, ladder_ok: () => false, upg_max: () => 5, upg_ok: () => false, upg_has_spare: () => false,
  gear_score: (n, lv) => 10 * (lv + 1), gear_wearable: () => true, support_cfg: () => false, two_hand: () => false,
  slots_of: () => ["ring1", "ring2"], slot_scores: (who) => worn[who], kit_missing: () => false, kit_names: () => [], find_kit: () => null,
});
const cfg = { COMPOUND_NEED_DRIVEN: true, COMPOUND_SELL_AT_LEVEL: 3, GEAR_MARGIN: 1.05 };
const item = (lv, i) => ({ it: { name: "ring", level: lv }, pack: "items0", i });

let p = AL.planners.sweep({ who_list: ["A", "B"], sup_list: [], items: [item(3, 0)], cfg, G_items, fn: fn({ A: { ring1: 10, ring2: 20 }, B: { ring1: 40, ring2: 40 } }) });
ok(p.give.length === 1 && p.give[0].who === "A" && p.give[0].slot === "ring1", "finished ring goes to the first character, onto his weakest ring slot");

p = AL.planners.sweep({ who_list: ["A"], sup_list: [], items: [item(3, 0)], cfg, G_items, fn: fn({ A: { ring1: 40, ring2: 40 } }) });
ok(p.give.length === 0, "nothing is given when the item does not beat what he wears");

p = AL.planners.sweep({ who_list: ["A"], sup_list: [], items: [item(3, 0), item(3, 1)], cfg, G_items, fn: fn({ A: { ring1: 10, ring2: 10 } }) });
ok(p.give.length === 2 && p.give[0].slot !== p.give[1].slot, "two rings fill the two slots (a used slot counts as taken)");

p = AL.planners.sweep({ who_list: ["A"], sup_list: [], items: [item(1, 0), item(1, 1), item(1, 2)], cfg, G_items, fn: Object.assign(fn({ A: { ring1: 0, ring2: 0 } }), { ladder_ok: () => true }) });
ok(p.give.length === 0, "a triple of rings the ladder still wants is kept for compounding");

// ---- copies ----
const ccfg = { SURPLUS_COPIES_PER_RANGER: { ring: 2 }, KEEP_BEST_COPIES: {}, SURPLUS_MAX_VALUE_EACH: 1000 };
const own = (lv, i, extra) => Object.assign({ it: { name: "ring", level: lv }, bag: i, waiting: false, kb: false }, extra || {});
const cenv = (o) => Object.assign({ n_chars: 2, worn_names: [], owned: [], cfg: ccfg, G_items, sell_value: () => 100 }, o);

let c = AL.planners.copies(cenv({ owned: [own(5, 0), own(5, 1), own(5, 2), own(5, 3), own(5, 4)] }));
ok(c.kept === 4 && c.sell.length === 1, "2 characters x 2 ring slots keep 4 copies, the 5th is sold");

c = AL.planners.copies(cenv({ worn_names: ["ring", "ring"], owned: [own(5, 0), own(5, 1), own(5, 2), own(5, 3)] }));
ok(c.kept === 2 && c.sell.length === 2, "worn pieces count against the allowance");

c = AL.planners.copies(cenv({ owned: [own(5, 0), own(6, 1), own(5, 2), own(5, 3), own(7, 4)] }));
ok(c.sell.length === 1 && c.sell[0].it.level === 5, "the lowest level goes first when copies must go");

c = AL.planners.copies(cenv({ owned: [own(5, 0), own(5, 1), own(5, 2), own(5, 3), own(4, 4, { waiting: true })] }));
ok(c.sell.every((x) => !x.waiting) && c.kept === 4, "an item waiting for a character is kept before higher levels");

c = AL.planners.copies(cenv({ sell_value: () => 5000, owned: [own(5, 0), own(5, 1), own(5, 2), own(5, 3), own(5, 4)] }));
ok(c.sell.length === 0 && c.held.length === 1 && /SURPLUS_MAX_VALUE_EACH/.test(c.held[0].why), "an expensive copy is held back, not sold");

c = AL.planners.copies(cenv({ cfg: Object.assign({}, ccfg, { KEEP_BEST_COPIES: { ring: 1 } }), owned: [own(5, 0), own(5, 1)] }));
ok(c.kept === 1 && c.sell.length === 1, "KEEP_BEST_COPIES overrides the per-character allowance");

process.exit(fails ? 1 : 0);
