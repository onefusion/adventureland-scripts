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
const cfg = { GEAR_MARGIN: 1.05 };
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

// ---- surplus ----
const scfg = { GEAR_MARGIN: 1.05, SURPLUS_KEEP_SPARE: 0, SURPLUS_MAX_VALUE_EACH: 1000 };
const cand = (lv, i, score, extra) => Object.assign({ it: { name: "ring", level: lv }, pack: "items0", i, score }, extra || {});
const senv = (o) => Object.assign({ who_list: ["A"], cands: [], slot_scores: () => ({ ring1: 10, ring2: 10 }), slot_of_type: { ring: ["ring1", "ring2"] }, cfg: scfg, G_items, sell_value: () => 100 }, o);

let sp = AL.planners.surplus(senv({ cands: [cand(3, 0, 50), cand(3, 1, 50), cand(3, 2, 50)] }));
ok(sp.kept === 2 && sp.sell.length === 1, "two rings that beat the worn ones are kept, the third is surplus");

sp = AL.planners.surplus(senv({ cands: [cand(3, 0, 5)] }));
ok(sp.kept === 0 && sp.sell.length === 1, "an item that beats nothing worn is surplus");

sp = AL.planners.surplus(senv({ cands: [cand(3, 0, 0)] }));
ok(sp.sell.length === 1, "an item nobody can wear is surplus");

sp = AL.planners.surplus(senv({ cfg: Object.assign({}, scfg, { SURPLUS_KEEP_SPARE: 1 }), cands: [cand(3, 0, 0), cand(3, 1, 0)] }));
ok(sp.kept === 1 && sp.sell.length === 1, "SURPLUS_KEEP_SPARE keeps one spare per item type");

sp = AL.planners.surplus(senv({ sell_value: () => 5000, cands: [cand(3, 0, 0)] }));
ok(sp.sell.length === 0 && sp.held.length === 1, "an expensive surplus item is held back");

sp = AL.planners.surplus(senv({ sell_value: (n, l) => l * 100, cands: [cand(1, 0, 0), cand(3, 1, 0), cand(2, 2, 0)] }));
ok(sp.sell.map((c) => c.value).join() === "300,200,100", "the most valuable surplus is listed first");

// ---- ladder ----
const lg = { ring: { type: "ring", compound: 1 }, book: { type: "source", compound: 1 } };
const lcfg = { COMPOUND_TARGET_LEVEL: 3, SURPLUS_COPIES_PER_RANGER: { ring: 2 } };
const lenv = (o) => Object.assign({ n_chars: 1, pieces: [], cfg: lcfg, G_items: lg,
  fn: { focus_of: () => null, wearable: () => true, gear_score: () => 10, would_wear: () => false } }, o);
const ring = (lv) => ({ name: "ring", level: lv });

let ld = AL.planners.ladder(lenv({ pieces: [ring(0), ring(0), ring(0)] }));
ok(ld.demand("ring") === 2 && ld.preferred("ring"), "demand is characters x slots; the only ring is the preferred one");
ok(ld.ladder_ok("ring", 0) && ld.take_triples("ring", 0, 1) === 1 && ld.held("ring", 1) === 1, "a triple at +0 is compounded once; the result counts at +1");

ld = AL.planners.ladder(lenv({ pieces: [ring(1), ring(1), ring(1)] }));
ok(!ld.ladder_ok("ring", 1), "lower tiers must stay covered: 3 copies at +1 (demand 2) cannot lose 3 to a compound");
ld = AL.planners.ladder(lenv({ pieces: [ring(1), ring(1), ring(1), ring(1), ring(1), ring(1)] }));
ok(ld.ladder_ok("ring", 1), "6 copies at +1 leave demand + 2 spare behind, so a triple may be compounded");

ld = AL.planners.ladder(lenv({ pieces: [ring(3), ring(3), ring(0), ring(0), ring(0)] }));
ok(!ld.ladder_ok("ring", 0), "nothing is compounded once every slot already holds the target level");

