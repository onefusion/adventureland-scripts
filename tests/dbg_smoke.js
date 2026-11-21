// Smoke tests for AutoMerchant v4 / AutoRanger v4 / AL Lib v2 on a mock Adventure Land world with a VIRTUAL clock
// (minutes of game time run in milliseconds). Run:  node tests/v4_smoke.js [scenario-name] [-v]
// This is NOT the real game: it checks the protocol and the branches of the ladder / queue, not game-API behaviour.
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const DIR = path.resolve(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(DIR, f === "AutoMerchant v4.js" && process.env.MERCHANT_FILE ? process.env.MERCHANT_FILE : f === "AutoRanger v4.js" && process.env.RANGER_FILE ? process.env.RANGER_FILE : f === "AutoPriest v4.js" && process.env.PRIEST_FILE ? process.env.PRIEST_FILE : f), "utf8"); // MERCHANT_FILE="AutoMerchant v5.js" runs the same scenarios against v5
const VERBOSE = process.argv.includes("-v");

function make_world() {
  const world = {
    chars: {},
    store: {},
    logs: [],
    bank: { gold: 10000000, items0: [], items1: [], items3: [] },
    bank_full: false,
    clock: null,
    G: {
      craft: { quiver: { items: [[1, "ascale"], [200, "beewings"]], cost: 0, quest: "mcollector" } },
      items: {
        hpot0: { g: 50, s: true }, mpot0: { g: 50, s: true }, hpot1: { g: 100, s: true }, mpot1: { g: 100, s: true },
        wcap: { g: 100 }, wshoes: { g: 100 }, stinger: { g: 20, s: true }, cscroll0: { g: 6400, s: true }, cscroll1: { g: 240000, s: true },
        mistletoe: { g: 20000, e: 1, quest: "mistletoe", s: 9999, type: "gem" }, candycane: { g: 24000, e: 1, quest: "candycane", s: 9999, type: "gem" }, ornament: { g: 3000, e: 20, quest: "ornament", s: 9999, type: "quest" },
        hotchocolate: { g: 6000, s: 9999, type: "elixir" }, offeringp: { g: 480000 }, candycanesword: { g: 72000, type: "weapon", wtype: "short_sword", attack: 21 },
        hpamulet: { g: 20000, type: "amulet", hp: 200, compound: { hp: 240 }, grades: [3, 5, 6, 7] }, ringsj: { g: 5000, type: "ring", compound: { dex: 1 }, grades: [3, 5, 6, 7] }, firebow: { g: 178000, type: "weapon", upgrade: { attack: 6, range: 8 }, grades: [0, 8, 10, 12] }, oddity: { g: 100, type: "material" }, tracker: { g: 100, type: "tracker" }, lostearring: { g: 300, s: true }, scroll0: { g: 1000, s: true }, dexscroll: { g: 1000, s: true }, intscroll: { g: 8000, s: true, type: "pscroll", stat: "int" }, vitscroll: { g: 8000, s: true, type: "pscroll", stat: "vit" },
        ascale: { g: 500, s: 9999 }, beewings: { g: 25, s: 9999 },
        quiver: { g: 24000, type: "quiver", dex: 2, range: 20, armor: 10, upgrade: { dex: 1, armor: 2, range: 3.5 }, grades: [3, 7, 10, 12] },
        t2quiver: { g: 960000, name: "Agile Quiver", type: "quiver", tier: 2, dex: 9, range: 20, armor: 12, evasion: 1, upgrade: { dex: 1.5, armor: 3, range: 3.5 }, grades: [0, 4, 10, 12] },
        dexcap: { g: 500, type: "helmet", armor: 5, stat: 3, upgrade: { armor: 1 } }, plaincap: { g: 500, type: "helmet", armor: 5, upgrade: { armor: 1 } },
      },
      maps: { winter_inn: { spawns: [[0, 0]] }, main: { spawns: [[0, 0]] }, winterland: { spawns: [[0, 0]] }, bank: { spawns: [[0, 0]] }, woffice: { spawns: [[0, 0]] } },
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
  world.lottery = world.lottery || { item: 0, money: [], buys: [], item_price: 2000000, money_price: 100000, closes: new Date(Date.now() + 5 * 3600000).toISOString() };
  { const L = world.lottery; const hs = {};
    sb.parent.socket = {
      on(ev, h) { (hs[ev] = hs[ev] || []).push(h); }, off(ev, h) { hs[ev] = (hs[ev] || []).filter((x) => x !== h); },
      emit(ev, d) {
        const send = (e, p) => world.after(300, () => { for (const h of (hs[e] || []).slice()) h(p); return {}; });
        if (ev === "lottery_status") send("lottery_status", { product: "daily_item", available: true, accountTickets: L.item, current: { prize: { name: "dexring" }, ticketPrice: L.item_price, accountLimit: 1, closesAt: L.closes, purchasesPermitted: true } });
        else if (ev === "money_lottery_status") send("money_lottery_status", { product: "money_lottery", available: true, accountTickets: L.money.length, current: { drawId: "d1", jackpotGold: 5000000, ticketPrice: L.money_price, accountLimit: 5, closesAt: L.closes, purchasesPermitted: true } });
        else if (ev === "lottery_purchase") { L.item++; L.buys.push("item"); ch.gold -= L.item_price; send("lottery_purchase", { success: true }); }
        else if (ev === "money_lottery_quick_pick") send("money_lottery_quick_pick", { success: true, numbers: [1, 2, 3, 4, 5 + L.money.length] });
        else if (ev === "money_lottery_purchase") { L.money.push(d.numbers); L.buys.push("money"); ch.gold -= L.money_price; send("money_lottery_purchase", { success: true, receipt: { numbers: d.numbers } }); }
      },
    };
  }
  sb.game_log = (m) => world.log(name, m);
  sb.set_message = () => {}; ch.buttons = {}; sb.add_top_button = (id, label, fn) => { ch.buttons[id] = fn; };
  sb.get = (k) => world.store[name + ":" + k]; sb.set = (k, v) => { world.store[name + ":" + k] = v; };
  sb.setTimeout = (fn, ms) => world.clock.set(fn, ms); sb.setInterval = (fn, ms) => world.clock.every(fn, ms);
  sb.clearInterval = (id) => world.clock.clear(id); sb.clearTimeout = sb.clearInterval;
  sb.Date = { now: () => world.clock.t, parse: Date.parse };
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
    if (Array.isArray(to)) { to.filter((n) => n !== name).forEach((n) => sb.send_cm(n, msg)); return Promise.resolve({ receivers: to }); }
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
  const NPC = { fancypots: { map: "main", x: -60, y: -100 }, basics: { map: "main", x: -89, y: -165 }, scrolls: { map: "main", x: -150, y: -60 }, newupgrade: { map: "main", x: -140, y: -90 }, monsterhunter: { map: "main", x: 126, y: -413 }, ornaments: { map: "winterland", x: -137, y: -193 }, mistletoe: { map: "winter_inn", x: 94, y: -181 }, santa: { map: "winterland", x: 1242, y: -1631 }, craftsman: { map: "main", x: 92, y: 670 }, mcollector: { map: "main", x: 81, y: -283 }, lotterylady: { map: "main", x: -341, y: 168 }, lostandfound: { map: "woffice", x: -24, y: -178 }, exchange: { map: "main", x: -300, y: -250 } };
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
    return world.after(2000, () => { const it = ch.items[a]; if (sc.name === "dexscroll") it.stat_type = "dex"; else if (sc.name === "intscroll") it.stat_type = "int"; else if (sc.name === "vitscroll") it.stat_type = "vit"; else it.level = (it.level || 0) + 1; take_item(ch, si, 1); return {}; });
  };
  ch.exchanges = [];
  sb.exchange = (i) => {
    const it = ch.items[i]; const e = world.G.items[it.name].e;
    if (it.q < e) return Promise.reject({ reason: "not_enough" });
    ch.exchanges.push({ name: it.name, x: ch.x, y: ch.y, map: ch.map });
    ch.q.exchange = true;
    return world.after(2000, () => { ch.q.exchange = false; it.q -= e; if (!it.q) ch.items[i] = null; const rw = it.name === "ornament" ? "candycanesword" : "hotchocolate"; const f = ch.items.findIndex((x) => !x); ch.items[f] = rw === "hotchocolate" ? { name: rw, q: 1 } : { name: rw, level: 0 }; return { success: true, reward: { name: rw } }; });
  };
  world.donations = world.donations || [];
  sb.donate_gold = (g) => {
    if (g > ch.gold) return Promise.reject({ reason: "not_enough_gold", place: "donate" });
    return world.after(800, () => { ch.gold -= g; ch.xp = (ch.xp || 0) + g * 4.8; world.donations.push({ g, map: ch.map }); if (world.donate_gift) { const f = ch.items.findIndex((x) => !x); ch.items[f] = { name: "gem0", q: 1 }; } return { response: g < (world.donate_min || 0) ? "donate_low" : "donate_thx", gold: g, place: "donate" }; });
  };
  ch.crafted = [];
  sb.auto_craft = (name) => {
    const rec = world.G.craft[name]; if (!rec) return Promise.reject({ reason: "no recipe" });
    const np = rec.quest === "mcollector" ? [81, -283] : [92, 670]; if (!(Math.hypot(ch.x - np[0], ch.y - np[1]) < 400) || ch.map !== "main") return Promise.reject({ reason: "too far from the crafter" });
    for (const [q, n] of rec.items) { const have = ch.items.reduce((a2, i) => a2 + (i && i.name === n ? i.q || 1 : 0), 0); if (have < q) return Promise.reject({ reason: "missing " + n }); }
    return world.after(1500, () => { for (const [q, n] of rec.items) { let left = q; for (let i = 0; i < ch.items.length && left > 0; i++) { const it = ch.items[i]; if (it && it.name === n) { const t = Math.min(left, it.q || 1); it.q = (it.q || 1) - t; left -= t; if (!it.q) ch.items[i] = null; } } } add_item(ch, name, 1, 0); ch.crafted.push(name); return { success: true }; });
  };
  sb.split = (i, n) => { const it = ch.items[i]; it.q -= n; const f = ch.items.findIndex((x) => !x); ch.items[f] = { name: it.name, q: n }; return Promise.resolve({}); };
  sb.load_code = (slot) => { if (slot === "lib") vm.runInContext(src("AL Lib v2.js"), ctx, { filename: "AL Lib v2.js" }); return Promise.resolve({}); };
  sb.stop_character = (n) => { (world.stopped = world.stopped || []).push(n); return Promise.resolve({}); }; sb.start_character = (n, slot) => { (world.started = world.started || []).push(n); (world.started_slots = world.started_slots || {})[n] = slot; }; sb.get_active_characters = () => { const o = {}; for (const k in world.chars) if (world.chars[k].online && world.chars[k].script_char) o[k] = true; return o; };
  world.party = world.party || {};
  sb.send_party_invite = (n) => { (world.invites = world.invites || []).push(name + ">" + n); const t = world.chars[n]; if (t && t.sb && t.sb.on_party_invite) t.sb.on_party_invite(name); return Promise.resolve({}); };
  sb.accept_party_invite = (leader) => { world.party[name] = leader; world.party[leader] = leader; return Promise.resolve({}); };
  sb.send_party_request = (n) => { (world.requests = world.requests || []).push(name + ">" + n); const t = world.chars[n]; if (t && t.sb && t.sb.on_party_request) t.sb.on_party_request(name); return Promise.resolve({}); };
  sb.accept_party_request = (who) => { world.party[who] = world.party[name] || name; world.party[name] = world.party[name] || name; return Promise.resolve({}); };
  Object.defineProperty(ch, "party", { configurable: true, get: () => world.party[name] || undefined, set: () => {} });
  sb.get_party = () => { const o = {}; for (const k in world.party) if (world.party[k] === (world.party[name] || name) || k === name) o[k] = {}; return o; };
  const ctx = vm.createContext(sb);
  ch.ctx = ctx; ch.sb = sb;
  if (script) {
    let text = src(script);
    if (/AutoMerchant/.test(script) && !(overrides && overrides.fire_on)) { text = text.replace("UPGRADE_MAX_LEVEL_BY_ITEM: { firebow: 7 }", "UPGRADE_MAX_LEVEL_BY_ITEM: {}"); text = text.replace('UPGRADE_GAMBLE_NAMES: ["firebow"]', "UPGRADE_GAMBLE_NAMES: []"); } // v5: the per-item upgrade cap (Fire Bow +7) is tested on its own (UPF1)
    if (/AutoMerchant/.test(script) && !(overrides && overrides.layout_on)) text = text.replace("BANK_LAYOUT: true", "BANK_LAYOUT: false"); // v5: the bank layout (packs per kind of item) is tested on its own (BL1-BL6)
    for (const [re, to, optional] of overrides || []) { if (!re.test(text)) { if (optional) continue; throw new Error("override did not match: " + re); } text = text.replace(re, to); }
    vm.runInContext(text, ctx, { filename: script });
  }
  return ch;
}

const RANGER_OVR = [[/PARTY_MEMBERS: \[[^\]]*\]/, "PARTY_MEMBERS: []"], [/HUNT_ENABLED: true/, "HUNT_ENABLED: false"], [/GEAR_SHARE: true/, "GEAR_SHARE: false"], [/LUCK_STOP: true/, "LUCK_STOP: false"]]; // v5: the Merchant's Luck stop is tested on its own (FL1-FL4)
const WC_OFF = [/WARRIOR_COMPOUND: \{[^\n]*\},\n/, "WARRIOR_COMPOUND: null,\n", true]; // v5: the Warrior compound set is tested on its own (WC1, WC2)
const MERCH_OVR = [WC_OFF, [/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/CRAFT_ENABLED: true/, "CRAFT_ENABLED: false"], [/LOTTERY_ENABLED: true/, "LOTTERY_ENABLED: false"]];
const MERCH_OVR_COMPOUND = [WC_OFF, [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/CRAFT_ENABLED: true/, "CRAFT_ENABLED: false"], [/LOTTERY_ENABLED: true/, "LOTTERY_ENABLED: false"]];

