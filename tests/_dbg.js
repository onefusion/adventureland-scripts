// Smoke tests for AutoMerchant v4 / AutoRanger v4 / AL Lib v2 on a mock Adventure Land world with a VIRTUAL clock
// (minutes of game time run in milliseconds). Run:  node tests/v4_smoke.js [scenario-name] [-v]
// This is NOT the real game: it checks the protocol and the branches of the ladder / queue, not game-API behaviour.
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const DIR = path.resolve(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const VERBOSE = process.argv.includes("-v");

function make_world() {
  const world = {
    chars: {},
    store: {},
    logs: [],
    bank: { gold: 10000000, items0: [], items1: [], items2: [] },
    bank_full: false,
    clock: null,
    G: {
      items: {
        hpot0: { g: 50, s: true }, mpot0: { g: 50, s: true }, hpot1: { g: 100, s: true }, mpot1: { g: 100, s: true },
        wcap: { g: 100 }, wshoes: { g: 100 }, stinger: { g: 20, s: true }, cscroll0: { g: 6400, s: true }, cscroll1: { g: 240000, s: true },
        mistletoe: { g: 20000, e: 1, quest: "mistletoe", s: 9999, type: "gem" }, candycane: { g: 24000, e: 1, quest: "candycane", s: 9999, type: "gem" }, ornament: { g: 3000, e: 20, quest: "ornament", s: 9999, type: "quest" },
        hotchocolate: { g: 6000, s: 9999, type: "elixir" }, offeringp: { g: 480000 }, candycanesword: { g: 72000, type: "weapon", wtype: "short_sword", attack: 21 },
        ringsj: { g: 5000, type: "ring", compound: { dex: 1 }, grades: [3, 5, 6, 7] }, lostearring: { g: 300, s: true }, scroll0: { g: 1000, s: true }, dexscroll: { g: 1000, s: true },
        dexcap: { g: 500, type: "helmet", armor: 5, stat: 3, upgrade: { armor: 1 } }, plaincap: { g: 500, type: "helmet", armor: 5, upgrade: { armor: 1 } },
      },
      maps: { winter_inn: { spawns: [[0, 0]] }, main: { spawns: [[0, 0]] }, winterland: { spawns: [[0, 0]] }, bank: { spawns: [[0, 0]] } },
      monsters: {}, skills: {},
    },
  };
  const c = { t: 1e9, q: [], seq: 0 };
  c.set = (fn, ms) => { const id = ++c.seq; c.q.push({ id, t: c.t + Math.max(0, ms | 0), fn }); return id; };
  c.every = (fn, ms) => { const id = ++c.seq; const rec = { id, t: c.t + ms, fn: () => { rec.t = c.t + ms; c.q.push(rec); fn(); } }; c.q.push(rec); return id; };
  c.clear = (id) => { c.q = c.q.filter((x) => x.id !== id); };
  const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
  c.run = async (secs) => {
    const until = c.t + secs * 1000;
    for (;;) {
      await tick();
      let best = -1;
      for (let i = 0; i < c.q.length; i++) if (c.q[i].t <= until && (best < 0 || c.q[i].t < c.q[best].t || (c.q[i].t === c.q[best].t && c.q[i].id < c.q[best].id))) best = i;
      if (best < 0) { c.t = until; await tick(); return; }
      const [ev] = c.q.splice(best, 1);
      c.t = Math.max(c.t, ev.t);
      try { ev.fn(); } catch (e) { world.logs.push({ t: 0, who: "HARNESS", msg: "timer error: " + e.message }); }
    }
  };
  world.clock = c;
  world.t0 = c.t;
  world.log = (who, msg) => { const l = { t: Math.round((c.t - world.t0) / 100) / 10, who, msg: String(msg) }; world.logs.push(l); if (VERBOSE) console.log(String(l.t).padStart(6), who.padEnd(9), l.msg); };
  world.after = (ms, fn) => new Promise((res) => c.set(() => res(fn()), ms));
  return world;
}

function add_item(ch, name, q, level) {
  const def = {}; // stackables merge
  const st = q > 1 || ["hpot0", "hpot1", "mpot0", "mpot1", "cscroll0", "stinger"].includes(name);
  if (st) { const it = ch.items.find((x) => x && x.name === name); if (it) { it.q = (it.q || 1) + q; return; } }
  const i = ch.items.findIndex((x) => !x);
  if (i < 0) throw new Error("bag full");
  ch.items[i] = st ? { name, q } : { name, level: level || 0 };
}
function take_item(ch, i, q) {
  const it = ch.items[i]; if (!it) return null;
  const n = Math.min(q || 1, it.q || 1);
  const out = { name: it.name, q: n, level: it.level };
  if ((it.q || 1) > n) it.q -= n; else ch.items[i] = null;
  return out;
}

// kind: "ranger" | "merchant" run a script; "fake" is a scripted stand-in the scenario drives by hand
function make_char(world, name, o, script, overrides) {
  const ch = Object.assign({ name, map: "main", x: 0, y: 0, hp: 1000, max_hp: 1000, mp: 500, max_mp: 500, gold: 10000, items: [], isize: 42, slots: {}, ctype: "ranger", rip: false, q: {}, level: 80, attack: 100, frequency: 1, speed: 50, s: {}, stand: false, moving: false, ping: 50, online: true, _h: {}, _mv: 0, inbox: [] }, o || {});
  while (ch.items.length < ch.isize) ch.items.push(null);
  Object.defineProperty(ch, "bank", { get: () => (ch.map === "bank" ? world.bank : undefined) });
  ch.on = (ev, fn) => { (ch._h[ev] = ch._h[ev] || []).push(fn); };
  world.chars[name] = ch;
  const smart = { moving: false };
  const sb = { character: ch, smart, G: world.G, console, game: { on() {} }, parent: { entities: {}, calculate_difficulty: () => 0, add_chat() {}, next_skill: {} } };
  sb.game_log = (m) => world.log(name, m);
  sb.set_message = () => {}; ch.buttons = {}; sb.add_top_button = (id, label, fn) => { ch.buttons[id] = fn; };
  sb.get = (k) => world.store[name + ":" + k]; sb.set = (k, v) => { world.store[name + ":" + k] = v; };
  sb.setTimeout = (fn, ms) => world.clock.set(fn, ms); sb.setInterval = (fn, ms) => world.clock.every(fn, ms);
  sb.clearInterval = (id) => world.clock.clear(id); sb.clearTimeout = sb.clearInterval;
  sb.Date = { now: () => world.clock.t };
  sb.quantity = (n) => ch.items.reduce((s, it) => s + (it && it.name === n ? it.q || 1 : 0), 0);
  sb.locate_item = (n) => ch.items.findIndex((it) => it && it.name === n);
  sb.is_moving = () => !!ch.moving;
  const move = (dest) => {
    let map = ch.map, x = ch.x, y = ch.y;
    if (typeof dest === "string") { map = dest; x = 0; y = 0; } else { map = dest.map || ch.map; x = dest.x; y = dest.y; }
    const dist = map === ch.map ? Math.hypot(x - ch.x, y - ch.y) : 1500;
    const token = ++ch._mv; smart.moving = true; ch.moving = true; ch._stop = false;
    return new Promise((res) => world.clock.set(() => {
      if (ch._mv !== token || ch._stop || !smart.moving) { res({ failed: true, reason: "interrupted" }); return; }
      ch.map = map; ch.x = x; ch.y = y; ch.moving = false; smart.moving = false; res({ success: true });
    }, (dist / ch.speed) * 1000));
  };
  ch.moves = 0;
  sb.smart_move = (d) => { ch.moves++; return ch.no_path ? Promise.resolve({ failed: true, reason: "no_path" }) : move(d); }; sb.xmove = (x, y) => move({ x, y });
  sb.stop = () => { ch._stop = true; ch.moving = false; };
  sb.town = () => world.after(3000, () => { (ch.town_threat = ch.town_threat || []).push(Math.min(...Object.values(sb.parent.entities).map((e) => Math.hypot(e.x - ch.x, e.y - ch.y)), 1e9)); if (ch.town_broken) return {}; const sp = world.G.maps[ch.map].spawns[0]; ch.x = sp[0]; ch.y = sp[1]; return {}; });
  sb.get_player = (n) => { const o2 = world.chars[n]; return o2 && o2.map === ch.map && Math.hypot(o2.x - ch.x, o2.y - ch.y) < 500 ? o2 : null; };
  sb.send_cm = (to, msg) => {
    const t = world.chars[to];
    if (!t || !t.online) return Promise.resolve({ receivers: [] });
    const copy = JSON.parse(JSON.stringify(msg));
    world.clock.set(() => { t.inbox.push({ from: name, msg: copy }); for (const h of t._h.cm || []) h({ name, message: copy }); }, 100);
    return Promise.resolve({ receivers: [to] });
  };
  const give = (to, i, q) => { const t = world.chars[to]; const it = take_item(ch, i, q); if (it) add_item(t, it.name, it.q, it.level); };
  sb.send_item = (to, i, q) => { const t = world.chars[to]; if (!t || t.map !== ch.map || Math.hypot(t.x - ch.x, t.y - ch.y) > 400) return Promise.reject({ reason: "too_far" }); give(to, i, q); return Promise.resolve({}); };
  sb.send_gold = (to, a) => { ch.gold -= a; world.chars[to].gold += a; return Promise.resolve({}); };
  sb.buy_with_gold = (n, q) => { const c = (world.G.items[n].g) * q; if (ch.gold < c) return Promise.reject({ reason: "no gold" }); ch.gold -= c; add_item(ch, n, q); return Promise.resolve({}); };
  sb.sell = (i, q) => { const it = take_item(ch, i, q); if (it) ch.gold += Math.floor(world.G.items[it.name].g * 0.4 * it.q); return Promise.resolve({}); };
  sb.destroy = (i) => { ch.items[i] = null; return Promise.resolve({}); };
  sb.equip = (i, slot) => { const it = ch.items[i]; if (!it) return Promise.resolve({}); if (slot) { const old = ch.slots[slot]; ch.slots[slot] = { name: it.name, level: it.level || 0, stat_type: it.stat_type }; ch.items[i] = old && old.name ? { name: old.name, level: old.level || 0 } : null; } else take_item(ch, i, 1); return Promise.resolve({}); };
  sb.unequip = (slot) => { delete ch.slots[slot]; return Promise.resolve({}); };
  sb.is_on_cooldown = () => false; sb.use_skill = () => Promise.resolve({}); sb.attack = () => Promise.resolve({});
  sb.loot = () => {}; sb.get_target = () => null; sb.change_target = () => {}; sb.is_in_range = () => ch.in_range !== false; sb.reduce_cooldown = () => {};
  sb.respawn = () => Promise.resolve({});
  sb.wait_for = (cond, ms) => new Promise((res, rej) => { const t0 = world.clock.t; const poll = () => { let ok = false; try { ok = cond(); } catch (e) {} if (ok) return res(true); if (world.clock.t - t0 >= ms) return rej({ reason: "timed out" }); world.clock.set(poll, 100); }; poll(); });
  const NPC = { fancypots: { map: "main", x: -60, y: -100 }, basics: { map: "main", x: -89, y: -165 }, scrolls: { map: "main", x: -150, y: -60 }, newupgrade: { map: "main", x: -140, y: -90 }, monsterhunter: { map: "main", x: 126, y: -413 }, ornaments: { map: "winterland", x: -137, y: -193 }, mistletoe: { map: "winter_inn", x: 94, y: -181 }, santa: { map: "winterland", x: 1242, y: -1631 } };
  sb.find_npc = (n) => NPC[n] || null;
  sb.open_stand = () => { ch.stand = true; return Promise.resolve({}); }; sb.close_stand = () => { ch.stand = false; return Promise.resolve({}); };
  sb.trade = (i, slot, price, q) => { const it = take_item(ch, i, q); ch.slots["trade" + slot] = { name: it.name, q: it.q }; return Promise.resolve({}); };
  sb.bank_store = (i) => { if (world.bank_full) return Promise.reject({ reason: "bank full" }); const it = ch.items[i]; ch.items[i] = null; const arr = world.bank.items0; const f = arr.findIndex((x) => !x); if (f >= 0) arr[f] = it; else arr.push(it); return Promise.resolve({}); };
  sb.bank_retrieve = (pack, i) => { const it = world.bank[pack][i]; world.bank[pack][i] = null; const j = ch.items.findIndex((x) => !x); ch.items[j] = it; return Promise.resolve({}); };
  sb.bank_withdraw = (a) => { world.bank.gold -= a; ch.gold += a; return Promise.resolve({}); };
  sb.bank_deposit = (a) => { world.bank.gold += a; ch.gold -= a; return Promise.resolve({}); };
  sb.compound = (a, b, c, si, off, only) => {
    if (only) return Promise.resolve({ chance: off === null || off === undefined ? 0.9 : 0.95, grace: 0 });
    return world.after(3000, () => { const lv = (ch.items[a].level || 0) + 1; const nm = ch.items[a].name; ch.items[a] = ch.items[b] = ch.items[c] = null; take_item(ch, si, 1); add_item(ch, nm, 1, lv); return {}; });
  };
  sb.upgrade = (a, si, off, only) => {
    const sc = ch.items[si]; if (only) return Promise.resolve({ chance: 0.9, grace: 0 });
    return world.after(2000, () => { const it = ch.items[a]; if (sc.name === "dexscroll") it.stat_type = "dex"; else it.level = (it.level || 0) + 1; take_item(ch, si, 1); return {}; });
  };
  ch.exchanges = [];
  sb.exchange = (i) => {
    const it = ch.items[i]; const e = world.G.items[it.name].e;
    if (it.q < e) return Promise.reject({ reason: "not_enough" });
    ch.exchanges.push({ name: it.name, x: ch.x, y: ch.y, map: ch.map });
    ch.q.exchange = true;
    return world.after(2000, () => { ch.q.exchange = false; it.q -= e; if (!it.q) ch.items[i] = null; const rw = it.name === "ornament" ? "candycanesword" : "hotchocolate"; const f = ch.items.findIndex((x) => !x); ch.items[f] = rw === "hotchocolate" ? { name: rw, q: 1 } : { name: rw, level: 0 }; return { success: true, reward: { name: rw } }; });
  };
  sb.split = (i, n) => { const it = ch.items[i]; it.q -= n; const f = ch.items.findIndex((x) => !x); ch.items[f] = { name: it.name, q: n }; return Promise.resolve({}); };
  sb.load_code = (slot) => { if (slot === "lib") vm.runInContext(src("AL Lib v2.js"), ctx, { filename: "AL Lib v2.js" }); return Promise.resolve({}); };
  sb.start_character = (n) => { (world.started = world.started || []).push(n); }; sb.get_active_characters = () => { const o = {}; for (const k in world.chars) if (world.chars[k].online && world.chars[k].script_char) o[k] = true; return o; };
  world.party = world.party || {};
  sb.send_party_invite = (n) => { (world.invites = world.invites || []).push(name + ">" + n); const t = world.chars[n]; if (t && t.sb && t.sb.on_party_invite) t.sb.on_party_invite(name); return Promise.resolve({}); };
  sb.accept_party_invite = (leader) => { world.party[name] = leader; world.party[leader] = leader; return Promise.resolve({}); };
  sb.get_party = () => { const o = {}; for (const k in world.party) if (world.party[k] === (world.party[name] || name) || k === name) o[k] = {}; return o; };
  const ctx = vm.createContext(sb);
  ch.ctx = ctx; ch.sb = sb;
  if (script) {
    let text = src(script);
    for (const [re, to] of overrides || []) { if (!re.test(text)) throw new Error("override did not match: " + re); text = text.replace(re, to); }
    vm.runInContext(text, ctx, { filename: script });
  }
  return ch;
}

const RANGER_OVR = [[/PARTY_MEMBERS: \[[^\]]*\]/, "PARTY_MEMBERS: []"], [/HUNT_ENABLED: true/, "HUNT_ENABLED: false"], [/GEAR_SHARE: true/, "GEAR_SHARE: false"]];
const MERCH_OVR = [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"]];
const MERCH_OVR_COMPOUND = [[/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"]];

function merchant_char(world, o, ovr) {
  const m = make_char(world, "Goodies", Object.assign({ ctype: "merchant", x: -115, y: -5, gold: 20000 }, o), "AutoMerchant v4.js", ovr || MERCH_OVR);
  for (const [n, q] of [["hpot1", 300], ["mpot1", 300], ["hpot0", 100], ["mpot0", 100]]) add_item(m, n, q);
  return m;
}
function ranger_char(world, o, items) {
  const r = make_char(world, "SexyDexy", Object.assign({ x: 387, y: 1066 }, o), "AutoRanger v4.js", RANGER_OVR);
  for (const [n, q] of items || [["hpot1", 10], ["mpot1", 10]]) add_item(r, n, q);
  return r;
}
function party_ranger(world, name, o, items) {
  const ovr = RANGER_OVR.concat([[/PARTY_MEMBERS: \[[^\]]*\]/, 'PARTY_MEMBERS: ["Dexy2", "Dexy3"]']]);
  const r = make_char(world, name, Object.assign({ x: 387, y: 1066, attack: 440, frequency: 2 }, o), "AutoRanger v4.js", ovr);
  r.script_char = true;
  for (const [n, q] of items || [["hpot1", 250], ["mpot1", 250]]) add_item(r, n, q);
  return r;
}
const fake_ranger = (world, o) => make_char(world, "SexyDexy", Object.assign({ x: -110, y: 15 }, o));
function fake_merchant(world, o) { const f = make_char(world, "Goodies", Object.assign({ ctype: "merchant", x: -115, y: -5 }, o)); f.send = (to, msg) => f.sb.send_cm(to, msg); return f; }
const msgs = (ch, type) => ch.inbox.filter((m) => m.msg.type === type).map((m) => m.msg);
const logged = (world, who, re) => world.logs.some((l) => (!who || l.who === who) && re.test(l.msg));

// ----------------------------------------------------------------------------------------------------------------
const scenarios = {};
const T = (name, fn) => (scenarios[name] = fn);

// ---- MERCHANT with a scripted Ranger ----------------------------------------------------------------------------
T("M1 restock: ack with ETA, delivery, job_done", async (w) => {
  const m = merchant_char(w); const r = fake_ranger(w);
  await w.clock.run(5);
  r.sb.send_cm("Goodies", { type: "job_request", id: "r1", jtype: "restock", hp: 50, mp: 40, map: "main", x: -110, y: 15 });
  await w.clock.run(60);
  const st = msgs(r, "job_status"); const done = msgs(r, "job_done");
  return [[st.length > 0 && st[0].state === "QUEUED" && Number.isFinite(st[0].eta), "first status is the ack with an ETA"],
    [st.some((s) => s.state === "EN_ROUTE") && st.some((s) => s.state === "TRANSFERRING"), "went through EN_ROUTE / TRANSFERRING"],
    [done.length === 1 && done[0].hp === 50 && done[0].mp === 40, "job_done with the amounts"],
    [r.items.some((i) => i && i.name === "hpot1" && i.q === 50), "potions arrived"]];
});
T("M2 cancel race: Merchant turns back, cancel_ack, no failure sent", async (w) => {
  const m = merchant_char(w); const r = fake_ranger(w, { map: "winterland", x: 10, y: 10 });
  await w.clock.run(5);
  r.sb.send_cm("Goodies", { type: "job_request", id: "r2", jtype: "restock", hp: 50, mp: 0, map: "winterland", x: 10, y: 10 });
  await w.clock.run(15); // he is walking (cross-map walk takes ~30s)
  r.sb.send_cm("Goodies", { type: "job_cancel", id: "r2" });
  await w.clock.run(60);
  return [[msgs(r, "cancel_ack").length >= 1, "cancel_ack"], [m.map === "main", "turned back, is on main again"],
    [msgs(r, "job_failed").length === 0 && msgs(r, "job_done").length === 0, "no failure / done for a cancelled job"]];
});
T("M3 no-show: waits ~15s, job_failed(no_show), goes home", async (w) => {
  const m = merchant_char(w); const r = fake_ranger(w, { map: "winterland", x: 10, y: 10 });
  await w.clock.run(5);
  r.sb.send_cm("Goodies", { type: "job_request", id: "r3", jtype: "restock", hp: 50, mp: 0, map: "main", x: -110, y: 15 });
  await w.clock.run(60); // the fake Ranger is on another map: nobody at the meeting point
  const f = msgs(r, "job_failed");
  return [[f.length === 1 && f[0].reason === "no_show", "job_failed(no_show)"], [Math.hypot(m.x + 115, m.y + 5) < 60, "back at the stand"]];
});
T("M4 travel_to_main mid-walk: drops the trip, waits at the main safe spot", async (w) => {
  const m = merchant_char(w); const r = fake_ranger(w, { map: "winterland", x: 10, y: 10 });
  await w.clock.run(5);
  r.sb.send_cm("Goodies", { type: "job_request", id: "r4", jtype: "restock", hp: 50, mp: 0, map: "winterland", x: 10, y: 10 });
  await w.clock.run(12);
  r.sb.send_cm("Goodies", { type: "travel_to_main" });
  await w.clock.run(40);
  return [[msgs(r, "cancel_ack").length >= 1, "cancel_ack"], [m.map === "main" && Math.hypot(m.x + 110, m.y - 15) < 40, "waiting at the main safe spot"],
    [msgs(r, "job_failed").length === 0, "no no_show failure"]];
});
T("M5 compound round yields to a job at a boundary, then serves it", async (w) => {
  for (let i = 0; i < 6; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, {}, MERCH_OVR_COMPOUND); const r = fake_ranger(w);
  await w.clock.run(40);
  r.sb.send_cm("Goodies", { type: "job_request", id: "r5", jtype: "restock", hp: 30, mp: 0, map: "main", x: -110, y: 15 });
  await w.clock.run(120);
  const st = msgs(r, "job_status");
  return [[logged(w, "Goodies", /a job is waiting/), "round yielded"], [msgs(r, "job_done").length === 1, "job served"],
    [st.length > 0 && st[0].eta > 0, "ETA reported while busy: " + (st[0] && st[0].eta)]];
});
T("M6 hello from a restarted Ranger kills his ghost jobs", async (w) => {
  const m = merchant_char(w); const r = fake_ranger(w, { map: "winterland", x: 10, y: 10 });
  await w.clock.run(5);
  r.sb.send_cm("Goodies", { type: "job_request", id: "r6", jtype: "restock", hp: 50, mp: 0, map: "winterland", x: 10, y: 10 });
  await w.clock.run(10);
  r.sb.send_cm("Goodies", { type: "hello", jobs: [], want_reply: true }); // he reloaded and holds nothing
  await w.clock.run(40);
  return [[logged(w, "Goodies", /ghost job/), "ghost detected"], [m.map === "main", "turned back"], [msgs(r, "hello").length >= 1, "answered the hello"]];
});
T("M8 compound round takes 24 items = 8 triples from a pile of identical rings", async (w) => {
  for (let i = 0; i < 30; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, {}, MERCH_OVR_COMPOUND);
  await w.clock.run(150);
  const wins = w.logs.filter((l) => /COMPOUND SUCCESS/.test(l.msg)).length;
  return [[logged(w, "Goodies", /8 triple\(s\) = 24 item/), "planned 8 triples / 24 items"], [logged(w, "Goodies", /Bought 8x cscroll0/), "bought 8 scrolls in one go"], [wins >= 8, "compounded 8+ times: " + wins]];
});
T("M9 upgrade round applies a Dexterity scroll to a finished piece that beats what is worn", async (w) => {
  w.bank.items0.push({ name: "dexcap", level: 0 }); w.bank.items0.push({ name: "plaincap", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/FLIP_ENABLED: true/, "FLIP_ENABLED: false"], [/UPGRADE_EVERY_MS: \d+/, "UPGRADE_EVERY_MS: 1000"], [/UPGRADE_MAX_LEVEL: 5/, "UPGRADE_MAX_LEVEL: 1"]]);
  const r = fake_ranger(w);
  r.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "plaincap", level: 0 } }, map: "main", x: -110, y: 15 });
  const rep = setInterval(() => {}, 1e9); clearInterval(rep);
  w.clock.every(() => r.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "plaincap", level: 0 } }, map: "main", x: -110, y: 15 }), 60000);
  await w.clock.run(400);
  const dex = m.items.filter((i) => i && i.stat_type === "dex");
  return [[logged(w, "Goodies", /DEX SCROLL applied to dexcap/), "dex scroll applied to dexcap"], [dex.length === 1 && dex[0].name === "dexcap", "only dexcap carries the stat"], [!logged(w, "Goodies", /DEX SCROLL.*plaincap/), "no scroll wasted on an item without a stat value"]];
});
const UPG_FAST = [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/FLIP_ENABLED: true/, "FLIP_ENABLED: false"], [/UPGRADE_EVERY_MS: \d+/, "UPGRADE_EVERY_MS: 1000"], [/UPGRADE_MAX_LEVEL: 5/, "UPGRADE_MAX_LEVEL: 1"], [/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']];
const gear_rep = (ch, slots) => ch.sb.send_cm("Goodies", { type: "gear_report", slots, map: "main", x: -110, y: 15 });
T("G1 gear goes to the leader first when he would gain", async (w) => {
  w.bank.items0.push({ name: "plaincap", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, UPG_FAST);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  return [[logged(w, "Goodies", /Keeping plaincap \+1 for SexyDexy/), "kept for the leader"], [!logged(w, "Goodies", /Keeping plaincap.*for Dexy2/), "not for the follower"]];
});
T("G2 gear the leader does not need goes to a follower, who gets it at his next meeting", async (w) => {
  w.bank.items0.push({ name: "plaincap", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, UPG_FAST);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { helmet: { name: "dexcap", level: 3, stat_type: "dex" } }); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  const kept = logged(w, "Goodies", /Keeping plaincap \+1 for Dexy2/);
  F.sb.send_cm("Goodies", { type: "job_request", id: "f1", jtype: "restock", hp: 10, mp: 0, map: "main", x: -110, y: 25 });
  await w.clock.run(120);
  const give = msgs(F, "gear_give")[0];
  return [[kept, "kept for the follower"], [!logged(w, "Goodies", /Keeping plaincap \+1 for SexyDexy/), "not for the leader"], [give && give.slot === "helmet" && give.name === "plaincap", "follower told to equip it: " + JSON.stringify(give)], [F.items.some((i) => i && i.name === "plaincap"), "item handed to the follower"]];
});
T("G3 hand-me-down: leader equips, tells the Merchant what he replaced, passes it to the follower", async (w) => {
  const M = fake_merchant(w); const L = party_ranger(w, "SexyDexy", { x: 400, y: 1066, slots: { helmet: { name: "plaincap", level: 0 } } });
  const F = party_ranger(w, "Dexy2", { x: 420, y: 1066 });
  add_item(L, "dexcap", 1, 0);
  await w.clock.run(30);
  M.send("SexyDexy", { type: "gear_give", name: "dexcap", level: 0, slot: "helmet" });
  await w.clock.run(30);
  const replaced = msgs(M, "gear_replaced")[0];
  M.send("SexyDexy", { type: "gear_pass", to: "Dexy2", name: "plaincap", level: 0, slot: "helmet" });
  await w.clock.run(60);
  return [[L.slots.helmet && L.slots.helmet.name === "dexcap", "leader wears the new cap"], [replaced && replaced.name === "plaincap", "told the Merchant what he replaced: " + JSON.stringify(replaced)],
    [F.slots.helmet && F.slots.helmet.name === "plaincap", "follower wears the hand-me-down"], [!L.items.some((i) => i && i.name === "plaincap"), "leader no longer holds it"]];
});
T("G4 Merchant routes a hand-me-down to the follower who would gain", async (w) => {
  const m = merchant_char(w, { gold: 5000 }, [[/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']]);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  gear_rep(L, { helmet: { name: "dexcap", level: 0 } }); gear_rep(F, {});
  await w.clock.run(2);
  L.sb.send_cm("Goodies", { type: "gear_replaced", name: "plaincap", level: 0 });
  await w.clock.run(5);
  const pass = msgs(L, "gear_pass")[0];
  return [[pass && pass.to === "Dexy2" && pass.slot === "helmet" && pass.name === "plaincap", "told the leader to pass it on: " + JSON.stringify(pass)]];
});
T("E1 exchange run: right amounts at the right NPCs, rewards sorted, leftovers back in the bank", async (w) => {
  w.bank.items0.push({ name: "mistletoe", q: 30 }, { name: "candycane", q: 12 }, { name: "ornament", q: 45 });
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  await w.clock.run(900);
  const ex = (n) => m.exchanges.filter((e) => e.name === n);
  const inbank = (n) => w.bank.items0.filter((x) => x && x.name === n).reduce((a, x) => a + (x.q || 1), 0);
  const inbag = (n) => m.items.filter((x) => x && x.name === n).reduce((a, x) => a + (x.q || 1), 0);
  return [[ex("mistletoe").length === 10 && ex("candycane").length === 10 && ex("ornament").length === 1, "exchange calls: m" + ex("mistletoe").length + " c" + ex("candycane").length + " o" + ex("ornament").length],
    [ex("ornament")[0] && ex("ornament")[0].map === "winterland" && ex("mistletoe")[0].map === "winter_inn" && ex("candycane")[0].x > 1000, "each item exchanged at its own NPC"],
    [inbank("mistletoe") === 20 && inbank("candycane") === 2 && inbank("ornament") === 25, "leftovers back in the bank: " + inbank("mistletoe") + "/" + inbank("candycane") + "/" + inbank("ornament")],
    [inbag("mistletoe") + inbag("candycane") + inbag("ornament") === 0, "no event items left in the bag"],
    [inbank("hotchocolate") === 20, "useful rewards banked: " + inbank("hotchocolate")],
    [inbag("candycanesword") + w.bank.items0.filter((x) => x && x.name === "candycanesword").length === 0, "unusable weapon sold"],
    [logged(w, "Goodies", /Exchange rewards:/), "reward summary logged"]];
});
T("M10 compound test buttons: odds check quotes (with the Primling too), the real test compounds one triple", async (w) => {
  for (let i = 0; i < 3; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, { gold: 20000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/EXCHANGE_ENABLED: true/, "EXCHANGE_ENABLED: false"]]);
  add_item(m, "offeringp", 1);
  await w.clock.run(10);
  m.buttons.al_comp_odds();
  await w.clock.run(120);
  const lv1 = () => w.bank.items0.some((x) => x && x.name === "ringsj" && x.level === 1) || m.items.some((x) => x && x.name === "ringsj" && x.level === 1);
  const odds_ok = logged(w, "Goodies", /no offering: 90%/) && logged(w, "Goodies", /with offeringp: 95%/);
  const before = lv1();
  m.buttons.al_comp_test();
  await w.clock.run(200);
  return [[odds_ok, "odds check quoted both without and with the Primling"], [!before, "the odds check compounded nothing"],
    [lv1(), "the real test produced a +1 ring"], [logged(w, "Goodies", /compounding ringsj \+0 x3 now WITH offeringp/), "real test used the Primling that was in the bag"]];
});
T("M7 queue order: restock before junk, FIFO", async (w) => {
  const m = merchant_char(w, { gold: 20000 }); const r = fake_ranger(w);
  await w.clock.run(5);
  add_item(r, "wcap", 1); add_item(r, "wcap", 1); add_item(r, "wcap", 1);
  r.sb.send_cm("Goodies", { type: "job_request", id: "j1", jtype: "junk", count: 3, names: ["wcap"], map: "main", x: -110, y: 15 });
  r.sb.send_cm("Goodies", { type: "job_request", id: "r7", jtype: "restock", hp: 20, mp: 0, map: "main", x: -110, y: 15 });
  await w.clock.run(1);
  const first_done = () => msgs(r, "job_done").map((d) => d.id);
  await w.clock.run(120);
  return [[first_done()[0] === "r7", "restock served first: " + first_done().join(",")]];
});

// ---- RANGER with a scripted Merchant ----------------------------------------------------------------------------
function merchant_script(w, f, how) {
  // how: {eta, delay, silent, ping_stop_after}
  f._h.cm = [(m) => {
    const d = m.message;
    if (d.type === "job_request" && !how.silent) {
      const r = w.chars.SexyDexy; const id = d.id;
      f.send("SexyDexy", { type: "job_status", id, state: "QUEUED", eta: how.eta, doing: "testing" });
      if (how.eta > 60) return;
      let n = 0;
      const ping = w.clock.every(() => { if (how.stop_pings && w.clock.t - how.t_req > how.stop_pings * 1000) { w.clock.clear(ping); return; } f.send("SexyDexy", { type: "job_status", id, state: "EN_ROUTE", eta: Math.max(0, how.eta - ++n * 10), doing: "walking" }); }, 10000);
      how.t_req = w.clock.t;
      if (how.stop_pings) return;
      w.clock.set(() => {
        w.clock.clear(ping);
        f.map = r.map; f.x = r.x + 20; f.y = r.y; // arrived
        if (d.jtype === "restock") {
          const t = w.chars.SexyDexy; add_item(t, "hpot1", d.hp); add_item(t, "mpot1", d.mp);
          f.send("SexyDexy", { type: "job_done", id, hp: d.hp, mp: d.mp, got: d.hp + d.mp });
        } else {
          f.send("SexyDexy", { type: "job_ready", id, cap: 20 });
        }
      }, how.delay * 1000);
    }
    if (d.type === "job_sent") { const t = w.chars.SexyDexy; f.send("SexyDexy", { type: "job_done", id: d.id, got: d.count }); }
    if (d.type === "job_cancel") f.send("SexyDexy", { type: "cancel_ack", id: d.id });
  }];
}
T("R1 normal: retreats, asks, ETA<=60 -> waits, potions delivered, hunt resumes", async (w) => {
  const f = fake_merchant(w); merchant_script(w, f, { eta: 20, delay: 25 });
  const r = ranger_char(w);
  await w.clock.run(90);
  const req = msgs(f, "job_request");
  return [[req.length === 1 && req[0].jtype === "restock", "one restock request"], [logged(w, "SexyDexy", /Retreating to the nearest town/), "retreated first"],
    [r.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "potions delivered"], [logged(w, "SexyDexy", /Need met/), "ladder finished"],
    [msgs(f, "job_cancel").length === 0, "nothing cancelled"]];
});
T("R2 busy Merchant (ETA 90s): cancels, self-service on main (Ernis), no Merchant wait", async (w) => {
  const f = fake_merchant(w); merchant_script(w, f, { eta: 90, delay: 0 });
  const r = ranger_char(w, { gold: 100000 });
  await w.clock.run(200);
  return [[msgs(f, "job_cancel").length === 1, "cancelled the queued job"], [logged(w, "SexyDexy", /is busy: ETA 90s/), "gave up on ETA > 60s"],
    [logged(w, "SexyDexy", /handling it myself/), "fallback 2"], [r.items.some((i) => i && i.name === "hpot1" && i.q >= 100), "bought potions at Ernis"],
    [msgs(f, "travel_to_main").length === 0, "no travel_to_main (already on main)"]];
});
T("R3 no answer (Merchant offline): immediate fallback 2", async (w) => {
  const r = ranger_char(w, { gold: 100000 });
  await w.clock.run(200);
  return [[logged(w, "SexyDexy", /not reachable/), "knows he is offline at once"], [logged(w, "SexyDexy", /handling it myself/), "fallback 2"],
    [r.items.some((i) => i && i.name === "hpot1" && i.q >= 100), "bought potions"]];
});
T("R3b Merchant online but silent: 60s then fallback", async (w) => {
  const f = fake_merchant(w); merchant_script(w, f, { silent: true });
  const r = ranger_char(w, { gold: 100000 });
  await w.clock.run(250);
  const l = w.logs.find((x) => /did not answer within 60s/.test(x.msg)); const a = w.logs.find((x) => /Asking Goodies/.test(x.msg));
  return [[!!l && !!a && Math.abs(l.t - a.t - 60) < 3, "gave up 60s after the request: " + (l && a ? (l.t - a.t).toFixed(1) : "-")], [logged(w, "SexyDexy", /handling it myself/), "fallback 2"]];
});
T("R8 Merchant offline, full bag of junk: sells at Gabriel, potions bought, need met", async (w) => {
  const r = ranger_char(w, { gold: 100000 });
  for (let i = 0; i < 30; i++) add_item(r, "wcap", 1);
  await w.clock.run(250);
  return [[!r.items.some((i) => i && i.name === "wcap"), "junk sold"], [logged(w, "SexyDexy", /Sold \d+ junk item/), "logged the sale at Gabriel"],
    [r.items.some((i) => i && i.name === "hpot1" && i.q >= 100), "potions bought"], [logged(w, "SexyDexy", /Need met/), "ladder finished"],
    [!logged(w, "SexyDexy", /Moving to bank/), "no bank trip needed once the junk was sold"]];
});
T("R9 town skill does nothing and no path exists: ladder gives up, he keeps hunting, no pathfinder spam", async (w) => {
  const r = ranger_char(w, { gold: 100000 }); r.town_broken = true; r.no_path = true;
  await w.clock.run(200);
  return [[logged(w, "SexyDexy", /Could not retreat to town - back to hunting/), "ladder abandoned"], [r.moves <= 6, "few path searches in 200s: " + r.moves],
    [!logged(w, "SexyDexy", /Asking Goodies/), "did not ask the Merchant to come to the field"]];
});
T("R10 a bee that cannot be reached (Path not found): few path searches, then ignored", async (w) => {
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, {}, [["hpot1", 100], ["mpot1", 100]]);
  r.x = 387; r.y = 1066; r.no_path = true; r.in_range = false;
  r.sb.parent.entities.b1 = { id: "b1", type: "monster", mtype: "bee", visible: true, dead: false, x: 387 + 300, y: 1066 };
  await w.clock.run(60);
  return [[r.moves <= 12, "path searches in 60s: " + r.moves], [logged(w, "SexyDexy", /Cannot get closer to bee/), "gave up on that bee"]];
});
T("R11 monster on top of him: steps away before casting town", async (w) => {
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10, range: 30 };
  const r = ranger_char(w, { x: 387, y: 1066 }, [["hpot1", 2], ["mpot1", 100]]);
  r.sb.parent.entities.b1 = { id: "b1", type: "monster", mtype: "bee", visible: true, dead: false, x: 387 + 20, y: 1066, target: "SexyDexy" };
  await w.clock.run(40);
  const d = (r.town_threat || [])[0];
  return [[d !== undefined && d > 150, "first town cast happened " + Math.round(d) + "px from the monster"], [logged(w, "SexyDexy", /Moved away from the monsters/), "logged the step away"]];
});
T("R12 farm goal: walks to the Phoenix spawn, fights it when it appears, goal data logged", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.drops = { monsters: { phoenix: [[0.12, "dexearring"], [1, "stormfeather"]] } };
  w.G.items.dexearring = { name: "Earring of Dexterity", g: 38000, type: "earring" }; w.G.items.stormfeather = { name: "Storm Feather", g: 100 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.attacks = 0; const oa = r.sb.attack; r.sb.attack = (t) => { r.attacks++; return oa(t); };
  await w.clock.run(60);
  const walked = r.x > 650 && r.y < 0;
  r.sb.parent.entities.p1 = { id: "p1", type: "monster", mtype: "phoenix", visible: true, dead: false, x: r.x + 50, y: r.y, hp: 160000, max_hp: 160000, attack: 125 };
  await w.clock.run(30);
  return [[logged(w, "SexyDexy", /Farm goal: Phoenix/) && logged(w, "SexyDexy", /Earring of Dexterity 12%/), "goal announced with the drop odds"],
    [walked, "walked to the spawn box: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"], [r.attacks > 0, "attacked the Phoenix once it appeared: " + r.attacks]];
});
T("P1 three Rangers: followers invited, walk to the leader, shoot what he shoots", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.drops = { monsters: { phoenix: [[0.12, "dexearring"]] } };
  w.G.items.dexearring = { name: "Earring of Dexterity", g: 38000, type: "earring" };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  const hits = { Dexy2: 0, Dexy3: 0 };
  for (const f of [F2, F3]) { const oa = f.sb.attack; f.sb.attack = (t) => { hits[f.name]++; return oa(t); }; }
  await w.clock.run(90);
  const near = (f) => f.map === "main" && Math.hypot(f.x - L.x, f.y - L.y) < 300;
  const ph = { id: "p1", type: "monster", mtype: "phoenix", visible: true, dead: false, x: L.x + 40, y: L.y, hp: 160000, max_hp: 160000, attack: 125 };
  for (const c of [L, F2, F3]) c.sb.parent.entities.p1 = Object.assign({}, ph);
  L.target = "p1";
  await w.clock.run(40);
  const arrived = near(F2) && near(F3);
  return [
    [arrived, "followers walked to the leader at the Phoenix: (" + Math.round(F2.x) + "," + Math.round(F2.y) + ") (" + Math.round(F3.x) + "," + Math.round(F3.y) + ") leader (" + Math.round(L.x) + "," + Math.round(L.y) + ")"],
    [hits.Dexy2 > 0 && hits.Dexy3 > 0, "both followers attacked the Phoenix: " + hits.Dexy2 + "/" + hits.Dexy3],
    [logged(w, "Dexy2", /following SexyDexy/), "follower logged the walk"]];
});
T("PA1 the Merchant is party leader: invites all three Rangers, they accept only his invite", async (w) => {
  const m = make_char(w, "Goodies", { ctype: "merchant", x: -115, y: -5, gold: 20000 }, "AutoMerchant v4.js", MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2", "Dexy3"]']]));
  m.script_char = true;
  for (const [n, q] of [["hpot1", 300], ["mpot1", 300], ["hpot0", 100], ["mpot0", 100]]) add_item(m, n, q);
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  F2.sb.on_party_invite("Mallory"); F3.sb.on_party_invite("SexyDexy"); L.sb.on_party_invite("Dexy2"); // strangers and other Rangers are ignored
  const stray = w.party.Dexy2 || w.party.Dexy3 || w.party.SexyDexy || null;
  await w.clock.run(40);
  const inv = (w.invites || []).filter((x) => x.indexOf("Goodies>") === 0).map((x) => x.slice(8));
  return [[!stray, "invites from anyone but the Merchant are ignored"], [inv.indexOf("SexyDexy") !== -1 && inv.indexOf("Dexy2") !== -1 && inv.indexOf("Dexy3") !== -1, "Merchant invited all three: " + inv.join(",")],
    [w.party.SexyDexy === "Goodies" && w.party.Dexy2 === "Goodies" && w.party.Dexy3 === "Goodies", "all three joined his party"], [!(w.invites || []).some((x) => /^(SexyDexy|Dexy2|Dexy3)>/.test(x)), "no Ranger sends invites"]];
});
T("B1 party farms bees only until every follower is level 60, then goals start", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2", { level: 40 }); const F3 = party_ranger(w, "Dexy3", { level: 70 });
  await w.clock.run(240);
  console.log("INBOX", JSON.stringify(L.inbox.map(m=>m.from+":"+m.msg.type).slice(0,8)), "F2 inbox", F2.inbox.length); const held = !logged(w, "SexyDexy", /Farm goal: Phoenix/) && logged(w, "SexyDexy", /Party farms bees only: Dexy2 \(level 40\)/);
  F2.level = 60;
  await w.clock.run(60);
  return [[held, "no goal while Dexy2 is level 40"], [logged(w, "SexyDexy", /Everyone is level 60\+/), "announced the party is ready"], [logged(w, "SexyDexy", /Farm goal: Phoenix/), "goal farming started once both reached 60"]];
});
T("P2 follower alone (leader silent): farms bees on his own, no walk to nowhere", async (w) => {
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const F = party_ranger(w, "Dexy2", { x: 600, y: 1000 });
  await w.clock.run(60);
  return [[!logged(w, "Dexy2", /following SexyDexy/), "never tried to follow a leader that is not there"], [F.map === "main", "stayed on main"]];
});
T("P3 real Merchant serves a follower Ranger's restock", async (w) => {
  const m = make_char(w, "Goodies", { ctype: "merchant", x: -115, y: -5, gold: 100000 }, "AutoMerchant v4.js", MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']]));
  for (const [n, q] of [["hpot1", 300], ["mpot1", 300], ["hpot0", 100], ["mpot0", 100]]) add_item(m, n, q);
  const F = party_ranger(w, "Dexy2", {}, [["hpot1", 10], ["mpot1", 10]]);
  await w.clock.run(200);
  return [[F.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "follower got potions from the Merchant"], [logged(w, "Goodies", /Job restock from Dexy2/), "Merchant queued Dexy2's request"]];
});
T("R13 farm goal: monster never shows up -> goal rests, back to the bees", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(400);
  return [[logged(w, "SexyDexy", /Farm goal Phoenix ended: not in view/), "gave up on an absent Phoenix"], [Math.hypot(r.x - 496, r.y - 1068) < 250 || r.y > 500, "heading back to the bee spot: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"]];
});
T("R14 farm goal: a monster that would take too long is skipped", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000000, respawn: 32 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(60);
  return [[logged(w, "SexyDexy", /Farm goal phoenix skipped/), "skipped with a reason"], [!logged(w, "SexyDexy", /Farm goal: Phoenix/), "never started"]];
});
T("R4 Merchant stops pinging after committing: lost contact -> fallback", async (w) => {
  const f = fake_merchant(w); merchant_script(w, f, { eta: 30, delay: 0, stop_pings: 20 });
  const r = ranger_char(w, { gold: 100000 });
  await w.clock.run(250);
  return [[logged(w, "SexyDexy", /No ping from Goodies/), "liveness loss detected"], [logged(w, "SexyDexy", /handling it myself/), "fallback 2"]];
});
T("R5 on winterland: busy -> travel_to_main BEFORE the portal, asks again on main", async (w) => {
  const f = fake_merchant(w); merchant_script(w, f, { eta: 90, delay: 0 });
  const r = ranger_char(w, { map: "winterland", x: 300, y: 300, gold: 100000 });
  await w.clock.run(300);
  const asks = msgs(f, "job_request");
  const ttm = f.inbox.findIndex((m) => m.msg.type === "travel_to_main");
  const second = f.inbox.findIndex((m, i) => m.msg.type === "job_request" && i > ttm);
  return [[ttm >= 0, "travel_to_main sent"], [asks.length === 2 && asks[0].map === "winterland" && asks[1].map === "main", "asked on winterland, then on main"],
    [second > ttm, "the second ask came after travel_to_main"], [r.map === "main", "ended on main"]];
});
T("R6 bank full: fallback 3 waits at the safe spot and re-asks every ~30s until served", async (w) => {
  w.bank_full = true;
  const f = fake_merchant(w); merchant_script(w, f, { silent: true });
  const items = [["hpot1", 100], ["mpot1", 100]];
  const r = ranger_char(w, { gold: 100000 }, items);
  for (let i = 0; i < 30; i++) add_item(r, "ringsj", 1, 0); // 30 compound keepers: bag nearly full, nothing sellable, bank refuses
  await w.clock.run(260);
  const asks = msgs(f, "job_request").filter((m) => m.jtype !== "restock");
  const waiting = logged(w, "SexyDexy", /Bank and bag are both full/);
  const at_safe = Math.hypot(r.x + 110, r.y - 15) < 80;
  // now the Merchant becomes available
  merchant_script(w, f, { eta: 20, delay: 5 });
  await w.clock.run(120);
  return [[waiting, "fallback 3 reached"], [asks.length >= 3, "re-asked repeatedly: " + asks.length], [logged(w, "SexyDexy", /Handed \d+ item/), "handed the loot over once he answered"],
    [at_safe, "stood at the safe spot"]];
});
T("R7 Merchant restarts: hello -> Ranger re-sends the job", async (w) => {
  const f = fake_merchant(w); merchant_script(w, f, { eta: 40, delay: 100 });
  const r = ranger_char(w);
  await w.clock.run(30);
  f.send("SexyDexy", { type: "hello", jobs: [], want_reply: true });
  await w.clock.run(5);
  const asks = msgs(f, "job_request");
  return [[asks.length >= 2 && asks[0].id === asks[1].id, "same job id re-sent after his hello"], [msgs(f, "hello").length >= 1, "answered his hello"]];
});

