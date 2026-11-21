// Unit test for the Ranger gear scoring: attack first, dex scaled by weapon attack, level-aware stat scrolls.
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", process.env.MERCHANT_FILE || "dist/AutoMerchant v6.js"), "utf8");
const lib_src = fs.readFileSync(path.join(__dirname, "..", process.env.LIB_FILE || "dist/AL Libs v6.js"), "utf8"); // the scorer itself lives in the lib (AL.gear)
// the weights live in AL.config (stage 5); the v5 files (old lib) still carry them in the Merchant text
let cfg;
try {
  const tmp = vm.createContext({ console });
  vm.runInContext(lib_src + "\nthis.__w = AL.config && AL.config.for_script(\"Merchant\").GEAR_WEIGHTS;", tmp);
  if (tmp.__w) cfg = "GEAR_WEIGHTS: " + JSON.stringify(tmp.__w) + ",";
} catch (e) {}
if (!cfg) cfg = src.match(/GEAR_WEIGHTS: \{[\s\S]*?\n    \},/)[0];
const block = src.match(/\/\/ <gear-scoring>[\s\S]*?\/\/ <\/gear-scoring>/)[0];
const ctx = {
  game_log() {},
  say() {},
  S: { ranger_gear: null, gears: {} },
  G: { items: {
    atk_bow: { attack: 40, armor: 0 },
    tank_cap: { armor: 100, resistance: 100 },
    stat_cap: { armor: 10, stat: 3, type: "helmet" },
    plain_cap: { armor: 10, type: "helmet" },
    low_bow: { attack: 30 },
    xmashat: { armor: 10, stat: 1, tier: 1.5, type: "helmet", upgrade: { armor: 1.5, stat: 1 } },
    big_bow: { attack: 100, upgrade: { attack: 5 } },
    fastglove: { type: "gloves", armor: 5, frequency: 2 },
    plainglove: { type: "gloves", armor: 5 },
    fireb: { type: "weapon", wtype: "bow", attack: 30, ability: "burn", attr0: 2 },
    plainb: { type: "weapon", wtype: "bow", attack: 30 },
    merrylike: { type: "weapon", wtype: "bow", attack: 30, ability: "secondchance", attr0: 10 },
    frenzyamu: { type: "amulet", dex: 1, ability: "frenzy", attr0: 1.75 },
    plainamu: { type: "amulet", dex: 1 },
    critring: { type: "ring", crit: 2 },
    cheer: { type: "source", dex: 16, vit: 16, resistance: 120, compound: { dex: 6, vit: 6, resistance: 30 } },
    quiver: { type: "quiver", dex: 2, range: 20, armor: 10, upgrade: { dex: 1, armor: 2, range: 3.5 } },
  } },
};
vm.createContext(ctx);
vm.runInContext(lib_src, ctx);
vm.runInContext("const CFG = { STAT_AS_MAIN: " + (process.env.STAT_MAIN === "1") + ", ABILITY_IGNORE_ITEMS: [], SET_BONUS: true, SET_WEIGHTS: { phresistance: 0.05 }, DEX_SCROLL_POTENTIAL: true, DEX_AUTO_WEIGHT: true, STAT_SCROLL_MULT: 1, UPGRADE_MAX_LEVEL: 5, FREQ_PCT_PER_POINT: 1, ABILITY_WEIGHTS: { burn: 2, secondchance: 0.05 }, " + cfg + " };\nconst upg_max = () => 5; const SLOT_OF_TYPE = { helmet: [\"helmet\"], shoes: [\"shoes\"], pants: [\"pants\"], gloves: [\"gloves\"], earring: [\"earring1\", \"earring2\"], ring: [\"ring1\", \"ring2\"] };\n" + block + "\nthis.gear_score = gear_score; this.potential_score = potential_score; this.prop_at = prop_at; this.dex_weight = () => gear_scorers.ranger.dex_weight(); this.damage_ref = () => gear_scorers.ranger.damage_ref();", ctx);
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const gs = ctx.gear_score;
ok(gs("atk_bow", 0) > gs("tank_cap", 0), "attack outweighs big armor/resistance");
ok(gs("stat_cap", 0, { assume_dex: true }) > gs("stat_cap", 0), "dex scroll potential raises a stat item");
ok(gs("plain_cap", 0, { assume_dex: true }) === gs("plain_cap", 0), "no stat value -> no potential");
ok(gs("stat_cap", 0, { stat_type: "dex" }) === gs("stat_cap", 0, { assume_dex: true }), "applied dex scroll counts like the potential");
ok(gs("stat_cap", 0, { stat_type: "str", assume_dex: true }) < gs("stat_cap", 0, { assume_dex: true }), "a scroll already applied is not replaced by an assumed dex");
ok(gs("low_bow", 0) < gs("atk_bow", 0), "higher attack wins");
ok(ctx.potential_score({ name: "stat_cap" }) > gs("stat_cap", 5), "potential_score assumes dex");
// stat grows with level: xmashat stat 1 + 1 per level -> +5 gives 6 dex
ok(ctx.prop_at(ctx.G.items.xmashat, 5, "stat") === 6, "xmashat +5 carries stat 6: " + ctx.prop_at(ctx.G.items.xmashat, 5, "stat"));
ok(gs("xmashat", 5, { assume_dex: true }) - gs("xmashat", 5) >= 5 * ctx.dex_weight(), "a +5 hat gains about 6 dex from a scroll");
// dex is worth weapon_attack/20 attack: a 100-attack bow makes 1 dex worth 3*100/20 = 15
ctx.S.ranger_gear = { slots: { mainhand: { name: "big_bow", level: 0 } } };
ok(ctx.dex_weight() === 15, "dex weight follows the worn weapon: " + ctx.dex_weight());
ctx.S.ranger_gear = null;
ok(ctx.dex_weight() === 1, "no weapon info -> plain dex weight");
// Book of Cheer (wbookhs, Sean\'s screenshot: dex 16 at +0, 22 at +1, 28 at +2) vs a quiver (test data, not the real quiver)
ctx.S.ranger_gear = { slots: { mainhand: { name: "big_bow", level: 0 } } };
ok(gs("cheer", 1) > gs("quiver", 3), "Book of Cheer +1 beats a +3 quiver: " + gs("cheer", 1) + " vs " + gs("quiver", 3));
ok(gs("cheer", 0) > gs("quiver", 0), "Book of Cheer +0 beats a +0 quiver");
const cheer_dex = [0,1,2,3,4,5,6,7].map((l) => Math.round(ctx.prop_at(ctx.G.items.cheer, l, "dex")));
ok(cheer_dex.join() === "16,22,28,34,40,48,57,69", "Book of Cheer dex per level matches the game (screenshot): " + cheer_dex.join());
const cheer_res = [0,1,2,3,4,5,6,7].map((l) => Math.round(ctx.prop_at(ctx.G.items.cheer, l, "resistance")));
ok(cheer_res.join() === "120,150,180,210,240,278,323,383", "Book of Cheer resistance per level matches: " + cheer_res.join());
// attack speed counts as a percentage of the Ranger's damage; abilities follow the configured weights; "other" stats sit below armor/resistance
ctx.S.ranger_gear = { slots: { mainhand: { name: "big_bow", level: 0 } } };
ok(gs("fastglove", 0) > gs("plainglove", 0), "a glove with attack speed beats the same glove without");
const fgain = gs("fastglove", 0) - gs("plainglove", 0);
ok(Math.abs(fgain - 2 * ctx.damage_ref() / 100) < 1e-6, "2 frequency = 2% of the damage reference: " + fgain + " vs " + 2 * ctx.damage_ref() / 100);
ok(gs("fireb", 0) > gs("plainb", 0), "a burn bow beats the plain bow when burn has a weight");
const bgain = gs("fireb", 0) - gs("plainb", 0);
ok(Math.abs(bgain - 2 * 2 * ctx.damage_ref() / 100) < 1e-6, "burn 2 at attr0 2 = 4% of the damage reference: " + bgain);
ok(gs("fireb", 0) > gs("merrylike", 0), "burn outranks second chance on the same bow");
ok(gs("frenzyamu", 0) === gs("plainamu", 0), "frenzy (needs a cast) adds nothing");
ok(gs("critring", 0) < gs("tank_cap", 0), "other stats (crit) rank below armor and resistance");
// ---- set bonuses (Sean 2026-11-20): the bonuses add up per piece worn; a piece is worth what it adds given the OTHER worn slots ----
ctx.S.ranger_gear = null;
ctx.G.sets = { hset: { 1: {}, 2: { dex: 3 }, 3: { speed: 2, dex: 3 }, 4: { apiercing: 60 }, items: [] }, kset: { 2: { apiercing: 80 } } };
Object.assign(ctx.G.items, {
  h_hat: { type: "helmet", set: "hset", armor: 20 }, h_boots: { type: "shoes", set: "hset", armor: 10 }, h_pants: { type: "pants", set: "hset", armor: 10 }, h_gloves: { type: "gloves", set: "hset", armor: 10 },
  plain_hat: { type: "helmet", armor: 20 }, k_ear: { type: "earring", set: "kset" },
});
const dwt = ctx.dex_weight();
ok(gs("h_hat", 0) === gs("plain_hat", 0), "a lone set piece (nothing else of the set worn) has no set credit");
ctx.S.ranger_gear = { slots: { shoes: { name: "h_boots", level: 0 } } };
ok(Math.abs(gs("h_hat", 0) - gs("plain_hat", 0) - 3 * dwt) < 1e-9, "second set piece adds the 2-piece bonus (dex 3): " + (gs("h_hat", 0) - gs("plain_hat", 0)) + " vs " + 3 * dwt);
ctx.S.ranger_gear = { slots: { shoes: { name: "h_boots", level: 0 }, pants: { name: "h_pants", level: 0 } } };
const third = gs("h_hat", 0) - gs("plain_hat", 0);
ok(Math.abs(third - (3 * dwt + 2 * ctx.CFG_SPEED + 0)) < 1e-9 || Math.abs(third - (3 * dwt + 2 * 0.02)) < 1e-9, "third piece adds dex 3 more and speed 2: " + third);
ctx.S.ranger_gear = { slots: { helmet: { name: "h_hat", level: 0 }, shoes: { name: "h_boots", level: 0 }, pants: { name: "h_pants", level: 0 } } };
ok(Math.abs(gs("h_hat", 0) - third - gs("plain_hat", 0)) < 1e-9, "the worn hat scores the same as the same hat as a candidate (swap inside the set cancels)");
ok(gs("plain_hat", 0) < gs("h_hat", 0), "with 2 set pieces worn elsewhere the set hat beats the plain one of equal armor");
ctx.S.ranger_gear = { slots: { earring1: { name: "k_ear", level: 0 } } };
ok(gs("k_ear", 0) > 79 * 0.01, "the second earring of a 2-piece set gets the set credit (free earring slot): " + gs("k_ear", 0));
ctx.S.ranger_gear = { slots: { earring1: { name: "k_ear", level: 0 }, earring2: { name: "k_ear", level: 0 } } };
ok(Math.abs(gs("k_ear", 0) - 80 * 0.01) < 1e-9, "both earrings worn: each is credited with the full pair bonus when it replaces one of them: " + gs("k_ear", 0));
ctx.CFG_SET_OFF = true;
if (process.env.STAT_MAIN === "1") ok(gs("stat_cap", 0) === gs("stat_cap", 0, { assume_dex: true }) && gs("stat_cap", 0) > gs("plain_cap", 0), "STAT_AS_MAIN: an unscrolled stat item already counts its stat as dex");
process.exit(bad ? 1 : 0);