function merchant_char(world, o, ovr) {
  const m = make_char(world, "Goodies", Object.assign({ ctype: "merchant", x: -115, y: -5, gold: 20000 }, o), "AutoMerchant v4.js", ovr || MERCH_OVR);
  for (const [n, q] of [["hpot1", 1000], ["mpot1", 1000], ["hpot0", 1000], ["mpot0", 1000]]) add_item(m, n, q);
  return m;
}
function ranger_char(world, o, items) {
  const r = make_char(world, "SexyDexy", Object.assign({ x: 387, y: 1066 }, o), "AutoRanger v4.js", RANGER_OVR);
  for (const [n, q] of items || [["hpot1", 10], ["mpot1", 10]]) add_item(r, n, q);
  return r;
}
function party_ranger(world, name, o, items) {
  const ovr = RANGER_OVR.concat([[/PARTY_MEMBERS: \[[^\]]*\]/, 'PARTY_MEMBERS: ["Dexy2", "Dexy3"]']]).concat(o && o.support ? [] : [[/PARTY_SUPPORT: \[[^\]]*\]/, "PARTY_SUPPORT: []"]]);
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
  const m = merchant_char(w, { gold: 50000 }, [[/UPGRADE_MIN_COPIES: 2/, "UPGRADE_MIN_COPIES: 1"], [/DEX_SCROLL_APPLY: false/, "DEX_SCROLL_APPLY: true"], [/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/FLIP_ENABLED: true/, "FLIP_ENABLED: false"], [/UPGRADE_EVERY_MS: \d+/, "UPGRADE_EVERY_MS: 1000"], [/UPGRADE_MAX_LEVEL: 5/, "UPGRADE_MAX_LEVEL: 1"]]);
  const r = fake_ranger(w);
  r.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "plaincap", level: 0 } }, map: "main", x: -110, y: 15 });
  const rep = setInterval(() => {}, 1e9); clearInterval(rep);
  w.clock.every(() => r.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "plaincap", level: 0 } }, map: "main", x: -110, y: 15 }), 60000);
  await w.clock.run(400);
  const dex = m.items.filter((i) => i && i.stat_type === "dex");
  return [[logged(w, "Goodies", /DEX SCROLL applied to dexcap/), "dex scroll applied to dexcap"], [dex.length === 1 && dex[0].name === "dexcap", "only dexcap carries the stat"], [!logged(w, "Goodies", /DEX SCROLL.*plaincap/), "no scroll wasted on an item without a stat value"]];
});
const UPG_FAST = [[/UPGRADE_MIN_COPIES: 2/, "UPGRADE_MIN_COPIES: 1"], [/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/CRAFT_ENABLED: true/, "CRAFT_ENABLED: false"], [/LOTTERY_ENABLED: true/, "LOTTERY_ENABLED: false"], [/FLIP_ENABLED: true/, "FLIP_ENABLED: false"], [/UPGRADE_EVERY_MS: \d+/, "UPGRADE_EVERY_MS: 1000"], [/UPGRADE_MAX_LEVEL: 5/, "UPGRADE_MAX_LEVEL: 1"], [/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']];
const gear_rep = (ch, slots) => ch.sb.send_cm("Goodies", { type: "gear_report", slots, map: "main", x: -110, y: 15 });
T("S1 low potion stock: withdraws the priced shortfall capped at 5% of the bank, tier-1 bought first", async (w) => {
  w.bank.gold = 2000000;
  const m = make_char(w, "Goodies", { ctype: "merchant", x: -115, y: -5, gold: 5000 }, "AutoMerchant v4.js", MERCH_OVR);
  for (const n of ["hpot1", "mpot1", "hpot0", "mpot0"]) add_item(m, n, 100);
  await w.clock.run(60);
  const q = (n) => m.items.reduce((a2, i) => a2 + (i && i.name === n ? i.q || 1 : 0), 0);
  const first = w.logs.find((l) => l.who === "Goodies" && /Withdrew \d+ gold/.test(l.msg));
  const snap = { h1: q("hpot1"), m1: q("mpot1"), h0: q("hpot0"), m0: q("mpot0") };
  return [[logged(w, "Goodies", /Potion funding is capped at 5% of the bank \(100000 of/), "announced the 5% cap"],
    [first && /Withdrew 100000 gold/.test(first.msg), "first withdrawal is exactly the cap: " + (first && first.msg)],
    [snap.h1 === 1000 && snap.m1 > 100 && snap.m1 < 1000 && snap.h0 === 100 && snap.m0 === 100, "tier-1 first, tier-0 untouched: " + JSON.stringify(snap)]];
});
T("S2 full potion stock: no bank trip, no shopping", async (w) => {
  const m = merchant_char(w, { gold: 5000 });
  await w.clock.run(120);
  return [[!logged(w, "Goodies", /withdrawing gold for potions/), "no withdrawal trip"], [!logged(w, "Goodies", /restocking potions at Ernis/), "no shopping trip"]];
});
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
const SUR_OVR = MERCH_OVR_COMPOUND.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]'], [/GEAR_SWEEP: true/, "GEAR_SWEEP: false"], [/SURPLUS_COPIES: true/, "SURPLUS_COPIES: false"], [/SURPLUS_DRY_RUN: (true|false)/, "SURPLUS_DRY_RUN: true"]]);
const full_bank = (w, n) => { for (let i = 0; i < n; i++) w.bank[["items0", "items1", "items3"][Math.floor(i / 42)]].push({ name: "plaincap", level: 5 }); };
const bank_count = (w) => [0, 1, 3].reduce((a, k) => a + w.bank["items" + k].filter((x) => x).length, 0);
T("S3 surplus: full bank, finished caps no Ranger needs -> dry run only logs the plan", async (w) => {
  full_bank(w, 122);
  const m = merchant_char(w, { gold: 50000 }, SUR_OVR); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { helmet: { name: "plaincap", level: 0 } }); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[logged(w, "Goodies", /Surplus check: 2 finished item\(s\) kept for the Rangers, 120 surplus/), "2 kept (one per Ranger), rest surplus"],
    [logged(w, "Goodies", /dry run, would sell 9 surplus/), "dry run names 9 items (12 free wanted of the 41 usable slots per pack)"], [bank_count(w) === 122, "nothing left the bank"]];
});
T("S4 surplus: real run sells just enough to reach the target free slots", async (w) => {
  full_bank(w, 122);
  const m = merchant_char(w, { gold: 50000 }, SUR_OVR.concat([[/SURPLUS_DRY_RUN: true/, "SURPLUS_DRY_RUN: false"]])); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { helmet: { name: "plaincap", level: 0 } }); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[logged(w, "Goodies", /Sold 9 surplus item/), "sold 9"], [bank_count(w) === 113, "bank now holds " + bank_count(w)], [!m.items.some((i) => i && i.name === "plaincap"), "bag holds no caps"]];
});
T("S5 surplus: no gear report from a Ranger -> nothing is sold", async (w) => {
  full_bank(w, 122);
  const m = merchant_char(w, { gold: 50000 }, SUR_OVR.concat([[/SURPLUS_DRY_RUN: true/, "SURPLUS_DRY_RUN: false"]])); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w);
  const send = () => gear_rep(L, {});
  send(); w.clock.every(send, 60000);
  await w.clock.run(250); // inside the 5 min after a restart everybody counts, so the silent Dexy2 is waited for
  return [[logged(w, "Goodies", /Surplus check skipped: no fresh gear report from Dexy2/), "skipped, names the missing report"], [bank_count(w) === 122, "bank untouched"]];
});
const COUR_OVR = MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2", "Dexy3"]']]);
const COUR_MERCH = (w, o, ovr) => { const m = make_char(w, "Goodies", Object.assign({ ctype: "merchant", x: -115, y: -5, gold: 100000 }, o), "AutoMerchant v4.js", ovr || COUR_OVR); for (const [n, q] of [["hpot1", 1000], ["mpot1", 1000], ["hpot0", 1000], ["mpot0", 1000]]) add_item(m, n, q); return m; };
const qty = (c, n) => c.items.filter((i) => i && i.name === n).reduce((a, i) => a + (i.q || 1), 0);
T("C1 courier trip: leader low on potions -> a follower fetches for the party and hands the leader his share", async (w) => {
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy", {}, [["hpot1", 30], ["mpot1", 30]]); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  await w.clock.run(900);
  return [[logged(w, "SexyDexy", /Courier trip: SexyDexy is low on potions - Dexy2 goes to town/), "leader picked Dexy2"], [logged(w, "Dexy2", /Stopgap: 10 hpot1 to SexyDexy/), "stopgap potions first"],
    [qty(L, "hpot1") >= 245 && qty(L, "mpot1") >= 245, "leader holds " + qty(L, "hpot1") + "/" + qty(L, "mpot1")], [qty(F2, "hpot1") >= 245, "courier restocked to " + qty(F2, "hpot1")], [qty(F3, "hpot1") === 250, "the other follower untouched"],
    [logged(w, "SexyDexy", /Courier Dexy2 is back \(ok\)/), "leader told the trip is over"], [!w.logs.some((l) => l.who === "SexyDexy" && /pausing the hunt and retreating/.test(l.msg)), "leader never left the fight"]];
});
T("C6 no follower Ranger online: the leader makes the courier trip himself and the Priest gets her potions", async (w) => {
  if (!IS_R5 || !process.env.PRIEST_FILE) return skip_r4;
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy", { support: true }, [["hpot1", 30], ["mpot1", 30]]);
  const P = priest_char(w, { x: 380, y: 1066 }); add_item(P, "hpot1", 12); add_item(P, "mpot1", 12);
  await w.clock.run(1200);
  return [[logged(w, "SexyDexy", /no follower Ranger is online, SexyDexy goes to town himself/), "leader took the trip"], [qty(L, "hpot1") >= 245 && qty(L, "mpot1") >= 245, "leader restocked: " + qty(L, "hpot1") + "/" + qty(L, "mpot1")], [qty(P, "hpot1") >= 100, "Priest got potions: " + qty(P, "hpot1") + "/" + qty(P, "mpot1")], [logged(w, "SexyDexy", /Courier SexyDexy is back \(ok\)/), "trip closed: " + w.logs.filter((l) => l.who === "SexyDexy" && /ourier/.test(l.msg)).map((l) => l.msg).slice(-3).join(" | ")]];
});
T("CQ1 courier trip starts early (at 100 potions) while nothing else is going on - 40 is the threshold only during events", async (w) => {
  if (!IS_R5) return skip_r4;
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy", {}, [["hpot1", 100], ["mpot1", 100]]); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  await w.clock.run(900);
  return [[logged(w, "SexyDexy", /Courier trip: SexyDexy is low on potions - Dexy2 goes to town/), "quiet-time trip at 100 potions"], [qty(L, "hpot1") >= 245, "leader restocked to " + qty(L, "hpot1")]];
});
T("C2 courier trip: a follower's full bag -> his junk rides with the courier to the Merchant", async (w) => {
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  for (let i = 0; i < 30; i++) add_item(F3, "wcap", 1);
  await w.clock.run(900);
  const left = F3.items.filter((i) => i && i.name === "wcap").length;
  return [[logged(w, "SexyDexy", /Courier trip: Dexy3 has a full bag/), "bag triggered the trip"], [left <= 18, "Dexy3 gave up junk (left " + left + ")"], [!F2.items.some((i) => i && i.name === "wcap"), "courier sold it all"],
    [logged(w, "SexyDexy", /Courier Dexy2 is back \(ok\)/), "trip finished"]];
});
T("C3 courier trip: no follower around -> the leader says so and keeps fighting", async (w) => {
  const L = party_ranger(w, "SexyDexy", {}, [["hpot1", 30], ["mpot1", 30]]);
  await w.clock.run(100); // (from 2 minutes on a leader without any follower makes the trip himself: test C6)
  return [[!logged(w, "SexyDexy", /Courier trip: /), "no trip started"], [!w.logs.some((l) => l.who === "SexyDexy" && /pausing the hunt and retreating/.test(l.msg)), "no personal retreat either"]];
});
T("C4 courier trip: gear the Merchant holds for another Ranger rides along with the courier", async (w) => {
  w.bank.items0.push({ name: "plaincap", level: 0 });
  const ovr = UPG_FAST.map((x) => (/TRUSTED_NAMES/.test(String(x[0])) ? [x[0], 'TRUSTED_NAMES: ["Dexy2", "Dexy3"]'] : /UPGRADE_EVERY_MS/.test(String(x[0])) ? [x[0], "UPGRADE_EVERY_MS: 400000"] : x));
  const M = COUR_MERCH(w, { gold: 500000 }, ovr.concat([[/exch2_next: now\(\) \+ 150000/, "exch2_next: now() + 99999999"]]));
  const L = party_ranger(w, "SexyDexy", { slots: { helmet: { name: "dexcap", level: 3, stat_type: "dex" } } }, [["hpot1", 250], ["mpot1", 250]]);
  const F2 = party_ranger(w, "Dexy2", { slots: { helmet: { name: "dexcap", level: 3, stat_type: "dex" } } }); const F3 = party_ranger(w, "Dexy3");
  const send = () => { for (const c of [L, F2, F3]) gear_rep(c, c.slots); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(260);
  const kept = logged(w, "Goodies", /Keeping plaincap \+1 for Dexy3/);
  L.items = L.items.map((i) => (i && (i.name === "hpot1" || i.name === "mpot1") ? Object.assign(i, { q: 30 }) : i)); // now the leader runs low: a trip starts
  await w.clock.run(900);
  return [[kept, "Merchant kept the cap for Dexy3"], [logged(w, "Goodies", /Gave plaincap \+1 to Dexy2 to carry to Dexy3/), "handed to the courier for Dexy3"], [F3.slots.helmet && F3.slots.helmet.name === "plaincap", "Dexy3 wears it: " + JSON.stringify(F3.slots.helmet)]];
});
T("C5 courier trip: no Merchant -> the courier shops at Ernis for the whole party and still hands out the shares", async (w) => {
  const L = party_ranger(w, "SexyDexy", { gold: 100000 }, [["hpot1", 30], ["mpot1", 30]]); const F2 = party_ranger(w, "Dexy2", { gold: 100000 }); const F3 = party_ranger(w, "Dexy3", { gold: 100000 });
  await w.clock.run(1200);
  return [[logged(w, "Dexy2", /No Merchant available - handling it myself/), "fell back to self-service"], [qty(L, "hpot1") >= 245 && qty(L, "mpot1") >= 245, "leader holds " + qty(L, "hpot1") + "/" + qty(L, "mpot1")],
    [logged(w, "SexyDexy", /Courier Dexy2 is back \(ok\)/), "trip finished"]];
});
const SW_OVR = MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']]);
T("W1 gear sweep: finished rings in the bank go to the Rangers whose slots they beat, leader first; the leader is told", async (w) => {
  for (let i = 0; i < 3; i++) w.bank.items0.push({ name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  const lead = w.logs.filter((l) => l.who === "Goodies" && /Gear sweep: ringsj \+3 for SexyDexy/.test(l.msg)).length;
  const fol = w.logs.filter((l) => l.who === "Goodies" && /Gear sweep: ringsj \+3 for Dexy2/.test(l.msg)).length;
  F.sb.send_cm("Goodies", { type: "job_request", id: "w1", jtype: "restock", hp: 10, mp: 0, map: "main", x: -110, y: 25 });
  await w.clock.run(150);
  return [[lead === 2 && fol === 1, "leader gets two rings, the follower one (" + lead + "/" + fol + ")"], [msgs(L, "gear_ready").length > 0, "leader told gear is waiting"],
    [F.items.filter((i) => i && i.name === "ringsj").length === 1, "follower got his ring at his meeting"], [bank_count(w) === 0, "bank emptied of them"]];
});
T("W4 gear sweep: a finished quiver goes to the Ranger with an empty offhand slot", async (w) => {
  w.bank.items0.push({ name: "quiver", level: 5 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  return [[logged(w, "Goodies", /Gear sweep: quiver \+5 for SexyDexy/), "quiver assigned to the leader's offhand"]];
});
T("W5 gear sweep: an Agile Quiver (t2quiver) in the bank goes to SexyDexy although everyone wears a base quiver, and he gets it at his next meeting", async (w) => {
  w.bank.items1.push({ name: "t2quiver", level: 4 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { offhand: { name: "quiver", level: 5 } }); gear_rep(F, { offhand: { name: "quiver", level: 3 } }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  const lead = logged(w, "Goodies", /Gear sweep: t2quiver \+4 for SexyDexy \(better than his offhand\)/);
  L.sb.send_cm("Goodies", { type: "job_request", id: "w5", jtype: "restock", hp: 10, mp: 0, map: "main", x: -110, y: 15 });
  await w.clock.run(150);
  return [[lead, "assigned to the leader first"], [msgs(L, "gear_ready").length > 0, "leader told it is waiting"],
    [L.items.some((i) => i && i.name === "t2quiver"), "SexyDexy received it at his meeting"], [!w.bank.items1.some((x) => x && x.name === "t2quiver"), "it left the bank"]];
});
T("W6 gear sweep: a single Agile Quiver is not sold, upgraded or banked back as junk while it waits", async (w) => {
  w.bank.items1.push({ name: "t2quiver", level: 4 });
  const m = merchant_char(w, { gold: 50000, gear_wait: true }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { offhand: { name: "quiver", level: 5 } }); gear_rep(F, { offhand: { name: "quiver", level: 3 } }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(1500); // no meeting: the item stays reserved in his bag across tidy and bank rounds
  const held = m.items.filter((i) => i && i.name === "t2quiver").length + w.bank.items0.concat(w.bank.items1, w.bank.items3).filter((x) => x && x.name === "t2quiver").length;
  return [[held === 1, "still exactly one Agile Quiver in the bag or bank: " + held], [!logged(w, "Goodies", /Sold t2quiver/), "never sold"]];
});
const SW_CRAFT = SW_OVR.concat([[/CRAFT_ENABLED: false/, "CRAFT_ENABLED: true"], [/CRAFT_ITEMS: \[[^\]]*\]/, 'CRAFT_ITEMS: ["quiver"]']]); // the live Merchant ships with CRAFT_ITEMS empty (craft report only)
T("CR1 crafting: each Ranger without a quiver gets one made at Cole from bank materials", async (w) => {
  w.bank.items0.push({ name: "ascale", q: 3 }, { name: "beewings", q: 450 });
  const m = merchant_char(w, { gold: 50000 }, SW_CRAFT);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(1500);
  const q = m.items.filter((i) => i && i.name === "quiver").length;
  return [[m.crafted.length === 2, "crafted " + m.crafted.length + " quivers"], [q === 2, "both quivers in the bag: " + q], [logged(w, "Goodies", /Crafted a quiver \(mcollector\)/), "logged it"]];
});
T("ML1 Merchant's Luck: level 40, casts on each Ranger once, renews only after 50 min", async (w) => {
  w.G.skills = { mluck: { name: "Merchant's Luck", level: 40, mp: 10, range: 320, cooldown: 100, target: "player", duration: 3600000 } };
  const m = merchant_char(w, { gold: 50000, level: 40, mp: 500, max_mp: 500 }, SW_OVR.concat([[/MLUCK_ENABLED: false/, "MLUCK_ENABLED: true"]]));
  const casts = []; m.sb.use_skill = (n, t) => { casts.push(n + ">" + t.name); t.s = { mluck: { ms: 3600000, f: "Goodies" } }; return Promise.resolve({}); };
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  const first = casts.slice();
  await w.clock.run(1200); // still inside the hour (1600 s)
  const mid = casts.length;
  L.s = {}; F.s = {};
  await w.clock.run(2400); // past 50 min since the first cast
  return [[first.length === 2 && first.indexOf("mluck>SexyDexy") !== -1 && first.indexOf("mluck>Dexy2") !== -1, "one cast on each: " + first.join(",")], [mid === 2, "no recast inside the hour: " + mid], [casts.length === 4, "renewed after 50 min: " + casts.length],
    [logged(w, "Goodies", /Merchant's Luck cast on SexyDexy/), "logged the cast"]];
});
T("ML2 Merchant's Luck: below level 40 or skill unknown -> never casts", async (w) => {
  const m = merchant_char(w, { gold: 50000, level: 30, mp: 500, max_mp: 500 }, SW_OVR);
  const casts = []; m.sb.use_skill = (n) => { casts.push(n); return Promise.resolve({}); };
  const L = fake_ranger(w); const send = () => gear_rep(L, {}); send(); w.clock.every(send, 60000);
  w.G.skills = { mluck: { level: 40, mp: 10, range: 320, duration: 3600000 } };
  await w.clock.run(300);
  const low = casts.length;
  delete w.G.skills.mluck;
  m.level = 50;
  await w.clock.run(300);
  return [[low === 0, "level 30: no cast"], [casts.length === 0, "no skill in G.skills: no cast"]];
});
T("CR2 crafting: materials missing -> says so and does not craft", async (w) => {
  w.bank.items0.push({ name: "beewings", q: 450 });
  const m = merchant_char(w, { gold: 50000 }, SW_CRAFT);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, { offhand: { name: "quiver", level: 2 } }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[m.crafted.length === 0, "nothing crafted"], [logged(w, "Goodies", /Crafting quiver for the Rangers is waiting for materials: 1 more ascale/), "names the missing scale"]];
});
T("CR3 crafting: Rangers already wearing a quiver need none", async (w) => {
  w.bank.items0.push({ name: "ascale", q: 3 }, { name: "beewings", q: 450 });
  const m = merchant_char(w, { gold: 50000 }, SW_CRAFT);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { offhand: { name: "quiver", level: 3 } }); gear_rep(F, { offhand: { name: "quiver", level: 2 } }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[m.crafted.length === 0, "nothing crafted"], [!logged(w, "Goodies", /Moving to bank - crafting/), "no trip"]];
});
const SW_TARGET = SW_OVR.concat([[/CRAFT_ENABLED: false/, "CRAFT_ENABLED: true"], [/total: 6 \}/, "total: 1 }"]]);
const venom_world = (w) => {
  w.G.craft.venomband = { items: [[1, "dexring", 2], [1, "verdantcore"], [12, "poison"], [4, "snakefang"]], cost: 240000 };
  w.G.items.venomband = { name: "Venom Band", type: "ring", compound: { dex: 2.5 }, g: 220000 };
  w.G.items.dexring = { name: "Ring of Dexterity", type: "ring", compound: { dex: 2 }, g: 24000 };
  w.G.items.verdantcore = { name: "Verdant Core", type: "material", s: 9999, g: 88000 };
  w.G.items.poison = { name: "Poison Sack", type: "skill_item", s: 9999, g: 1000 };
  w.G.items.snakefang = { name: "Snake Fang", type: "material", s: 9999, g: 1200 };
};
T("CR4 crafting target: a Venom Band is made (until 'total' exist) from a Ring of Dexterity +2 (not the +0 one), core, sacks and fangs", async (w) => {
  venom_world(w);
  w.bank.items0.push({ name: "dexring", level: 0 }, { name: "dexring", level: 2 }, { name: "verdantcore", q: 2 }, { name: "poison", q: 30 }, { name: "snakefang", q: 9 });
  const m = merchant_char(w, { gold: 900000 }, SW_TARGET);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(1500);
  const v = m.items.filter((i) => i && i.name === "venomband").length;
  return [[m.crafted.length === 1 && v === 1, "crafted exactly 1 (total 1): " + m.crafted.join(",")], [w.bank.items0.some((x) => x && x.name === "dexring" && (x.level || 0) === 0), "the +0 ring stayed in the bank"]];
});
T("CR5 crafting target: only a +0 Ring of Dexterity in the bank -> says it needs one at +2, crafts nothing", async (w) => {
  venom_world(w);
  w.bank.items0.push({ name: "dexring", level: 0 }, { name: "verdantcore", q: 2 }, { name: "poison", q: 30 }, { name: "snakefang", q: 9 });
  const m = merchant_char(w, { gold: 900000 }, SW_TARGET);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[m.crafted.length === 0, "nothing crafted"], [logged(w, "Goodies", /Crafting venomband for the Rangers is waiting for materials: 1 more dexring \+2/), "names the missing +2 ring"]];
});
T("MK5 market watch: Ponty's Snake Fangs are bought for the Venom Band (stack arrives in the bag), a listing far bigger than the need is left", async (w) => {
  if (!IS_V5) return skip_v4;
  venom_world(w);
  w.bank.gold = 40000000;
  w.bank.items0.push({ name: "dexring", level: 2 }, { name: "verdantcore", q: 2 }, { name: "poison", q: 30 });
  const m = merchant_char(w, { gold: 50000 }, MK_OVR(true).concat([[/total: 6 \}/, "total: 1 }"], [/CRAFT_ENABLED: false/, "CRAFT_ENABLED: true"], [/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']]));
  const stock = [{ name: "snakefang", level: 0, rid: "s1", q: 4 }, { name: "snakefang", level: 0, rid: "s2", q: 500 }];
  const hs = {}; m.sb.calculate_item_value = () => 20000;
  m.sb.parent.socket = { on(ev, h) { (hs[ev] = hs[ev] || []).push(h); }, off(ev, h) { hs[ev] = (hs[ev] || []).filter((x) => x !== h); },
    emit(ev, d) { if (ev === "secondhands") w.after(300, () => { for (const h of (hs.secondhands || []).slice()) h(stock); }); else if (ev === "sbuy") { const i = stock.findIndex((x) => x.rid === d.rid); if (i >= 0) { const x = stock.splice(i, 1)[0]; add_item(m, x.name, x.q, 0); m.gold -= 1000; w.bought = (w.bought || []).concat(x.rid); } } } };
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(800);
  return [[logged(w, "Goodies", /Market watch: bought 4x snakefang for \d+ gold .* for the venomband/), "bought the 4 fangs"], [(w.bought || []).join(",") === "s1", "only the small listing: " + (w.bought || []).join(",")]];
});
const LOT_OVR = MERCH_OVR.concat([[/LOTTERY_ENABLED: false/, "LOTTERY_ENABLED: true"]]);
T("LT1 lottery: spare gold above the floor -> one item ticket and five money tickets, 2.5M total", async (w) => {
  w.bank.gold = 30000000;
  const m = merchant_char(w, { gold: 50000 }, LOT_OVR);
  await w.clock.run(900);
  const spent = JSON.parse(w.store["Goodies:lottery_ledger"] || "{}").spent;
  return [[w.lottery.buys.filter((b) => b === "item").length === 1 && w.lottery.buys.filter((b) => b === "money").length === 5, "bought " + w.lottery.buys.join(",")], [spent === 2500000, "ledger " + spent], [logged(w, "Goodies", /Lottery status - item/), "status logged"]];
});
T("LT2 lottery: bank below the floor -> nothing bought, says why", async (w) => {
  w.bank.gold = 9000000;
  const m = merchant_char(w, { gold: 50000 }, LOT_OVR);
  await w.clock.run(900);
  return [[w.lottery.buys.length === 0, "nothing bought"], [logged(w, "Goodies", /Lottery: nothing to spend/), "explained"]];
});
T("LT3 lottery: daily cap already nearly used -> only what fits", async (w) => {
  w.bank.gold = 30000000;
  w.store["Goodies:lottery_ledger"] = JSON.stringify({ day: String(Math.floor(w.clock.t / 86400000)), spent: 2300000 });
  const m = merchant_char(w, { gold: 50000 }, LOT_OVR);
  await w.clock.run(900);
  return [[w.lottery.buys.filter((b) => b === "item").length === 0 && w.lottery.buys.filter((b) => b === "money").length === 2, "bought " + w.lottery.buys.join(",")]];
});
T("LT4 lottery: the off switch stops it", async (w) => {
  w.bank.gold = 30000000;
  w.store["Goodies:lottery_off"] = true;
  const m = merchant_char(w, { gold: 50000 }, LOT_OVR);
  await w.clock.run(900);
  return [[w.lottery.buys.length === 0, "nothing bought"]];
});
const DON_OVR = MERCH_OVR.concat([[/DONATE_ENABLED: (false|true)/, "DONATE_ENABLED: true"]]);
T("DN1 donation: first visit is the small probe at Lost and Found, the next ones use the normal step", async (w) => {
  w.bank.gold = 40000000;
  const m = merchant_char(w, { gold: 50000 }, DON_OVR);
  await w.clock.run(8000);
  return [[w.donations.length >= 2 && w.donations[0].g === 100000 && w.donations[1].g === 5000000, "donations " + w.donations.map((d) => d.g).join(",")], [w.donations[0] && w.donations[0].map === "woffice", "given at Lost and Found"], [logged(w, "Goodies", /Donation: gave 100000 gold -> answer .*XP \+480000/), "answer and XP logged"]];
});
T("DN2 donation: bank at the floor -> nothing given, says why", async (w) => {
  w.bank.gold = 15000000;
  const m = merchant_char(w, { gold: 50000 }, DON_OVR);
  await w.clock.run(900);
  return [[w.donations.length === 0, "nothing given"], [logged(w, "Goodies", /Donation: nothing to give/), "explained"]];
});
T("DN3 donation: not enough free bag slots -> no trip (handed-back loot needs room)", async (w) => {
  w.bank.gold = 40000000;
  const m = merchant_char(w, { gold: 50000 }, DON_OVR.concat([[/BAG_TIDY: true/, "BAG_TIDY: false"]]));
  for (let i = 0; i < 31; i++) add_item(m, "wshoes", 1);
  await w.clock.run(900);
  return [[w.donations.length === 0, "nothing given"]];
});
T("DN4 donation: loot handed back is logged and the NPC calling it too little stops further visits", async (w) => {
  w.bank.gold = 40000000; w.donate_gift = true; w.donate_min = 1000000;
  const m = merchant_char(w, { gold: 50000 }, DON_OVR);
  await w.clock.run(9000);
  return [[logged(w, "Goodies", /handed back: 1x gem0/), "gift logged"], [logged(w, "Goodies", /calls 100000 too little|too little/), "too-little reply stops it"], [w.donations.length === 1, "only the probe was given: " + w.donations.length]];
});
const cap_run = async (w, wealth0) => {
  w.bank.gold = 100000000;
  w.store["Goodies:donate_track"] = JSON.stringify({ day: "-5", t0: w.clock.t - 86400000, wealth0, cap: 10000000, out: 0 });
  merchant_char(w, { gold: 50000 }, DON_OVR);
  await w.clock.run(900);
  return JSON.parse(w.store["Goodies:donate_track"] || "{}");
};
T("DN6 donation cap: a big earning day raises the cap by one step", async (w) => {
  const tr = await cap_run(w, 40000000);
  return [[tr.cap === 15000000, "cap " + tr.cap], [logged(w, "Goodies", /Donation cap: earned about .* -> cap 15000000/), "logged"]];
});
T("DN7 donation cap: a poor day lowers it by one step (never under the minimum)", async (w) => {
  const tr = await cap_run(w, 99000000);
  return [[tr.cap === 5000000, "cap " + tr.cap]];
});
T("DN5 donation: off switch", async (w) => {
  w.bank.gold = 40000000; w.store["Goodies:donate_off"] = true;
  const m = merchant_char(w, { gold: 50000 }, DON_OVR);
  await w.clock.run(900);
  return [[w.donations.length === 0, "nothing given"]];
});
T("WT1 world watch: a boss going live and gone is logged, the boss table sorts by size, an event gets exactly one warning per limit", async (w) => {
  w.G.monsters = w.G.monsters || {}; w.G.monsters.phoenix = { name: "Phoenix", hp: 160000 }; w.G.monsters.mvampire = { name: "Dracul", hp: 500000 };
  w.G.events = { snowman: { name: "Snowman Hunt" } };
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR);
  const S = m.sb.parent.S = { schedule: { server_time: Date.now() + 5000, events: [{ id: "e1", event: "snowman", status: "scheduled", at: Date.now() + 5000 + 50 * 60000 }] } };
  await w.clock.run(60);
  S.phoenix = { live: true, hp: 150000, max_hp: 160000, map: "main", x: 100, y: 200 };
  S.mvampire = { live: true, hp: 500000, max_hp: 500000, map: "cave", x: 5, y: 6 };
  await w.clock.run(60);
  delete S.phoenix; S.mvampire.live = false;
  await w.clock.run(60);
  S.schedule.events[0].at = Date.now() + 5000 + 12 * 60000;
  await w.clock.run(60);
  await w.clock.run(1900);
  const rep = w.logs.filter((l) => l.who === "Goodies" && /Bosses \(largest first\): .*HP/.test(l.msg)).pop();
  const warns = w.logs.filter((l) => l.who === "Goodies" && /Event soon: Snowman Hunt/.test(l.msg)).map((l) => l.msg);
  return [[logged(w, "Goodies", /Boss up: Phoenix .*at main 100,200/), "phoenix up logged"], [logged(w, "Goodies", /Boss gone: Phoenix/), "phoenix gone logged"], [rep && rep.msg.indexOf("mvampire") < rep.msg.indexOf("phoenix"), "table lists the bigger boss first: " + (rep && rep.msg)], [warns.length === 3, "one warning per limit passed (60, 15, 5 min): " + warns.length]];
});
T("W2 gear sweep: a ring that does not beat what the Rangers wear stays in the bank", async (w) => {
  w.bank.items0.push({ name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const rings = { ring1: { name: "ringsj", level: 4 }, ring2: { name: "ringsj", level: 4 } };
  const send = () => { gear_rep(L, rings); gear_rep(F, rings); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  return [[!logged(w, "Goodies", /Gear sweep: ringsj/), "nothing taken"], [bank_count(w) === 1, "ring still in the bank"], [msgs(L, "gear_ready").length === 0, "no message"]];
});
T("W3 leader starts a courier trip when the Merchant says gear is waiting", async (w) => {
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  await w.clock.run(30);
  M.sb.send_cm("SexyDexy", { type: "gear_ready", names: ["Dexy3"] });
  await w.clock.run(300);
  return [[logged(w, "SexyDexy", /Courier trip: better gear is waiting at the Merchant/), "trip for gear"], [logged(w, "SexyDexy", /Courier Dexy2 is back \(ok\)/), "trip finished"]];
});
const fill_rest = (w) => { for (const k of ["items0", "items1", "items3"]) while (w.bank[k].length < 42) w.bank[k].push({ name: "wshoes", level: 0 }); };
const CP_OVR = MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]'], [/GEAR_SWEEP: true/, "GEAR_SWEEP: false"], [/SURPLUS_DRY_RUN: (true|false)/, "SURPLUS_DRY_RUN: false"]]);
T("X1 consolidate (bank nearly full): both Rangers already wear the +5 piece -> every other +5 of it is sold", async (w) => {
  for (let i = 0; i < 5; i++) w.bank.items0.push({ name: "plaincap", level: 5 });
  w.bank.items0.push({ name: "plaincap", level: 4 }); // below the cap level: untouched
  fill_rest(w);
  const m = merchant_char(w, { gold: 50000 }, CP_OVR); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const worn = { helmet: { name: "plaincap", level: 5 } };
  const send = () => { gear_rep(L, worn); gear_rep(F, worn); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  const left5 = w.bank.items0.filter((x) => x && x.name === "plaincap" && x.level === 5).length;
  return [[left5 === 0, "no spare +5 left in the bank (" + left5 + ")"], [w.bank.items0.some((x) => x && x.name === "plaincap" && x.level === 4), "the +4 stays"], [logged(w, "Goodies", /Sold 5 extra copie/), "sold 5"]];
});
T("X2 copy limit: earrings keep two per Ranger, everything else one", async (w) => {
  w.G.items.xear = { g: 1000, type: "earring", compound: { dex: 1 }, grades: [3, 5, 6, 7] };
  for (let i = 0; i < 6; i++) w.bank.items0.push({ name: "xear", level: 5 });
  for (let i = 0; i < 4; i++) w.bank.items0.push({ name: "plaincap", level: 5 });
  fill_rest(w);
  const m = merchant_char(w, { gold: 50000 }, CP_OVR); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  const n = (nm) => w.bank.items0.filter((x) => x && x.name === nm).length;
  return [[n("xear") === 4, "earrings kept: " + n("xear") + " (2 Rangers x 2)"], [n("plaincap") === 2, "caps kept: " + n("plaincap") + " (2 Rangers x 1)"]];
});
T("X3 copy limit: dry run only logs", async (w) => {
  for (let i = 0; i < 4; i++) w.bank.items0.push({ name: "plaincap", level: 5 });
  fill_rest(w);
  const m = merchant_char(w, { gold: 50000 }, CP_OVR.concat([[/SURPLUS_DRY_RUN: false/, "SURPLUS_DRY_RUN: true"]])); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  return [[logged(w, "Goodies", /Copy limit - dry run, would sell 2 extra/), "plans 2"], [w.bank.items0.filter((x) => x && x.name === "plaincap").length === 4, "bank untouched"]];
});
T("X4 copy limit waits while the bank has 10+ free item slots", async (w) => {
  for (let i = 0; i < 5; i++) w.bank.items0.push({ name: "plaincap", level: 5 });
  const m = merchant_char(w, { gold: 50000 }, CP_OVR); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { helmet: { name: "plaincap", level: 5 } }); gear_rep(F, { helmet: { name: "plaincap", level: 5 } }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  return [[w.bank.items0.filter((x) => x && x.name === "plaincap").length === 5, "nothing sold"], [!logged(w, "Goodies", /Consolidating bank/), "no consolidation"]];
});
T("B1 bag tidy: a full Merchant bag sells his junk, banks gear that must wait, and logs what fills it", async (w) => {
  const m = merchant_char(w, { gold: 50000 }, CP_OVR);
  for (let i = 0; i < 8; i++) add_item(m, "wshoes", 1);
  for (let i = 0; i < 30; i++) add_item(m, "plaincap", 1, 2);
  await w.clock.run(300);
  const junk = m.items.filter((i) => i && i.name === "wshoes").length;
  const caps = m.items.filter((i) => i && i.name === "plaincap").length;
  return [[logged(w, "Goodies", /Bag is nearly full \(0 free\): .*wshoes/), "census logged"], [junk === 0, "junk sold (" + junk + " left)"], [caps < 30 && w.bank.items0.some((x) => x && x.name === "plaincap"), "gear banked (bag holds " + caps + ")"]];
});
T("B2 bag tidy: extra +5 copies in the bag are sold when the Rangers already wear that piece", async (w) => {
  const m = merchant_char(w, { gold: 50000 }, CP_OVR); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const worn = { helmet: { name: "plaincap", level: 5 } };
  const send = () => { gear_rep(L, worn); gear_rep(F, worn); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(5); // the gear reports are in before the bag fills up
  for (let i = 0; i < 31; i++) add_item(m, "wshoes", 1);
  for (let i = 0; i < 6; i++) add_item(m, "plaincap", 1, 5);
  await w.clock.run(400);
  const caps = m.items.filter((i) => i && i.name === "plaincap").length;
  return [[caps === 0, "all 6 extra caps sold (" + caps + " left)"], [m.items.filter((i) => i && i.name === "wshoes").length === 0, "junk sold too"]];
});
T("B4 bag tidy: +0 accessories nobody needs (a complete triple of a non-preferred kind) are sold, not hoarded", async (w) => {
  w.G.items.badring = { g: 5000, type: "ring", compound: { dex: 0.1 }, grades: [3, 5, 6, 7] };
  const m = merchant_char(w, { gold: 50000 }, CP_OVR); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const worn = { ring1: { name: "ringsj", level: 5 }, ring2: { name: "ringsj", level: 5 } };
  const send = () => { gear_rep(L, worn); gear_rep(F, worn); };
  send(); w.clock.every(send, 60000);
  w.bank.items0.push({ name: "ringsj", level: 0 }); // makes ringsj the preferred ring
  await w.clock.run(5);
  for (let i = 0; i < 6; i++) add_item(m, "badring", 1, 0);
  for (let i = 0; i < 24; i++) add_item(m, "wshoes", 1);
  await w.clock.run(400);
  const bad = m.items.filter((i) => i && i.name === "badring").length;
  return [[bad === 0, "all badrings sold (" + bad + " left)"]];
});
T("B3 gear sweep waits for a missing gear report and says so", async (w) => {
  const m = merchant_char(w, { gold: 50000 }, CP_OVR);
  const L = fake_ranger(w);
  const F = make_char(w, "Dexy2", { x: -110, y: 25 }); gear_rep(F, {}); // reported once, then went quiet: stale after 10 min, "away" only after 30 min
  const send = () => gear_rep(L, {});
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[logged(w, "Goodies", /waiting for a fresh gear report from Dexy2/), "says who is missing"]];
});
T("B4 a follower that never reported (offline) does not block the surplus check or the sweep note", async (w) => {
  full_bank(w, 122);
  const m = merchant_char(w, { gold: 50000 }, SUR_OVR.concat([[/SURPLUS_DRY_RUN: true/, "SURPLUS_DRY_RUN: false"]])); m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w);
  const send = () => gear_rep(L, {});
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  return [[logged(w, "Goodies", /Surplus check: \d+ finished/), "the surplus check ran after the restart grace without Dexy2"], [!logged(w, "Goodies", /waiting for a fresh gear report from Dexy2/), "no warning about the absent follower"]];
});
const LAD_OVR = MERCH_OVR_COMPOUND.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]'], [/GEAR_SWEEP: true/, "GEAR_SWEEP: false"], [/SURPLUS_COPIES: true/, "SURPLUS_COPIES: false"]]);
const rings_at = (w, lv, nm) => { const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3); return all.filter((x) => x && x.name === (nm || "ringsj") && (x.level || 0) === lv).length; };
const lad_world = (w, worn) => { const m = merchant_char(w, { gold: 50000 }, LAD_OVR); const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const send = () => { gear_rep(L, worn || {}); gear_rep(F, worn || {}); }; send(); w.clock.every(send, 60000); return m; };
T("L1 compound ladder: nobody has a +1 ring yet -> base rings are compounded to +1, one per open slot, no +2", async (w) => {
  for (let i = 0; i < 18; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = lad_world(w);
  await w.clock.run(2500);
  const inbag = m.items.filter((x) => x && x.name === "ringsj" && x.level === 1).length;
  const lv2 = rings_at(w, 2) + m.items.filter((x) => x && x.name === "ringsj" && x.level === 2).length;
  return [[rings_at(w, 1) + inbag + lv2 >= 4, "at least four +1-or-better rings (2 Rangers x 2 ring slots): " + (rings_at(w, 1) + inbag + lv2)], [rings_at(w, 1) + inbag - 2 * lv2 >= 0 && rings_at(w, 1) + inbag + lv2 >= 4, "the +1 slots stay covered: +1=" + (rings_at(w, 1) + inbag) + " +2=" + lv2], [logged(w, "Goodies", /Compound ladder .*ringsj: \+1 \d\/4/), "ladder reported"]];
});
T("L2 compound ladder: every ring slot already has a +1 -> spare +1 rings go to +2", async (w) => {
  for (let i = 0; i < 6; i++) w.bank.items0.push({ name: "ringsj", level: 1 });
  const worn = { ring1: { name: "ringsj", level: 1 }, ring2: { name: "ringsj", level: 1 } };
  const m = lad_world(w, worn);
  await w.clock.run(900);
  const inbag = m.items.filter((x) => x && x.name === "ringsj" && x.level === 2).length;
  return [[rings_at(w, 2) + inbag === 1, "one +2 ring made"], [rings_at(w, 1) + m.items.filter((x) => x && x.name === "ringsj" && x.level === 1).length === 3, "three +1 stay behind"]];
});
T("L3 compound ladder: +1 rings the Rangers still lack are NOT compounded away (lower tier first)", async (w) => {
  for (let i = 0; i < 3; i++) w.bank.items0.push({ name: "ringsj", level: 1 });
  const m = lad_world(w, {}); // nobody wears anything: 3 +1 rings are fewer than the 4 slots
  await w.clock.run(900);
  const inbag = m.items.filter((x) => x && x.name === "ringsj" && x.level === 2).length;
  return [[rings_at(w, 2) + inbag === 0, "no +2 made while +1 slots are open"]];
});
T("L4 compound ladder: only the best accessory of a kind is compounded", async (w) => {
  w.G.items.badring = { g: 5000, type: "ring", compound: { dex: 0.1 }, grades: [3, 5, 6, 7] };
  for (let i = 0; i < 6; i++) w.bank.items0.push({ name: "ringsj", level: 0 }, { name: "badring", level: 0 });
  const m = lad_world(w);
  await w.clock.run(1200);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items);
  const n = (nm, lv) => all.filter((x) => x && x.name === nm && (x.level || 0) === lv).length;
  return [[n("ringsj", 1) === 1 && n("ringsj", 0) === 3, "ringsj: one triple made one +1, three +0 stay behind"], [n("badring", 0) === 6 && n("badring", 1) === 0, "badring left alone"]];
});
T("CP1 compound safety: five identical rings -> nothing is compounded (a failure would destroy the last triple)", async (w) => {
  for (let i = 0; i < 5; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = lad_world(w);
  await w.clock.run(900);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items);
  const n = (lv) => all.filter((x) => x && x.name === "ringsj" && (x.level || 0) === lv).length;
  return [[n(0) === 5 && n(1) === 0, "still five +0 rings: " + n(0) + "/" + n(1)]];
});
T("CP2 compound safety: nine identical rings -> two triples, one triple always stays", async (w) => {
  for (let i = 0; i < 9; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = lad_world(w);
  await w.clock.run(1500);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items);
  const n = (lv) => all.filter((x) => x && x.name === "ringsj" && (x.level || 0) === lv).length;
  return [[n(0) >= 3, "at least three +0 rings left: " + n(0)], [n(1) === 2, "two +1 made: " + n(1)]];
});
const book_world = (w) => { w.G.items.cscroll2 = { g: 9200000, s: true }; w.G.items.wbookhs = { g: 960000, type: "source", compound: { dex: 6, vit: 6, resistance: 30 }, grades: [0, 2, 6, 7], set: "holidays" }; w.bank.gold = 100000000; const m = merchant_char(w, { gold: 50000 }, LAD_OVR.concat([[/COMPOUND_FOCUS: \{ \/\*[^*]*\*\/ \}, COMPOUND_FOCUS_OLD:/, "COMPOUND_FOCUS_X: {}, COMPOUND_FOCUS:"]])); const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000); return m; };
const books_at = (w, m, lv) => [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && x.name === "wbookhs" && (x.level || 0) === lv).length;
T("BJ1 bank junk sweep: ice skates, Grinch capes, staffs, Merry Ranger bows and Books of Cheer in the bank are sold; other items stay", async (w) => {
  for (const n of ["iceskates", "gcape", "mushroomstaff", "ornamentstaff"]) { w.G.items[n] = w.G.items[n] || { g: 10000 }; w.bank.items1.push({ name: n, level: 0 }, { name: n, level: 0 }); }
  w.G.items.merry = { g: 124000, type: "weapon", wtype: "bow", attack: 40, range: 40, upgrade: { attack: 5.5, range: 8 }, grades: [0, 7, 10, 12] }; w.bank.items1.push({ name: "merry", level: 0 }, { name: "merry", level: 0 });
  w.G.items.wbookhs = { g: 960000, type: "source", compound: { dex: 6 }, grades: [0, 2, 6, 7] };
  w.bank.items1.push({ name: "wbookhs", level: 0 }, { name: "ringhs", level: 0 });
  const m = lad_world(w);
  const g0 = m.gold;
  await w.clock.run(1500);
  const left = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && ["iceskates", "gcape", "mushroomstaff", "ornamentstaff"].indexOf(x.name) !== -1).length + [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && x.name === "merry").length;
  const books = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && x.name === "wbookhs").length;
  return [[left === 0, "junk left: " + left], [books === 0, "books left: " + books], [logged(w, "Goodies", /Bank junk sweep/), "logged the sweep"]];
});
const UPG_REAL = UPG_FAST.slice(1);
T("UP1 upgrade safety: a single copy is never upgraded", async (w) => {
  w.bank.items0.push({ name: "plaincap", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, UPG_REAL);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(600);
  return [[!logged(w, "Goodies", /UPGRADE SUCCESS/), "no upgrade attempted"], [logged(w, "Goodies", /Gear sweep: plaincap \+0 for/), "handed to a Ranger as it is"]];
});
T("UPF1 per-item upgrade cap: a Fire Bow goes on to +7 with the 40,000 g scroll (grade 1), +7 is the end, and other gear still stops at UPGRADE_MAX_LEVEL", async (w) => {
  w.G.items.scroll1 = { g: 40000, s: true, type: "uscroll", grade: 1 }; w.G.items.firebow.wtype = "bow";
  w.bank.items0.push({ name: "firebow", level: 6 }, { name: "firebow", level: 6 }, { name: "plaincap", level: 5 }, { name: "plaincap", level: 5 });
  const ovr = Object.assign(UPG_REAL.filter((x) => !/UPGRADE_MAX_LEVEL: 5/.test(String(x[0]))).concat([[/UPGRADE_SESSION_PCT: 0\.1/, "UPGRADE_SESSION_PCT: 1"]]), { fire_on: true });
  const m = merchant_char(w, { gold: 500000 }, ovr);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { mainhand: { name: "firebow", level: 7 } }); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(1500);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items);
  const lv = (n, x) => all.filter((i) => i && i.name === n && (i.level || 0) === x).length;
  return [[lv("firebow", 7) === 1 && lv("firebow", 6) === 1, "one Fire Bow +7, the spare +6 stays: +7=" + lv("firebow", 7) + " +6=" + lv("firebow", 6)], [lv("firebow", 8) === 0, "never above +7"], [lv("plaincap", 6) === 0, "plaincap stays at +5 (the general cap)"]];
});
T("UPF2 Fire Bow fodder: a bow that does not beat SexyDexy's is upgraded even at a low chance and without a spare; once it beats his, it is set aside and handed to him", async (w) => {
  w.G.items.scroll1 = { g: 40000, s: true, type: "uscroll", grade: 1 }; w.G.items.firebow.wtype = "bow";
  w.bank.items0.push({ name: "firebow", level: 4 });
  const ovr = Object.assign(UPG_REAL.filter((x) => !/UPGRADE_MAX_LEVEL: 5/.test(String(x[0]))).concat([[/UPGRADE_SESSION_PCT: 0\.1/, "UPGRADE_SESSION_PCT: 1"]]), { fire_on: true });
  const m = merchant_char(w, { gold: 500000 }, ovr);
  const real = m.sb.upgrade; m.sb.upgrade = (a, si, off, only) => (only ? Promise.resolve({ chance: 0.2, grace: 0 }) : real(a, si, off, only));
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { mainhand: { name: "firebow", level: 4 } }); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(2400);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items);
  const lv = (x) => all.filter((i) => i && i.name === "firebow" && (i.level || 0) === x).length;
  return [[logged(w, "Goodies", /UPGRADE SUCCESS - firebow \+4 -> \+5 with scroll1: 20%/), "upgraded at 20% with no spare copy"], [lv(5) === 1 && lv(6) === 0, "one +5, no +6 (set aside): +5=" + lv(5) + " +6=" + lv(6)], [logged(w, "Goodies", /Upgrade: firebow \+5 is better than what SexyDexy wears - set aside/), "set-aside line"], [m.items.some((x) => x && x.name === "firebow" && x.level === 5) || logged(w, "Goodies", /Gear sweep: firebow \+5 for SexyDexy/), "the +5 is held in the Merchant's bag for SexyDexy (the upgrade round's own hand-over)"]];
});
T("UPF3 Fire Bow set aside: bows that already beat SexyDexy's are not upgraded (no gamble) and one goes to him", async (w) => {
  w.G.items.scroll1 = { g: 40000, s: true, type: "uscroll", grade: 1 }; w.G.items.firebow.wtype = "bow";
  w.bank.items0.push({ name: "firebow", level: 6 }, { name: "firebow", level: 6 });
  const ovr = Object.assign(UPG_REAL.filter((x) => !/UPGRADE_MAX_LEVEL: 5/.test(String(x[0]))).concat([[/UPGRADE_SESSION_PCT: 0\.1/, "UPGRADE_SESSION_PCT: 1"]]), { fire_on: true });
  const m = merchant_char(w, { gold: 500000 }, ovr);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, { mainhand: { name: "firebow", level: 4 } }); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(2400);
  return [[!logged(w, "Goodies", /UPGRADE SUCCESS/), "nothing upgraded"], [logged(w, "Goodies", /Gear sweep: firebow \+6 for SexyDexy/), "a +6 is set aside for SexyDexy"]];
});
T("UP2 upgrade safety: two copies -> one is upgraded, the other stays as the fallback", async (w) => {
  w.bank.items0.push({ name: "plaincap", level: 0 }, { name: "plaincap", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, UPG_REAL.concat([[/UPGRADE_MAX_LEVEL: 1/, "UPGRADE_MAX_LEVEL: 3"]]));
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items);
  const lv = (x) => all.filter((i) => i && i.name === "plaincap" && (i.level || 0) === x).length;
  return [[w.logs.filter((l) => l.who === "Goodies" && /UPGRADE SUCCESS/.test(l.msg)).length === 1, "exactly one upgrade"], [lv(1) === 1 && lv(0) === 1, "one +1 and one +0 remain: +0=" + lv(0) + " +1=" + lv(1)], [logged(w, "Goodies", /no second copy to fall back on/), "stops and says why"]];
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
T("E2 exchange run: fewer than 30 free bag slots -> no bank trip, no exchange", async (w) => {
  w.bank.items0.push({ name: "mistletoe", q: 30 }, { name: "candycane", q: 12 }, { name: "ornament", q: 45 });
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  for (let i = 0; i < 20; i++) add_item(m, "ascale", 1); // (not junk, so the junk tidy leaves them) 4 potion stacks + 20 = 24 used, 18 free
  await w.clock.run(900);
  return [[m.exchanges.length === 0, "nothing exchanged"], [logged(w, "Goodies", /Exchange run waits: only 18 free bag slots, it needs 30/), "says why it waits"], [!logged(w, "Goodies", /Moving to bank - compound round/) || !logged(w, "Goodies", /Exchange run:/), "no exchange run started"]];
});
T("TG bag tidy: bag nearly full of non-junk drops -> everything he does not need on him is banked, potions stay", async (w) => {
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"]]);
  for (let i = 0; i < 34; i++) add_item(m, "ascale", 1);
  await w.clock.run(900);
  const left = m.items.filter((i) => i && i.name === "ascale").length;
  const pots = m.items.filter((i) => i && /pot/.test(i.name)).length;
  return [[left === 0, "drops banked, left in the bag: " + left], [pots === 4, "the four potion stacks stayed: " + pots], [logged(w, "Goodies", /Bag tidy: banked \d+ more item/), "logged it"]];
});
T("TG2 Grinch gear nobody needs is sold at Gabriel even though the bank is full; with stale gear reports it is held", async (w) => {
  w.G.items.gcape = { name: "Grinch Cape", g: 40000, type: "cape" };
  w.bank.items0 = []; for (let i = 0; i < 200; i++) w.bank.items0.push({ name: "wcap", q: 1 }); // the bank is full
  const m = merchant_char(w, { gold: 5000 }, SW_OVR); m.sb.calculate_item_value = () => 40000;
  for (let i = 0; i < 6; i++) add_item(m, "gcape", 1);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  const left = m.items.filter((i) => i && i.name === "gcape").length;
  return [[left === 0, "capes left in the bag: " + left], [logged(w, "Goodies", /Bag tidy: sold 6 item/), "tidy sold them"], [m.gold > 5000, "gold went up: " + m.gold]];
});
T("TG3 Grinch gear is held (not sold) while the gear reports are missing", async (w) => {
  w.G.items.xmace = { name: "Merry Mace", g: 40000, type: "weapon", wtype: "mace" };
  const m = merchant_char(w, { gold: 5000 }, SW_OVR);
  for (let i = 0; i < 6; i++) add_item(m, "xmace", 1);
  await w.clock.run(900);
  const left = m.items.filter((i) => i && i.name === "xmace").length;
  return [[left === 6, "maces still in the bag: " + left]];
});
T("TG4 Ranger drops off a load of Grinch gear -> the Merchant tidies his bag right after the hand-over", async (w) => {
  w.G.items.gcape = { name: "Grinch Cape", g: 40000, type: "cape" };
  const m = merchant_char(w, { gold: 5000 }, MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]'], [/exch2_next: now\(\) \+ 150000/, "exch2_next: now() + 99999999"]])); m.sb.calculate_item_value = () => 40000;
  const r = ranger_char(w);
  const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(r, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(150); // the Merchant's start-up sweep is over
  for (let i = 0; i < 30; i++) add_item(r, "gcape", 1);
  await w.clock.run(400);
  const inM = m.items.filter((i) => i && i.name === "gcape").length;
  const inR = r.items.filter((i) => i && i.name === "gcape").length;
  return [[inR < 30, "the Ranger handed capes over: " + (30 - inR)], [inM === 0, "none left in the Merchant's bag: " + inM], [m.gold > 5000, "sold them: gold " + m.gold]];
});
T("E3 exchange run: exactly enough space (event stacks + 30 free) -> it runs", async (w) => {
  w.bank.items0.push({ name: "mistletoe", q: 30 }, { name: "candycane", q: 12 }, { name: "ornament", q: 45 });
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  for (let i = 0; i < 4; i++) add_item(m, "wshoes", 1); // 8 used, 34 free; 3 stacks taken out leaves 31
  await w.clock.run(900);
  return [[m.exchanges.length > 0, "exchanged " + m.exchanges.length + " times"]];
});
T("HLD1 manual hold: he walks to Lost and Found and stays (no walking home) until released", async (w) => {
  if (!IS_R5) return skip_r4;
  const m = merchant_char(w, { gold: 5000 });
  m.sb.set("hold_at", "lostandfound");
  await w.clock.run(300);
  const there = m.map === "woffice" && Math.hypot(m.x + 24, m.y + 178) < 60;
  const held = logged(w, "Goodies", /Manual hold: at Lost and Found/);
  await w.clock.run(600);
  const still = m.map === "woffice" && Math.hypot(m.x + 24, m.y + 178) < 60;
  m.sb.set("hold_at", "release");
  await w.clock.run(300);
  return [[held, "arrived and announced"], [there, "at the NPC (" + m.map + " " + Math.round(m.x) + "," + Math.round(m.y) + ")"], [still, "still there 10 min later"], [logged(w, "Goodies", /Manual hold: released/), "released"], [m.map === "main", "back on main"]];
});
T("BX1 Bank excess: everything but potions and stand stock goes to the bank", async (w) => {
  if (!IS_R5) return skip_r4;
  const m = merchant_char(w, { gold: 5000 });
  add_item(m, "oddity", 1, 0); add_item(m, "oddity", 1, 0); add_item(m, "cscroll0", 5); add_item(m, "stand0", 1, 0);
  m.sb.set("bank_excess", "1");
  await w.clock.run(300);
  const inbag = (n) => m.items.filter((x) => x && x.name === n).reduce((a, x) => a + (x.q || 1), 0);
  const names = m.items.filter(Boolean).map((i) => i.name);
  return [[logged(w, "Goodies", /Bank excess: \d+ item stack\(s\) moved to the bank; the bag now holds only potions/), "reported"], [inbag("oddity") === 0 && inbag("cscroll0") === 0, "excess gone: " + names.join(",")], [inbag("hpot1") > 0 && inbag("hpot0") > 0, "potions stay"], [inbag("stand0") === 1, "the stand item stays"]];
});
T("EX7 exchange rounds take turns: with both due, round 1 and round 2 alternate (a round that started hands the turn to the other)", async (w) => {
  if (!IS_R5) return skip_r4;
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/EXCHANGE_EVERY_MS: 30 \* 60000/, "EXCHANGE_EVERY_MS: 60000"], [/EXCHANGE2_EVERY_MS: 30 \* 60000/, "EXCHANGE2_EVERY_MS: 60000"], [/EXCHANGE_EMPTY_BACKOFF_MS: 60 \* 60000/, "EXCHANGE_EMPTY_BACKOFF_MS: 60000"], [/exch2_next: now\(\) \+ 150000/, "exch2_next: now() + 1000"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  await w.clock.run(900);
  const seq = w.logs.filter((l) => l.who === "Goodies" && /^\[Merchant\] (Exchange run|Exchange round 2):/.test(l.msg)).map((l) => (/\] Exchange round 2:/.test(l.msg) ? 2 : 1));
  const alt = seq.length >= 4 && seq.every((v, i) => i === 0 || v !== seq[i - 1]);
  return [[alt, "rounds alternate: " + seq.join(",") + " / " + w.logs.filter((l) => /xchange/.test(l.msg)).slice(0, 4).map((l) => l.who + ":" + l.msg.slice(0, 40)).join(" | ")]];
});
T("E4 Market Parcels go to Xyn: 10 per hour, then nothing until the hour is over", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.marketparcel = { name: "Market Parcel", type: "gem", e: 1, s: 9999, g: 100 };
  w.bank.items0.push({ name: "marketparcel", q: 25 });
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  await w.clock.run(900);
  const first = m.exchanges.filter((e) => e.name === "marketparcel").length;
  await w.clock.run(1800);
  const mid = m.exchanges.filter((e) => e.name === "marketparcel").length;
  await w.clock.run(2400);
  const later = m.exchanges.filter((e) => e.name === "marketparcel").length;
  return [[first === 10, "first hour: " + first], [mid === 10, "30 min later still " + mid], [later === 20, "after the hour: " + later]];
});

T("E6 Exchange round 2 at Xyn: Raw Emerald, Armor Box and Weapon Box, 5 each per round; round 1 leaves them alone", async (w) => {
  if (!IS_R5) return skip_r4;
  for (const [k, n] of [["gem0", "Raw Emerald"], ["armorbox", "Armor Box"], ["weaponbox", "Weapon Box"]]) { w.G.items[k] = { name: n, type: "box", e: 1, s: 9999, g: 100000 }; w.bank.items0.push({ name: k, q: 12 }); }
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/exch2_next: now\(\) \+ 150000/, "exch2_next: now() + 100000"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  await w.clock.run(60);
  const at_round1 = m.exchanges.filter((e) => ["gem0", "armorbox", "weaponbox"].indexOf(e.name) !== -1).length;
  await w.clock.run(400);
  const ex = (n) => m.exchanges.filter((e) => e.name === n);
  return [[at_round1 === 0, "round 1 exchanged none of them: " + at_round1], [ex("gem0").length === 5 && ex("armorbox").length === 5 && ex("weaponbox").length === 5, "5 each in the first round 2: " + ex("gem0").length + "/" + ex("armorbox").length + "/" + ex("weaponbox").length], [ex("gem0")[0] && ex("gem0")[0].map === "main" && ex("gem0")[0].x < -200, "at Xyn"], [logged(w, "Goodies", /Exchange round 2:/), "round 2 is named in the log"]];
});
T("E5 quantum pieces: one of each is crafted into a Xmas Box at Leo, the box goes to Xyn, leftovers go back to the bank", async (w) => {
  if (!IS_R5) return skip_r4;
  const names = ["x0","x1","x2","x3","x4","x5","x6","x7","x8"];
  w.G.craft.xbox = { items: names.map((n) => [1, n]), cost: 0 };
  w.G.items.xbox = { name: "Xmas Box", type: "quest", e: 1, s: 9999, g: 1000000 };
  for (const n of names) { w.G.items[n] = { name: "Quantum Piece", type: "quest", s: 9999, g: 4000 }; w.bank.items0.push({ name: n, q: 3 }); }
  const m = merchant_char(w, { gold: 5000 }, [[/COMPOUND_ENABLED: true/, "COMPOUND_ENABLED: false"], [/UPGRADE_ENABLED: true/, "UPGRADE_ENABLED: false"], [/exch_next: now\(\) \+ 90000/, "exch_next: now() + 1000"]]);
  await w.clock.run(900);
  const inbank = (n) => w.bank.items0.filter((x) => x && x.name === n).reduce((a, x) => a + (x.q || 1), 0);
  const inbag = (n) => m.items.filter((x) => x && x.name === n).reduce((a, x) => a + (x.q || 1), 0);
  const ex = m.exchanges.filter((e) => e.name === "xbox");
  return [[logged(w, "Goodies", /Crafted a Xmas Box/), "crafted"], [ex.length === 1 && ex[0].map === "main", "box exchanged once on the main map"],
    [names.every((n) => inbank(n) === 2 && inbag(n) === 0), "pieces: " + names.map((n) => inbank(n) + "/" + inbag(n)).join(" ")]];
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
T("M10 the Compound odds / Compound test buttons are gone (removed at Sean's request)", async (w) => {
  const m = merchant_char(w, { gold: 20000 });
  await w.clock.run(10);
  return [[!m.buttons.al_comp_odds && !m.buttons.al_comp_test, "no compound test buttons"], [!!m.buttons.al_sell_round && !!m.buttons.al_bank_excess, "the other buttons are still there"]];
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
  for (const [n, q] of [["hpot1", 1000], ["mpot1", 1000], ["hpot0", 1000], ["mpot0", 1000]]) add_item(m, n, q);
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  F2.sb.on_party_invite("Mallory"); L.sb.on_party_invite("Dexy2"); // strangers and invitations to the leader from a follower are ignored (a follower also accepts his leader)
  const stray = w.party.Dexy2 || w.party.Dexy3 || w.party.SexyDexy || null;
  await w.clock.run(40);
  const inv = (w.invites || []).filter((x) => x.indexOf("Goodies>") === 0).map((x) => x.slice(8));
  return [[!stray, "invites from strangers (and to the leader from a follower) are ignored"], [inv.indexOf("SexyDexy") !== -1 && inv.indexOf("Dexy2") !== -1 && inv.indexOf("Dexy3") !== -1, "Merchant invited all three: " + inv.join(",")],
    [w.party.SexyDexy === "Goodies" && w.party.Dexy2 === "Goodies" && w.party.Dexy3 === "Goodies", "all three joined his party"], [!(w.invites || []).some((x) => /^(SexyDexy|Dexy2|Dexy3)>/.test(x)), "no Ranger sends invites"]];
});
T("B1 party farms bees only until every follower is level 60, then goals start", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2", { level: 40 }); const F3 = party_ranger(w, "Dexy3", { level: 70, support: true });
  await w.clock.run(240);
  const held = !logged(w, "SexyDexy", /Farm goal: Phoenix/) && logged(w, "SexyDexy", /Party farms bees only: Dexy2/);
  F2.level = 60;
  await w.clock.run(60);
  return [[held, "no goal while Dexy2 is level 40"], [logged(w, "SexyDexy", /Everyone is level 60\+/), "announced the party is ready"], [logged(w, "SexyDexy", /Farm goal: Phoenix/), "goal farming started once both reached 60"]];
});
T("HB1 bees-only party, everyone level 50+: an easy Daisy hunt is taken (goals stay off); below 50 nothing", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.snake = { name: "Snake", attack: 24, frequency: 0.6, hp: 720 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.maps.main.monsters = [{ type: "snake", count: 5, boundary: [-300, 1700, 100, 2000] }, { type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const L = party_ranger(w, "SexyDexy", { x: 387, y: 1066, attack: 440, frequency: 2 }); const F2 = party_ranger(w, "Dexy2", { level: 50 }); w.DBG = 1;
  L.sb.character.s = { monsterhunt: { id: "snake", c: 5, ms: 1200000 } };
  await w.clock.run(120);
  const early = logged(w, "SexyDexy", /heading to Snake/);
  F2.level = 50;
  await w.clock.run(240);
  return [[!early, "no hunt while a member is level 45"], [logged(w, "SexyDexy", /heading to Snake/), "easy hunt taken at 50"], [!logged(w, "SexyDexy", /Farm goal: Phoenix/), "no goal (still bees-only, below 60)"]];
});
T("P2 follower alone (leader silent): farms bees on his own, no walk to nowhere", async (w) => {
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const F = party_ranger(w, "Dexy2", { x: 600, y: 1000 });
  await w.clock.run(60);
  return [[!logged(w, "Dexy2", /following SexyDexy/), "never tried to follow a leader that is not there"], [F.map === "main", "stayed on main"]];
});
T("P3 real Merchant serves a follower Ranger's restock", async (w) => {
  const m = make_char(w, "Goodies", { ctype: "merchant", x: -115, y: -5, gold: 100000 }, "AutoMerchant v4.js", MERCH_OVR.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]']]));
  for (const [n, q] of [["hpot1", 1000], ["mpot1", 1000], ["hpot0", 1000], ["mpot0", 1000]]) add_item(m, n, q);
  const F = party_ranger(w, "Dexy2", {}, [["hpot1", 5], ["mpot1", 5]]);
  await w.clock.run(200);
  return [[F.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "follower got potions from the Merchant"], [logged(w, "Goodies", /Job restock from Dexy2/), "Merchant queued Dexy2's request"]];
});
T("R13 farm goal: monster never shows up -> goal rests, back to the bees", async (w) => {
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(520);
  return [[logged(w, "SexyDexy", /Farm goal Phoenix ended: not in view/), "gave up on an absent Phoenix"], [Math.hypot(r.x - 496, r.y - 1068) < 250 || logged(w, "SexyDexy", /Moving to main \(496, 1068\) - drifted/), "heading back to the bee spot: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"]];
});
T("GS1 farm goal with several spawn areas (the Phoenix: 5 random-respawn areas): every main-map area is searched in turn, other maps are skipped, then the goal rests", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.halloween = { spawns: [[0, 0]] }; w.G.maps.cave = { spawns: [[0, 0]] };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, stype: "randomrespawn", boundaries: [["main", 708, -300, 1668, -86], ["main", 378, 1686, 904, 1920], ["main", -1358, -118, -1010, 1680], ["halloween", -166, 453, 182, 808], ["cave", -375, -1287, 14, -1041]] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(900);
  const pts = w.logs.filter((l) => l.who === "SexyDexy" && /Moving to main \((-?\d+), (-?\d+)\) - (searching for|heading to) Phoenix/.test(l.msg)).map((l) => l.msg.match(/\((-?\d+), (-?\d+)\)/).slice(1).map(Number));
  const in_box = (b) => pts.some(([x, y]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  return [[in_box([708, -300, 1668, -86]) && in_box([378, 1686, 904, 1920]) && in_box([-1358, -118, -1010, 1680]), "went to all three main-map areas: " + pts.length + " moves"],
    [!w.logs.some((l) => /halloween|cave/.test(l.msg) && /Phoenix/.test(l.msg)), "never went to the halloween or cave areas"],
    [logged(w, "SexyDexy", /Not here \(1 of 3 Phoenix spawn areas searched\)/) && logged(w, "SexyDexy", /Not here \(2 of 3/), "moved on area by area"],
    [logged(w, "SexyDexy", /Farm goal Phoenix ended: searched every Phoenix spawn area without seeing it/), "rested after searching every area"]];
});
T("GT1 farm goal: a \"Goal:\" progress line every minute, and a result line (time, seen or not, kills, loot) when it ends", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(520);
  const notes = w.logs.filter((l) => l.who === "SexyDexy" && /Goal: Phoenix - \d+ of 10 min \|/.test(l.msg)).length;
  return [[notes >= 2, "progress lines: " + notes], [logged(w, "SexyDexy", /Farm goal Phoenix result: \d+ min, never seen, kills ~0, 0 of 1 areas searched, loot: nothing \| all sessions so far: 1 \(seen in 0\)/), "result line"]];
});
T("GT2 farm goal: kills are estimated and loot is counted while the goal runs", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(30);
  r.sb.parent.entities.p1 = { id: "p1", type: "monster", mtype: "phoenix", visible: true, dead: false, x: r.x + 30, y: r.y, hp: 20000, max_hp: 160000, attack: 1 };
  await w.clock.run(3);
  delete r.sb.parent.entities.p1; // gone at 12% HP = a kill
  for (const h of r._h.loot || []) h({ id: "c1", items: [{ name: "dexearring", q: 1 }, { name: "stormfeather", q: 2 }] });
  await w.clock.run(5);
  await w.clock.run(520);
  return [[(r._h.loot || []).length === 1, "loot hook registered"], [logged(w, "SexyDexy", /Farm goal Phoenix result: .*seen \(first after \d+ min\), kills ~1, .*loot: 1x dexearring, 2x stormfeather/), "kill and loot in the result line"]];
});
T("BC1 boss events end after the 15 min cap (the Snowman) and the party is not pulled back in for 30 min", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.snowman = { name: "Snowman", attack: 1, frequency: 1, hp: 20000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.snowman = { live: true, hp: 20000000, max_hp: 20000000, map: "main", x: 900, y: 1066, target: null };
  await w.clock.run(960);
  const capped = logged(w, "SexyDexy", /Boss event Snowman ended: time cap of 15 min reached/);
  await w.clock.run(200);
  const starts = w.logs.filter((l) => l.who === "SexyDexy" && /Boss event: Snowman is up/.test(l.msg)).length;
  return [[capped, "ended by the cap"], [starts === 1, "not rejoined during the rest: starts " + starts]];
});
T("BA1 after a boss event ends a courier trip brings everyone's drops to the Merchant", async (w) => {
  if (!IS_R5) return skip_r4;
  const M = COUR_MERCH(w);
  w.G.monsters.snowman = { name: "Snowman", attack: 1, frequency: 1, hp: 20000000, respawn: 43200 };
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  const S = L.sb.parent.S = L.sb.parent.S || {};
  S.snowman = { live: true, hp: 20000000, max_hp: 20000000, map: "main", x: 900, y: 1066, target: null };
  for (let i = 0; i < 2; i++) add_item(F3, "oddity", 1, 0);
  add_item(L, "oddity", 1, 0);
  await w.clock.run(1300);
  const at_m = M.items.filter((i) => i && i.name === "oddity").length + w.bank.items0.filter((i) => i && i.name === "oddity").length;
  const left = [L, F2, F3].reduce((a, c) => a + c.items.filter((i) => i && i.name === "oddity").length, 0);
  return [[logged(w, "SexyDexy", /Boss event Snowman ended/), "event ended"], [logged(w, "SexyDexy", /Courier trip: the Snowman event is over - everyone's drops go to the Merchant/), "trip started after the event"], [left === 0 && at_m === 3, "Rangers hold " + left + ", Merchant holds " + at_m]];
});
T("BT2 a live boss raises the Merchant's potion stock target (he restocks from 1000 up to 2400)", async (w) => {
  if (!IS_R5) return skip_r4;
  const m = merchant_char(w);
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  const S = m.sb.parent.S = m.sb.parent.S || {};
  S.grinch = { live: true, hp: 3000000, max_hp: 3000000, map: "main", x: -100, y: 20, target: null };
  m.gold = 5000000;
  await w.clock.run(400);
  const q = (n) => m.items.filter((i) => i && i.name === n).reduce((a, i) => a + (i.q || 1), 0);
  return [[q("hpot1") > 1000 && q("mpot1") > 1000, "stock now hp " + q("hpot1") + " / mp " + q("mpot1")]];
});

T("BT1 a boss event starts with a top-off trip when a Ranger has fewer than 200 potions", async (w) => {
  if (!IS_R5) return skip_r4;
  const M = COUR_MERCH(w);
  w.G.monsters.snowman = { name: "Snowman", attack: 1, frequency: 1, hp: 20000000, respawn: 43200 };
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  for (const c of [L, F2, F3]) for (const i of c.items) if (i && /^[hm]pot1$/.test(i.name)) i.q = 150;
  const S = L.sb.parent.S = L.sb.parent.S || {};
  S.snowman = { live: true, hp: 20000000, max_hp: 20000000, map: "main", x: 900, y: 1066, target: null };
  await w.clock.run(60);
  return [[logged(w, "SexyDexy", /Boss event: Snowman is up/), "event started"], [logged(w, "SexyDexy", /Courier trip: .*top off first/), "top-off trip started"]];
});

T("BP1 boss priority: a running Snowman event gives way when the Grinch turns up, and the Grinch event starts at once", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.snowman = { name: "Snowman", attack: 1, frequency: 1, hp: 20000000, respawn: 43200 };
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.snowman = { live: true, hp: 20000000, max_hp: 20000000, map: "main", x: 900, y: 1066, target: null };
  await w.clock.run(60);
  const snow = logged(w, "SexyDexy", /Boss event: Snowman is up/);
  S.grinch = { live: true, hp: 3000000, max_hp: 3000000, map: "main", x: -100, y: 20, target: null };
  await w.clock.run(60);
  return [[snow, "Snowman event started first"], [logged(w, "SexyDexy", /Boss event Snowman ended: a higher-priority boss \(Grinch\) is up/), "Snowman gave way"], [logged(w, "SexyDexy", /Boss event: Grinch is up/), "Grinch event started"]];
});
T("DG1 danger stop-gap: a fast HP drop with three monsters on him is logged and starts town; the death report names the attackers", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066, hp: 1000, max_hp: 1000 }, [["hpot1", 100], ["mpot1", 100]]);
  let towns = 0; r.sb.town = () => { towns++; return Promise.resolve({}); };
  for (let i = 0; i < 3; i++) r.sb.parent.entities["b" + i] = { id: "b" + i, type: "monster", mtype: "bee", visible: true, dead: false, x: 387 + 10 * i, y: 1066, target: "SexyDexy", attack: 1 };
  await w.clock.run(2);
  r.hp = 250; // 75% lost at once
  await w.clock.run(2);
  const warned = logged(w, "SexyDexy", /DANGER: HP 25% after losing 7\dB?% in 4s, 3x bee on me - casting town/) || logged(w, "SexyDexy", /DANGER: HP \d+% after losing \d+% in 4s, 3x bee on me - casting town/);
  r.rip = true;
  await w.clock.run(8);
  return [[warned, "danger line"], [towns >= 1, "town cast: " + towns], [logged(w, "SexyDexy", /Dead - respawning \(last attackers: 3x bee\)/), "death report"]];
});
const NOPOST = [/ post: true, post_radius: 600/, ""]; // these scenarios test the chasing mode (a boss without a post)
T("BE1 Grinch event: leader walks to the server position, fights him, keeps searching 5 min after he vanishes, then gives up", async (w) => {
  RANGER_OVR.push(NOPOST);
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 24000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.attacks = 0; const oa = r.sb.attack; r.sb.attack = (t) => { r.attacks++; return oa(t); };
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.grinch = { live: true, hp: 20000000, max_hp: 24000000, map: "main", x: 900, y: 1066, target: null };
  await w.clock.run(40);
  const started = logged(w, "SexyDexy", /Boss event: Grinch is up at main 900,1066/);
  const walked = r.x > 700;
  r.sb.parent.entities.g1 = { id: "g1", type: "monster", mtype: "grinch", visible: true, dead: false, x: r.x + 50, y: r.y, hp: 20000000, max_hp: 24000000, attack: 9 };
  await w.clock.run(20);
  const shot = r.attacks > 0;
  delete r.sb.parent.entities.g1; S.grinch.live = false; // he teleported away
  await w.clock.run(200);
  const still = !logged(w, "SexyDexy", /Boss event Grinch ended/);
  await w.clock.run(150);
  RANGER_OVR.pop();
  return [[started, "announced with live HP"], [walked, "walked toward the Grinch: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"], [shot, "attacked him: " + r.attacks],
    [still, "still searching 200s after he vanished"], [logged(w, "SexyDexy", /Boss event Grinch ended: not seen for 5 min/), "gave up after 5 min"]];
});
T("BE7 boss in view: a farm goal must not pull the leader away from the boss (regression: he moved to the Snowman and walked back to the hunt)", async (w) => {
  RANGER_OVR.push(NOPOST);
  w.G.monsters.snowman = { name: "Snowman", attack: 9, frequency: 0.5, hp: 5000000, respawn: 43200 };
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.attacks = 0; const oa = r.sb.attack; r.sb.attack = (t) => { r.attacks++; return oa(t); };
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.snowman = { live: true, hp: 4000000, max_hp: 5000000, map: "main", x: 440, y: 1066, target: null };
  r.sb.parent.entities.s1 = { id: "s1", type: "monster", mtype: "snowman", visible: true, dead: false, x: r.x + 50, y: r.y, hp: 4000000, max_hp: 5000000, attack: 9 };
  await w.clock.run(90);
  RANGER_OVR.pop();
  return [[logged(w, "SexyDexy", /Boss event: Snowman is up/), "event started"], [!logged(w, "SexyDexy", /Farm goal: Phoenix/), "no farm goal started while the Snowman is in view"], [r.attacks > 0, "shot the Snowman: " + r.attacks], [Math.hypot(r.x - 387, r.y - 1066) < 300, "stayed near the Snowman: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"]];
});
T("BE2 Grinch event: followers get the boss as the party goal and walk to / shoot him", async (w) => {
  RANGER_OVR.push(NOPOST);
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 24000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  const hits = { Dexy2: 0, Dexy3: 0 };
  for (const f of [F2, F3]) { const oa = f.sb.attack; f.sb.attack = (t) => { if (t && t.mtype === "grinch") hits[f.name]++; return oa(t); }; }
  for (const c of [L, F2, F3]) { const S = c.sb.parent.S = c.sb.parent.S || {}; S.grinch = { live: true, hp: 24000000, max_hp: 24000000, map: "main", x: 1000, y: 1000 }; }
  await w.clock.run(90);
  const g = { id: "g1", type: "monster", mtype: "grinch", visible: true, dead: false, x: L.x + 40, y: L.y, hp: 24000000, max_hp: 24000000, attack: 9 };
  for (const c of [L, F2, F3]) c.sb.parent.entities.g1 = Object.assign({}, g);
  await w.clock.run(40);
  const near = (f) => f.map === "main" && Math.hypot(f.x - L.x, f.y - L.y) < 300;
  RANGER_OVR.pop();
  return [[near(F2) && near(F3), "followers at the leader: (" + Math.round(F2.x) + "," + Math.round(F2.y) + ") (" + Math.round(F3.x) + "," + Math.round(F3.y) + ") leader (" + Math.round(L.x) + "," + Math.round(L.y) + ")"],
    [hits.Dexy2 > 0 && hits.Dexy3 > 0, "both followers shot the Grinch: " + hits.Dexy2 + "/" + hits.Dexy3]];
});
T("BE3 boss events switched off with set(boss_events, off): no detour", async (w) => {
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 24000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.sb.set("boss_events", "off");
  const S = r.sb.parent.S = r.sb.parent.S || {}; S.grinch = { live: true, hp: 1, max_hp: 1, map: "main", x: 1500, y: 1000 };
  await w.clock.run(60);
  return [[!logged(w, "SexyDexy", /Boss event/), "no boss event started"], [r.x < 700, "stayed on the bees: (" + Math.round(r.x) + ")"]];
});
T("BE4 boss_force from the console starts the event with a given position, even when the server shows nothing", async (w) => {
  RANGER_OVR.push(NOPOST);
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.sb.parent.S = r.sb.parent.S || {};
  r.sb.set("boss_force", "nonsense");
  await w.clock.run(15);
  const bad = logged(w, "SexyDexy", /boss_force: 'nonsense' is not one of grinch/);
  r.sb.set("boss_force", "grinch:main,1000,1000");
  await w.clock.run(40);
  RANGER_OVR.pop();
  return [[bad, "unknown value explained"], [logged(w, "SexyDexy", /Boss event started by hand: Grinch at main 1000,1000/), "started by hand"], [r.x > 800, "walked there: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"]];
});
T("BD1 Grinch button: the Ranger hands all junk to the Merchant nearby at once (potions stay)", async (w) => {
  RANGER_OVR.push(NOPOST);
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.items.iceskates = w.G.items.iceskates || { name: "Ice Skates", g: 920000, type: "shoes" };
  w.G.items.gcape = w.G.items.gcape || { name: "Grinch Cape", g: 8008, type: "cape" };
  const M = make_char(w, "Goodies", { x: -110, y: 25 });
  const r = ranger_char(w, { x: -100, y: 25 }, [["hpot1", 100], ["mpot1", 100]]);
  add_item(r, "wcap", 1); add_item(r, "iceskates", 1); add_item(r, "gcape", 1); add_item(r, "wbookhs", 1);
  r.sb.parent.S = r.sb.parent.S || {};
  r.sb.set("boss_force", "grinch:main,1000,1000");
  await w.clock.run(60);
  RANGER_OVR.pop();
  const left = r.items.filter((i) => i && ["wcap", "iceskates", "gcape", "wbookhs"].indexOf(i.name) !== -1).length;
  const got = M.items.filter((i) => i && ["wcap", "iceskates", "gcape", "wbookhs"].indexOf(i.name) !== -1).length;
  const pots = r.items.filter((i) => i && /pot/.test(i.name)).length;
  return [[left === 0, "junk left on the Ranger: " + left], [got === 4, "Merchant received: " + got], [pots === 2, "potions stayed: " + pots], [logged(w, "SexyDexy", /Boss hand-over: gave 4 item/), "logged"]];
});
T("BD2 Grinch hand-over: stackables go to Goodies and into the bank, never sold; junk is sold", async (w) => {
  RANGER_OVR.push(NOPOST);
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR);
  m.x = -110; m.y = 25;
  const r = ranger_char(w, { x: -100, y: 25 }, [["hpot1", 100], ["mpot1", 100]]);
  add_item(r, "ascale", 12); add_item(r, "wcap", 1);
  r.sb.parent.S = r.sb.parent.S || {};
  r.sb.set("boss_force", "grinch:main,1000,1000");
  await w.clock.run(900);
  RANGER_OVR.pop();
  const bank_n = [].concat(w.bank.items0, w.bank.items1, w.bank.items3).filter((x) => x && x.name === "ascale").reduce((a, x) => a + (x.q || 1), 0);
  const left_r = r.items.filter((i) => i && i.name === "ascale").length;
  const in_m = m.items.filter((i) => i && i.name === "ascale").length;
  return [[left_r === 0, "left on the Ranger: " + left_r], [bank_n === 12, "banked: " + bank_n], [in_m === 0, "none left in the Merchant's bag: " + in_m], [!logged(w, "Goodies", /Sold ascale/), "not sold"]];
});
T("NS1 offerings (Primling, Primordial Essence, Primordial X) are never sold, even when something asks to sell them", async (w) => {
  for (const n of ["offeringp", "offering", "offeringx"]) w.G.items[n] = w.G.items[n] || { g: 480000, s: 1000, type: "offering" };
  const m = merchant_char(w, { gold: 5000 }, MERCH_OVR.concat([[/JUNK_SELLABLE: \[/, 'JUNK_SELLABLE: ["offeringp", "offering", "offeringx", ']]));
  add_item(m, "offeringp", 5); add_item(m, "offering", 2); add_item(m, "offeringx", 1);
  for (let i = 0; i < 6; i++) add_item(m, "wcap", 1);
  await w.clock.run(900);
  const n = (k) => m.items.filter((x) => x && x.name === k).length + [].concat(w.bank.items0, w.bank.items1, w.bank.items3).filter((x) => x && x.name === k).length;
  return [[n("offeringp") === 1 && n("offering") === 1 && n("offeringx") === 1, "offerings kept: " + [n("offeringp"), n("offering"), n("offeringx")].join("/")], [!logged(w, "Goodies", /Sold offering/), "none sold"]];
});
T("BM1 boss fight: Hunter's Mark goes on the boss, is refreshed when it runs low, and is not recast while it is fresh", async (w) => {
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  const marks = []; const e = { id: "g1", type: "monster", mtype: "grinch", visible: true, dead: false, x: r.x + 50, y: r.y, hp: 3000000, max_hp: 3000000, s: {} };
  r.sb.use_skill = (n, t) => { if (n === "huntersmark") { marks.push(t.id); t.s = { marked: { ms: 10000 } }; } return Promise.resolve({}); };
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.grinch = { live: true, hp: 3000000, max_hp: 3000000, map: "main", x: 400, y: 100 };
  await w.clock.run(60);
  r.in_range = true; r.sb.parent.entities.g1 = e;
  await w.clock.run(15);
  const first = marks.length;
  e.s = { marked: { ms: 9000 } }; await w.clock.run(10);
  const fresh = marks.length === first;
  e.s = { marked: { ms: 1500 } }; await w.clock.run(10);
  return [[first >= 1, "marked him: " + first], [fresh, "not recast while the mark has 9 s left"], [marks.length > first, "recast when 1.5 s were left: " + marks.length]];
});
T("BE5 Grinch with a post: party stays in town, shoots him when he is in range, no chasing; leaves 5 min after the last sighting", async (w) => {
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.attacks = 0; const oa = r.sb.attack; r.sb.attack = (t) => { if (t && t.mtype === "grinch") r.attacks++; return oa(t); };
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.grinch = { live: true, hp: 3000000, max_hp: 3000000, map: "winterland", x: 500, y: 500 }; // far away: not "around" -> nothing starts
  await w.clock.run(30);
  const ignored = !logged(w, "SexyDexy", /Boss event: Grinch is up/);
  S.grinch = { live: true, hp: 3000000, max_hp: 3000000, map: "main", x: 400, y: 100 }; // 300 px from the post: around
  await w.clock.run(60);
  const home = Math.hypot(r.x + 110, r.y - 15) < 150;
  S.grinch.x = 400; S.grinch.y = 400; // he is 600+ px away from the post but in view elsewhere: the party does not walk to him
  r.in_range = false; // the mock's range check is this flag
  r.sb.parent.entities.g1 = { id: "g1", type: "monster", mtype: "grinch", visible: true, dead: false, x: r.x + 900, y: r.y, hp: 3000000, max_hp: 3000000 };
  await w.clock.run(30);
  const stayed = Math.hypot(r.x + 110, r.y - 15) < 150 && r.attacks === 0;
  r.in_range = true; r.sb.parent.entities.g1.x = r.x + 50; // he teleports into range
  await w.clock.run(20);
  const shot = r.attacks > 0;
  delete r.sb.parent.entities.g1; S.grinch.live = false; // gone
  await w.clock.run(200);
  const waiting = !logged(w, "SexyDexy", /Boss event Grinch ended/);
  await w.clock.run(150);
  return [[ignored, "a Grinch far from the post does not start the event"], [home, "walked to the post: (" + Math.round(r.x) + "," + Math.round(r.y) + ")"], [stayed, "did not chase a Grinch out of range, no shots: " + r.attacks],
    [shot, "shot him once he was in range: " + r.attacks], [waiting, "still waiting at the post 200 s after he vanished"], [logged(w, "SexyDexy", /Boss event Grinch ended: not seen for 5 min/), "left after 5 min"]];
});
T("BE6 UI buttons: Grinch starts the event, Boss events switches boss events off (ending it) and on again", async (w) => {
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.sb.parent.S = r.sb.parent.S || {};
  await w.clock.run(10);
  const have = !!(r.buttons && r.buttons.al_boss_grinch && r.buttons.al_boss_toggle);
  if (have) r.buttons.al_boss_grinch();
  await w.clock.run(15);
  const started = logged(w, "SexyDexy", /Boss event started by hand: Grinch/);
  if (have) r.buttons.al_boss_toggle();
  await w.clock.run(15);
  const off = logged(w, "SexyDexy", /Boss event Grinch ended: switched off/) && logged(w, "SexyDexy", /boss events are now OFF/);
  if (have) r.buttons.al_boss_toggle();
  await w.clock.run(5);
  return [[have, "both buttons exist on the leader"], [started, "Grinch button started the event"], [off, "toggle switched boss events off and ended the event"], [logged(w, "SexyDexy", /boss events are now ON/), "toggle switched them on again"]];
});
T("R15 scorpions are shot one at a time: no 3shot/5shot even with three in range", async (w) => {
  w.G.monsters.scorpion = { name: "Scorpion", attack: 1, frequency: 1, hp: 100000 };
  const r = make_char(w, "SexyDexy", { x: 1578, y: -168, attack: 440, frequency: 2 }, "AutoRanger v4.js", RANGER_OVR.concat([[/TARGET_TYPES: \[[^\]]*\]/, 'TARGET_TYPES: ["scorpion"]'], [/FARM_SPOT: \{[^}]*\}/, 'FARM_SPOT: { map: "main", x: 1578, y: -168 }'], [/MAX_DIFFICULTY: \d/, "MAX_DIFFICULTY: 1"]]));
  for (const [n, q] of [["hpot1", 100], ["mpot1", 100]]) add_item(r, n, q);
  const calls = { multi: 0, plain: 0 };
  r.sb.use_skill = (n) => { if (/^[35]shot$/.test(n)) calls.multi++; return Promise.resolve({}); };
  r.sb.attack = () => { calls.plain++; return Promise.resolve({}); };
  for (let i = 0; i < 5; i++) r.sb.parent.entities["s" + i] = { id: "s" + i, type: "monster", mtype: "scorpion", visible: true, dead: false, x: 1578 + 10 * i, y: -168 };
  await w.clock.run(60);
  return [[calls.multi === 0, "multishots used: " + calls.multi], [calls.plain > 0, "plain attacks: " + calls.plain]];
});
T("TS1 only TRI_SHOT_MONSTERS get 3shot/5shot: five goos in range are shot one at a time", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.goo = { name: "Scorpion", attack: 1, frequency: 1, hp: 100000 };
  const r = make_char(w, "SexyDexy", { x: 1578, y: -168, attack: 440, frequency: 2 }, "AutoRanger v4.js", RANGER_OVR.concat([[/TARGET_TYPES: \[[^\]]*\]/, 'TARGET_TYPES: ["goo"]'], [/FARM_SPOT: \{[^}]*\}/, 'FARM_SPOT: { map: "main", x: 1578, y: -168 }'], [/MAX_DIFFICULTY: \d/, "MAX_DIFFICULTY: 1"]]));
  for (const [n, q] of [["hpot1", 100], ["mpot1", 100]]) add_item(r, n, q);
  const calls = { multi: 0, plain: 0 };
  r.sb.use_skill = (n) => { if (/^[35]shot$/.test(n)) calls.multi++; return Promise.resolve({}); };
  r.sb.attack = () => { calls.plain++; return Promise.resolve({}); };
  for (let i = 0; i < 5; i++) r.sb.parent.entities["s" + i] = { id: "s" + i, type: "monster", mtype: "goo", visible: true, dead: false, x: 1578 + 10 * i, y: -168 };
  await w.clock.run(60);
  return [[calls.multi === 0, "multishots used: " + calls.multi], [calls.plain > 0, "plain attacks: " + calls.plain]];
});
T("TS2 bees (in TRI_SHOT_MONSTERS) still get the multishots", async (w) => {
  w.G.monsters.bee = { name: "Scorpion", attack: 1, frequency: 1, hp: 100000 };
  const r = make_char(w, "SexyDexy", { x: 1578, y: -168, attack: 440, frequency: 2 }, "AutoRanger v4.js", RANGER_OVR.concat([[/TARGET_TYPES: \[[^\]]*\]/, 'TARGET_TYPES: ["bee"]'], [/FARM_SPOT: \{[^}]*\}/, 'FARM_SPOT: { map: "main", x: 1578, y: -168 }'], [/MAX_DIFFICULTY: \d/, "MAX_DIFFICULTY: 1"]]));
  for (const [n, q] of [["hpot1", 100], ["mpot1", 100]]) add_item(r, n, q);
  const calls = { multi: 0, plain: 0 };
  r.sb.use_skill = (n) => { if (/^[35]shot$/.test(n)) calls.multi++; return Promise.resolve({}); };
  r.sb.attack = () => { calls.plain++; return Promise.resolve({}); };
  for (let i = 0; i < 5; i++) r.sb.parent.entities["s" + i] = { id: "s" + i, type: "monster", mtype: "bee", visible: true, dead: false, x: 1578 + 10 * i, y: -168 };
  await w.clock.run(60);
  return [[calls.multi > 0 || !IS_R5, "multishots used: " + calls.multi], [calls.plain > 0, "plain attacks: " + calls.plain]];
});
T("CN1 status lines also go to the browser console (the game log cannot be copied); other lines only with CONSOLE_ALL", async (w) => {
  if (!IS_V5 || !IS_R5) return skip_v4;
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  const r = ranger_char(w, { attack: 440, frequency: 2 }, [["hpot1", 300], ["mpot1", 300]]);
  const out = []; for (const c of [m, r]) c.sb.console = Object.assign({}, console, { log: (...a) => out.push(a.join(" ")) });
  await w.clock.run(30);
  w.store["Goodies:sched_status"] = "1"; w.store["SexyDexy:ranger_status"] = "1";
  await w.clock.run(30);
  return [[out.some((l) => /Schedule: /.test(l) && /Merchant/.test(l)), "Merchant schedule line in console.log"], [out.some((l) => /Loop since last status/.test(l) && /SexyDexy/.test(l)), "Ranger loop line in console.log"], [!out.some((l) => /Moving to|Listed/.test(l)), "ordinary lines are not mirrored"]];
});
const priest_char = (w, o) => {
  const P = make_char(w, "SexyHexy", Object.assign({ ctype: "priest", x: 0, y: 0, hp: 600, max_hp: 600, mp: 1500, max_mp: 1500, range: 120, speed: 60 }, o), "AutoPriest v4.js");
  P.script_char = true; P.heals = []; P.skills = []; P.attacks = 0;
  P.sb.heal = (t) => { P.heals.push(t.name); return Promise.resolve({}); };
  P.sb.use_skill = (n) => { P.skills.push(n); return Promise.resolve({}); };
  P.sb.attack = () => { P.attacks++; return Promise.resolve({}); };
  w.party.SexyHexy = "SexyDexy"; w.party.SexyDexy = "SexyDexy";
  return P;
};
T("PR1 Priest walks to the leader after his party_state and then stays near him", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 400, y: 0, hp: 1000, max_hp: 1000 });
  const P = priest_char(w);
  P.sb.parent.entities.SexyDexy = L;
  L.sb.send_cm("SexyHexy", { type: "party_state", map: "main", x: 400, y: 0, goal: null });
  await w.clock.run(40);
  return [[Math.hypot(P.x - 400, P.y) < 200, "Priest at (" + Math.round(P.x) + "," + Math.round(P.y) + "), leader at (400,0)"]];
});
T("PR2 Priest heals the hurt leader and casts party heal when two are hurt", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 300, max_hp: 1000 });
  const P = priest_char(w, { x: 0, y: 0 });
  P.sb.parent.entities.SexyDexy = L;
  await w.clock.run(10);
  const single = P.heals.filter((n) => n === "SexyDexy").length;
  P.hp = 100; L.hp = 200; // now two of them are low
  await w.clock.run(10);
  return [[single > 0, "single heals on the leader: " + single], [P.skills.indexOf("partyheal") !== -1, "party heal cast: " + JSON.stringify(P.skills.slice(0, 3))]];
});
T("PR6 Priest attacks the Grinch and heals whoever he targets at a higher threshold (85% would not normally be healed)", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 850, max_hp: 1000 });
  const P = priest_char(w, { x: 0, y: 0 });
  P.sb.parent.entities.SexyDexy = L;
  await w.clock.run(10);
  const calm = P.heals.length;
  P.sb.parent.entities.grinch1 = { id: "grinch1", type: "monster", mtype: "grinch", name: "Grinch", x: 60, y: 0, map: "main", hp: 1e6, max_hp: 1e6, target: "SexyDexy", visible: true, dead: false };
  await w.clock.run(10);
  const healed = P.heals.filter((n) => n === "SexyDexy").length + P.skills.filter((n) => n === "partyheal").length; // a party member being hit: party heal
  L.hp = 1000; if (L.sb && L.sb.character) L.sb.character.hp = 1000; P.sb.is_on_cooldown = (n) => n === "darkblessing"; await w.clock.run(10); // topped up: now she shoots the Grinch
  return [[calm === 0, "no heal at 85% without the Grinch: " + calm], [healed > 0, "healed the Grinch's target: " + healed], [P.attacks > 0, "attacked the Grinch: " + P.attacks]];
});
T("ML1 Grinch live: the Merchant buffs every player in town without Merchant's Luck (strangers too), skips the buffed, the far away and NPCs, and checks again for newcomers", async (w) => {
  w.G.skills = { mluck: { name: "Merchant's Luck", level: 40, mp: 10, range: 320, cooldown: 100, target: "player", duration: 3600000 } };
  const m = merchant_char(w, { gold: 50000, level: 40, mp: 500, max_mp: 500 }, SW_OVR);
  const casts = []; m.sb.use_skill = (n, t) => { casts.push(t.name); t.s = { mluck: { ms: 3600000, f: "Goodies" } }; return Promise.resolve({}); };
  const E = m.sb.parent.entities;
  const pc = (name, x, y, extra) => { E[name] = Object.assign({ id: name, type: "character", name, x, y, map: "main" }, extra || {}); };
  pc("Alice", -60, 20); pc("Bob", -200, 100); pc("Carol", -90, 0, { s: { mluck: { ms: 3000000 } } }); pc("Far", 900, 900); pc("Shopkeep", -100, 0, { npc: true });
  await w.clock.run(120);
  const quiet = casts.slice();
  m.sb.parent.S = { grinch: { live: true } };
  await w.clock.run(120);
  const first = casts.slice();
  pc("Newbie", -120, 30);
  await w.clock.run(120);
  return [[quiet.length === 0, "nothing while the Grinch is not live: " + quiet.join(",")], [first.slice().sort().join(",") === "Alice,Bob", "Alice and Bob buffed, not Carol (has it), Far, Shopkeep: " + first.join(",")], [casts.length === 3 && casts[2] === "Newbie", "newcomer buffed on the next look, nobody twice: " + casts.join(",")]];
});
const warrior_char = (w, o) => {
  const W = make_char(w, "SexyWexy", Object.assign({ ctype: "warrior", x: 0, y: 0, hp: 2000, max_hp: 2000, mp: 1500, max_mp: 1500, range: 40, speed: 60, level: 80 }, o), "AutoWarrior v5.js");
  W.script_char = true; W.skills = []; W.attacks = 0; W.moves = 0;
  const used = {}; // skills have a cooldown (5 s here), otherwise the mock lets one skill fire every tick
  W.sb.is_on_cooldown = (n) => n !== "attack" && used[n] !== undefined && w.clock.t - used[n] < 5000;
  W.sb.use_skill = (n, t) => { used[n] = w.clock.t; W.skills.push(n + (t ? ">" + (t.mtype || t.name) : "")); return Promise.resolve({}); };
  W.sb.attack = () => { W.attacks++; return Promise.resolve({}); };
  W.sb.move = () => { W.moves++; return Promise.resolve({}); };
  w.party.SexyWexy = "SexyDexy"; w.party.SexyDexy = "SexyDexy";
  return W;
};
const WC_ON = (ovr) => ovr.filter((x) => x !== WC_OFF);
T("WC1 Warrior compound set: while the Warrior lacks the rings, spare Rings of Small Joys are compounded up (not sold)", async (w) => {
  if (!IS_R5) return skip_r4;
  for (let i = 0; i < 9; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, WC_ON(LAD_OVR));
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const W = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); gear_rep(W, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(2500);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && x.name === "ringsj");
  const up = all.filter((x) => (x.level || 0) >= 1).length;
  return [[up >= 1 && all.every((x) => (x.level || 0) >= 1), "everything funnelled up (keep 0): " + all.map((x) => "+" + (x.level || 0)).join(" ")], [!logged(w, "Goodies", /Bank junk sweep/), "nothing sold while the set is incomplete"]];
});
T("WC2 Warrior compound set complete: he wears two +3 rings, every other Ring of Small Joys (even a +3) is sold whatever its level", async (w) => {
  if (!IS_R5) return skip_r4;
  w.bank.items0.push({ name: "ringsj", level: 3 }, { name: "ringsj", level: 3 }, { name: "ringsj", level: 1 }, { name: "ringsj", level: 1 });
  for (let i = 0; i < 4; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, WC_ON(LAD_OVR));
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const W = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); gear_rep(W, { ring1: { name: "ringsj", level: 3 }, ring2: { name: "ringsj", level: 3 } }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(1500);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && x.name === "ringsj");
  return [[all.length === 0, "all spare rings sold: " + all.map((x) => "+" + (x.level || 0)).join(" ")], [logged(w, "Goodies", /Bank junk sweep/), "sold by the bank junk sweep"]];
});
T("WR1 Warrior taunts the Grinch when he hits somebody else, attacks him when he is on the Warrior, hard-shells when low", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { taunt: { mp: 40, range: 200, cooldown: 3000 }, hardshell: { level: 60, mp: 480, cooldown: 16000 }, agitate: { level: 68, mp: 420, range: 320 }, warcry: { level: 70, mp: 320 }, stomp: { level: 52, mp: 120 } });
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 1000, max_hp: 1000 });
  const W = warrior_char(w, { x: 0, y: 0 });
  W.sb.parent.entities.SexyDexy = L;
  const E = W.sb.parent.entities;
  E.grinch1 = { id: "grinch1", type: "monster", mtype: "grinch", name: "Grinch", x: 20, y: 0, map: "main", hp: 1e6, max_hp: 1e6, target: "SexyDexy", visible: true, dead: false };
  await w.clock.run(10);
  const taunted = W.skills.filter((x) => x === "taunt>grinch").length;
  E.grinch1.target = "SexyWexy"; W.skills.length = 0;
  await w.clock.run(10);
  const quiet = W.skills.filter((x) => /^taunt/.test(x)).length;
  const hit = W.attacks;
  W.hp = 800; if (W.sb.character) W.sb.character.hp = 800; await w.clock.run(10);
  return [[taunted > 0, "taunted the Grinch while he hit SexyDexy: " + taunted], [quiet === 0, "no taunt once the Grinch is on him: " + quiet], [hit > 0, "attacks the Grinch: " + hit], [W.skills.indexOf("hardshell") !== -1, "hard shell at 40% HP: " + W.skills.join(",")]];
});
T("WR2 Warrior follows the leader, attacks what the leader attacks, agitates when 3 monsters hit others, and asks to join the party", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { taunt: { mp: 40, range: 200 }, agitate: { level: 68, mp: 420, range: 320 } });
  const L = make_char(w, "SexyDexy", { x: 400, y: 0, hp: 1000, max_hp: 1000 });
  const W = warrior_char(w, { x: 0, y: 0 });
  W.sb.parent.entities.SexyDexy = L;
  L.sb.send_cm("SexyWexy", { type: "party_state", map: "main", x: 400, y: 0, goal: null });
  await w.clock.run(40);
  const near = Math.hypot(W.x - 400, W.y) < 200;
  const E = W.sb.parent.entities;
  for (const i of [1, 2, 3]) E["bee" + i] = { id: "bee" + i, type: "monster", mtype: "bee", name: "Bee", x: W.x + 30, y: W.y, map: "main", hp: 100, max_hp: 100, target: "SexyDexy", visible: true, dead: false };
  await w.clock.run(10);
  return [[near, "walked to the leader: (" + Math.round(W.x) + "," + Math.round(W.y) + ")"], [W.skills.indexOf("agitate") !== -1, "agitate with 3 monsters on a partner: " + W.skills.join(",")]];
});
T("WR3 Warrior focus: broadcasts the biggest monster hitting the party, taunts it when it hits somebody else, swaps in a basher for Stomp and back", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { taunt: { mp: 40, range: 200 }, stomp: { level: 52, mp: 120 }, huntersmark: { mp: 240 }, curse: { level: 52, mp: 200, range: 240 } });
  w.G.items = Object.assign(w.G.items || {}, { sword1: { wtype: "sword" }, basher1: { wtype: "basher" } });
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 1000, max_hp: 1000 });
  const W = warrior_char(w, { x: 0, y: 0 });
  W.sb.parent.entities.SexyDexy = L;
  const ch = W.sb.character;
  ch.slots.mainhand = { name: "sword1", level: 2 }; ch.items[0] = { name: "basher1", level: 1 };
  const eq = [];
  W.sb.equip = (i, slot) => { const it = ch.items[i]; if (!it) return Promise.resolve({}); const old = ch.slots.mainhand; ch.slots.mainhand = { name: it.name, level: it.level || 0 }; ch.items[i] = old ? { name: old.name, level: old.level || 0 } : null; eq.push(it.name); return Promise.resolve({}); };
  const E = W.sb.parent.entities;
  const mk = (id, mt, hp, tg) => (E[id] = { id, type: "monster", mtype: mt, name: mt, x: 20, y: 0, map: "main", hp, max_hp: hp, target: tg, visible: true, dead: false });
  mk("small1", "bee", 100, "SexyWexy"); mk("big1", "crab", 90000, "SexyDexy");
  const R = fake_ranger(w);
  await w.clock.run(10);
  const taunted = W.skills.indexOf("taunt>crab") !== -1;
  const stomped = W.skills.indexOf("stomp") !== -1;
  const swapped = eq.length >= 2 && eq[0] === "basher1" && eq[eq.length - 1] === "sword1";
  const back = ch.slots.mainhand && ch.slots.mainhand.name === "sword1" && ch.slots.mainhand.level === 2;
  const got = R.inbox.some((x) => x.msg.type === "focus" && x.msg.tid === "big1");
  return [[got, "focus announced to the Ranger"], [taunted, "taunted the big monster: " + W.skills.join(",")], [stomped && swapped && back, "stomp with basher swapped in and the sword back: " + eq.join(",") + " main=" + (ch.slots.mainhand && ch.slots.mainhand.name)]];
});
T("PR9 Priest curses the monster the Warrior announced as focus (not the leader's target)", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { curse: { level: 52, mp: 200, range: 240 } });
  const P = priest_char(w, { x: 0, y: 0, level: 75 });
  const W = make_char(w, "SexyWexy", { x: 30, y: 0, ctype: "warrior" });
  const E = P.sb.parent.entities;
  E.big1 = { id: "big1", type: "monster", mtype: "crab", name: "crab", x: 50, y: 0, map: "main", hp: 9e4, max_hp: 9e4, target: "SexyWexy", visible: true, dead: false };
  E.small1 = { id: "small1", type: "monster", mtype: "bee", name: "bee", x: 40, y: 0, map: "main", hp: 100, max_hp: 100, target: "SexyDexy", visible: true, dead: false };
  const L = make_char(w, "SexyDexy", { x: 40, y: 0 }); L.target = "small1"; E.SexyDexy = L;
  const cursed = [];
  P.sb.use_skill = (n, t2) => { if (n === "curse") cursed.push(t2 && t2.id); return Promise.resolve({}); };
  w.party.SexyWexy = "SexyDexy";
  W.sb.send_cm("SexyHexy", { type: "focus", tid: "big1", mtype: "crab" });
  await w.clock.run(10);
  return [[cursed[0] === "big1", "cursed the focus target first: " + cursed.join(",")]];
});
T("RF1 Ranger holds fire while the Warrior has not engaged (heartbeat, no focus), then fires once the monster has a target; WR4 Warrior pulls a farm-type monster first", async (w) => {
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  r.attacks = 0; r.at_t = []; const oa = r.sb.attack; r.sb.attack = (t) => { r.attacks++; r.at_t.push(Math.round(w.clock.t)); return oa(t); };
  const W = make_char(w, "SexyWexy", { ctype: "warrior", x: 380, y: 1066 });
  const E = r.sb.parent.entities;
  E.b1 = { id: "b1", type: "monster", mtype: "bee", visible: true, dead: false, x: r.x + 40, y: r.y, hp: 10, max_hp: 10, attack: 1, target: null };
  const beat = () => W.sb.send_cm("SexyDexy", { type: "focus", tid: null, mtype: null });
  beat(); w.clock.every(beat, 1000);
  await w.clock.run(0.3); r.attacks = 0; // (the first shots go out before the first heartbeat arrives)
  await w.clock.run(3);
  const held = r.attacks;
  E.b1.target = "SexyWexy"; // the Warrior has it now
  await w.clock.run(3);
  return [[held === 0, "no shot while nobody had aggro: " + held + ""], [r.attacks > 0, "shoots once the Warrior has it: " + r.attacks]];
});
T("WR4 Warrior pulls: nothing fights, the leader reports the farm type, the Warrior walks to the nearest bee and hits it and announces it", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 1000, max_hp: 1000 });
  const Wr = warrior_char(w, { x: 0, y: 0 });
  const R = fake_ranger(w);
  Wr.sb.parent.entities.SexyDexy = L;
  L.sb.send_cm("SexyWexy", { type: "party_state", map: "main", x: 40, y: 0, goal: null, types: ["bee"] });
  const E = Wr.sb.parent.entities;
  E.far1 = { id: "far1", type: "monster", mtype: "crab", name: "crab", x: 60, y: 0, map: "main", hp: 100, max_hp: 100, target: null, visible: true, dead: false };
  E.bee1 = { id: "bee1", type: "monster", mtype: "bee", name: "bee", x: 15, y: 0, map: "main", hp: 100, max_hp: 100, target: null, visible: true, dead: false };
  await w.clock.run(10);
  return [[Wr.attacks > 0, "attacked the bee: " + Wr.attacks], [R.inbox.some((x) => x.msg.type === "focus" && x.msg.tid === "bee1"), "announced the bee as focus"]];
});
T("TR1 town trip: while the leader's party_state says trip, the Warrior and the Priest stay at the reported field spot (even with the leader in view walking away); without it they follow", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 400, y: 0, hp: 1000, max_hp: 1000 });
  const W = warrior_char(w, { x: 0, y: 0 });
  const P = priest_char(w, { x: 20, y: 0 });
  W.sb.parent.entities.SexyDexy = L; P.sb.parent.entities.SexyDexy = L;
  let trip = true;
  const send = () => { for (const n of ["SexyWexy", "SexyHexy"]) L.sb.send_cm(n, { type: "party_state", map: "main", x: 400, y: 0, goal: null, trip, farm: { map: "main", x: 0, y: 0 } }); };
  send(); w.clock.every(send, 4000);
  await w.clock.run(30);
  const stayed = Math.hypot(W.x, W.y) < 150 && Math.hypot(P.x, P.y) < 150;
  trip = false;
  await w.clock.run(40);
  const followed = Math.hypot(W.x - 400, W.y) < 200 && Math.hypot(P.x - 400, P.y) < 200;
  return [[stayed, "stayed in the field during the trip: W(" + Math.round(W.x) + "," + Math.round(W.y) + ") P(" + Math.round(P.x) + "," + Math.round(P.y) + ")"], [followed, "follows again without the trip flag: W(" + Math.round(W.x) + ") P(" + Math.round(P.x) + ")"]];
});
T("WR6 the Warrior never hands his basher, the magic-set pieces or the swapped-out weapon to the courier; real junk still goes", async (w) => {
  w.G.items.wbasher = { g: 4900, type: "weapon", wtype: "basher", upgrade: { attack: 6 } }; w.G.items.reshelm = { type: "helmet", resistance: 40 }; w.G.items.junkcap = { g: 10, type: "helmet" };
  const L = make_char(w, "SexyDexy", { x: 10, y: 0 });
  const M = make_char(w, "Goodies", { ctype: "merchant", x: 0, y: 0 });
  const W = warrior_char(w, { x: 0, y: 0 });
  const ch = W.sb.character;
  ch.items[0] = { name: "wbasher", level: 0 }; ch.items[1] = { name: "reshelm", level: 0 }; ch.items[2] = { name: "junkcap", level: 0 };
  M.sb.send_cm("SexyWexy", { type: "gear_give", name: "reshelm", level: 0, slot: "alt:helmet" });
  await w.clock.run(200); // (past the grace period after a gear hand-over)
  L.sb.send_cm("SexyWexy", { type: "courier_collect", id: "c1", max: 10 });
  await w.clock.run(10);
  const has = (c, n) => c.items.some((i) => i && i.name === n);
  return [[has(ch, "wbasher"), "the basher stays with the Warrior"], [has(ch, "reshelm"), "the magic-set piece stays"], [has(L, "junkcap") && !has(ch, "junkcap"), "the junk cap went to the courier"]];
});
T("PR8 Priest: in an ordinary fight the Warrior is healed first (from 88%), unless somebody else is below 35%", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 700, max_hp: 1000 });
  const W = make_char(w, "SexyWexy", { x: 30, y: 10, hp: 850, max_hp: 1000 });
  w.party.SexyWexy = "SexyDexy";
  const P = priest_char(w, { x: 0, y: 0 });
  P.sb.parent.entities.SexyDexy = L; P.sb.parent.entities.SexyWexy = W;
  await w.clock.run(5);
  const first = P.heals[0];
  L.hp = 300; if (L.sb && L.sb.character) L.sb.character.hp = 300; P.heals.length = 0;
  await w.clock.run(5);
  return [[first === "SexyWexy", "Warrior (85%) healed before the Ranger (70%): " + first], [P.heals[0] === "SexyDexy", "the Ranger at 30% goes first: " + P.heals[0]]];
});
T("PR7 Grinch target: the Merchant (not in her party) gets the single heal, a party member gets party heal; she curses the Grinch once and blesses at level 70", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { curse: { level: 52, mp: 200, range: 240 }, darkblessing: { level: 70, mp: 900 } });
  const M = make_char(w, "Goodies", { ctype: "merchant", x: 30, y: 0, hp: 500, max_hp: 1000 });
  const P = priest_char(w, { x: 0, y: 0, level: 75 });
  const E = P.sb.parent.entities; E.Goodies = M;
  E.grinch1 = { id: "grinch1", type: "monster", mtype: "grinch", name: "Grinch", x: 60, y: 0, map: "main", hp: 1e6, max_hp: 1e6, target: "Goodies", visible: true, dead: false };
  P.curses = 0; P.sb.use_skill = (n, t) => { P.skills.push(n); if (n === "curse") { P.curses++; E.grinch1.s = { curse: { ms: 5000 } }; } return Promise.resolve({}); };
  await w.clock.run(10);
  const merchant_heals = P.heals.filter((n) => n === "Goodies").length;
  const party_before = P.skills.filter((n) => n === "partyheal").length;
  M.hp = 1000; await w.clock.run(10); // topped up: curse and blessing
  const mid_curses = P.curses;
  E.grinch1.target = "SexyDexy"; const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 500, max_hp: 1000 }); E.SexyDexy = L;
  await w.clock.run(10);
  const party_after = P.skills.filter((n) => n === "partyheal").length;
  return [[merchant_heals > 0 && party_before === 0, "Merchant healed with the single heal: " + merchant_heals + ", partyheal " + party_before], [party_after > 0, "party member targeted -> partyheal: " + party_after], [mid_curses === 1 && P.curses === 1, "cursed once, not again while it lasts: " + mid_curses + "/" + P.curses], [P.skills.indexOf("darkblessing") !== -1, "dark blessing cast at level 75"]];
});
T("PR3 Priest ignores strangers: only the leader's party_state moves her", async (w) => {
  const P = priest_char(w);
  const X = make_char(w, "Stranger", { x: 900, y: 0 });
  X.sb.send_cm("SexyHexy", { type: "party_state", map: "main", x: 900, y: 0 });
  await w.clock.run(30);
  return [[Math.hypot(P.x, P.y) < 5, "stayed at (" + Math.round(P.x) + "," + Math.round(P.y) + ")"]];
});
T("PR4 Merchant invites the Priest to the party; she accepts only from him", async (w) => {
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR.concat([[/SUPPORT_NAMES: \[[^\]]*\]/, 'SUPPORT_NAMES: ["SexyHexy"]']]));
  const P = priest_char(w);
  await w.clock.run(40);
  return [[(w.invites || []).indexOf("Goodies>SexyHexy") !== -1, "invited: " + JSON.stringify(w.invites)], [w.party.SexyHexy === "Goodies", "accepted into Goodies' party: " + w.party.SexyHexy]];
});
T("PR5 the leader starts offline followers and the Priest (own code slot)", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 387, y: 1066 }, "AutoRanger v4.js", [[/HUNT_ENABLED: true/, "HUNT_ENABLED: false"], [/GEAR_SHARE: true/, "GEAR_SHARE: false"], [/PARTY_START_MEMBERS: false/, "PARTY_START_MEMBERS: true"], [/PARTY_SUPPORT: \[[^\]]*\]/, 'PARTY_SUPPORT: ["SexyHexy"]']]);
  L.script_char = true; add_item(L, "hpot1", 200); add_item(L, "mpot1", 200);
  await w.clock.run(60);
  return [[(w.started || []).indexOf("SexyLexy") !== -1 && (w.started || []).indexOf("SexyRexy") !== -1, "followers started: " + JSON.stringify(w.started)], [(w.started || []).indexOf("SexyHexy") !== -1 && w.started_slots.SexyHexy === "7", "Priest started in slot " + (w.started_slots || {}).SexyHexy]];
});
T("PR6 the leader stops code-started followers on request (set stop_characters), once", async (w) => {
  const L = make_char(w, "SexyDexy", { x: 387, y: 1066 }, "AutoRanger v4.js", [[/HUNT_ENABLED: true/, "HUNT_ENABLED: false"], [/GEAR_SHARE: true/, "GEAR_SHARE: false"]]);
  L.script_char = true; add_item(L, "hpot1", 200); add_item(L, "mpot1", 200);
  const A = make_char(w, "SexyLexy", { x: 400, y: 1066 }); A.script_char = true;
  const B = make_char(w, "SexyRexy", { x: 410, y: 1066 }); B.script_char = true;
  await w.clock.run(10);
  L.sb.set("stop_characters", "followers");
  await w.clock.run(60);
  const st = w.stopped || [];
  return [[st.indexOf("SexyLexy") !== -1 && st.indexOf("SexyRexy") !== -1, "stopped: " + JSON.stringify(st)], [st.length === 2, "each only once"], [!L.sb.get("stop_characters"), "request cleared"]];
});
const HUNT_ON = [[/PARTY_MEMBERS: \[[^\]]*\]/, "PARTY_MEMBERS: []"], [/GEAR_SHARE: true/, "GEAR_SHARE: false"]];
const hunt_world = (w, extra) => {
  w.G.monsters.snake = { name: "Snake", attack: 24, frequency: 0.6, hp: 720 };
  w.G.monsters.greenjr = { name: "Green Jr.", attack: 30, frequency: 20, hp: 4200 };
  w.G.maps.main.monsters = [{ type: "snake", count: 5, boundary: [-300, 1700, 100, 2000] }];
  const r = make_char(w, "SexyDexy", Object.assign({ x: 387, y: 1066, attack: 440, frequency: 2 }, extra || {}), "AutoRanger v4.js", HUNT_ON);
  add_item(r, "hpot1", 100); add_item(r, "mpot1", 100);
  r.sb.character.s = { monsterhunt: { id: "snake", c: 5, ms: 1200000 } };
  r.sb.parent.S = r.sb.parent.S || {};
  return r;
};
T("HD1 hunt danger: Green Jr. is at the snake spawn (server) -> the hunt waits, he farms instead of walking there", async (w) => {
  const r = hunt_world(w);
  r.sb.parent.S.greenjr = { live: true, hp: 4200, max_hp: 4200, map: "main", x: -100, y: 1850 };
  await w.clock.run(120);
  return [[logged(w, "SexyDexy", /Monster hunt on hold: Green Jr\./), "hunt on hold, reason logged"], [!logged(w, "SexyDexy", /heading to Snake/), "did not head to the snakes"]];
});
T("HD2 hunt danger: Green Jr. close by during a hunt -> retreats to town and holds hunts", async (w) => {
  const r = hunt_world(w);
  r.sb.parent.entities.gj = { id: "gj", type: "monster", mtype: "greenjr", visible: true, dead: false, x: r.x + 100, y: r.y, hp: 4200, max_hp: 4200 };
  await w.clock.run(60);
  return [[logged(w, "SexyDexy", /DANGER: Green Jr\. is close/), "danger logged"], [!logged(w, "SexyDexy", /heading to Snake/), "no walk to the snakes during the hold"]];
});
T("HD3 danger applies to followers too: a follower who sees Green Jr. close by retreats and stays back", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.greenjr = { name: "Green Jr.", attack: 30, frequency: 20, hp: 4200 };
  const L = party_ranger(w, "SexyDexy"); const F = party_ranger(w, "Dexy2");
  F.sb.parent.entities.gj = { id: "gj", type: "monster", mtype: "greenjr", visible: true, dead: false, x: F.x + 100, y: F.y, hp: 4200, max_hp: 4200 };
  await w.clock.run(30);
  return [[logged(w, "Dexy2", /DANGER: Green Jr\. is close .* staying back for 60 s/), "follower logged the danger"], [!logged(w, "SexyDexy", /DANGER: Green Jr\. is close/), "leader far from it: no alarm"]];
});
T("HD4 danger in the Halloween Town: walks to the portal NPC and takes the portal back to the main map", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.greenjr = { name: "Green Jr.", attack: 30, frequency: 20, hp: 4200 };
  w.G.maps.halloween = { spawns: [[0, 0]] };
  w.G.npcs = { transporter: { places: { main: 3 } } };
  const r = party_ranger(w, "SexyDexy");
  r.map = "halloween"; r.x = 300; r.y = 300;
  r.sb.find_npc = (n) => (n === "transporter" ? { map: "halloween", x: 20, y: 20 } : null);
  const sent = [];
  r.sb.parent.socket = { emit: (ev, d) => { sent.push([ev, d]); if (ev === "transport") r.map = "main"; }, on() {}, off() {} };
  r.sb.parent.entities.gj = { id: "gj", type: "monster", mtype: "greenjr", visible: true, dead: false, x: r.x + 100, y: r.y, hp: 4200, max_hp: 4200 };
  await w.clock.run(60);
  return [[logged(w, "SexyDexy", /DANGER: Green Jr\. is close/), "danger logged"], [logged(w, "SexyDexy", /Moving to .*portal NPC in halloween/), "walked to the portal NPC"], [sent.some((e) => e[0] === "transport" && e[1].to === "main" && e[1].s === 3), "portal used: " + JSON.stringify(sent)], [r.map === "main", "back on the main map"]];
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
T("GH1 spare upgradeable gear (Fire Bows) is handed to the Merchant with the junk, never sold; worn gear stays", async (w) => {
  if (!IS_R5) return skip_r4;
  const m = merchant_char(w); const r = ranger_char(w);
  for (let i = 0; i < 4; i++) add_item(r, "firebow", 1, 0);
  for (let i = 0; i < 4; i++) add_item(r, "wcap", 1);
  for (let i = 0; i < 28; i++) add_item(r, "ringsj", 1, 0); // a nearly full bag starts the solo ladder's hand-over
  await w.clock.run(250);
  const left = r.items.filter((i) => i && i.name === "firebow").length;
  const at_m = m.items.filter((i) => i && i.name === "firebow").length + w.bank.items0.filter((i) => i && i.name === "firebow").length;
  return [[left === 0, "Ranger kept " + left + " Fire Bows"], [at_m === 4, "Merchant holds " + at_m + " Fire Bows (bag + bank)"], [!w.logs.some((l) => l.who === "Goodies" && /Sold firebow/.test(l.msg)), "not sold"]];
});
T("GH2 courier trip also starts for spare gear (between events), and the gear rides to the Merchant", async (w) => {
  if (!IS_R5) return skip_r4;
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy"); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  for (let i = 0; i < 2; i++) add_item(F3, "firebow", 1, 0);
  await w.clock.run(900);
  const total = [L, F2, F3].reduce((a, c) => a + c.items.filter((i) => i && i.name === "firebow").length, 0);
  const at_m = M.items.filter((i) => i && i.name === "firebow").length + w.bank.items0.filter((i) => i && i.name === "firebow").length;
  return [[logged(w, "SexyDexy", /Courier trip: Dexy3 carries spare gear for the Merchant to upgrade/), "trip for the gear"], [total === 0 && at_m === 2, "Rangers hold " + total + ", Merchant holds " + at_m]];
});
T("CT1 courier trip: the courier tells the Merchant what to prepare, and every non-potion item of the party goes to him (a tracker stays)", async (w) => {
  if (!IS_R5) return skip_r4;
  const M = COUR_MERCH(w);
  const L = party_ranger(w, "SexyDexy", {}, [["hpot1", 30], ["mpot1", 30]]); const F2 = party_ranger(w, "Dexy2"); const F3 = party_ranger(w, "Dexy3");
  for (let i = 0; i < 3; i++) add_item(L, "oddity", 1, 0);
  for (let i = 0; i < 2; i++) add_item(F3, "oddity", 1, 0);
  add_item(F3, "tracker", 1, 0);
  await w.clock.run(900);
  const odd = [L, F2, F3].reduce((a, c) => a + c.items.filter((i) => i && i.name === "oddity").length, 0);
  const at_m = M.items.filter((i) => i && i.name === "oddity").length + w.bank.items0.filter((i) => i && i.name === "oddity").length;
  return [[logged(w, "Dexy2", /Told the Merchant: \d+ hpot1 \+ \d+ mpot1 to pick up, \d+ item\(s\) to sort/), "courier announced the trip"], [logged(w, "Goodies", /Courier notice from Dexy2: \d+ hpot1 \+ \d+ mpot1 to pick up/), "Merchant got the notice"],
    [odd === 0 && at_m === 5, "Rangers hold " + odd + ", Merchant holds " + at_m], [F3.items.some((i) => i && i.name === "tracker"), "tracker stayed"]];
});
const bank_socket = (w, m, works) => { if (works) m.sb.bank_store = (i, pack, slot) => { const it = m.items[i]; m.items[i] = null; if (pack === undefined) { const f = w.bank.items0.findIndex((x) => !x); if (f >= 0) w.bank.items0[f] = it; else w.bank.items0.push(it); return Promise.resolve({}); } if (slot === undefined) { const cap = (w.G.items[it.name] || {}).s; const t = typeof cap === "number" ? w.bank[pack].find((x) => x && x.name === it.name && x.q + it.q <= cap) : null; if (t) t.q += it.q; else { const f = w.bank[pack].findIndex((x) => !x); if (f >= 0) w.bank[pack][f] = it; else w.bank[pack].push(it); } return Promise.resolve({}); } const dst = w.bank[pack][slot]; if (dst && dst.name === it.name) dst.q += it.q; else w.bank[pack][slot] = it; return Promise.resolve({}); }; };
T("BK1 bank sort: when he leaves the bank each pack is in order (type, name, highest level first) with the free slots last", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "ringsj", level: 1 }, null, { name: "wcap", level: 0 }, { name: "ringsj", level: 3 }, null, { name: "plaincap", level: 2 }, { name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  bank_socket(w, m, true);
  await w.clock.run(400);
  const names = w.bank.items0.map((x) => (x ? x.name + "+" + (x.level || 0) : "-"));
  const last_item = names.reduce((a, n, i) => (n !== "-" ? i : a), -1);
  const sorted = names.slice(0, last_item + 1).every((n) => n !== "-");
  const rings = names.filter((n) => /^ringsj/.test(n));
  return [[logged(w, "Goodies", /Bank sort: \d+ move\(s\) made/), "sort ran"], [sorted, "no gaps before the last item: " + names.join(",")], [rings.join(",") === "ringsj+3,ringsj+3,ringsj+1", "rings by level: " + rings.join(",")]];
});
T("BM1 bank merge: stackables split over several bank slots are joined into one stack (when the total fits), others stay", async (w) => {
  if (!IS_V5) return skip_v4;
  w.G.items.lostearring.s = 100; w.G.items.capstack = { g: 1, s: 50 };
  w.bank.items0.push({ name: "lostearring", q: 30 }, { name: "capstack", q: 40 });
  w.bank.items1.push({ name: "lostearring", q: 20 });
  w.bank.items3.push({ name: "lostearring", q: 10 }, { name: "capstack", q: 30 }, { name: "ringsj", level: 1 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  bank_socket(w, m, true);
  await w.clock.run(400);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3).filter(Boolean);
  const le = all.filter((x) => x.name === "lostearring");
  const cs = all.filter((x) => x.name === "capstack");
  return [[le.length === 1 && le[0].q === 60, "lostearring stacks: " + le.map((x) => x.q).join("+")], [cs.length === 2, "capstack (70 > stack size 50) stays split: " + cs.map((x) => x.q).join("+")], [logged(w, "Goodies", /Bank merge: 2 split stack\(s\) joined \(lostearring\)/), "logged"]];
});
T("BM2 bank merge: if the game does not put the stack onto the other one, merging switches itself off", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "lostearring", q: 30 });
  w.bank.items1.push({ name: "lostearring", q: 20 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  await w.clock.run(400); // the mock's bank_store ignores the target slot: the stack is stored elsewhere
  return [[logged(w, "Goodies", /Bank merge: lostearring was not added onto the stack/), "switched off"]];
});
T("PS1 private sale: set(sell_item) takes one Fire Bow +4 out of the bank and lists it on trade5 at Gabriel's value minus 500k", async (w) => {
  if (!IS_V5) return skip_v4;
  w.G.items.firebow = w.G.items.firebow || { name: "Fire Bow", type: "weapon", wtype: "bow", g: 178000, upgrade: { attack: 6 } };
  w.bank.items1.push({ name: "firebow", level: 4 }, { name: "firebow", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  bank_socket(w, m, true);
  m.sb.calculate_item_value = (it) => (it.name === "firebow" ? 4000000 : 1);
  w.store["Goodies:flip_factor"] = "0.5";
  await w.clock.run(30);
  w.store["Goodies:sell_item"] = "firebow:4";
  await w.clock.run(300);
  const tr = m.slots && m.slots.trade5;
  const left = w.bank.items1.filter((x) => x && x.name === "firebow").map((x) => x.level);
  return [[logged(w, "Goodies", /Private sale: Gabriel would pay about 2000000 .*listing it at 1500000/), "price line"], [!!tr && tr.name === "firebow", "listed on trade5: " + JSON.stringify(tr)], [left.join(",") === "0", "the +0 stays in the bank: " + left.join(",")]];
});
T("PS2 private sale: a bad sell_item value is refused with the format, nothing is touched", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items1.push({ name: "firebow", level: 4 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  await w.clock.run(30);
  w.store["Goodies:sell_item"] = "firebow";
  await w.clock.run(60);
  return [[logged(w, "Goodies", /sell_item: 'firebow' is not name:level/), "refused"], [w.bank.items1.some((x) => x && x.name === "firebow"), "bow still in the bank"]];
});
const MK_OVR = (buy) => MERCH_OVR_COMPOUND.concat([[/MARKET_NPC_FALLBACK: null/, 'MARKET_NPC_FALLBACK: { map: "main", x: -110, y: 15 }'], [/MARKET_EVERY_MS: 3 \* 3600000/, "MARKET_EVERY_MS: 3600000"], [/MARKET_BUY: true/, "MARKET_BUY: " + (buy ? "true" : "false")], [/MARKET_COMPOUND_BUY: true/, "MARKET_COMPOUND_BUY: " + (buy ? "true" : "false")], [/FLIP_ENABLED: true/, "FLIP_ENABLED: false"]]);
const ponty = (w, m, stock) => { const hs = {}; m.sb.calculate_item_value = (it) => (it.name === "plaincap" ? 10000 : 20000); m.sb.parent.socket = { on(ev, h) { (hs[ev] = hs[ev] || []).push(h); }, off(ev, h) { hs[ev] = (hs[ev] || []).filter((x) => x !== h); },
  emit(ev, d) { if (ev === "secondhands") w.after(300, () => { for (const h of (hs.secondhands || []).slice()) h(stock); }); else if (ev === "sbuy") { const i = stock.findIndex((s) => s.rid === d.rid); if (i >= 0) { const s = stock.splice(i, 1)[0]; add_item(m, s.name, 1, s.level || 0); m.gold -= Math.round(10500); w.bought = (w.bought || 0) + 1; } } } }; };
T("MK1 market watch: Ponty's list is scored against what the Rangers wear and the better piece is reported (report only, nothing bought)", async (w) => {
  if (!IS_V5) return skip_v4;
  const m = merchant_char(w, { gold: 5000000 }, MK_OVR(false));
  ponty(w, m, [{ name: "plaincap", level: 0, rid: "r1" }, { name: "plaincap", level: 0, rid: "r2" }]);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(800);
  return [[logged(w, "Goodies", /Market watch: for SexyDexy: plaincap \+0 \(x2 at Ponty\), score [\d.]+ as it is \([\d.]+ fully upgraded with a Dexterity scroll\), he wears 0, about 20000 gold/), "reported"], [logged(w, "Goodies", /Market watch: report only/), "report-only line"], [!w.bought, "nothing bought"]];
});
T("MK2 market watch: with MARKET_BUY it buys one piece within the limits and learns the real price", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.gold = 40000000;
  const m = merchant_char(w, { gold: 50000 }, MK_OVR(true));
  ponty(w, m, [{ name: "plaincap", level: 0, rid: "r1" }, { name: "plaincap", level: 0, rid: "r2" }]);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(800);
  return [[logged(w, "Goodies", /Market watch: bought plaincap \+0 for 10500 gold/), "bought"], [w.bought >= 1, "sbuy sent: " + w.bought]];
});
T("MK4 market watch: compound-set copies are bought up to MARKET_COMPOUND_MAX_LEVEL (+2), a +3 set is only reported", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.gold = 40000000;
  const m = merchant_char(w, { gold: 50000 }, MK_OVR(true));
  ponty(w, m, [{ name: "ringsj", level: 2, rid: "a1" }, { name: "ringsj", level: 2, rid: "a2" }, { name: "ringsj", level: 2, rid: "a3" }, { name: "ringsj", level: 3, rid: "b1" }, { name: "ringsj", level: 3, rid: "b2" }, { name: "ringsj", level: 3, rid: "b3" }]);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(800);
  const got = (lv) => w.logs.filter((l) => l.who === "Goodies" && new RegExp("Market watch: bought ringsj \\+" + lv + " .*to complete a compound set").test(l.msg)).length;
  return [[got(2) === 3, "ringsj +2 bought: " + got(2)], [got(3) === 0, "ringsj +3 bought: " + got(3)], [logged(w, "Goodies", /not buying ringsj \+3 for compounding: above MARKET_COMPOUND_MAX_LEVEL/), "explained"]];
});
T("MK3 market watch: one copy at Ponty goes to ONE Ranger (no duplicate buying for the same slot)", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.gold = 40000000;
  const m = merchant_char(w, { gold: 50000 }, MK_OVR(true));
  ponty(w, m, [{ name: "plaincap", level: 0, rid: "r1" }]);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); }; send(); w.clock.every(send, 60000);
  await w.clock.run(800);
  const lines = w.logs.filter((l) => l.who === "Goodies" && /Market watch: for /.test(l.msg)).length;
  return [[lines === 1, "one allocation line: " + lines], [w.bought === 1, "bought exactly one: " + w.bought]];
});
T("SR1 manual sell round: set(sell_round) sells the junk in the bank and the bag at once", async (w) => {
  if (!IS_V5) return skip_v4;
  for (const n of ["iceskates", "gcape"]) { w.G.items[n] = w.G.items[n] || { g: 10000 }; w.bank.items1.push({ name: n, level: 0 }, { name: n, level: 0 }); }
  const m = lad_world(w);
  await w.clock.run(20);
  const before = [].concat(w.bank.items0, w.bank.items1, w.bank.items3).filter((x) => x && ["iceskates", "gcape"].indexOf(x.name) !== -1).length;
  w.store["Goodies:sell_round"] = "1";
  await w.clock.run(400);
  const left = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && ["iceskates", "gcape"].indexOf(x.name) !== -1).length;
  return [[before === 4, "junk in the bank before: " + before], [logged(w, "Goodies", /Manual sell round: bank junk and surplus first/), "started"], [left === 0, "junk left: " + left], [logged(w, "Goodies", /Manual sell round: done/), "finished"]];
});
T("SR2 manual sell round with a FULL bag: the bag junk is sold first, which makes room to take the bank junk out", async (w) => {
  if (!IS_V5) return skip_v4;
  for (const n of ["iceskates", "gcape"]) { w.G.items[n] = w.G.items[n] || { g: 10000 }; w.bank.items1.push({ name: n, level: 0 }, { name: n, level: 0 }); }
  const m = lad_world(w);
  for (let i = 0; i < 8; i++) add_item(m, "wcap", 1);
  let k = 0; while (m.items.some((x) => !x)) { const nm = "filler" + (k++); w.G.items[nm] = { name: nm, g: 1, type: "material" }; add_item(m, nm, 1); }
  await w.clock.run(60); // the normal bag tidy has run by now; fill the bag with junk again
  for (let i = 0; i < 8; i++) add_item(m, "wcap", 1);
  const free_before = m.items.filter((x) => !x).length;
  w.store["Goodies:sell_round"] = "1";
  await w.clock.run(500);
  const left = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items).filter((x) => x && ["iceskates", "gcape"].indexOf(x.name) !== -1).length;
  const caps = m.items.filter((x) => x && x.name === "wcap").length;
  return [[free_before === 0, "bag full before the round: " + free_before + " free"], [caps === 0, "bag junk sold: " + caps + " left"], [left === 0, "bank junk sold too: " + left + " left"], [logged(w, "Goodies", /sold \d+ junk item\(s\) from the bag first|Manual sell round: done/), "logged"]];
});
T("BK2 bank sort: if the game does not move the items, those two slots are pinned (and the Merchant carries on)", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "ringsj", level: 1 }, null, { name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  bank_socket(w, m, false);
  await w.clock.run(400);
  return [[logged(w, "Goodies", /Bank sort: the game did not do the move \d+ <-> \d+ in items0 .* those two slots are left alone/), "switched off"], [logged(w, "Goodies", /back to the stand/), "went home anyway"]];
});
T("BK3 bank sort: a retrieve answered no_item (my copy of the bank was stale) stops this visit but does NOT switch sorting off", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "ringsj", level: 1 }, null, { name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  bank_socket(w, m, true);
  let first = true;
  const real = m.sb.bank_retrieve;
  m.sb.bank_retrieve = (pack, i) => { if (first) { first = false; return Promise.reject({ reason: "no_item" }); } return real(pack, i); };
  await w.clock.run(900);
  return [[logged(w, "Goodies", /Bank sort: .*no_item.* - the game's bank differs from my copy \(out of date\); stopping for this visit/), "stale copy noticed"], [!logged(w, "Goodies", /bank sorting is switched off/), "sorting not switched off"], [logged(w, "Goodies", /those slots? .*skipped from now on|are skipped from now on/), "the stale pair is skipped from now on"], [!logged(w, "Goodies", /those two slots are left alone/), "not counted as a failure"]];
});
T("BK4 bank sort: a stackable the bag already holds is left in place (a retrieve would merge it into the bag stack), the rest is sorted", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "cscroll0", q: 7 }, { name: "ringsj", level: 1 }, null, { name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND); add_item(m, "cscroll0", 5);
  bank_socket(w, m, true);
  const q0 = m.items.filter((x) => x && x.name === "cscroll0").reduce((a, x) => a + (x.q || 1), 0);
  await w.clock.run(400);
  const q1 = m.items.filter((x) => x && x.name === "cscroll0").reduce((a, x) => a + (x.q || 1), 0);
  const rings = w.bank.items0.filter((x) => x && x.name === "ringsj").map((x) => x.level);
  return [[q0 === q1, "bag scrolls unchanged: " + q0 + " -> " + q1], [w.bank.items0.some((x) => x && x.name === "cscroll0" && x.q === 7), "bank scrolls still in the bank"], [rings.join(",") === "3,1", "rings sorted: " + rings.join(",")]];
});
const LAYOUT_OVR = Object.assign(MERCH_OVR.concat([[/EXCHANGE_ENABLED: true/, "EXCHANGE_ENABLED: false"]]), { layout_on: true });
const LAYOUT_OVR_COMPOUND = Object.assign(MERCH_OVR_COMPOUND.concat([[/EXCHANGE_ENABLED: true/, "EXCHANGE_ENABLED: false"]]), { layout_on: true });
const bank6 = (w) => { for (const k of ["items2", "items4", "items5"]) w.bank[k] = w.bank[k] || []; };
const findpack = (w, name) => ["items0", "items1", "items2", "items3", "items4", "items5"].filter((k) => (w.bank[k] || []).some((x) => x && x.name === name)).join(",") || "none";
T("BM3 bank merge: stacks of any stackable are joined first-fit (the smallest onto the biggest stack it fits on); a stack that fits nowhere stays", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "beewings", q: 9990 }, { name: "beewings", q: 20 }, { name: "beewings", q: 6 }, { name: "ascale", q: 5000 });
  w.bank.items1.push({ name: "beewings", q: 1 }, { name: "ascale", q: 3 }, { name: "ascale", q: 1 }, { name: "ascale", q: 4000 });
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  bank_socket(w, m, true);
  await w.clock.run(600);
  const q = (n) => [].concat(w.bank.items0, w.bank.items1, w.bank.items3).filter((x) => x && x.name === n).map((x) => x.q).sort((a, b) => b - a).join(",");
  return [[q("beewings") === "9997,20", "bee wings: " + q("beewings") + " (6 and 1 joined the 9990 stack, 20 did not fit)"], [q("ascale") === "9004", "scales all in one stack: " + q("ascale")]];
});
T("BL8 bank layout: a stackable is stored ONTO an existing stack with room, not as a new single stack", async (w) => {
  if (!IS_V5) return skip_v4;
  bank6(w);
  w.bank.items0.push({ name: "beewings", q: 9999 }, { name: "beewings", q: 100 });
  const m = merchant_char(w, { gold: 5000 }, LAYOUT_OVR);
  add_item(m, "beewings", 5);
  bank_socket(w, m, true);
  m.sb.set("bank_excess", "1");
  await w.clock.run(300);
  const q = w.bank.items0.filter((x) => x && x.name === "beewings").map((x) => x.q).sort((a, b) => b - a).join(",");
  return [[q === "9999,105", "stacks: " + q + " (the 9999 stack had no room, the 100 stack took the 5)"], [findpack(w, "beewings") === "items0", "still only in items0"]];
});
T("BL1 bank layout: deposits go to the item's own pack (compound 3, upgrade 2, exchange 1, stackables 0, the rest 5)", async (w) => {
  if (!IS_V5) return skip_v4;
  bank6(w);
  const m = merchant_char(w, { gold: 5000 }, LAYOUT_OVR);
  add_item(m, "ringsj", 1, 0); add_item(m, "firebow", 1, 0); add_item(m, "mistletoe", 10); add_item(m, "oddity", 1, 0); add_item(m, "lostearring", 4);
  bank_socket(w, m, true);
  m.sb.set("bank_excess", "1");
  await w.clock.run(300);
  const f = ["ringsj", "firebow", "mistletoe", "oddity", "lostearring"].map((n) => n + "=" + findpack(w, n)).join(" ");
  return [[findpack(w, "ringsj") === "items3", "compound: " + f], [findpack(w, "firebow") === "items2", "upgrade"], [findpack(w, "mistletoe") === "items1", "exchange"], [findpack(w, "oddity") === "items5", "excess"], [findpack(w, "lostearring") === "items0", "stackable"]];
});
T("BL2 bank layout: a full pack sends the deposit to the fallback pack (the LAST pack first), and slot 41 is never used", async (w) => {
  if (!IS_V5) return skip_v4;
  bank6(w);
  for (const k of ["items3", "items4"]) for (let i = 0; i < 41; i++) w.bank[k].push({ name: "ringsj", level: 1 });
  const m = merchant_char(w, { gold: 5000 }, LAYOUT_OVR);
  add_item(m, "ringsj", 1, 0);
  bank_socket(w, m, true);
  m.sb.set("bank_excess", "1");
  await w.clock.run(300);
  const in5 = w.bank.items5.filter((x) => x && x.name === "ringsj").length;
  return [[in5 === 1, "the ring went to items5: " + findpack(w, "ringsj") + " (" + in5 + ")"], [!w.bank.items3[41] && !w.bank.items4[41], "the last slot of the full packs is still empty"]];
});
T("BL3 bank layout router: items that sit in the wrong pack are moved into their own pack; items already home stay", async (w) => {
  if (!IS_V5) return skip_v4;
  bank6(w);
  w.bank.items0.push({ name: "ringsj", level: 2 }, { name: "firebow", level: 0 }, { name: "mistletoe", q: 30 }, { name: "oddity", level: 0 }, { name: "lostearring", q: 5 });
  w.bank.items3.push({ name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, LAYOUT_OVR_COMPOUND);
  bank_socket(w, m, true);
  await w.clock.run(500);
  const rings = w.bank.items3.filter((x) => x && x.name === "ringsj").map((x) => x.level).sort().join(",");
  return [[findpack(w, "firebow") === "items2", "upgrade: " + findpack(w, "firebow")], [findpack(w, "mistletoe") === "items1", "exchange: " + findpack(w, "mistletoe")], [findpack(w, "oddity") === "items5", "excess: " + findpack(w, "oddity")], [findpack(w, "lostearring") === "items0", "stackable stays in 0"], [rings === "2,3", "both rings in items3: " + rings], [logged(w, "Goodies", /Bank layout: \d+ item\(s\) moved to their pack/), "reported"]];
});
T("BL4 bank layout router: when the item's pack is full the item stays where it is and the log says so", async (w) => {
  if (!IS_V5) return skip_v4;
  bank6(w);
  for (const k of ["items3", "items4"]) for (let i = 0; i < 41; i++) w.bank[k].push({ name: "ringsj", level: 1 });
  w.bank.items0.push({ name: "ringsj", level: 2 });
  const m = merchant_char(w, { gold: 50000 }, LAYOUT_OVR);
  bank_socket(w, m, true);
  await w.clock.run(400);
  return [[w.bank.items0.some((x) => x && x.name === "ringsj"), "the ring stays in items0"], [logged(w, "Goodies", /Bank layout: .*no room in the pack\(s\) of: compound 1/), "no room reported"]];
});
T("BL5 bank sort uses the last slot as the transit slot: a swap needs only ONE free bag slot, and slot 41 ends empty", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "ringsj", level: 1 }, { name: "ringsj", level: 3 });
  const m = merchant_char(w, { gold: 5000 });
  let k = 0; while (m.items.filter((x) => !x).length > 1) { const nm = "filler" + (k++); w.G.items[nm] = { name: nm, g: 1, type: "material" }; add_item(m, nm, 1); }
  bank_socket(w, m, true);
  const free0 = m.items.filter((x) => !x).length;
  await w.clock.run(400);
  const rings = w.bank.items0.filter((x) => x && x.name === "ringsj").map((x) => x.level).join(",");
  return [[free0 === 1, "one free bag slot: " + free0], [rings === "3,1", "sorted anyway: " + rings], [!w.bank.items0[41], "the transit slot is empty again"], [!logged(w, "Goodies", /needs \d+ empty bag slot/), "no bag-space complaint"]];
});
T("BL6 an item found in a pack's last slot is moved out of it first", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.items0.push({ name: "ringsj", level: 1 }); w.bank.items0[41] = { name: "ringsj", level: 3 };
  const m = merchant_char(w, { gold: 5000 });
  bank_socket(w, m, true);
  await w.clock.run(400);
  const rings = w.bank.items0.filter((x) => x && x.name === "ringsj").map((x) => x.level).join(",");
  return [[!w.bank.items0[41], "last slot empty"], [rings === "3,1", "both rings kept and sorted: " + rings]];
});
T("BL7 every pack has its own swap budget: two scrambled packs both make progress in the same visit", async (w) => {
  if (!IS_V5) return skip_v4;
  for (const k of ["items0", "items1"]) w.bank[k].push({ name: "ringsj", level: 1 }, { name: "ringsj", level: 2 }, { name: "ringsj", level: 3 }, { name: "ringsj", level: 5 });
  const m = merchant_char(w, { gold: 5000 }, MERCH_OVR.concat([[/BANK_SORT_MAX_SWAPS: 30/, "BANK_SORT_MAX_SWAPS: 1"]]));
  bank_socket(w, m, true);
  await w.clock.run(60);
  const first = (k) => w.bank[k].filter(Boolean).map((x) => x.level).join(",");
  await w.clock.run(900);
  return [[logged(w, "Goodies", /Bank sort: 2 move\(s\) made, \d+ more next visit/), "one move per pack in the first visit"], [first("items0") === "5,3,2,1" && first("items1") === "5,3,2,1", "both packs sorted in the end: " + first("items0") + " | " + first("items1")]];
});
T("I3 real pair on winterland, Merchant busy compounding: falls back to main and is served there", async (w) => {
  for (let i = 0; i < 6; i++) w.bank.items0.push({ name: "ringsj", level: 0 });
  const m = merchant_char(w, {}, MERCH_OVR_COMPOUND); const r = ranger_char(w, { map: "winterland", x: 300, y: 300 });
  await w.clock.run(400);
  return [[logged(w, "SexyDexy", /busy: ETA \d+s is over 60s/) || logged(w, "SexyDexy", /not usable/), "first ask refused (busy / too far)"],
    [r.map === "main", "Ranger is on main"], [r.items.some((i) => i && i.name === "hpot1" && i.q >= 90), "potions arrived (Merchant or self-service)"]];
});

