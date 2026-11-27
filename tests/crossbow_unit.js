// Ranger gear scoring: the crossbow's weapon-type bonuses (+120 apiercing, -36 frequency) and a weapon's dex-multiplied attack (2026-11-27)
//   node tests/crossbow_unit.js   (run `node build/build.js` first: the lib is read from dist/)
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f + ".json"), "utf8"));
const G = { items: data("items"), sets: data("sets"), classes: data("classes") };
const ctx = { game_log() {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "dist/AL Libs v6.js"), "utf8"), ctx);
const base_cfg = () => ({ GEAR_WEIGHTS: { dex: 1, attack: 3, range: 0.5, apiercing: 0.01 }, FREQ_PCT_PER_POINT: 0.81, ABILITY_IGNORE_ITEMS: [], ABILITY_WEIGHTS: { burn: 2 }, SET_BONUS: false, DEX_AUTO_WEIGHT: true, STAT_AS_MAIN: false, DEX_SCROLL_POTENTIAL: false, UPGRADE_MAX_LEVEL: 5 });
const worn = { mainhand: { name: "firebow", level: 7 }, ring1: { name: "dexring", level: 3 }, ring2: { name: "dexring", level: 3 }, amulet: { name: "dexamulet", level: 2 }, earring1: { name: "dexearring", level: 2 }, earring2: { name: "dexearring", level: 2 } };
function scorer(ref) {
  const CFG = base_cfg();
  if (ref !== undefined) CFG.APIERCING_ARMOR_REF = ref;
  const env = { G, CFG, slot_of_type: { weapon: ["mainhand"] }, gears: {}, lead_gear: { slots: worn } };
  return ctx.AL.gear.scorers(env).ranger;
}
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log((ok ? "ok   " : "FAIL ") + label); };
const rel = (s) => s.score("crossbow", 7, { who: "SexyDexy" }) / s.score("firebow", 7, { who: "SexyDexy" }) - 1;
const s0 = scorer(1e-6), s150 = scorer(150), s500 = scorer(500);
check(Math.abs(rel(s0)) < 0.06, "against armor 0 the crossbow (no burn, -36 frequency) is about even with the Fire Bow: " + (rel(s0) * 100).toFixed(1) + "%");
check(rel(s150) > 0.08 && rel(s150) < 0.2, "against armor 150 it is ahead: " + (rel(s150) * 100).toFixed(1) + "%");
check(rel(s500) > rel(s150), "the more armor, the better the crossbow: " + (rel(s500) * 100).toFixed(1) + "%");
check(Math.abs(s150.wtype_bonus(G.items.crossbow).apiercing - 120) < 1e-9 && s150.wtype_bonus(G.items.crossbow).frequency === -36, "crossbow weapon-type bonus is +120 apiercing / -36 frequency");
const bow_b = s150.wtype_bonus(G.items.firebow);
check(!bow_b.apiercing && !bow_b.frequency, "a normal bow has no apiercing / frequency weapon-type bonus (only speed -3, which is not scored)");
check(s150.apiercing_pct(0) === 0 && s150.apiercing_pct(120) > s150.apiercing_pct(40), "armor piercing is worth more the more of it there is, 0 is worth nothing");
const f = scorer(150);
f.CFG.FREQ_PCT_PER_POINT = 0.81;
const g = scorer(150);
g.CFG.FREQ_PCT_PER_POINT = 1.25;
check(g.score("goldenpowerglove", 0, {}) > f.score("goldenpowerglove", 0, {}), "a lower frequency weight lowers a speed glove's score");
console.log(bad ? "crossbow_unit: " + bad + " failed" : "crossbow_unit OK");
process.exit(bad ? 1 : 0);
