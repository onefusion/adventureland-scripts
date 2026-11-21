// Stage 3 guard: the CFG of every v6 script must equal the v5 CFG for every key both have (the config moved into AL.config, nothing may change),
// and the keys that exist only in one of them are listed so a change is always deliberate.
//   node tests/config_equiv.js            (run `node build/build.js` first: the lib is read from dist/)
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");
const lib_ctx = vm.createContext({ console, globalThis: {}, setInterval() {}, setTimeout() {}, Date, Math, JSON, Promise, Object, Array, Set, Map, Number, String, Symbol });
vm.runInContext(fs.readFileSync(path.join(ROOT, "dist/AL Libs v6.js"), "utf8"), lib_ctx);
const AL = vm.runInContext("AL", lib_ctx);
function cfg_of(file, tag) {
  const t = fs.readFileSync(file, "utf8");
  const a = t.indexOf("const CFG = {");
  let d = 0, i = t.indexOf("{", a);
  const s = i;
  for (; i < t.length; i++) { if (t[i] === "{") d++; else if (t[i] === "}") { d--; if (!d) break; } }
  return vm.runInNewContext("(" + t.slice(s, i + 1) + ")", tag ? { AL, C: AL.config.for_script(tag) } : {});
}
const PAIRS = [["AutoMerchant"], ["AutoRanger"], ["AutoWarrior"], ["AutoPriest"]];
const ALLOWED = JSON.parse(fs.readFileSync(path.join(__dirname, "golden/config_allowed_diffs.json"), "utf8")); // { "AutoRanger": { "KEY": "why" } }
// lists of names are compared as sets (v5 typed the same items in a different order in different files; every use is a membership test)
const norm = (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v.slice().sort() : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
let bad = 0;
for (const [n] of PAIRS) {
  const v5 = cfg_of(path.join(ROOT, n + " v5.js"), null), v6 = cfg_of(path.join(ROOT, "dist", n + " v6.js"), n.replace("Auto", ""));
  const allowed = ALLOWED[n] || {};
  const changed = Object.keys(v5).filter((k) => k in v6 && !same(v5[k], v6[k]));
  const only5 = Object.keys(v5).filter((k) => !(k in v6)), only6 = Object.keys(v6).filter((k) => !(k in v5));
  const unexpected = changed.concat(only5, only6).filter((k) => !(k in allowed));
  const stale = Object.keys(allowed).filter((k) => !changed.includes(k) && !only5.includes(k) && !only6.includes(k));
  if (unexpected.length || stale.length) { bad++; console.log("FAIL " + n + ": unexpected differences from v5: " + JSON.stringify(unexpected) + (stale.length ? " | allowed but no longer different: " + JSON.stringify(stale) : "")); for (const k of unexpected.filter((k) => changed.includes(k))) console.log("   " + k + "\n     v5: " + JSON.stringify(v5[k]).slice(0, 200) + "\n     v6: " + JSON.stringify(v6[k]).slice(0, 200)); }
  else console.log("PASS " + n + ": " + Object.keys(v5).length + " v5 keys; " + Object.keys(allowed).length + " deliberate differences");
}
process.exit(bad ? 1 : 0);