// ---- v5 scheduler (the same scenarios above run against v5 with MERCHANT_FILE; these only apply to v5) ----
const MERCH_SRC = src("AutoMerchant v4.js");
const IS_V5 = /SCHEDULER \(v5\)/.test(MERCH_SRC);
const skip_v4 = [[true, "skipped: this Merchant has no scheduler (v4)"]];
const TASK_ORDER = () => [...MERCH_SRC.matchAll(/sched_add\(\{\s*name: "(\w+)"/g)].map((x) => x[1]);
T("SC1 scheduler: the task order is the one agreed with Sean (guards against an accidental reorder)", async (w) => {
  if (!IS_V5) return skip_v4;
  const got = TASK_ORDER().join(",");
  const want = "manual,hold,bankxs,sellnow,sale,tidy,sweep,mluck_town,mluck_party,exchange,exchange2,compound,upgrade,craft,donate,lottery,market,mluck"; // Sean-approved order (Phase 3); v4 was manual,exchange,donate,lottery,mluck,craft,compound,tidy,sweep,upgrade
  return [[got === want, "order is " + got]];
});
T("SC2 scheduler: set(\"sched_status\",\"1\") prints every task's timer and clears the key", async (w) => {
  if (!IS_V5) return skip_v4;
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  await w.clock.run(20);
  w.store["Goodies:sched_status"] = "1";
  await w.clock.run(30);
  const line = (w.logs.find((l) => l.who === "Goodies" && /Schedule: /.test(l.msg)) || {}).msg || "";
  return [[!!line, "schedule line logged"], [/exchange (in|ready|idle|off)/.test(line) && /donate /.test(line) && /compound /.test(line) && /tidy /.test(line) && /sweep /.test(line) && /upgrade /.test(line), "names every task: " + line.slice(0, 120)],
    [w.store["Goodies:sched_status"] === "", "key cleared"]];
});
T("SC3 scheduler: the schedule line is also logged on its own, without the console command", async (w) => {
  if (!IS_V5) return skip_v4;
  merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND);
  await w.clock.run(420); // first line ~5 minutes after start
  return [[logged(w, "Goodies", /Schedule: /), "periodic schedule line"]];
});
T("SC4 scheduler: two rounds due at the same time run in table order (tidy before compound), the other is logged as waiting and counted", async (w) => {
  if (!IS_V5) return skip_v4;
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND); // compound is due at start; the junk makes the bag tidy due too (tidy comes first)
  for (let i = 0; i < 6; i++) add_item(m, "wshoes", 1);
  await w.clock.run(240);
  w.store["Goodies:sched_status"] = "1";
  await w.clock.run(30);
  const line = (w.logs.filter((l) => l.who === "Goodies" && /Schedule: /.test(l.msg)).pop() || {}).msg || "";
  const iC = w.logs.findIndex((l) => /Also due after Bag tidy: .*compound/.test(l.msg));
  return [[iC >= 0, "log says the compound round waited behind the tidy"], [/compound [^;]*\[waited [1-9]/.test(line), "waited count in the schedule line: " + line.slice(0, 200)],
    [m.items.filter((i) => i && i.name === "wshoes").length === 0, "the tidy sold the junk"], [logged(w, "Goodies", /Moving to bank - compound round/), "the compound round ran after it"]];
});
T("SC5 scheduler: rounds that are off show as off, and a Ranger job still goes first", async (w) => {
  if (!IS_V5) return skip_v4;
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR); // compound, upgrade, craft and lottery off
  const r = ranger_char(w, { x: -110, y: 15 }, [["hpot1", 5], ["mpot1", 5]]);
  await w.clock.run(10);
  w.store["Goodies:sched_status"] = "1";
  await w.clock.run(30);
  const line = (w.logs.find((l) => l.who === "Goodies" && /Schedule: /.test(l.msg)) || {}).msg || "";
  return [[/compound off/.test(line) && /upgrade off/.test(line) && /craft off/.test(line) && /lottery off/.test(line), "off tasks marked: " + line.slice(0, 160)], [r.items.some((i) => i && i.name === "hpot1" && i.q >= 100), "the Ranger's restock job was served"]];
});

