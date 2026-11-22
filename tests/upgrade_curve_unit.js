// the upgrade curve against Sean's Basher tooltips (2026-11-22, +4..+12): node tests/upgrade_curve_unit.js after node build/build.js
const fs = require("fs"), vm = require("vm");
const ctx = { console, character: {}, setTimeout, Promise, Date, JSON, get: () => null, set() {} };
ctx.globalThis = ctx; vm.createContext(ctx);
const mod = { exports: {} };
vm.runInContext("(function(exports,module){" + fs.readFileSync("dist/AL Libs v6.js", "utf8") + "\n})", ctx)(mod.exports, mod);
const AL = mod.exports;
const items = JSON.parse(fs.readFileSync("data/items.json", "utf8")); const B = (items.items || items).basher;
const sc = new AL.gear.GearScorer({ G: { items: {}, sets: {} }, CFG: {}, env: {} });
const at = (lv, p) => sc.prop_at(B, lv, p);
// level: [attack, range, armor, speed, stun(rounded up on the tooltip)]
const seen = { 4: [71, 10, 36, 4, 3], 5: [80, 11, 40, 5, 3], 6: [89, 12, 44, 6, 4], 7: [100, 13, 49, 7, 4], 8: [114, 15, 55, 9, 5], 9: [132, 17, 63, 11, 6], 10: [159, 20, 75, 14, 7], 11: [170, 21, 80, 15, 8], 12: [181, 22, 85, 16, 9] };
let fails = 0;
for (const [lv, [a, r, ar, sp, st]] of Object.entries(seen)) {
  const got = [at(+lv, "attack"), at(+lv, "range"), at(+lv, "armor"), at(+lv, "speed"), at(+lv, "stun")].map((v, i) => (i === 4 ? Math.round(v + 0.0001) : Math.round(v)));
  const ok = got.join() === [a, r, ar, sp, st].join();
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + "Basher +" + lv + ": " + got.join(" / ") + (ok ? "" : " (tooltip " + [a, r, ar, sp, st].join(" / ") + ")"));
}
if (fails) process.exit(1);
console.log("upgrade_curve_unit OK");