ld = AL.planners.ladder(lenv({ fn: { focus_of: (n) => (n === "book" ? { target: 2 } : null), wearable: () => false, gear_score: () => 0, would_wear: () => false }, pieces: [{ name: "book", level: 0 }, { name: "book", level: 0 }, { name: "book", level: 0 }] }));
ok(ld.ladder_ok("book", 1) && !ld.ladder_ok("book", 2) && ld.useful({ name: "book", level: 0 }), "focus items are funnelled up to their own target and are never dead stock");

ld = AL.planners.ladder(lenv({ cfg: Object.assign({}, lcfg), pieces: [ring(0), ring(0)] }));
ok(ld.useful({ name: "ring", level: 0 }) && !ld.useful({ name: "ring", level: 3 }), "a piece is useful while a tier above it is still open, not once it is at the target");

// ---- compound groups ----
const grp = (lv, bag, bank) => ({ key: "ring+" + lv, item: { name: "ring", level: lv }, bag, bank: new Array(bank).fill({}) });
const genv = (groups, o) => Object.assign({ groups,
  fn: { keep_of: () => 0, scroll_for: () => "cscroll0", scroll_grade: () => 0, max_grade_of: () => 1, focus_of: () => null, ladder: () => ({ take_triples: (n, L, avail) => avail }) } }, o);

let cg = AL.planners.compound_groups(genv([grp(1, 3, 0), grp(0, 2, 5), grp(2, 2, 0)]));
ok(cg.groups.map((g) => g.item.level).join() === "0,1" && cg.groups[0].max_triples === 2 && cg.groups[1].max_triples === 1, "groups with fewer than three copies are dropped; the rest are sorted lowest level first with their triple counts");

cg = AL.planners.compound_groups(genv([grp(0, 3, 0)], { fn: Object.assign(genv([]).fn, { keep_of: () => 3 }) }));
ok(cg.groups.length === 0, "a full triple that must stay behind (keep_of 3) is not compounded");

cg = AL.planners.compound_groups(genv([grp(0, 3, 0)], { fn: Object.assign(genv([]).fn, { scroll_grade: () => 2 }) }));
ok(cg.groups.length === 0 && cg.skipped.length === 1, "a scroll above the allowed tier skips the group and reports it");

cg = AL.planners.compound_groups({ groups: [grp(0, 6, 0)], fn: Object.assign(genv([]).fn, { ladder: () => ({ take_triples: (n, L, avail) => Math.min(avail, 1) }) }) });
ok(cg.groups.length === 1 && cg.groups[0].max_triples === 1, "with the ladder on, the ladder decides how many triples");

// ---- upgrade (stage 7) ----
const UG = { RANGER_NAME: "R", GEAR_MARGIN: 1.05 };
const uit = (name, level, extra) => Object.assign({ name, level }, extra);
const uenv = (items, o) => Object.assign({
  cfg: UG, G_items: { bow: { upgrade: 1 }, cap: { upgrade: 1 }, junk: {} },
  items: items.map((it, i) => ({ it, where: { bag: i } })),
  fn: {
    upg_ok: (it) => !!it && it.name !== "junk", has_spare: () => true, potential: (it) => 100, best_target: () => null, support_target: () => null,
    support_names: () => ["W"], wearable: () => true, upg_max: () => 7, scroll_ok: () => true, roster: () => ["R"], fresh_for: () => true,
    worn_floor: () => ({ slot: "mainhand", score: 80 }), score: () => 100, label: (it) => it.name + " +" + it.level, support_cfg: (w) => w === "W",
  } }, o);
