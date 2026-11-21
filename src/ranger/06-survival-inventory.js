  // ============================ SURVIVAL ==========================
  async function survive() {
    if (character.rip) {
      force_death(character.name);
      R.deaths = (R.deaths || 0) + 1; // for the Merchant's hourly report
      if (is_leader()) death_note(character.name);
      else call(() => send_cm(CFG.PARTY_LEADER, { type: "died" }));
      say("Dead - respawning" + (R.last_attackers ? " (last attackers: " + R.last_attackers + ")" : ""), "#CF575F");
      R.last_attackers = "";
      R.hp_hist = [];
      await wait(CFG.RESPAWN_DELAY_MS);
      await call(() => respawn());
      await wait(1500);
      if (!have_need()) {
        log_move(CFG.FARM_SPOT, "heading back after respawn");
        call(() => smart_move(CFG.FARM_SPOT)); // head back (not awaited); with a need the ladder takes over
      }
      return true;
    }
    const hp_pct = character.hp / character.max_hp;
    const mp_pct = character.mp / character.max_mp;
    if (CFG.DANGER_ENABLED) {
      // v5: how fast HP is falling (every pass: a hit can take him from full to low between two samples) and who is hitting him
      const t = now();
      R.hp_hist.push({ t, p: hp_pct });
      while (R.hp_hist.length && t - R.hp_hist[0].t > CFG.DANGER_WINDOW_MS) R.hp_hist.shift();
      if (hp_pct < 0.6) {
        const hit = threats().filter((e) => e.target === character.name || e.target === character.id);
        if (hit.length) {
          const kinds = {};
          for (const e of hit) kinds[e.mtype] = (kinds[e.mtype] || 0) + 1;
          R.last_attackers = Object.keys(kinds).map((k) => kinds[k] + "x " + k).join(", "); // kept for the death report
        }
        const top = Math.max.apply(null, R.hp_hist.map((h) => h.p));
        if (hp_pct <= CFG.DANGER_HP_PCT && top - hp_pct >= CFG.DANGER_DROP_PCT && hit.length >= CFG.DANGER_MIN_ATTACKERS && t - R.danger_at > 30000) {
          R.danger_at = t;
          say("DANGER: HP " + Math.round(hp_pct * 100) + "% after losing " + Math.round((top - hp_pct) * 100) + "% in " + Math.round(CFG.DANGER_WINDOW_MS / 1000) + "s, " + R.last_attackers + " on me" + (CFG.DANGER_TOWN ? " - casting town" : ""), "#CF575F");
          if (CFG.DANGER_TOWN) call(() => town());
        }
      }
    }
    if (!is_on_cooldown("use_hp")) {
      // drink the configured potion by name; use_skill("use_hp") would pick one for us
      if (hp_pct <= CFG.HP_USE_PCT && quantity(CFG.HP_POTION) > 0)
        call(() => equip(locate_item(CFG.HP_POTION)));
      else if (mp_pct <= CFG.MP_USE_PCT && quantity(CFG.MP_POTION) > 0)
        call(() => equip(locate_item(CFG.MP_POTION)));
    }
    if (
      hp_pct <= CFG.FLEE_HP_PCT &&
      quantity(CFG.HP_POTION) === 0 &&
      now() - R.fled_at > 20000
    ) {
      R.fled_at = now();
      R.ladder_next = 0; // out of potions is a need: the ladder starts as soon as he is in town
      say("Hurt and out of HP potions - retreating to town", "#CF575F");
      await call(() => town());
    }
    return false;
  }

  // ============================ INVENTORY =========================
  function free_slots() {
    let n = 0;
    for (let i = 0; i < character.isize; i++) if (!character.items[i]) n++;
    return n;
  }

  function junk_slots() {
    const out = [];
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (!it || CFG.JUNK_ITEMS.indexOf(it.name) === -1) continue;
      if (it.l || ((it.level || 0) > CFG.JUNK_MAX_LEVEL && CFG.JUNK_ANY_LEVEL.indexOf(it.name) === -1)) continue; // locked or upgraded: keep
      out.push(i);
    }
    return out;
  }

  // Compound material: any item (any level, not locked) whose key is in KEEP_FOR_COMPOUND
  function keep_slots() {
    const out = [];
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (!it || CFG.KEEP_FOR_COMPOUND.indexOf(it.name) === -1 || it.l)
        continue;
      out.push(i);
    }
    return out;
  }
  // Stackable loot: anything the game marks as stackable, except potions/scrolls and the STACK_KEEP list
  function stack_slots() {
    const out = [];
    if (!CFG.STACK_TO_MERCHANT) return out;
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      if (!it || it.l || !G.items[it.name] || !G.items[it.name].s) continue;
      if (CFG.STACK_KEEP.indexOf(it.name) !== -1) continue;
      if (CFG.STACK_KEEP_PREFIXES.some((p) => it.name.indexOf(p) === 0))
        continue;
      out.push(i);
    }
    return out;
  }
  // v5: spare gear (see GEAR_HANDOFF)
  function gear_slots() {
    const out = [];
    if (!CFG.GEAR_HANDOFF || now() - (R.gear_recv_at || 0) < CFG.GEAR_HANDOFF_GRACE_MS) return out;
    const carried = (R.courier_gear || []).slice(); // gear the courier carries for the others
    for (let i = 0; i < character.isize; i++) {
      const it = character.items[i];
      const def = it && G.items[it.name];
      if (!it || it.l || !def || def.s) continue; // stackables have their own rules (stack_slots / STACK_KEEP)
      if (!CFG.HANDOFF_ALL_ITEMS && !def.upgrade && !def.compound) continue;
      if (CFG.BAG_KEEP.indexOf(it.name) !== -1 || CFG.BAG_KEEP_PREFIXES.some((p) => it.name.indexOf(p) === 0)) continue;
      if (CFG.GEAR_KEEP.indexOf(it.name) !== -1 || CFG.JUNK_ITEMS.indexOf(it.name) !== -1 || CFG.KEEP_FOR_COMPOUND.indexOf(it.name) !== -1) continue;
      const k = carried.findIndex((c) => c.name === it.name && (Number(c.level) || 0) === (it.level || 0));
      if (k !== -1) {
        carried.splice(k, 1);
        continue;
      }
      out.push(i);
    }
    return out;
  }
  const handoff_slots = () => junk_slots().concat(keep_slots(), stack_slots(), gear_slots());

  // Sells (or destroys) every junk slot. A slot only counts as done if it is actually empty afterwards.
  async function dump_junk(action) {
    let done = 0;
    for (const i of junk_slots()) {
      const it = character.items[i];
      if (!it) continue;
      const name = it.name;
      const gold_before = character.gold;
      const res = await call(() =>
        action === "sell" ? sell(i, it.q || 1) : destroy(i)
      );
      const gone = await call(() =>
        wait_for(
          () => !character.items[i] || character.items[i].name !== name,
          2500
        )
      );
      if (res.failed || gone.failed) {
        say(
          "Could not " +
            action +
            " " +
            name +
            ": " +
            (res.reason || gone.reason || "slot unchanged"),
          "#CF575F"
        );
        return { done, ok: false };
      }
      done++;
      if (action === "sell")
        say(
          "Sold " +
            name +
            " (+" +
            Math.max(0, character.gold - gold_before) +
            "g)"
        );
      await wait(150);
    }
    return { done, ok: true };
  }
