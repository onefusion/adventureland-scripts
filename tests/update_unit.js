// AL.update unit check: node tests/update_unit.js (run from the repo root after node build/build.js)
const fs = require("fs"), vm = require("vm");
const store = {};
const ctx = { console, game_log() {}, get: (k) => store[k] || null, set: (k, v) => { store[k] = v; }, character: {}, setTimeout, setInterval, clearInterval, Promise, Date, JSON };
ctx.globalThis = ctx; vm.createContext(ctx);
const mod = { exports: {} };
vm.runInContext("(function(exports,module){" + fs.readFileSync("dist/AL Libs v6.js", "utf8") + "\n})", ctx)(mod.exports, mod);
const AL = mod.exports;
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const logs = [], reloads = [];
  let remote = "bbbb", reason = "", http = 200, calls = 0;
  const mk = (cfg) => AL.update.create({
    say: (m) => logs.push(m), cfg: Object.assign({ enabled: true, repo: "o/r", branch: "main", check_ms: 1, min_gap_ms: 60000 }, cfg),
    current: () => "aaaa", can_reload: () => reason, reload: (w) => reloads.push(w),
    fetch: async (u) => { calls++; return { ok: http === 200, status: http, json: async () => ({ build: remote }) }; },
  });
  let U = mk({});
  U.tick(); await sleep(20);
  ok(reloads.length === 1 && /bbbb/.test(reloads[0]), "a different build on GitHub triggers one reload");
  U = mk({}); U.tick(); await sleep(20);
  ok(reloads.length === 1, "the same new build is not reloaded again inside min_gap_ms (stale CDN guard)");
  { // console: update_check_now checks at once (ignores check_ms and the guard) and reports the result
    store.update_check_now = "1"; remote = "aaaa"; const before = logs.length; U = mk({ check_ms: 3600000 }); U.tick(); await sleep(20);
    ok(logs.slice(before).some((l) => /checking GitHub now/.test(l)) && logs.slice(before).some((l) => /GitHub has build aaaa, I am running aaaa - up to date/.test(l)) && store.update_check_now === "", "update_check_now: checks at once and reports even when up to date");
    remote = "bbbb";
  }
  remote = "cccc"; reason = "a job is running"; U = mk({}); U.tick(); await sleep(20);
  ok(reloads.length === 1 && logs.some((l) => /waiting for a safe moment/.test(l)), "not safe: waits and says why");
  reason = ""; U.try_reload();
  ok(reloads.length === 2, "reloads as soon as it is safe");
  remote = "aaaa"; U = mk({}); U.tick(); await sleep(20);
  ok(reloads.length === 2, "same build: nothing happens");
  remote = "dddd"; http = 404; const n = reloads.length; U = mk({}); U.tick(); await sleep(20);
  ok(reloads.length === n && logs.some((l) => /could not read version.json/.test(l)), "HTTP error: no reload, one log line");
  http = 200; U = mk({ enabled: false }); calls = 0; U.tick(); await sleep(20);
  ok(calls === 0, "disabled: no fetch");
  ok(AL.update.version_url({ repo: "o/r", branch: "main" }) === "https://raw.githubusercontent.com/o/r/main/dist/version.json", "version url");
  console.log(fails ? "update_unit FAILED" : "update_unit OK"); process.exit(fails ? 1 : 0);
})();