T("SC6 scheduler: a round that keeps waiting behind a busier, higher-priority one still gets its turn (no starvation)", async (w) => {
  if (!IS_V5) return skip_v4;
  // the tidy is always due (interval 0, junk refilled every second); compound is lower in the table and would wait for ever
  const m = merchant_char(w, { gold: 50000 }, MERCH_OVR_COMPOUND.concat([[/TRUSTED_NAMES: \[[^\]]*\]/, 'TRUSTED_NAMES: ["Dexy2"]'], [/GEAR_SWEEP: true/, "GEAR_SWEEP: false"], [/SURPLUS_COPIES: true/, "SURPLUS_COPIES: false"], [/COMPOUND_EVERY_MS: \d+/, "COMPOUND_EVERY_MS: 60000"], [/BAG_TIDY_EVERY_MS: \d+/, "BAG_TIDY_EVERY_MS: 0"], [/SCHED_MAX_WAIT_MS: [^,]+,/, "SCHED_MAX_WAIT_MS: 30000,"]]));
  m.sb.calculate_item_value = () => 1000;
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); // fresh gear reports, so the tidy has no reason to wait 4 minutes
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  w.clock.every(() => { if (m.items.filter((i) => !i).length > 10) for (let i = 0; i < 6; i++) add_item(m, "wshoes", 1); }, 1000);
  await w.clock.run(400);
  const i = w.logs.findIndex((l) => /Schedule: Compound round has waited \d+[sm] behind other rounds - running it now/.test(l.msg));
  w.store["Goodies:sched_status"] = "1";
  await w.clock.run(30);
  const line = (w.logs.filter((l) => /Schedule: tidy/.test(l.msg)).pop() || {}).msg || "";
  return [[i >= 0, "starvation rule fired for the compound round at " + (i >= 0 ? w.logs[i].t + "s" : "never")], [/compound [^;]*ran [2-9]x/.test(line), "compound round ran again: " + line.slice(0, 220)]];
});
const RANGER_SRC = src("AutoRanger v4.js");
const IS_R5 = /STEP TABLE \(v5\)/.test(RANGER_SRC);
const skip_r4 = [[true, "skipped: this Ranger has no step table (v4)"]];
T("RS1 ranger step table: the brain loop runs its steps in the v4 order (guards against an accidental reorder)", async (w) => {
  if (!IS_R5) return skip_r4;
  const got = [...RANGER_SRC.matchAll(/step_add\(\{ name: "(\w+)"/g)].map((x) => x[1]).join(",");
  const want = "survive,danger,destroy,courier,ladder,housekeeping,luck,follower,boss,hunt,goal,fight"; // safety first (survive, need ladder), then the party/boss/hunt/goal chain, fight is the fallback
  return [[got === want, "order is " + got]];
});
T("RS2 ranger step table: set(\"ranger_status\",\"1\") prints which step used the loop and clears the key", async (w) => {
  if (!IS_R5) return skip_r4;
  const r = ranger_char(w, {}, [["hpot1", 300], ["mpot1", 300]]); // plenty of potions: no need, so the loop reaches the fight
  await w.clock.run(30);
  w.store["SexyDexy:ranger_status"] = "1";
  await w.clock.run(20);
  const line = (w.logs.find((l) => l.who === "SexyDexy" && /Loop since last status/.test(l.msg)) || {}).msg || "";
  return [[!!line, "status line logged"], [/survive \d+% x\d+/.test(line) && /fight \d+% x[1-9]/.test(line) && /ladder /.test(line) && /goal /.test(line), "names every step, fight handled passes: " + line.slice(0, 140)], [w.store["SexyDexy:ranger_status"] === "", "key cleared"]];
});
T("RS3 ranger step table: the status line also appears on its own", async (w) => {
  if (!IS_R5) return skip_r4;
  const r = make_char(w, "SexyDexy", { x: 387, y: 1066 }, "AutoRanger v4.js", RANGER_OVR.concat([[/RANGER_STATUS_MS: [^,]+,/, "RANGER_STATUS_MS: 60000,"]]));
  await w.clock.run(200);
  return [[w.logs.filter((l) => l.who === "SexyDexy" && /Loop since last status/.test(l.msg)).length >= 2, "periodic lines"]];
});
T("RS4 ranger step table: a potion need is handled by the ladder step (counted), and the Ranger is served", async (w) => {
  if (!IS_R5) return skip_r4;
  const m = merchant_char(w, { gold: 50000 });
  const r = ranger_char(w, { x: -110, y: 15 }, [["hpot1", 5], ["mpot1", 5]]);
  await w.clock.run(60);
  w.store["SexyDexy:ranger_status"] = "1";
  await w.clock.run(20);
  const line = (w.logs.find((l) => l.who === "SexyDexy" && /Loop since last status/.test(l.msg)) || {}).msg || "";
  return [[/ladder \d+% x[1-9]|now in ladder/.test(line), "ladder counted or running: " + line.slice(0, 200)], [r.items.some((i) => i && i.name === "hpot1" && i.q >= 100), "potions delivered"]];
});
T("RS5 junk list: xmashat and xmasshoes are junk for both the Merchant and the Ranger", async (w) => {
  const ms = MERCH_SRC.match(/JUNK_SELLABLE: \[([^\]]*)\]/)[1], rs = RANGER_SRC.match(/JUNK_ITEMS: \[([^\]]*)\]/)[1];
  if (!/v5/.test(MERCH_SRC.slice(0, 200)) && !IS_V5) return [[true, "skipped on v4 files"]];
  return [[/"xmashat"/.test(ms) && /"xmasshoes"/.test(ms), "Merchant JUNK_SELLABLE"], [!IS_R5 || (/"xmashat"/.test(rs) && /"xmasshoes"/.test(rs)), "Ranger JUNK_ITEMS"]];
});
T("RP1 ranger paced queue: every send_item, send_gold and start_character call goes through the shared queue (static guard)", async (w) => {
  if (!IS_R5) return skip_r4;
  const bad = [];
  for (const m of RANGER_SRC.matchAll(/(?<!function )\b(send_item|send_gold|start_character)\(/g)) {
    const before = RANGER_SRC.slice(Math.max(0, m.index - 60), m.index);
    if (!/call_paced\("(transfer|start)", \(\) =>\s*$/.test(before)) bad.push(m[1] + "@" + m.index);
  }
  return [[bad.length === 0, "unqueued calls: " + bad.join(",")]];
});
T("RP2 ranger paced queue: the leader's start_character requests are at least 1.5 s apart", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = make_char(w, "SexyDexy", { x: 387, y: 1066 }, "AutoRanger v4.js", [[/HUNT_ENABLED: true/, "HUNT_ENABLED: false"], [/GEAR_SHARE: true/, "GEAR_SHARE: false"], [/PARTY_START_MEMBERS: false/, "PARTY_START_MEMBERS: true"], [/PARTY_SUPPORT: \[[^\]]*\]/, 'PARTY_SUPPORT: ["SexyHexy"]']]);
  L.script_char = true; add_item(L, "hpot1", 200); add_item(L, "mpot1", 200);
  const orig = L.sb.start_character, times = [];
  L.sb.start_character = (n, slot) => { times.push([n, w.clock.t]); return orig(n, slot); };
  await w.clock.run(60);
  let min_gap = Infinity;
  for (let i = 1; i < times.length; i++) min_gap = Math.min(min_gap, times[i][1] - times[i - 1][1]);
  return [[times.length >= 3, "start requests: " + times.map((t) => t[0]).join(",")], [min_gap >= 1500, "smallest gap " + min_gap + " ms"]];
});
T("SP1 paced queue: every lottery request goes out at least 1.5 s after the previous one finished", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.gold = 30000000;
  const m = merchant_char(w, { gold: 50000 }, LOT_OVR);
  const sk = m.sb.parent.socket, orig = sk.emit, sent = [];
  sk.emit = function (ev, d) { sent.push([ev, w.clock.t]); return orig.call(sk, ev, d); };
  await w.clock.run(900);
  let min_gap = Infinity;
  for (let i = 1; i < sent.length; i++) min_gap = Math.min(min_gap, sent[i][1] - sent[i - 1][1]);
  return [[sent.length >= 8, "requests sent: " + sent.length], [min_gap >= 1500, "smallest gap " + min_gap + " ms"], [w.lottery.buys.length === 6, "still bought 1 item + 5 money tickets: " + w.lottery.buys.join(",")]];
});
T("SP2 paced queue: donation, exchange and lottery requests are all routed through paced() (static guard)", async (w) => {
  if (!IS_V5) return skip_v4;
  const bad = [];
  for (const m of MERCH_SRC.matchAll(/call\(\(\) => (donate_gold|exchange)\(/g)) if (MERCH_SRC.slice(Math.max(0, m.index - 12), m.index) !== "paced(() => ") bad.push(m[1] + "@" + m.index);
  const emits = [...MERCH_SRC.matchAll(/\.emit\(/g)].length - [...MERCH_SRC.matchAll(/\.emit\("bank"/g)].length; // the bank sort (not rate-limited, checked move by move) has its own emit
  const raw_calls = [...MERCH_SRC.matchAll(/[^_]sock_ask_raw\(/g)].length;
  return [[bad.length === 0, "unpaced calls: " + bad.join(",")], [emits === 1, "socket emit only in sock_ask_raw (" + emits + ")"], [raw_calls === 2, "sock_ask_raw: its definition and the paced wrapper only (" + raw_calls + ")"]];
});
T("SP3 paced queue: the schedule line reports how many requests were paced", async (w) => {
  if (!IS_V5) return skip_v4;
  w.bank.gold = 30000000;
  merchant_char(w, { gold: 50000 }, LOT_OVR);
  await w.clock.run(600);
  w.store["Goodies:sched_status"] = "1";
  await w.clock.run(30);
  const line = (w.logs.filter((l) => l.who === "Goodies" && /Schedule: /.test(l.msg)).pop() || {}).msg || "";
  return [[/paced requests \d+/.test(line), line.slice(-90)]];
});


// ---- v5: party membership without the Merchant, the Priest as a party member, Phoenix every 30 minutes ----
T("PJ1 no Merchant: the Ranger leader invites an online follower that is not in his party, and the follower accepts", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = party_ranger(w, "SexyDexy"); const F = party_ranger(w, "Dexy2");
  await w.clock.run(40);
  return [[(w.invites || []).indexOf("SexyDexy>Dexy2") !== -1 || (w.requests || []).indexOf("Dexy2>SexyDexy") !== -1, "invited or asked: " + JSON.stringify([w.invites, w.requests])], [w.party.Dexy2 === "SexyDexy", "Dexy2 is in SexyDexy's party: " + w.party.Dexy2], [logged(w, "Dexy2", /Accepting the party invitation from SexyDexy/) || logged(w, "SexyDexy", /Accepting the party request from Dexy2/), "accept logged"]];
});
T("PJ5 characters Sean launched himself are missing from get_active_characters: the leader still invites a follower he hears from, and the Priest still asks the leader", async (w) => {
  if (!IS_R5 || !process.env.PRIEST_FILE) return skip_r4;
  const L = party_ranger(w, "SexyDexy", { support: true }); const F = party_ranger(w, "Dexy2"); const P = priest_char(w);
  for (const c of [L, F, P]) c.script_char = false; // not "active" for get_active_characters
  delete w.party.SexyHexy; delete w.party.SexyDexy; delete w.party.Dexy2;
  await w.clock.run(120);
  return [[w.party.Dexy2 === "SexyDexy", "follower in the party: " + w.party.Dexy2], [w.party.SexyHexy === "SexyDexy", "Priest in the party: " + w.party.SexyHexy]];
});
T("PJ2 the Priest (v5) asks to join the leader's party and is let in; a stranger's request is ignored", async (w) => {
  if (!IS_R5 || !process.env.PRIEST_FILE) return skip_r4;
  const L = party_ranger(w, "SexyDexy", { support: true }); const P = priest_char(w);
  delete w.party.SexyHexy; delete w.party.SexyDexy;
  const X = make_char(w, "Stranger", { x: 900, y: 0 }); X.script_char = true;
  await w.clock.run(40);
  X.sb.send_party_request("SexyDexy");
  await w.clock.run(10);
  return [[w.party.SexyHexy === "SexyDexy", "Priest joined: " + w.party.SexyHexy], [w.party.Stranger === undefined, "stranger not accepted: " + w.party.Stranger]];
});
T("PJ3 the Priest's level gates the party: bees only until she reaches level 60, and only the Grinch event is joined meanwhile", async (w) => {
  if (!IS_R5 || !process.env.PRIEST_FILE) return skip_r4;
  w.G.monsters.snowman = { name: "Snowman", attack: 9, frequency: 0.5, hp: 5000000, respawn: 43200 };
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const L = party_ranger(w, "SexyDexy", { support: true }); const F = party_ranger(w, "Dexy2", { level: 70, support: true }); const F3 = party_ranger(w, "Dexy3", { level: 70, support: true }); const P = priest_char(w, { level: 1 });
  const S = L.sb.parent.S = L.sb.parent.S || {};
  S.snowman = { live: true, hp: 4000000, max_hp: 5000000, map: "main", x: 440, y: 1066, target: null };
  L.sb.parent.entities.s1 = { id: "s1", type: "monster", mtype: "snowman", visible: true, dead: false, x: L.x + 50, y: L.y, hp: 4000000, max_hp: 5000000, attack: 9 };
  await w.clock.run(300);
  const held = !logged(w, "SexyDexy", /Farm goal: Phoenix/) && !logged(w, "SexyDexy", /Everyone is level 60/);
  const snow = logged(w, "SexyDexy", /Boss event: Snowman is up/);
  P.level = 60;
  await w.clock.run(60);
  return [[held, "no goal while the Priest is level 1"], [!snow, "Snowman event not joined by the small party"], [logged(w, "SexyDexy", /Everyone is level 60\+/), "party ready once the Priest reaches 60"]];
});
T("PJ4 the courier serves the Priest: she is in the courier trip's member list (potions for the whole party)", async (w) => {
  if (!IS_R5 || !process.env.PRIEST_FILE) return skip_r4;
  const L = party_ranger(w, "SexyDexy", { support: true }); const F = party_ranger(w, "Dexy2", { level: 70, support: true }); const P = priest_char(w, { level: 70 });
  await w.clock.run(60);
  return [[logged(w, "SexyDexy", /Courier trip: SexyHexy is low on potions - Dexy2 goes to town for everyone/), "courier sent for the Priest's potions"], [logged(w, "Dexy2", /Courier trip for the party: SexyDexy, Dexy2.*SexyHexy/), "the Priest is on the courier's list"]];
});
T("PH1 Phoenix is visited at most once every 30 minutes (the rest of the time he farms bees)", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.monsters.phoenix = { name: "Phoenix", attack: 125, frequency: 1.2, hp: 160000, respawn: 32 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "phoenix", count: 1, boundary: [700, -300, 1600, -90] }];
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  await w.clock.run(1500);
  const n1 = w.logs.filter((l) => l.who === "SexyDexy" && /Farm goal: Phoenix/.test(l.msg)).length;
  await w.clock.run(600);
  const n2 = w.logs.filter((l) => l.who === "SexyDexy" && /Farm goal: Phoenix/.test(l.msg)).length;
  return [[n1 === 1, "one visit in the first 25 minutes: " + n1], [n2 === 2, "a second visit after 30 minutes: " + n2]];
});

T("BE8 a boss that does not teleport (Snowman): once the server says he is not live and he is gone from view, the event ends after 30 s, not minutes", async (w) => {
  if (!IS_R5) return skip_r4;
  RANGER_OVR.push(NOPOST);
  w.G.monsters.snowman = { name: "Snowman", attack: 9, frequency: 0.5, hp: 5000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  const r = ranger_char(w, { attack: 440, frequency: 2, x: 387, y: 1066 }, [["hpot1", 100], ["mpot1", 100]]);
  const S = r.sb.parent.S = r.sb.parent.S || {};
  S.snowman = { live: true, hp: 4000000, max_hp: 5000000, map: "main", x: 440, y: 1066, target: null };
  r.sb.parent.entities.s1 = { id: "s1", type: "monster", mtype: "snowman", visible: true, dead: false, x: r.x + 50, y: r.y, hp: 4000000, max_hp: 5000000, attack: 9 };
  await w.clock.run(30);
  const started = logged(w, "SexyDexy", /Boss event: Snowman is up/);
  S.snowman = { live: false }; delete r.sb.parent.entities.s1;
  await w.clock.run(60);
  RANGER_OVR.pop();
  return [[started, "event started"], [logged(w, "SexyDexy", /Boss event Snowman ended: the server no longer lists him as live and he has not been seen for 30 s/), "ended on the server's word within a minute"]];
});


// ---- v5: the Priest loots, hands her bag to the courier, and takes part in the Merchant's gear sweep ----
const has_item = (w, ch, name) => ch.items.some((i) => i && i.name === name) || [0, 1, 3].some((k) => w.bank["items" + k].some((x) => x && x.name === name));
T("PL1 Priest loots chests (loot is per character)", async (w) => {
  if (!process.env.PRIEST_FILE) return skip_r4;
  const P = priest_char(w); P.loots = 0; P.sb.loot = () => { P.loots++; };
  await w.clock.run(10);
  return [[P.loots >= 5, "loot calls: " + P.loots]];
});
T("PL2 Priest gives the courier her junk, spare gear and spare gold when asked; her potions stay", async (w) => {
  if (!process.env.PRIEST_FILE) return skip_r4;
  const P = priest_char(w, { gold: 40000 }); const C = make_char(w, "SexyLexy", { x: 20, y: 0 });
  add_item(P, "hpot1", 50); add_item(P, "mpot1", 50); add_item(P, "wbook0", 1, 2); add_item(P, "wcap", 1); add_item(P, "wshoes", 1);
  await w.clock.run(2);
  C.sb.send_cm("SexyHexy", { type: "courier_collect", id: "c1", max: 12 });
  await w.clock.run(20);
  const got = (n) => C.items.some((i) => i && i.name === n);
  return [[got("wbook0") && got("wcap") && got("wshoes"), "items arrived at the courier"], [!P.items.some((i) => i && /^(wbook0|wcap|wshoes)$/.test(i.name)), "her bag is empty of them"],
    [P.items.some((i) => i && i.name === "hpot1") && P.items.some((i) => i && i.name === "mpot1"), "potions stay"], [C.gold >= 30000, "gold surplus sent: courier has " + C.gold], [msgs(C, "courier_collected").length === 1, "courier told"]];
});
T("PL3 Priest equips what the courier hands her (gear_give + item) and reports her gear to the Merchant", async (w) => {
  if (!process.env.PRIEST_FILE) return skip_r4;
  const P = priest_char(w); const C = make_char(w, "SexyLexy", { x: 20, y: 0 }); const M = fake_merchant(w);
  add_item(C, "wbook1", 1, 3);
  C.sb.send_cm("SexyHexy", { type: "gear_give", name: "wbook1", level: 3, slot: "offhand" });
  C.sb.send_item("SexyHexy", C.items.findIndex((i) => i && i.name === "wbook1"), 1);
  await w.clock.run(70);
  const rep = msgs(M, "gear_report").pop();
  return [[P.slots.offhand && P.slots.offhand.name === "wbook1" && P.slots.offhand.level === 3, "wbook1 +3 worn in the offhand: " + JSON.stringify(P.slots.offhand)], [!!rep && rep.slots.offhand && rep.slots.offhand.name === "wbook1", "gear report to the Merchant lists it"]];
});
T("PG1 Merchant gear sweep: a book in the bank goes to the Priest's empty offhand (not to a Ranger); the leader is told", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.wbook1 = { g: 100000, type: "source", int: 5, compound: { int: 3 }, grades: [0, 2, 6, 7] }; w.G.items.wbookhs = { g: 960000, type: "source", int: 8, dex: 2, compound: { dex: 6, vit: 6, resistance: 30 }, grades: [0, 2, 6, 7], set: "holidays" };
  w.bank.items0.push({ name: "wbook1", level: 3 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const P = make_char(w, "SexyHexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); gear_rep(P, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  return [[logged(w, "Goodies", /Gear sweep: wbook1 \+3 for SexyHexy/), "book assigned to the Priest"], [!logged(w, "Goodies", /Gear sweep: wbook1 \+3 for (SexyDexy|Dexy2)/), "no Ranger got it"], [(msgs(L, "gear_ready")[0] || { names: [] }).names.indexOf("SexyHexy") !== -1, "leader told the Priest's gear is waiting"]];
});
T("PS1 stat scroll for the Priest: an Intelligence Scroll is applied to a cap with a stat value before it is handed to her; none for a piece without one", async (w) => {
  if (!IS_R5) return skip_r4;
  w.bank.items0.push({ name: "dexcap", level: 0 }); w.bank.items0.push({ name: "plaincap", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const P = make_char(w, "SexyHexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, { helmet: { name: "plaincap", level: 9 } }); gear_rep(F, { helmet: { name: "plaincap", level: 9 } }); gear_rep(P, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  const got = m.items.filter((x) => x && x.stat_type);
  return [[logged(w, "Goodies", /STAT SCROLL applied to dexcap \+0 for SexyHexy \(intscroll\)/), "int scroll applied: " + w.logs.filter((l) => /STAT SCROLL|scroll/i.test(l.msg)).map((l) => l.msg).slice(0, 3).join(" | ")], [got.length === 1 && got[0].stat_type === "int", "the cap carries int"], [!logged(w, "Goodies", /STAT SCROLL.*plaincap/), "plaincap got no scroll"]];
});
T("GW1 Warrior gear (2026-11-18): the sword with vitality beats a stronger one, a basher goes to his bag (not worn) while he has none, and is kept (not sold) until then", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.swordv = { g: 100000, type: "weapon", wtype: "sword", attack: 20, vit: 12, upgrade: { attack: 4 }, grades: [0, 7, 10, 12] };
  w.G.items.swordh = { g: 100000, type: "weapon", wtype: "sword", attack: 60, upgrade: { attack: 4 }, grades: [0, 7, 10, 12] };
  w.G.items.wbasher = { g: 4900, type: "weapon", wtype: "basher", attack: 26, upgrade: { attack: 6 }, grades: [7, 9, 10, 12] };
  w.bank.items0.push({ name: "swordh", level: 0 }, { name: "swordv", level: 0 }, { name: "wbasher", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const Wr = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); Wr.sb.send_cm("Goodies", { type: "gear_report", slots: {}, bag: {}, map: "main", x: -110, y: 15 }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  return [[logged(w, "Goodies", /Gear sweep: swordv \+0 for SexyWexy/), "the vitality sword goes to the Warrior"], [!logged(w, "Goodies", /Gear sweep: swordh \+0 for SexyWexy/), "not the stronger plain sword"], [logged(w, "Goodies", /Gear sweep: wbasher \+0 for SexyWexy/), "basher assigned to his bag: " + w.logs.filter((l) => /basher/.test(l.msg)).map((l) => l.msg).slice(0, 2).join(" | ")]];
});
T("GW2 magic set (Merchant): a resistance helmet in the bank goes to the Warrior's second set (slot alt:helmet) while his main helmet stays; the leader is told", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.reshelm = { g: 100000, type: "helmet", class: ["warrior"], resistance: 40, armor: 5, upgrade: { resistance: 5 }, grades: [0, 7, 10, 12] };
  w.G.items.phelm = { g: 100000, type: "helmet", str: 10, evasion: 20, armor: 30, upgrade: { armor: 3 }, grades: [0, 7, 10, 12] };
  w.bank.items0.push({ name: "reshelm", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const Wr = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, { helmet: { name: "plaincap", level: 9 } }); gear_rep(F, { helmet: { name: "plaincap", level: 9 } }); Wr.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "phelm", level: 0 } }, bag: { wbasher: 1 }, alt: {}, map: "main", x: -110, y: 15 }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  const to_wexy = (msgs(L, "gear_ready")[0] || { names: [] }).names.indexOf("SexyWexy") !== -1;
  return [[logged(w, "Goodies", /Gear sweep: reshelm \+0 for SexyWexy/), "the resistance helmet is assigned to the Warrior: " + w.logs.filter((l) => /reshelm/.test(l.msg)).map((l) => l.msg).slice(0, 2).join(" | ")], [to_wexy, "leader told that gear waits for SexyWexy"]];
});
T("WR5 magic set (Warrior): receives a piece for the second set (kept in the bag), swaps it in for a big magical focus, swaps the main set back afterwards, and always reports the main set", async (w) => {
  w.G.items.reshelm = { type: "helmet", resistance: 40 }; w.G.items.phelm = { type: "helmet", armor: 30 };
  w.G.monsters.grinch = Object.assign(w.G.monsters.grinch || {}, { damage_type: "magical", hp: 1e6 });
  const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 1000, max_hp: 1000 });
  const M = make_char(w, "Goodies", { ctype: "merchant", x: 0, y: 0 });
  const W = warrior_char(w, { x: 0, y: 0 });
  W.sb.parent.entities.SexyDexy = L;
  const ch = W.sb.character;
  ch.slots.helmet = { name: "phelm", level: 0 }; ch.items[0] = { name: "reshelm", level: 0 };
  W.sb.equip = (i, slot) => { const it = ch.items[i]; if (!it) return Promise.resolve({}); const old = ch.slots[slot]; ch.slots[slot] = { name: it.name, level: it.level || 0 }; ch.items[i] = old ? { name: old.name, level: old.level || 0 } : null; return Promise.resolve({}); };
  const worn = () => ch.slots.helmet && ch.slots.helmet.name;
  M.sb.send_cm("SexyWexy", { type: "gear_give", name: "reshelm", level: 0, slot: "alt:helmet" });
  await w.clock.run(5);
  const kept = worn() === "phelm";
  const E = W.sb.parent.entities;
  E.grinch1 = { id: "grinch1", type: "monster", mtype: "grinch", name: "Grinch", x: 20, y: 0, map: "main", hp: 1e6, max_hp: 1e6, target: "SexyWexy", visible: true, dead: false };
  await w.clock.run(5);
  const on = worn() === "reshelm";
  const rep = (w.chars.Goodies.inbox || []).filter((x) => x.msg.type === "gear_report");
  delete E.grinch1;
  await w.clock.run(12);
  const back = worn() === "phelm";
  return [[kept, "the piece stays in the bag when it arrives: " + worn()], [on, "magic helmet on for the magical boss: " + worn()], [back, "main helmet back afterwards: " + worn()]];
});
T("PG4 Warrior (tank) gear rules: Spike's Attire goes to the Warrior's empty chest slot, a Book of Cheer never does", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.vattire = { name: "Spike's Attire", type: "chest", g: 4800000, armor: 42, resistance: 28, hp: 1600, upgrade: { armor: 6, resistance: 5, hp: 200 }, grades: [0, 4, 7, 9] };
  w.G.items.wbookhs = { g: 960000, type: "source", int: 8, dex: 2, vit: 16, resistance: 120, compound: { dex: 6, vit: 6, resistance: 30 }, grades: [0, 2, 6, 7], set: "holidays" };
  w.bank.items0.push({ name: "vattire", level: 0 }, { name: "wbookhs", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const Wr = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, { chest: { name: "vattire", level: 5 } }); gear_rep(F, { chest: { name: "vattire", level: 5 } }); gear_rep(Wr, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(200);
  return [[logged(w, "Goodies", /Gear sweep: .*vattire.* for SexyWexy/), "Spike's Attire assigned to the Warrior"], [!logged(w, "Goodies", /Gear sweep: .*wbookhs.* for SexyWexy/), "no Book for the Warrior"]];
});
T("PG2 Merchant never sells an item the Priest would wear (a Book of Cheer is junk for Rangers), but still sells it when no Priest reports", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.wbook1 = { g: 100000, type: "source", int: 5, compound: { int: 3 }, grades: [0, 2, 6, 7] }; w.G.items.wbookhs = { g: 960000, type: "source", int: 8, dex: 2, compound: { dex: 6, vit: 6, resistance: 30 }, grades: [0, 2, 6, 7], set: "holidays" };
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  add_item(m, "wbookhs", 1);
  for (let i = 0; i < 5; i++) add_item(m, "wcap", 1); // enough junk to trigger the tidy round
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const P = make_char(w, "SexyHexy", { x: -110, y: 35 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); gear_rep(P, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  return [[has_item(w, m, "wbookhs"), "Book of Cheer kept while the Priest has an empty offhand"], [!has_item(w, m, "wcap"), "the other junk was sold (the tidy round ran)"]];
});
T("PG3 control: without a Priest report the Merchant sells the Book of Cheer as junk", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.wbook1 = { g: 100000, type: "source", int: 5, compound: { int: 3 }, grades: [0, 2, 6, 7] }; w.G.items.wbookhs = { g: 960000, type: "source", int: 8, dex: 2, compound: { dex: 6, vit: 6, resistance: 30 }, grades: [0, 2, 6, 7], set: "holidays" };
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  add_item(m, "wbookhs", 1);
  for (let i = 0; i < 5; i++) add_item(m, "wcap", 1); // enough junk to trigger the tidy round
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 });
  const send = () => { gear_rep(L, {}); gear_rep(F, {}); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  return [[!has_item(w, m, "wbookhs"), "Book of Cheer sold when nobody would wear it"]];
});

// ---- v5 (Sean 2026-11-18): forced farm override, Merchant's Luck stop, Warrior MP guard -----------------------------
const FF_OVR = (luck) => RANGER_OVR.filter((x) => !/PARTY_MEMBERS/.test(String(x[0]))).concat([[/PARTY_MEMBERS: \[[^\]]*\]/, 'PARTY_MEMBERS: ["Dexy2", "Dexy3"]']]).concat(luck ? [[/LUCK_STOP: false/, "LUCK_STOP: true"]] : []);
const ff_world = (w, o, luck) => {
  w.G.monsters.poisio = { name: "Poisio", attack: 1, frequency: 1, hp: 10 };
  w.G.maps.main.monsters = [{ type: "poisio", count: 5, boundary: [1000, 1000, 1200, 1200] }];
  const L = make_char(w, "SexyDexy", Object.assign({ x: 1100, y: 1100, attack: 440, frequency: 2 }, o), "AutoRanger v4.js", FF_OVR(luck));
  L.script_char = true; add_item(L, "hpot1", 250); add_item(L, "mpot1", 250);
  L.sb.parent.calculate_difficulty = (m) => (m.mtype === "poisio" ? 2 : 0);
  L.attacks = 0; const oa = L.sb.attack; L.sb.attack = (t) => { L.attacks++; return oa(t); };
  return L;
};
const last_state = (ch) => msgs(ch, "party_state").slice(-1)[0];
T("FF1 forced farm: set(force_farm) lets only that hard monster past the difficulty limit and moves the farm + pull types; a death message drops it and brings the bees back", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = ff_world(w);
  const Wr = make_char(w, "SexyWexy", { ctype: "warrior", x: 1090, y: 1100 });
  L.sb.parent.entities.p1 = { id: "p1", type: "monster", mtype: "poisio", visible: true, dead: false, x: 1140, y: 1100, hp: 10, max_hp: 10, attack: 1, frequency: 1, target: null, map: "main" };
  await w.clock.run(8);
  const before = L.attacks;
  w.store["SexyDexy:force_farm"] = "poisio";
  await w.clock.run(12);
  const st = last_state(Wr);
  const shot = L.attacks;
  Wr.sb.send_cm("SexyDexy", { type: "died" });
  await w.clock.run(10);
  const st2 = last_state(Wr);
  return [[before === 0, "the hard poisio is skipped normally: " + before], [shot > 0, "shoots it once forced: " + shot], [logged(w, "SexyDexy", /FORCED FARM: Poisio/), "start logged"],
    [st && st.force === "poisio" && st.types[0] === "poisio", "party_state carries force + types: " + JSON.stringify(st && [st.force, st.types])],
    [logged(w, "SexyDexy", /Forced farm of Poisio DROPPED: SexyWexy died/), "dropped on the Warrior's death message"], [w.store["SexyDexy:force_farm"] === "", "storage cleared so it does not restart"],
    [st2 && !st2.force && st2.types[0] === "bee", "bees are back in party_state: " + JSON.stringify(st2 && [st2.force, st2.types])]];
});
T("FF2 forced farm: a member found dead (rip) drops it; but not while the Grinch fight is on", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = ff_world(w);
  const Wr = make_char(w, "SexyWexy", { ctype: "warrior", x: 1090, y: 1100 });
  w.store["SexyDexy:force_farm"] = "poisio";
  await w.clock.run(6);
  L.sb.parent.entities.g1 = { id: "g1", type: "monster", mtype: "grinch", visible: true, dead: false, x: 1300, y: 1100, hp: 1e6, max_hp: 1e6, attack: 1, frequency: 1, target: null, map: "main" };
  Wr.rip = true;
  await w.clock.run(6);
  const kept = !logged(w, "SexyDexy", /DROPPED/);
  delete L.sb.parent.entities.g1; Wr.rip = false; await w.clock.run(370); // (the boss event runs on until the Grinch has been gone 5 min)
  Wr.rip = true;
  await w.clock.run(6);
  return [[kept, "the Grinch fight does not drop it"], [logged(w, "SexyDexy", /DROPPED: SexyWexy died/), "dropped on a rip without the Grinch"]];
});
T("FF3 forced farm: the leader's own death drops it; set(force_farm, '') ends it by hand; an unknown monster is refused", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = ff_world(w);
  w.store["SexyDexy:force_farm"] = "nosuchmonster";
  await w.clock.run(6);
  const refused = logged(w, "SexyDexy", /force_farm: 'nosuchmonster' is not a monster/) && w.store["SexyDexy:force_farm"] === "";
  w.store["SexyDexy:force_farm"] = "poisio"; await w.clock.run(6);
  w.store["SexyDexy:force_farm"] = ""; await w.clock.run(6);
  const ended = logged(w, "SexyDexy", /Forced farm ended by hand/);
  w.store["SexyDexy:force_farm"] = "poisio"; await w.clock.run(6);
  L.rip = true; await w.clock.run(6);
  return [[refused, "unknown monster refused and cleared"], [ended, "ended by hand"], [logged(w, "SexyDexy", /DROPPED: SexyDexy died/), "own death drops it"]];
});
T("FL1 Merchant's Luck stop: the forced farm sends the leader to the Merchant, who casts on the leader and the reported Warrior (not on a stranger); the leader logs it done", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.skills = { mluck: { name: "Merchant's Luck", level: 40, mp: 10, range: 320, cooldown: 100, target: "player", duration: 3600000 } };
  const M = merchant_char(w, { gold: 50000, level: 40, mp: 500, max_mp: 500 }, SW_OVR);
  const casts = []; M.sb.use_skill = (n, t) => { casts.push(t.name); t.s = { mluck: { ms: 3600000 } }; return Promise.resolve({}); };
  const L = ff_world(w, { x: -110, y: 15 }, true);
  const Wr = make_char(w, "SexyWexy", { ctype: "warrior", x: -100, y: 20 });
  const E = M.sb.parent.entities;
  L.type = "character"; Wr.type = "character"; E.SexyDexy = L; E.SexyWexy = Wr; E.Stranger = { id: "Stranger", type: "character", name: "Stranger", x: -120, y: 0, map: "main" };
  const rep = () => Wr.sb.send_cm("SexyDexy", { type: "party_level", level: 70, hp: 10, mp: 10, free: 10, junk: 0, gear: 0, gold: 0, map: "main" });
  rep(); w.clock.every(rep, 4000);
  await w.clock.run(60);
  w.store["SexyDexy:force_farm"] = "poisio";
  await w.clock.run(150);
  return [[casts.slice().sort().join(",") === "SexyDexy,SexyWexy", "cast on the leader and the Warrior only: " + casts.join(",")], [logged(w, "SexyDexy", /Merchant's Luck stop \(forced farm\)/), "stop started"], [logged(w, "SexyDexy", /Merchant's Luck stop done: cast on SexyDexy, SexyWexy|Merchant's Luck stop done: cast on SexyWexy, SexyDexy/), "leader heard 'done'"], [!logged(w, "SexyDexy", /no answer/), "no timeout"]];
});
T("FL2 Merchant's Luck stop: no Merchant answers -> the leader gives up after the timeout and goes on; no new stop for 30 minutes", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = ff_world(w, { x: -110, y: 15 }, true);
  w.store["SexyDexy:force_farm"] = "poisio";
  await w.clock.run(200);
  const gave_up = logged(w, "SexyDexy", /Merchant's Luck stop: no answer from Goodies/);
  const n1 = w.logs.filter((l) => /Merchant's Luck stop \(/.test(l.msg)).length;
  w.store["SexyDexy:force_farm"] = ""; await w.clock.run(3); w.store["SexyDexy:force_farm"] = "poisio";
  await w.clock.run(300);
  const n2 = w.logs.filter((l) => /Merchant's Luck stop \(/.test(l.msg)).length;
  return [[gave_up, "gave up after the timeout"], [n1 === 1 && n2 === 1, "no second stop within the retry window: " + n1 + "/" + n2]];
});
T("FL3 Merchant's Luck stop: everybody still buffed -> skipped", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = ff_world(w, { x: -110, y: 15 }, true);
  L.s = { mluck: { ms: 3000000 } };
  w.store["SexyDexy:force_farm"] = "poisio";
  await w.clock.run(30);
  return [[logged(w, "SexyDexy", /stop \(forced farm\) skipped: everyone still has the buff/), "skipped"]];
});
T("WR7 Warrior MP guard: Hard Shell is held when it would leave under 120 MP (550 MP, cost 480), used with enough MP", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { taunt: { mp: 40, range: 200, cooldown: 3000 }, hardshell: { level: 60, mp: 480, cooldown: 16000 } });
  const run = async (mp) => {
    const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 1000, max_hp: 1000 });
    const W = warrior_char(w, { x: 0, y: 0, mp, max_mp: mp, hp: 700, max_hp: 2000 });
    W.sb.parent.entities.SexyDexy = L;
    W.sb.parent.entities.m1 = { id: "m1", type: "monster", mtype: "bee", x: 20, y: 0, map: "main", hp: 100, max_hp: 100, target: "SexyWexy", visible: true, dead: false };
    await w.clock.run(8);
    return W.skills.indexOf("hardshell") !== -1;
  };
  const low = await run(550);
  delete w.chars.SexyWexy; delete w.chars.SexyDexy;
  const ok = await run(700);
  return [[!low, "held with 550 MP"], [ok, "cast with 700 MP"]];
});
T("WR8 deaths are reported: the Warrior and the Priest send a died message to the leader once", async (w) => {
  const R2 = fake_ranger(w);
  const W = warrior_char(w, { x: 0, y: 0 }); const P = priest_char(w, { x: 20, y: 0 });
  await w.clock.run(3);
  W.sb.character.rip = true; P.sb.character.rip = true;
  await w.clock.run(3);
  return [[msgs(R2, "died").length === 2, "one died message each: " + msgs(R2, "died").length]];
});