// ---- BOTH real scripts --------------------------------------------------------------------------------------------
T("I1 real Ranger + real Merchant: restock end to end", async (w) => {
  const m = merchant_char(w); const r = ranger_char(w);
  await w.clock.run(150);
  return [[r.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "Ranger got potions from the real Merchant"], [logged(w, "SexyDexy", /Need met/), "ladder finished"],
    [logged(w, "Goodies", /Delivered \d+ HP/), "Merchant logged the delivery"], [!logged(w, "SexyDexy", /handling it myself/), "no fallback needed"]];
});
T("I2 real pair, junk + potions in one visit (restock first)", async (w) => {
  const m = merchant_char(w); const r = ranger_char(w);
  for (let i = 0; i < 4; i++) add_item(r, "wcap", 1);
  for (let i = 0; i < 30; i++) add_item(r, "ringsj", 1, 0);
  await w.clock.run(200);
  return [[r.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "potions delivered"], [!r.items.some((i) => i && i.name === "wcap"), "junk collected"],
    [r.items.filter((i) => i && i.name === "ringsj").length < 30, "keepers handed over"], [logged(w, "SexyDexy", /Need met/), "ladder finished"]];
});
T("I3 real pair on winterland, Merchant busy compounding: falls back to main and is served there", async (w) => {
  for (let i = 0; i < 6; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, {}, MERCH_OVR_COMPOUND); const r = ranger_char(w, { map: "winterland", x: 300, y: 300 });
  await w.clock.run(400);
  return [[logged(w, "SexyDexy", /busy: ETA \d+s is over 60s/) || logged(w, "SexyDexy", /not usable/), "first ask refused (busy / too far)"],
    [r.map === "main", "Ranger is on main"], [r.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "potions arrived (Merchant or self-service)"]];
});

// ----------------------------------------------------------------------------------------------------------------
(async () => {
  const only = process.argv.slice(2).filter((a) => a !== "-v")[0];
  let bad = 0;
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && !name.startsWith(only)) continue;
    const w = make_world();
    let checks;
    try { checks = await fn(w); } catch (e) { checks = [[false, "threw: " + (e.stack || e)]]; }
    const errs = w.logs.filter((l) => /ERROR|timer error/.test(l.msg));
    if (errs.length) checks.push([false, "script errors: " + errs.slice(0, 3).map((e) => e.who + ": " + e.msg).join(" | ")]);
    const ok = checks.every((c) => c[0]);
    if (!ok) bad++;
    console.log((ok ? "PASS " : "FAIL ") + name);
    for (const [c, label] of checks) if (!c || VERBOSE) console.log("   " + (c ? "ok   " : "FAIL ") + label);
    if (!ok && !VERBOSE) for (const l of w.logs.slice(-25)) console.log("      " + String(l.t).padStart(6) + " " + l.who.padEnd(9) + l.msg);
  }
  console.log(bad ? bad + " scenario(s) failed" : "all scenarios passed");
  process.exit(bad ? 1 : 0);
})();
