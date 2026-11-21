// ============================== AL.update: pick up a new build from GitHub (2026-11-21) ==============================
// The characters run tiny LOADER slots (dist/loaders/) that fetch the built file from GitHub at every start. This module notices that a NEWER build has been pushed:
// it reads dist/version.json from the repo every check_ms and, when its build id differs from the one running (globalThis.__AL_BUILD, set by the banner line), asks
// the caller to reload. The reload runs the loader again, which fetches the new code. Only the party lead and the Merchant poll; followers reload when the lead's
// build id changes (AL.lead check_build), so the whole party follows within a minute or two of the lead.
// env: { say, cfg: { enabled, repo, branch, check_ms, min_gap_ms }, current() -> my build id, can_reload() -> "" or a reason it is not safe now, reload(why), fetch? (tests) }
AL.update = (function () {
  "use strict";
  const { now } = AL;
  const version_url = (cfg) => "https://raw.githubusercontent.com/" + cfg.repo + "/" + cfg.branch + "/dist/version.json";
  function create(env) {
    const { cfg } = env;
    const U = { last: 0, busy: false, pending: "", said: "", fail_said: 0, guard_said: "" };
    const log = (m, color) => {
      env.say("[update] " + m, color || "#51D2E1");
      try { console.log("[update] " + m); } catch (e) {} // the game log cannot be copied
    };
    // the same new build reloads at most once per min_gap_ms (a stale CDN copy must not cause a reload loop); stored with set() so it survives the reload
    function guard_ok(build) {
      try {
        const g = JSON.parse(get("al_update_guard") || "{}") || {};
        if (g[build] && now() - g[build] < (cfg.min_gap_ms || 30 * 60000)) return false;
        g[build] = now();
        set("al_update_guard", JSON.stringify(g));
      } catch (e) {}
      return true;
    }
    function try_reload() {
      const build = U.pending;
      if (!build) return;
      if (build === env.current()) return void (U.pending = "");
      const why = env.can_reload ? env.can_reload() : "";
      if (why) {
        if (U.said !== build + why) {
          U.said = build + why;
          log("build " + build + " is waiting for a safe moment: " + why);
        }
        return;
      }
      if (!guard_ok(build)) {
        if (U.guard_said !== build) {
          U.guard_said = build;
          log("build " + build + " was already tried within the last " + Math.round((cfg.min_gap_ms || 30 * 60000) / 60000) + " min and the running build did not change - not reloading again (GitHub copy stale?)", "#CF575F");
        }
        U.pending = "";
        return;
      }
      U.pending = "";
      log("reloading to build " + build + " (running " + env.current() + ")", "#E0A040");
      try {
        env.reload("new build " + build + " on GitHub");
      } catch (e) {
        log("reload failed: " + ((e && e.message) || e), "#CF575F");
      }
    }
    // call every few seconds; it fetches version.json at most every check_ms
    function tick() {
      if (cfg.enabled === false) return;
      try_reload();
      const f = env.fetch || (typeof fetch === "function" ? fetch : null);
      if (!f || U.busy || now() - U.last < (cfg.check_ms || 5 * 60000)) return;
      U.last = now();
      U.busy = true;
      Promise.resolve()
        .then(() => f(version_url(cfg) + "?t=" + Date.now(), { cache: "no-store" }))
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then((v) => {
          U.busy = false;
          const remote = String((v && v.build) || "");
          const mine = String(env.current() || "");
          if (!remote || !mine || remote === mine) return;
          if (U.pending !== remote) log("a new build " + remote + " is on GitHub (running " + mine + ")");
          U.pending = remote;
          try_reload();
        })
        .catch((e) => {
          U.busy = false;
          if (now() - U.fail_said > 30 * 60000) {
            U.fail_said = now();
            log("could not read version.json from GitHub: " + ((e && e.message) || e) + " (checking again in " + Math.round((cfg.check_ms || 300000) / 60000) + " min)", "#CF575F");
          }
        });
    }
    return { tick, try_reload, state: U };
  }
  return { create, version_url };
})();