T("FL4 Merchant's Luck stop at a boss start: a boss that is chased (no post) sends the leader to the Merchant first; the Grinch (waits at the post in town) does not", async (w) => {
  if (!IS_R5) return skip_r4;
  const LUCK_ON = [/LUCK_STOP: false/, "LUCK_STOP: true"];
  w.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  RANGER_OVR.push(LUCK_ON, NOPOST);
  const r = ranger_char(w, { x: -110, y: 15 }, [["hpot1", 100], ["mpot1", 100]]);
  r.sb.parent.S = r.sb.parent.S || {};
  r.sb.set("boss_force", "grinch:main,1000,1000");
  await w.clock.run(30);
  RANGER_OVR.pop(); RANGER_OVR.pop();
  const chased = logged(w, "SexyDexy", /Merchant's Luck stop \(boss Grinch\)/);
  const w2 = make_world();
  w2.G.monsters.grinch = { name: "Grinch", attack: 9, frequency: 0.5, hp: 3000000, respawn: 43200 };
  w2.G.monsters.bee = { name: "Bee", attack: 1, frequency: 1, hp: 10 };
  RANGER_OVR.push(LUCK_ON);
  const r2 = ranger_char(w2, { x: -110, y: 15 }, [["hpot1", 100], ["mpot1", 100]]);
  r2.sb.parent.S = r2.sb.parent.S || {};
  r2.sb.set("boss_force", "grinch:main,1000,1000");
  await w2.clock.run(30);
  RANGER_OVR.pop();
  return [[chased, "stop before a chased boss"], [!logged(w2, "SexyDexy", /Merchant's Luck stop/), "no stop for the Grinch at his town post"]];
});
T("FL5 Merchant's Luck stop while farming: waits until a member has reported in, then one stop about 2 minutes in, the next about an hour after the first ended", async (w) => {
  if (!IS_R5) return skip_r4;
  const L = ff_world(w, { x: -110, y: 15 }, true);
  const count = () => w.logs.filter((l) => /Merchant's Luck stop \(hourly/.test(l.msg)).length;
  await w.clock.run(600);
  const alone = count();
  const Wr = make_char(w, "SexyWexy", { ctype: "warrior", x: -100, y: 20 });
  const rep = () => Wr.sb.send_cm("SexyDexy", { type: "party_level", level: 70, hp: 10, mp: 10, free: 10, junk: 0, gear: 0, gold: 0, map: "main" });
  rep(); w.clock.every(rep, 4000);
  await w.clock.run(400);
  const first = count();
  await w.clock.run(2900);
  const mid = count();
  await w.clock.run(900);
  return [[alone === 0, "no stop while nobody else has reported: " + alone], [first === 1, "one stop once the Warrior reported: " + first], [mid === 1, "none within the hour: " + mid], [count() === 2, "the next one after the hour: " + count()]];
});

T("WR9 Warrior: no Stomp below level 52 (STOMP_MIN_LEVEL, the game's own gate), Stomp from 52", async (w) => {
  w.G.skills = Object.assign(w.G.skills || {}, { taunt: { mp: 40, range: 200, cooldown: 3000 }, stomp: { level: 52, mp: 120 } });
  const run = async (level) => {
    const L = make_char(w, "SexyDexy", { x: 40, y: 0, hp: 1000, max_hp: 1000 });
    const W = warrior_char(w, { x: 0, y: 0, level, hp: 800, max_hp: 2000 });
    w.G.items = Object.assign(w.G.items || {}, { sword1: { wtype: "sword" }, basher1: { wtype: "basher" } });
    W.sb.character.slots.mainhand = { name: "sword1", level: 0 }; W.sb.character.items[0] = { name: "basher1", level: 0 };
    W.sb.equip = (i, slot) => { const it = W.sb.character.items[i]; if (!it) return Promise.resolve({}); const old = W.sb.character.slots.mainhand; W.sb.character.slots.mainhand = { name: it.name, level: it.level || 0 }; W.sb.character.items[i] = old ? { name: old.name, level: old.level || 0 } : null; return Promise.resolve({}); };
    W.sb.parent.entities.SexyDexy = L;
    W.sb.parent.entities.m1 = { id: "m1", type: "monster", mtype: "bee", x: 20, y: 0, map: "main", hp: 100, max_hp: 100, target: "SexyWexy", visible: true, dead: false };
    W.sb.parent.entities.m2 = { id: "m2", type: "monster", mtype: "bee", x: 25, y: 0, map: "main", hp: 100, max_hp: 100, target: "SexyWexy", visible: true, dead: false };
    await w.clock.run(8);
    return W.skills.indexOf("stomp") !== -1;
  };
  const low = await run(50);
  delete w.chars.SexyWexy; delete w.chars.SexyDexy;
  const ok = await run(55);
  return [[!low, "no stomp at level 50"], [ok, "stomp at level 55"]];
});

T("GW3 Warrior with no chest and no legs: a Super Sweater (on the junk list) and Heavy Underarmor in the bank are assigned to him, not sold", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.sweaterhs = { g: 160000, type: "chest", vit: 12, armor: 34, resistance: 23, upgrade: { armor: 3 }, grades: [0, 7, 10, 12] };
  w.G.items.hpants = { g: 780000, type: "pants", armor: 35, resistance: 21, upgrade: { armor: 3 }, grades: [0, 7, 10, 12] };
  w.G.items.phelm = { g: 100000, type: "helmet", str: 10, evasion: 20, armor: 30, upgrade: { armor: 3 }, grades: [0, 7, 10, 12] };
  w.bank.items0.push({ name: "sweaterhs", level: 0 }, { name: "hpants", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, SW_OVR);
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const Wr = make_char(w, "SexyWexy", { x: -110, y: 35 });
  w.G.items.rangerchest = { g: 100, type: "chest", dex: 30, armor: 60, resistance: 40 }; w.G.items.rangerpants = { g: 100, type: "pants", dex: 30, armor: 60, resistance: 40 };
  const rs = { chest: { name: "rangerchest", level: 5 }, pants: { name: "rangerpants", level: 5 } };
  const send = () => { gear_rep(L, rs); gear_rep(F, rs); Wr.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "phelm", level: 0 } }, bag: { wbasher: 1 }, alt: {}, map: "main", x: -110, y: 15 }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(400);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items, Wr.items).filter((x) => x);
  const has = (n) => all.some((x) => x.name === n);
  return [[logged(w, "Goodies", /Gear sweep: sweaterhs \+0 for SexyWexy/), "the sweater is assigned to the Warrior"], [logged(w, "Goodies", /Gear sweep: hpants \+0 for SexyWexy/), "the underarmor is assigned to the Warrior"], [has("sweaterhs") && has("hpants"), "neither was sold"]];
});
T("UPS1 stop-gap upgrade: two Xmas Sweaters in the bank, the Warrior's chest slot is empty -> one is upgraded for him (the other stays), none sold", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.xmassweater = { g: 16000, type: "chest", evasion: 0.5, armor: 16, resistance: 11, upgrade: { evasion: 0.25, resistance: 1.5, armor: 1.5 }, grades: [4, 8, 10, 12] };
  w.G.items.rangerchest = { g: 100, type: "chest", dex: 30, armor: 60, resistance: 40 };
  w.G.items.phelm = { g: 100000, type: "helmet", str: 10, evasion: 20, armor: 30, upgrade: { armor: 3 }, grades: [0, 7, 10, 12] };
  w.bank.items0.push({ name: "xmassweater", level: 0 }, { name: "xmassweater", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, UPG_REAL.concat([[/UPGRADE_MAX_LEVEL: 1/, "UPGRADE_MAX_LEVEL: 3"]]));
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const Wr = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const rs = { chest: { name: "rangerchest", level: 5 } };
  const send = () => { gear_rep(L, rs); gear_rep(F, rs); Wr.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "phelm", level: 0 } }, bag: { wbasher: 1 }, alt: {}, map: "main", x: -110, y: 15 }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items, Wr.items).filter((i) => i && i.name === "xmassweater");
  const up = all.filter((i) => (i.level || 0) >= 1).length;
  return [[w.logs.filter((l) => l.who === "Goodies" && /UPGRADE SUCCESS/.test(l.msg)).length >= 1, "an upgrade happened for the Warrior"], [up >= 1, "an upgraded sweater exists: " + all.map((i) => "+" + (i.level || 0)).join(" ")], [all.length === 2, "both kept (none sold): " + all.length]];
});
T("UPS2 stop-gap upgrade: two Xmas Pants in the bank, the Warrior's legs slot is empty -> one is upgraded for him, none sold", async (w) => {
  if (!IS_R5) return skip_r4;
  w.G.items.xmaspants = { g: 12000, type: "pants", vit: 2, armor: 14, upgrade: { armor: 1.5, vit: 0.5 }, grades: [4, 8, 10, 12] };
  w.G.items.rangerpants = { g: 100, type: "pants", dex: 30, armor: 60, resistance: 40 };
  w.G.items.phelm = { g: 100000, type: "helmet", str: 10, evasion: 20, armor: 30, upgrade: { armor: 3 }, grades: [0, 7, 10, 12] };
  w.bank.items0.push({ name: "xmaspants", level: 0 }, { name: "xmaspants", level: 0 });
  const m = merchant_char(w, { gold: 50000 }, UPG_REAL.concat([[/UPGRADE_MAX_LEVEL: 1/, "UPGRADE_MAX_LEVEL: 3"]]));
  const L = fake_ranger(w); const F = make_char(w, "Dexy2", { x: -110, y: 25 }); const Wr = make_char(w, "SexyWexy", { x: -110, y: 35 });
  const rs = { pants: { name: "rangerpants", level: 5 } };
  const send = () => { gear_rep(L, rs); gear_rep(F, rs); Wr.sb.send_cm("Goodies", { type: "gear_report", slots: { helmet: { name: "phelm", level: 0 } }, bag: { wbasher: 1 }, alt: {}, map: "main", x: -110, y: 15 }); };
  send(); w.clock.every(send, 60000);
  await w.clock.run(900);
  const all = [].concat(w.bank.items0, w.bank.items1, w.bank.items3, m.items, Wr.items).filter((i) => i && i.name === "xmaspants");
  const up = all.filter((i) => (i.level || 0) >= 1).length;
  return [[w.logs.filter((l) => l.who === "Goodies" && /UPGRADE SUCCESS/.test(l.msg)).length >= 1, "an upgrade happened for the Warrior"], [up >= 1, "an upgraded pair exists: " + all.map((i) => "+" + (i.level || 0)).join(" ")], [all.length === 2, "both kept (none sold): " + all.length]];
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
