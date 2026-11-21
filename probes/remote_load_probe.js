// REMOTE LOAD PROBE (2026-11-21). Paste into a spare code slot and start it on ONE idle character (it only reads; it starts nothing and sends nothing).
// It answers: can a character fetch code from GitHub, run it, and which route works? Every result is a game_log line starting with [probe].
(async () => {
  const OWNER = "onefusion/adventureland-scripts";
  const FILE = "dist/AL%20Libs%20v6.js";
  const SHA = "b967d308f07cfd62315b627fd93ee0066693b2e7"; // a commit that is on GitHub (pinning test)
  const URLS = {
    raw_main: "https://raw.githubusercontent.com/" + OWNER + "/main/" + FILE,
    raw_sha: "https://raw.githubusercontent.com/" + OWNER + "/" + SHA + "/" + FILE,
    jsd_main: "https://cdn.jsdelivr.net/gh/" + OWNER + "@main/" + FILE,
    jsd_sha: "https://cdn.jsdelivr.net/gh/" + OWNER + "@" + SHA + "/" + FILE,
  };
  // every line goes to the game log AND the browser console (the game log cannot be copied); all lines are printed again as ONE block at the end
  const lines = [];
  const log = (m, ok) => {
    lines.push((ok === false ? "FAIL " : ok ? "OK   " : "     ") + m);
    console.log("[probe] " + m);
    game_log("[probe] " + m, ok === false ? "#CF575F" : ok ? "#5BCB5B" : "#7DC4E4");
  };
  const bust = (u) => u + (u.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
  const run = async (name, f) => {
    const t0 = Date.now();
    try {
      const r = await f();
      log(name + ": OK in " + (Date.now() - t0) + " ms" + (r === undefined ? "" : " - " + r), true);
      return r;
    } catch (e) {
      log(name + ": FAILED after " + (Date.now() - t0) + " ms - " + ((e && e.message) || e), false);
    }
  };
  const F = typeof fetch === "function" ? fetch : typeof parent.fetch === "function" ? parent.fetch.bind(parent) : null;
  log("fetch=" + typeof fetch + " parent.fetch=" + typeof parent.fetch + " eval=" + typeof eval + " Function=" + typeof Function + " XHR=" + typeof XMLHttpRequest + " parent.document=" + typeof parent.document + " require_code=" + typeof require_code);
  await run("eval 1+1", async () => String((0, eval)("1+1")));
  await run("new Function", async () => String(new Function("a", "return a*2")(21)));
  const text = {};
  if (F) {
    for (const k of Object.keys(URLS)) {
      await run("fetch " + k, async () => {
        const r = await F(bust(URLS[k]), { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        text[k] = await r.text();
        return text[k].length + " bytes, type " + r.headers.get("content-type") + ", starts: " + text[k].slice(0, 40).replace(/\s+/g, " ") + (/build ([0-9a-f]{8})/.exec(text[k].slice(0, 400)) ? " | build " + /build ([0-9a-f]{8})/.exec(text[k].slice(0, 400))[1] : "");
      });
    }
  }
  const src = text.raw_main || text.jsd_main;
  if (src) {
    await run("run the fetched lib inside a function wrapper (like require_code)", async () => {
      const mod = { exports: {} };
      new Function("exports", "module", src)(mod.exports, mod);
      const AL = mod.exports;
      return "AL.VERSION=" + (AL && AL.VERSION) + ", modules: " + Object.keys(AL || {}).slice(0, 8).join(",") + ", lib build global=" + globalThis.__AL_LIB_BUILD;
    });
  }
  // script-tag route (the page runs it as a classic script; raw.githubusercontent.com sends nosniff + text/plain, which browsers refuse to run: that is why jsDelivr is tried too)
  for (const k of ["raw_main", "jsd_main"]) {
    await run("script tag " + k, () =>
      new Promise((res, rej) => {
        const d = parent.document;
        if (!d) return rej(new Error("no parent.document"));
        const s = d.createElement("script");
        const to = setTimeout(() => rej(new Error("timeout 15 s")), 15000);
        s.onload = () => { clearTimeout(to); res("loaded (the lib may log a harmless 'module is not defined')"); };
        s.onerror = () => { clearTimeout(to); rej(new Error("blocked or failed to load")); };
        s.src = bust(URLS[k]);
        d.head.appendChild(s);
      })
    );
  }
  log("probe finished", null);
  console.log("[probe] ===== SUMMARY (copy everything between the lines) =====\n" + lines.join("\n") + "\n[probe] ===== END =====");
})();
