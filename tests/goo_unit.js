// AL.goo unit check: node tests/goo_unit.js (after node build/build.js)
const fs = require("fs"), vm = require("vm");
const timers = [];
const calls = { join: [], move: [], attack: [], sm: [] };
const ctx = {
  console, setTimeout, clearInterval, Promise, Date, JSON, Math, Object, Array, Number, String,
  setInterval: (f) => timers.push(f),
  character: { name: "Dexy", map: "main", x: 0, y: 0, hp: 1000, max_hp: 1000, mp: 500, range: 100, rip: false },
  parent: { S: {}, entities: {}, party_list: ["Dexy"] },
  server: { status: { schedule: [] } },
  get: () => "", set() {},
  join: (m) => { calls.join.push(m); return Promise.resolve({ ok: true }); },
  move: (x, y) => calls.move.push([x, y]), attack: (e) => calls.attack.push(e.id), can_attack: () => true,
  smart_move: () => { calls.sm.push(1); return Promise.resolve({}); },
};
ctx.globalThis = ctx; vm.createContext(ctx);
const mod = { exports: {} };
vm.runInContext("(function(exports,module){" + fs.readFileSync("dist/AL Libs v6.js", "utf8") + "\n})", ctx)(mod.exports, mod);
const GOO = mod.exports.goo;
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const T0 = Date.parse("2026-11-23T12:00:00Z");
ok(GOO.state_of([{ event: "goobrawl", at: T0, status: "scheduled" }], {}, T0 - 60000).live, "schedule: 60 s before the start counts as live");
ok(!GOO.state_of([{ event: "goobrawl", at: T0, status: "scheduled" }], {}, T0 - 600000).live, "schedule: 10 min before is not live");
ok(GOO.state_of([{ event: "goobrawl", at: new Date(T0).toISOString() }], {}, T0 + 5 * 60000).live, "schedule: ISO time, 5 min after the start");
ok(!GOO.state_of([{ event: "goobrawl", at: T0, status: "done" }], {}, T0 + 60000).live, "schedule: a finished entry is not live");
ok(GOO.state_of({ a: { event: "goobrawl", at: T0 / 1000 } }, {}, T0).live, "schedule as an object, at in seconds");
ok(GOO.state_of([], { goobrawl: { live: true } }, T0).live, "parent.S.goobrawl live");
ok(!GOO.state_of([{ event: "gigacrab", at: T0 }], {}, T0).live, "another event is ignored");
const mk = (mtype, dist, hp) => ({ mtype, dist, hp: hp === undefined ? 100 : hp });
ok(GOO.pick_target([mk("goo", 10), mk("bgoo", 300), mk("rgoo", 900)]).mtype === "rgoo", "Rainbow Goo first, even far away");
ok(GOO.pick_target([mk("goo", 10), mk("bgoo", 300), mk("bgoo", 100)]).dist === 100, "then the nearest Brawl Goo");
ok(GOO.pick_target([mk("goo", 50, 0)]) === null, "dead monsters are skipped");
// the module itself
const said = [];
GOO.start({ say: (m) => said.push(m), alive: () => true, cls: "ranger" });
const [join_tick, fight_tick] = timers;
ctx.server.status.schedule = [{ event: "goobrawl", at: Date.now() + 30000, status: "scheduled" }];
join_tick();
ok(calls.join.length === 1 && calls.join[0] === "goobrawl", "join('goobrawl') is called when the event is about to start");
join_tick();
ok(calls.join.length === 1, "but not again within 20 s");
ctx.character.map = "goobrawl";
ok(ctx.smart_move() instanceof Promise && calls.sm.length === 0, "smart_move does nothing inside the event map");
ctx.character.map = "main";
ctx.smart_move();
ok(calls.sm.length === 1, "smart_move works again outside");
ctx.character.map = "goobrawl"; ctx.character.x = 0; ctx.character.y = 0;
ctx.parent.entities = { a: { id: "a", type: "monster", mtype: "goo", x: 50, y: 0, hp: 100 }, b: { id: "b", type: "monster", mtype: "rgoo", x: 300, y: 0, hp: 1e6 } };
fight_tick();
ok(calls.move.length === 1 && calls.move[0][0] > 150 && calls.attack.length === 0, "walks towards the Rainbow Goo (out of range), no attack yet");
ctx.character.x = 250;
fight_tick();
ok(calls.attack[calls.attack.length - 1] === "b", "attacks the Rainbow Goo once in range");
// leaving: no monsters for 60 s inside -> the game's own leave is emitted, and no re-join for a while
const emitted = []; ctx.parent.socket = { emit: (m) => emitted.push(m) };
ctx.parent.entities = {}; ctx.character.map = "goobrawl";
fight_tick(); ok(emitted.length === 0, "no leave right after the last monster is gone");
const real_now = Date.now; Date.now = () => real_now() + 61000;
fight_tick(); ok(emitted[0] === "leave", "leaves the island after 60 s without monsters");
ctx.character.map = "main"; ctx.server.status.schedule = [{ event: "goobrawl", at: real_now(), status: "scheduled" }];
const before = calls.join.length; join_tick();
ok(calls.join.length === before, "does not join again right after leaving");
Date.now = real_now;
if (fails) { console.log("goo_unit FAILED " + fails); process.exit(1); }
console.log("goo_unit OK");
