// Golden-value test for gear scoring (refactor stage 1, decision D13 item 4).
//   node tests/golden_gear.js              compare the lib scorer (dist/AL Libs v6.js, run `node build/build.js` first) with tests/golden/gear_scores.json.gz
//   node tests/golden_gear.js --from-v5    (re)generate the golden file from the OLD v5 Merchant scorer (AutoMerchant v5.js: `gear_score` + `support_score`); done once, 2026-11-20
//   node tests/golden_gear.js --from-lib   regenerate the golden file from the lib scorer (use after a DELIBERATE scoring change or to extend the levels)
// What is scored: every wearable item (types of the slot maps) x levels 0..GOLDEN_MAX_LEVEL x 4 option sets x 4 contexts (worn gear, config flags) x 5 roles (Ranger with and without
// `who`, Warrior, Warrior's second set, Priest), plus potential_score. All numbers must be identical to the last digit.
//
// HOW TO EXTEND TO HIGHER ITEM LEVELS (Sean wants 8, 9, 10 as the need appears):
//  1. raise GOLDEN_MAX_LEVEL below (7 -> 8, 9 or 10)
//  2. regenerate with --from-lib and review the diff of the table: only the new levels' rows may be new, old rows must not change
//  3. the upgrade formula above +7 is unverified (decision G2): check the new levels against the in-game item screen before trusting the new rows
//  4. raise the matching limits in the Merchant at the same time (upgrade cap, Fire Bow cap, scroll tier rules), since the scorer only scores levels the planners can reach
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const ROOT = path.resolve(__dirname, "..");
const GOLDEN_MAX_LEVEL = 7;
const GOLDEN_FILE = path.join(__dirname, "golden", "gear_scores.json.gz");
const V5_FILE = path.join(ROOT, process.env.V5_MERCHANT || "AutoMerchant v5.js");
const LIB_FILE = path.join(ROOT, process.env.LIB_FILE || "dist/AL Libs v6.js");
const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f + ".json"), "utf8"));
const G = { items: data("items"), sets: data("sets") };
// the Ranger's slot map (the support classes add shield/source, but the set-credit code always used the Ranger map)
const SLOT_OF_TYPE = { helmet: ["helmet"], chest: ["chest"], pants: ["pants"], gloves: ["gloves"], shoes: ["shoes"], cape: ["cape"], ring: ["ring1", "ring2"], earring: ["earring1", "earring2"], amulet: ["amulet"], belt: ["belt"], orb: ["orb"], quiver: ["offhand"], weapon: ["mainhand"] };
const WEARABLE = new Set(Object.keys(SLOT_OF_TYPE).concat(["shield", "source"]));
const ITEMS = Object.keys(G.items).filter((n) => WEARABLE.has(G.items[n].type)).sort();
const ROLES = [
  { role: "ranger", who: "SexyDexy" },
  { role: "ranger_nowho", who: undefined },
  { role: "warrior", who: "SexyWexy" },
  { role: "warrior_alt", who: "SexyWexy+" },
  { role: "priest", who: "SexyHexy" },
];
// worn-gear contexts: A = nothing worn; B = a weapon per role and one piece of every set worn (levels 0-3), so set credits and weapon-based weights are exercised
function worn_report(kind) {
  const slots = {};
  const first = (pred) => ITEMS.find((n) => pred(G.items[n]));
  if (kind === "ranger") slots.mainhand = { name: G.items.firebow ? "firebow" : first((d) => d.type === "weapon" && d.wtype === "bow"), level: 5 };
  if (kind === "warrior") slots.mainhand = { name: first((d) => d.type === "weapon" && d.wtype === "sword"), level: 3 };
  if (kind === "priest") slots.mainhand = { name: first((d) => d.type === "weapon" && (d.wtype === "staff" || d.wtype === "pmace")), level: 2 };
  let k = 0;
  for (const s of Object.keys(G.sets).sort()) {
    for (const n of ITEMS) {
      const d = G.items[n];
      if (d.set !== s) continue;
      const slot = (SLOT_OF_TYPE[d.type] || [])[0];
      if (!slot || slots[slot] || slot === "mainhand") continue;
      slots[slot] = { name: n, level: k++ % 4 };
      break;
    }
  }
  return { slots };
}
function make_state(ctxname) {
  if (ctxname === "A") return { gears: {}, lead_gear: null };
  const r = worn_report("ranger"), w = worn_report("warrior"), p = worn_report("priest");
  return { gears: { SexyDexy: r, SexyWexy: w, "SexyWexy+": w, SexyHexy: p }, lead_gear: r };
}
const OPTS = (role_scroll_stat) => [
  ["none", {}],
  ["stat_main", { stat_type: role_scroll_stat }],
  ["assume", { assume_dex: true }],
  ["stat_vit", { stat_type: "vit" }],
];
// contexts: worn gear (A none, B weapons + one piece of every set) and config flags (C = B with STAT_AS_MAIN off, D = B with set bonuses and the auto dex weight off)
const CONTEXTS = ["A", "B", "C", "D"];
const FLAGS = { C: { STAT_AS_MAIN: false }, D: { SET_BONUS: false, DEX_AUTO_WEIGHT: false } };
function table(adapter) {
  const out = {};
  for (const c of CONTEXTS) {
    adapter.set_state(make_state(c));
    adapter.set_flags(FLAGS[c] || {});
    for (const r of ROLES) {
      const main_stat = adapter.scroll_stat(r.who);
      for (const [oname, o] of OPTS(main_stat)) {
        for (let lv = 0; lv <= GOLDEN_MAX_LEVEL; lv++) {
          out[[r.role, c, oname, lv].join("|")] = ITEMS.map((n) => adapter.score(n, lv, Object.assign({ who: r.who }, o)));
        }
      }
    }
    out["potential|" + c] = ITEMS.map((n) => adapter.potential({ name: n }));
    out["potential_dex|" + c] = ITEMS.map((n) => adapter.potential({ name: n, stat_type: "dex" }));
  }
  return out;
}
// ---- adapter for the OLD v5 Merchant: its own source text, extracted and run in a vm ----
function old_adapter() {
  const text = fs.readFileSync(V5_FILE, "utf8");
  const cut = (from, to) => { const a = text.indexOf(from), b = text.indexOf(to, a); if (a < 0 || b < 0) throw new Error("cannot cut " + from); return text.slice(a, b); };
  const cfg = cut("  const CFG = {", "\n  };\n") + "\n  };\n";
  const upg = cut("  const upg_max = (name) =>", "  const upg_min_chance");
  const scoring = cut("  const SLOT_OF_TYPE = {", "  // </gear-scoring>");
  const ctx = { G };
  vm.createContext(ctx);
  vm.runInContext(cfg + upg + scoring + "\n", ctx);
  vm.runInContext("var __saved = {};", ctx);
  vm.runInContext("function __cfg() { return CFG; } function __ps(it) { return potential_score(it); } function __sc(who) { const s = support_cfg(who); return s && s.scroll && G.items[s.scroll] ? G.items[s.scroll].stat : 'dex'; }", ctx);
  return {
    set_state(st) { ctx.S = { gears: st.gears, ranger_gear: st.lead_gear }; },
    set_flags(f) { vm.runInContext("{ for (const k in __saved) CFG[k] = __saved[k]; __saved = {}; const __f = " + JSON.stringify(f) + "; for (const k in __f) { __saved[k] = CFG[k]; CFG[k] = __f[k]; } }", ctx); },
    scroll_stat(who) { return ctx.__sc(who); },
    score(n, lv, o) { return ctx.gear_score(n, lv, o); },
    potential(it) { return ctx.__ps(it); },
  };
}
// ---- adapter for the NEW lib scorer ----
function lib_adapter() {
  const ctx = { game_log() {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(LIB_FILE, "utf8"), ctx, { filename: path.basename(LIB_FILE) });
  const old_text = fs.readFileSync(V5_FILE, "utf8");
  // the config is the Merchant's own CFG object (taken from the same source the golden file was made from)
  const a = old_text.indexOf("  const CFG = {"), b = old_text.indexOf("\n  };\n", a);
  const cfg_ctx = {};
  vm.createContext(cfg_ctx);
  vm.runInContext(old_text.slice(a, b) + "\n  };\n;this.CFG = CFG;", cfg_ctx);
  const CFG = cfg_ctx.CFG;
  const state = { gears: {}, lead_gear: null };
  const saved = {};
  const env = { G, CFG, slot_of_type: SLOT_OF_TYPE, get gears() { return state.gears; }, get lead_gear() { return state.lead_gear; } };
  const sc = ctx.AL.gear.scorers(env);
  const upg_max = (name) => Math.max(CFG.UPGRADE_MAX_LEVEL, (CFG.UPGRADE_MAX_LEVEL_BY_ITEM && CFG.UPGRADE_MAX_LEVEL_BY_ITEM[name]) || 0);
  return {
    set_state(st) { state.gears = st.gears; state.lead_gear = st.lead_gear; },
    set_flags(f) { for (const k in saved) CFG[k] = saved[k]; for (const k in saved) delete saved[k]; for (const k in f) { saved[k] = CFG[k]; CFG[k] = f[k]; } },
    scroll_stat(who) { const s = CFG.SUPPORT_GEAR && CFG.SUPPORT_GEAR[who]; return s && s.scroll && G.items[s.scroll] ? G.items[s.scroll].stat : "dex"; },
    score(n, lv, o) { return sc.for_who(o.who).score(n, lv, o); },
    potential(it) { return sc.ranger.potential(it, upg_max); },
  };
}
const save = (t) => fs.writeFileSync(GOLDEN_FILE, zlib.gzipSync(JSON.stringify({ meta: { source: process.argv[2] || "", max_level: GOLDEN_MAX_LEVEL, items: ITEMS, made: new Date().toISOString() }, values: t })));
const mode = process.argv[2];
if (mode === "--from-v5" || mode === "--from-lib") {
  const t = table(mode === "--from-v5" ? old_adapter() : lib_adapter());
  save(t);
  const n = Object.values(t).reduce((a, v) => a + v.length, 0);
  console.log("wrote " + path.relative(ROOT, GOLDEN_FILE) + ": " + Object.keys(t).length + " tables, " + n + " values, " + ITEMS.length + " items");
  process.exit(0);
}
const golden = JSON.parse(zlib.gunzipSync(fs.readFileSync(GOLDEN_FILE)));
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + label); };
check(golden.meta.items.join() === ITEMS.join(), "same wearable item list as the golden file (" + ITEMS.length + " items)");
check(golden.meta.max_level === GOLDEN_MAX_LEVEL, "golden file covers levels 0.." + golden.meta.max_level);
const got = table(lib_adapter());
let mism = 0, total = 0;
const names = ITEMS;
for (const key of Object.keys(golden.values)) {
  const g = golden.values[key], v = got[key];
  if (!v) { mism++; console.log("   missing table " + key); continue; }
  for (let i = 0; i < g.length; i++) {
    total++;
    if (!Object.is(g[i], v[i])) { mism++; if (mism <= 15) console.log("   " + key + " " + names[i] + ": golden " + g[i] + " lib " + v[i]); }
  }
}
check(mism === 0, "lib scorer equals the golden values: " + total + " values compared, " + mism + " different");
console.log(bad ? bad + " check(s) failed" : "golden gear scores match");
process.exit(bad ? 1 : 0);
