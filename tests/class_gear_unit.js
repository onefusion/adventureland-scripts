// class-restricted gear: node tests/class_gear_unit.js (after node build/build.js)
const fs = require("fs"), vm = require("vm");
const unequipped = [];
const ctx = {
  console, setTimeout, setInterval, clearInterval, Promise, Date, JSON, Math, Object, Array,
  character: { ctype: "ranger", slots: { chest: { name: "mwarmor", level: 6 }, helmet: { name: "xmashat", level: 1 } } },
  G: { items: { mwarmor: { class: ["warrior"], type: "chest" }, xmashat: { type: "helmet" } } },
  unequip: (s) => { unequipped.push(s); return Promise.resolve({}); },
  get: () => null, set() {},
};
ctx.globalThis = ctx; vm.createContext(ctx);
const mod = { exports: {} };
vm.runInContext("(function(exports,module){" + fs.readFileSync("dist/AL Libs v6.js", "utf8") + "\n})", ctx)(mod.exports, mod);
const AL = mod.exports;
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const said = [];
AL.runtime.strip_never_wear((m) => said.push(m));
ok(unequipped.length === 0, "a worn wrong-class piece is NOT taken off by the character (the slot must never be empty; the Merchant swaps a proper one in)");
ctx.character.ctype = "warrior"; unequipped.length = 0;
AL.runtime.strip_never_wear(() => {});
ok(unequipped.length === 0, "the Warrior keeps it");
if (fails) { console.log("class_gear_unit FAILED " + fails); process.exit(1); }
console.log("class_gear_unit OK");
