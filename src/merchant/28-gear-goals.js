  // ===== GEAR GOALS REPORT (Sean 2026-11-21): for every character, every slot: what he wears, the best pieces that exist for his weights and where they come from =====
  // Read-only. Run from the Goodies console:  set("gear_goals","1")   (everything also goes to console.log, one block, so it can be copied).
  // Scores are the same numbers the sweep / ladder use (the class scorer with that character's weights), each piece at the level the Merchant can take it to
  // (the compound target for compound items, the upgrade cap for upgrade items, +0 for the rest). "gap" = best piece minus the weakest worn piece of that slot type.
  function gear_goals() {
    try {
      const out = [];
      const L = (s) => out.push(s);
      const fmt = (n) => (Math.round(n * 10) / 10).toString();
      const who_all = roster_all().concat(support_names().filter((n) => roster_all().indexOf(n) === -1));
      // what exists anywhere we can see: worn by a character, in the Merchant's bag or in the bank packs he has seen
      const have = {};
      const note_have = (name, where) => {
        if (!name) return;
        (have[name] = have[name] || []).push(where);
      };
      for (const w of who_all) {
        const g = gear_of(w);
        if (g && g.slots) for (const s in g.slots) note_have(g.slots[s].name, w + "+" + (g.slots[s].level || 0));
      }
      for (let i = 0; i < character.isize; i++) if (character.items[i]) note_have(character.items[i].name, "bag+" + (character.items[i].level || 0));
      for (const pack of CFG.UPGRADE_PACKS || []) {
        const arr = character.bank && character.bank[pack];
        if (Array.isArray(arr)) for (const it of arr) if (it) note_have(it.name, "bank+" + (it.level || 0));
      }
      // sources: craftable, dropped by (best two), sold by an NPC, cash item
      const npc_stock = {};
      for (const id in G.npcs || {}) {
        const l = G.npcs[id] && G.npcs[id].items;
        if (Array.isArray(l)) l.forEach((n) => n && (npc_stock[n] = true));
      }
      const drops = {};
      const dm = (G.drops && G.drops.monsters) || {};
      for (const mt in dm) for (const e of dm[mt] || []) if (Array.isArray(e) && typeof e[1] === "string") (drops[e[1]] = drops[e[1]] || []).push([Number(e[0]) || 0, mt]);
      const source_of = (name) => {
        const def = G.items[name] || {};
        const s = [];
        if (G.craft && G.craft[name]) s.push("craft");
        if (npc_stock[name]) s.push("npc");
        const d = (drops[name] || []).sort((a, b) => b[0] - a[0]).slice(0, 2);
        if (d.length) s.push("drop:" + d.map((x) => x[1] + " " + (x[0] > 0 && x[0] < 1 ? "1/" + Math.round(1 / x[0]) : "w" + x[0])).join("/")); // chances in G.drops are fractions (1/N) or plain weights (w)
        if (def.cash) s.push("cash");
        return s.join(",") || "?"; // ? = not craftable, not sold, no monster drops it: exchange / event / box items
      };
      const cap_level = (name) => {
        const def = G.items[name] || {};
        if (def.compound) return Math.max(0, Number(target_of(name)) || CFG.COMPOUND_TARGET_LEVEL || 0);
        if (def.upgrade) return Math.max(0, Number(upg_max(name)) || 0);
        return 0;
      };
      L("[goals] ===== GEAR GOALS - scores are per character (class weights); level shown is the level the Merchant can take the piece to =====");
      for (const who of who_all) {
        const g = gear_of(who);
        const age = g ? Math.round((now() - g.at) / 60000) : null;
        L("[goals] --- " + who + (g ? " (gear report " + age + " min old)" : " (NO gear report: worn gear unknown)") + " ---");
        const types = {};
        for (const name in G.items) {
          const def = G.items[name];
          if (!def || !def.type) continue;
          if (!gear_wearable({ name }, who)) continue;
          const sl = slots_of(def.type, who);
          if (!sl || !sl.length) continue;
          (types[def.type] = types[def.type] || { slots: sl, items: [] }).items.push(name);
        }
        const gaps = [];
        for (const type of Object.keys(types).sort()) {
          const t = types[type];
          const worn = t.slots.map((s) => {
            const w = g && g.slots && g.slots[s];
            return { s, w, sc: w ? gear_score(w.name, w.level || 0, { stat_type: w.stat_type, who }) : 0 };
          });
          const cands = t.items
            .map((n) => {
              const lv = cap_level(n);
              return { n, lv, sc: gear_score(n, lv, { who }) };
            })
            .filter((c) => c.sc > 0)
            .sort((a, b) => b.sc - a.sc)
            .slice(0, 3);
          const floor = Math.min.apply(null, worn.map((x) => x.sc));
          const best = cands[0] ? cands[0].sc : 0;
          const gap = Math.max(0, best - floor);
          gaps.push({ type, gap, best: cands[0] && cands[0].n });
          L(
            "[goals] " + type + " [" + t.slots.join("/") + "] worn: " +
              (worn.map((x) => (x.w ? x.w.name + "+" + (x.w.level || 0) + "=" + fmt(x.sc) : "empty")).join(", ")) +
              " | best: " +
              (cands.map((c) => c.n + "+" + c.lv + "=" + fmt(c.sc) + " [" + source_of(c.n) + "]" + (have[c.n] ? " have " + have[c.n].slice(0, 3).join(",") : "")).join(" ; ") || "none")
          );
        }
        gaps.sort((a, b) => b.gap - a.gap);
        L("[goals] " + who + " biggest gaps: " + gaps.filter((x) => x.gap > 0).slice(0, 5).map((x) => x.type + " +" + fmt(x.gap) + (x.best ? " (" + x.best + ")" : "")).join(", "));
      }
      L("[goals] ===== END =====");
      // one console message per character (a single huge message gets cut off when it is copied from the console)
      try {
        let chunk = [];
        for (const line of out) {
          if (/^\[goals\] --- /.test(line) && chunk.length) {
            console.log(chunk.join("\n"));
            chunk = [];
          }
          chunk.push(line);
        }
        if (chunk.length) console.log(chunk.join("\n"));
      } catch (e) {}
      say("Gear goals report: " + who_all.length + " characters, " + out.length + " lines - copy it from the browser console (F12)", "#E0A040");
    } catch (e) {
      say("Gear goals report failed: " + ((e && e.message) || e), "#CF575F");
    }
  }
  setInterval(() => {
    try {
      if (String(get("gear_goals") || "") === "1") {
        set("gear_goals", "");
        gear_goals();
      }
    } catch (e) {}
  }, 10000);
