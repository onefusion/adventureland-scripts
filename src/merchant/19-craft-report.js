  // ===== CRAFT REPORT: which recipes would make money if the result is sold to an NPC (no player market to price against) =====
  // Value of a result = what Gabriel pays (game value x the learned flip factor). Cost = ingredients at the game's gold value
  // (what an NPC charges; materials you farm are really cheaper, so this is the pessimistic side) + the recipe's gold fee.
  // Runs once about 30 s after the start and again whenever the console says set("craft_report", "1").
  function craft_report() {
    try {
      if (!G.craft)
        return say("Craft report: no recipe data (G.craft)", "#CF575F");
      const npc_stock = {};
      for (const id in G.npcs || {}) {
        const l = G.npcs[id] && G.npcs[id].items;
        if (Array.isArray(l)) l.forEach((n) => n && (npc_stock[n] = true));
      }
      const rows = [];
      for (const key in G.craft) {
        const rec = G.craft[key];
        const def = G.items[key];
        if (!rec || !def || !Array.isArray(rec.items)) continue;
        let cost = Number(rec.cost) || 0;
        let unknown = 0;
        let farmed = 0;
        for (const ing of rec.items) {
          const q = Number(ing[0]) || 1;
          const d = G.items[ing[1]];
          if (!d) {
            unknown++;
            continue;
          }
          cost += q * (Number(d.g) || 0);
          if (!npc_stock[ing[1]]) farmed++;
        }
        const value = sell_value(key, 0);
        rows.push({
          key,
          name: def.name || key,
          value,
          cost,
          profit: value - cost,
          unknown,
          farmed,
          quest: rec.quest || "",
        });
      }
      rows.sort((a, b) => b.profit - a.profit);
      const fmt = (n) => Math.round(n).toLocaleString();
      say(
        "Craft report: " +
          rows.length +
          " recipes, sold to Gabriel at " +
          Math.round(flip_factor() * 100) +
          "% of game value. Best first (profit = value - ingredients - fee):",
        "#E0A040"
      );
      rows
        .slice(0, 5)
        .forEach((r) =>
          say(
            "  " +
              r.name +
              " [" +
              r.key +
              "]: sells " +
              fmt(r.value) +
              ", costs " +
              fmt(r.cost) +
              ", profit " +
              fmt(r.profit) +
              (r.farmed
                ? ", " + r.farmed + " ingredient(s) not sold by NPCs"
                : ", all ingredients buyable") +
              (r.quest ? ", at " + r.quest : "") +
              (r.unknown ? ", " + r.unknown + " unknown ingredient(s)" : ""),
            "#E0A040"
          )
        );
      // the shortlist: only recipes where every ingredient is sold by an NPC (a supply that never runs out), most profitable first
      // what he could make RIGHT NOW from the bag and the bank he last saw (stack counts), best total profit first
      for (const r of rows) {
        const rec = G.craft[r.key];
        let times = Infinity;
        for (const ing of rec.items)
          times = Math.min(
            times,
            Math.floor(mats_have(ing[1]) / (Number(ing[0]) || 1))
          );
        r.times = Number.isFinite(times) ? times : 0;
        r.total = r.times * r.profit;
      }
      const now_list = rows
        .filter((r) => r.times > 0)
        .sort((a, b) => b.total - a.total);
      say(
        "Craft report - CAN MAKE NOW from the bag and bank he last saw: " +
          now_list.length +
          " recipes (profit = result value minus ingredient value; selling the ingredients instead pays their game value)",
        "#E0A040"
      );
      now_list
        .slice(0, 8)
        .forEach((r) =>
          say(
            "  " +
              r.name +
              " [" +
              r.key +
              "] x" +
              r.times +
              ": profit " +
              fmt(r.profit) +
              " each, " +
              fmt(r.total) +
              " total" +
              (r.quest ? ", at " + r.quest : ""),
            "#E0A040"
          )
        );
      const sure = rows.filter((r) => r.profit > 0 && !r.farmed && !r.unknown);
      say(
        "Craft report - SHORTLIST (all ingredients buyable at NPCs, profit > 0): " +
          sure.length +
          " recipes",
        "#E0A040"
      );
      const buyable = rows.filter((r) => !r.farmed && !r.unknown);
      const stocked = Object.keys(npc_stock).length;
      say(
        "Craft report - check: " +
          stocked +
          " different items are sold by NPCs in G.npcs; " +
          buyable.length +
          " of " +
          rows.length +
          " recipes use only those. Closest to profit (profit, name): " +
          buyable
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 4)
            .map((r) => fmt(r.profit) + " " + r.key)
            .join(" | "),
        "#E0A040"
      );
      sure
        .slice(0, 10)
        .forEach((r) =>
          say(
            "  " +
              r.name +
              " [" +
              r.key +
              "]: sells " +
              fmt(r.value) +
              ", costs " +
              fmt(r.cost) +
              ", profit " +
              fmt(r.profit) +
              (r.quest ? ", at " + r.quest : ""),
            "#E0A040"
          )
        );
      const pos = rows.filter((r) => r.profit > 0).length;
      say(
        "Craft report: " +
          pos +
          " of " +
          rows.length +
          " recipes show a profit at these prices (ingredients valued at their NPC price)",
        "#E0A040"
      );
    } catch (e) {
      say("Craft report failed: " + ((e && e.message) || e), "#CF575F");
    }
  }
  setTimeout(craft_report, 30000);
  setInterval(() => {
    try {
      if (String(get("craft_report") || "") === "1") {
        set("craft_report", "");
        craft_report();
      }
    } catch (e) {}
  }, 10000);

  setInterval(world_watch, CFG.WATCH_EVERY_MS);
