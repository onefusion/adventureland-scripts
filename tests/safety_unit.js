// AL.safety unit check: node tests/safety_unit.js (after node build/build.js)
const fs = require("fs"), vm = require("vm");
const ctx = { console, setTimeout, clearInterval, Promise, Date, JSON, Math, Object, Array, Number, String, setInterval() {}, character: { name: "Dexy" }, parent: { entities: {} }, game_log() {} };
ctx.globalThis = ctx; vm.createContext(ctx);
const mod = { exports: {} };
vm.runInContext("(function(exports,module){" + fs.readFileSync("dist/AL Libs v6.js", "utf8") + "\n})", ctx)(mod.exports, mod);
const S = mod.exports.safety;
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const G = { monsters: { poisio: { damage_type: "physical" }, porcupine: { damage_type: "physical" }, pinkgoblin: { damage_type: "magical" }, odd: { damage_type: "pure" } } };
const mon = (id, mtype, target, hp) => ({ id, type: "monster", mtype, target, hp: hp === undefined ? 100 : hp });
const ents = (arr) => { const o = {}; for (const e of arr) o[e.id] = e; return o; };
const ranger = { name: "Dexy", courage: 2, mcourage: 2 };

// ---- pressure
let p = S.pressure(ents([mon(1, "poisio", "Dexy"), mon(2, "poisio", "Dexy")]), "Dexy", G, ranger);
ok(p.n_phys === 2 && !p.over && p.excess === 0 && p.dmg_est === 1, "2 physical monsters on a courage-2 Ranger: no fear");
p = S.pressure(ents([1, 2, 3].map((i) => mon(i, "poisio", "Dexy"))), "Dexy", G, ranger);
ok(p.over && p.excess === 1 && p.dmg_est === 0.6, "3 on him: 1 over, damage ~x0.6");
p = S.pressure(ents([1, 2, 3, 4].map((i) => mon(i, "porcupine", "Dexy"))), "Dexy", G, ranger);
ok(p.excess === 2 && p.dmg_est === 0.4, "4 on him: ~x0.4");
p = S.pressure(ents([1, 2, 3, 4, 5, 6].map((i) => mon(i, "porcupine", "Dexy"))), "Dexy", G, ranger);
ok(p.excess === 4 && p.dmg_est === 0.2, "6 on him: ~x0.2 (3 or more over)");
p = S.pressure(ents([mon(1, "poisio", "Other"), mon(2, "poisio", "Dexy")]), "Dexy", G, ranger);
ok(p.n_phys === 1, "only monsters that target him count");
const dead = mon(3, "poisio", "Dexy"); dead.dead = true; const inv = mon(4, "poisio", "Dexy"); inv.visible = false; const rip = mon(5, "poisio", "Dexy"); rip.rip = true;
p = S.pressure(ents([dead, inv, rip, mon(6, "poisio", "Dexy")]), "Dexy", G, ranger);
ok(p.n_phys === 1, "dead / hidden / rip monsters do not count");
p = S.pressure(ents([mon(1, "pinkgoblin", "Dexy"), mon(2, "pinkgoblin", "Dexy"), mon(3, "pinkgoblin", "Dexy"), mon(4, "odd", "Dexy")]), "Dexy", G, ranger);
ok(p.n_mag === 3 && p.n_phys === 0 && p.over && p.excess === 1, "magical ones count against magical courage; pure ones do not count");
p = S.pressure(ents([1, 2, 3, 4, 5].map((i) => mon(i, "poisio", "Wexy"))), "Wexy", G, { courage: 10, mcourage: 2 });
ok(!p.over, "a Warrior (courage 10) is fine with 5 on him");
p = S.pressure(ents([1, 2, 3].map((i) => mon(i, "poisio", "Dexy"))), "Dexy", G, { name: "Dexy" });
ok(p.courage === 2 && p.over, "no courage value on the character: default 2");
p = S.pressure(ents([mon(1, "poisio", "Dexy")]), "Dexy", G, { courage: 2, fear: 1 });
ok(p.game_fear === 1, "the game's own fear value is carried along for comparison");

// ---- multishot gate, relief target
ok(!S.block_multishot(S.pressure(ents([mon(1, "poisio", "Dexy")]), "Dexy", G, ranger), 2), "1 on him: multishot allowed");
ok(S.block_multishot(S.pressure(ents([mon(1, "poisio", "Dexy"), mon(2, "poisio", "Dexy")]), "Dexy", G, ranger), 2), "2 on him (at the limit): multishot blocked");
ok(S.block_multishot(S.pressure(ents([1, 2, 3].map((i) => mon(i, "poisio", "Dexy"))), "Dexy", G, ranger), 9), "feared: blocked whatever the limit");
ok(S.relief_target([mon(1, "poisio", "D", 500), mon(2, "poisio", "D", 80), mon(3, "poisio", "D", 300)]).id === 2, "relief: the lowest-HP monster on me");
ok(S.relief_target([]) === null, "relief: nobody on me, no target");