let up = AL.planners.upgrade(uenv([uit("bow", 3), null, uit("junk", 0)], { fn: Object.assign(uenv([]).fn, { best_target: () => ({ who: "R", f: { score: 80 } }) }) }));
ok(up.cands.length === 1 && up.cands[0].for === "R" && up.cands[0].gain === 20 && up.cands[0].bag === 0 && up.diag.upgradable === 1, "a piece that beats the leader's worn gear is a candidate (gain = potential - worn), with its bag position; nulls and non-upgradables are skipped");
up = AL.planners.upgrade(uenv([uit("bow", 3)], { fn: Object.assign(uenv([]).fn, { has_spare: () => false }) }));
ok(up.cands.length === 0 && up.diag.no_spare === 1 && up.diag.no_spare_names["bow+3"], "no spare copy: not a candidate, reported in the diagnostics");
up = AL.planners.upgrade(uenv([uit("bow", 3)]));
ok(up.cands.length === 0 && up.diag.not_better === 1 && /bow \+3 would score 100 at \+7, but R wears 80 \(needs 84\); W wears 80/.test(up.diag.why), "nobody gains: the diagnostics explain what each character wears: " + up.diag.why);
up = AL.planners.upgrade(uenv([uit("bow", 3), uit("cap", 5)], { fn: Object.assign(uenv([]).fn, { best_target: (it) => ({ who: it.name === "bow" ? "W" : "R", f: { score: 50 } }), score: (n, l, o) => (o && o.who === "W" ? 130 : 100) }) }));
ok(up.cands.map((c) => c.it.name).join() === "cap,bow" && up.cands[1].potential === 130 && up.cands[1].gain === 80, "the leader's upgrade comes first even when the support piece gains more; a support target is scored with its own weights");
up = AL.planners.upgrade(uenv([uit("bow", 3)], { fn: Object.assign(uenv([]).fn, { best_target: () => ({ who: "R", f: { score: 99 } }), score: () => 100 }) }));
ok(up.notes.length === 1 && up.notes[0].who === "R", "a piece that only wins once a stat scroll is applied is reported as a note");

const supenv = (o) => Object.assign({ cfg: { SUPPORT_UPGRADE_ANY: true, SUPPORT_UPGRADE_NAMES: [], GEAR_MARGIN: 1.05 },
  fn: { support_names: () => ["W", "P"], fresh_for: (w) => w !== "W", wearable: () => true, worn_floor: () => ({ score: 50 }), score: () => 60, upg_max: () => 7 } }, o);
ok(AL.planners.support_target(supenv(), uit("bow", 1)).who === "P", "support target: skips a character without a fresh report, takes the next one that gains");
ok(AL.planners.support_target(supenv({ cfg: { SUPPORT_UPGRADE_ANY: false, SUPPORT_UPGRADE_NAMES: ["x"], GEAR_MARGIN: 1.05 } }), uit("bow", 1)) === null, "support target: only listed names when SUPPORT_UPGRADE_ANY is off");
ok(AL.planners.support_target(supenv({ fn: Object.assign(supenv().fn, { score: () => 52 }) }), uit("bow", 1)) === null, "support target: no gain beyond the margin, no target");

const gmenv = (o) => Object.assign({ cfg: { UPGRADE_GAMBLE_NAMES: ["fbow"], RANGER_NAME: "R" }, fresh: true,
  ranger_gear: { slots: { mainhand: { name: "fbow", level: 4 } } }, fn: { beats_worn: () => false, upg_max: () => 7 } }, o);
ok(AL.planners.gamble_mode(gmenv(), uit("bow", 1)) === "" && AL.planners.gamble_mode(gmenv({ fresh: false }), uit("fbow", 1)) === "", "gamble mode: not a gamble item, or no fresh report: empty");
ok(AL.planners.gamble_mode(gmenv(), uit("fbow", 1)) === "fodder", "gamble mode: a gamble item that does not beat the worn one is fodder");
ok(AL.planners.gamble_mode(gmenv({ fn: { beats_worn: () => true, upg_max: () => 7 } }), uit("fbow", 6)) === "aside", "gamble mode: one that beats the worn one is set aside");
ok(AL.planners.gamble_mode(gmenv({ ranger_gear: { slots: { mainhand: { name: "fbow", level: 7 } } } }), uit("fbow", 1)) === "", "gamble mode: the leader already wears the cap, nothing to gain");

const flenv = (items, o) => Object.assign({ cfg: { FLIP_MIN_GAIN: 0.1 }, items: items.map((it, i) => ({ it, where: { bag: i } })),
  fn: { flip_ok: (it) => !!it, sell_value: () => 1000, chain_value: (n, l) => (n === "good" ? 1500 : 1050) } }, o);
const fl = AL.planners.flips(flenv([uit("meh", 0), null, uit("good", 0)]));
ok(fl.length === 1 && fl[0].it.name === "good" && fl[0].flip === true && fl[0].gain === 500 && fl[0].bag === 2, "flips: only chains that beat selling by FLIP_MIN_GAIN, best first, with position");

process.exit(fails ? 1 : 0);