// ---- fear_note
const st = {};
const three = S.pressure(ents([1, 2, 3].map((i) => mon(i, "poisio", "Dexy"))), "Dexy", G, ranger);
const four = S.pressure(ents([1, 2, 3, 4].map((i) => mon(i, "poisio", "Dexy"))), "Dexy", G, ranger);
const calm = S.pressure(ents([]), "Dexy", G, ranger);
let out = S.fear_note(st, three, 1000);
ok(out.length === 1 && /^FEAR: 3 monsters on Dexy/.test(out[0]), "fear starts: one line");
ok(S.fear_note(st, four, 5000).length === 0, "still feared, not yet 30 s: no new line");
out = S.fear_note(st, four, 40000);
ok(out.length === 1 && /^FEAR \(still, 39 s\)/.test(out[0]), "30 s later: a 'still' line");
ok(S.fear_note(st, calm, 41000).length === 0, "calm for 1 s: not over yet (hysteresis)");
out = S.fear_note(st, calm, 45000);
ok(out.length === 1 && /FEAR over after 39 s; worst: 4 monsters/.test(out[0]), "calm for 3 s: the end line with the worst count: " + out[0]);
ok(S.fear_note(st, calm, 50000).length === 0, "and nothing more afterwards");

// ---- post-mortem
const snaps = {};
S.snap_push(snaps, "Wexy", { t: 1000, hp: 1, on: 1, types: "porcupine x1" });
S.snap_push(snaps, "Wexy", { t: 4000, hp: 0.6, on: 5, types: "porcupine x5" });
S.snap_push(snaps, "Wexy", { t: 7000, hp: 0.05, on: 5, types: "porcupine x5" });
const pm = S.post_mortem(snaps, "Wexy", { where: "main 10,20", ctx: "farm", farm: "porcupine" }, 8000);
ok(/^DEAD: Wexy at main 10,20 \[farm: porcupine\]\. Last 6 s: HP 100% -> 5%, up to 5 monsters on him \(porcupine x5\)/.test(pm), "post-mortem line: " + pm);
ok(/No snapshot/.test(S.post_mortem({}, "Hexy", {}, 8000)), "post-mortem without snapshots says so");
for (let i = 0; i < 20; i++) S.snap_push(snaps, "Wexy", { t: 8000 + i, hp: 1, on: 0, types: "" }, 8);
ok(snaps.Wexy.length === 8, "the snapshot ring keeps 8");

// ---- record, breaker, safest
const T = 10 * 3600000;
let r = S.record([], { t: T, name: "Wexy", ctx: "farm", farm: "porcupine" }, 30);
ok(r.added && r.log.length === 1, "a death is recorded");
r = S.record(r.log, { t: T + 5000, name: "Wexy", ctx: "farm", farm: "porcupine" }, 30);
ok(!r.added && r.log.length === 1, "the same death noted again within a minute is ignored");
r = S.record(r.log, { t: T + 5000, name: "Hexy", ctx: "farm", farm: "porcupine" }, 30);
ok(r.added && r.log.length === 2, "another character's death counts");
let log = r.log;
let b = S.breaker(log, T + 10000, { max_incidents: 3 });
ok(!b.tripped && b.incidents === 1 && b.deaths === 2, "a wipe (2 deaths seconds apart) is ONE incident");
log = S.record(log, { t: T + 20 * 60000, name: "Dexy", ctx: "farm", farm: "croc" }, 30).log;
log = S.record(log, { t: T + 40 * 60000, name: "Wexy", ctx: "farm", farm: "croc" }, 30).log;
b = S.breaker(log, T + 41 * 60000, { max_incidents: 3, window_ms: 3600000 });
ok(b.tripped && b.incidents === 3, "3 incidents inside the hour trip the breaker");
b = S.breaker(log, T + 90 * 60000, { max_incidents: 3, window_ms: 3600000 });
ok(!b.tripped && b.incidents === 1, "the old ones fall out of the window (only the 40-min death is inside)");
b = S.breaker(log, T + 41 * 60000, { max_incidents: 3, since: T + 30 * 60000 });
ok(!b.tripped && b.incidents === 1, "after a trip only newer deaths count (since)");
const boss = S.record(log, { t: T + 41 * 60000, name: "Dexy", ctx: "boss", farm: "", counted: false }, 30).log;
ok(S.breaker(boss, T + 42 * 60000, { max_incidents: 4 }).incidents === 3, "a boss-fight death (counted: false) is logged but not counted");
const rot = ["poisio", "armadillo", "croc", "porcupine", "arcticbee"];
ok(S.safest(rot, log, T + 41 * 60000, 3600000) === "poisio", "safest farm: fewest deaths, ties in rotation order (poisio, 0 deaths)");
ok(S.safest(rot, log, T + 41 * 60000, 3600000, (t) => t === "poisio") === "armadillo", "safest farm skips excluded monsters");
console.log(fails ? "safety_unit: " + fails + " FAILED" : "safety_unit OK");
process.exit(fails ? 1 : 0);
