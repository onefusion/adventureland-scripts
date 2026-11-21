  // ====================== MESSAGES FROM THE RANGER ================
  function reply(to, msg) {
    return call(() => send_cm(to, msg));
  }

  character.on("cm", function (m) {
    if (!alive()) return;
    try {
      const d = AL.parse_job(m, (n) => is_trusted(n) || !!support_cfg(n)); // cm's can come from anyone - ignore strangers and malformed messages
      if (!d) return;
      switch (d.type) {
        case "job_request":
          return void on_request(m.name, d);
        case "job_cancel":
          return void on_cancel(m.name, d);
        case "job_sent":
          S.junk_sent[d.id] = clamp_int(d.count, 0, 42);
          return;
        case "boss_handoff": {
          // a Ranger hands over his bag at the start of a boss event: stackables are banked, never sold (the bank tells whether they are kept already)
          if (!Array.isArray(d.names)) return;
          for (const n of d.names.slice(0, 20))
            if (
              typeof n === "string" &&
              G.items[n] &&
              G.items[n].s &&
              !stack_protected(n)
            )
              stack_names[n] = true;
          S.tidy_next = 0;
          return;
        }
        case "courier_notice": {
          if (
            m.name !== CFG.RANGER_NAME &&
            CFG.TRUSTED_NAMES.indexOf(m.name) === -1
          )
            return;
          S.courier_note = {
            from: m.name,
            hp: clamp_int(d.hp, 0, 5000),
            mp: clamp_int(d.mp, 0, 5000),
            items: clamp_int(d.items, 0, 500),
            until: now() + CFG.COURIER_NOTICE_MS,
          };
          say(
            "Courier notice from " +
              m.name +
              ": " +
              S.courier_note.hp +
              " " +
              CFG.HP_POTION +
              " + " +
              S.courier_note.mp +
              " " +
              CFG.MP_POTION +
              " to pick up, " +
              S.courier_note.items +
              " item(s) to sort (I have " +
              quantity(CFG.HP_POTION) +
              "/" +
              quantity(CFG.MP_POTION) +
              ")",
            "#51D2E1"
          );
          return;
        }
        case "travel_to_main":
          return void on_travel_to_main(m.name);
        case "hello":
          return void on_hello(m.name, d);
        case "mluck_request": {
          if (
            m.name !== CFG.RANGER_NAME &&
            CFG.TRUSTED_NAMES.indexOf(m.name) === -1
          )
            return;
          const names = (Array.isArray(d.names) ? d.names : [])
            .slice(0, 12)
            .filter((n) => typeof n === "string" && n.length <= 30);
          const id = String(d.id || "").slice(0, 30);
          const def = mluck_def();
          if (
            !CFG.MLUCK_PARTY ||
            !def ||
            character.level < (Number(def.level) || 0)
          ) {
            say(
              "Merchant's Luck request from " +
                m.name +
                " refused (" +
                (!CFG.MLUCK_PARTY
                  ? "switched off"
                  : "skill not available at level " + character.level) +
                ")",
              "#CF575F"
            );
            return void reply(m.name, {
              type: "mluck_done",
              id,
              cast: [],
              failed: names,
              off: true,
            });
          }
          S.mluck_req = { id, from: m.name, names, at: now() };
          say(
            "Merchant's Luck request from " +
              m.name +
              " for " +
              names.join(", "),
            "#51D2E1"
          );
          return;
        }
        case "need_basher": {
          // Sean 2026-11-20: the Warrior has no basher (Stomp is the stun that keeps him alive): fetch one from the bank and hand it over in town, now
          if (!support_cfg(m.name) || !kit_names(m.name).length) return;
          S.kit_call = { who: m.name, at: now() };
          say("Basher call from " + m.name + " - fetching one from the bank and bringing it to him in town", "#E0A040");
          return;
        }
        case "gear_report": {
          if (!d.slots || typeof d.slots !== "object") return;
          if (
            m.name !== CFG.RANGER_NAME &&
            CFG.TRUSTED_NAMES.indexOf(m.name) === -1 &&
            !support_cfg(m.name)
          )
            return;
          const slots = {};
          for (const k of Object.keys(d.slots).slice(0, 20)) {
            const w = d.slots[k];
            if (w && typeof w.name === "string" && w.name.length <= 40)
              slots[k] = { name: w.name, level: clamp_int(w.level, 0, 20) };
            if (typeof w.stat_type === "string" && w.stat_type.length <= 12)
              slots[k].stat_type = w.stat_type;
          }
          if (!gear_of(m.name))
            say(
              "Got " +
                m.name +
                "'s gear report: " +
                Object.keys(slots).length +
                " worn item(s)"
            );
          const bag = {};
          if (d.bag && typeof d.bag === "object")
            for (const k of Object.keys(d.bag).slice(0, 10))
              if (k.length <= 40) bag[k] = clamp_int(d.bag[k], 0, 99);
          const rep_ = {
            slots,
            bag,
            map: String(d.map || "main"),
            x: Number(d.x),
            y: Number(d.y),
            at: now(),
          };
          stat_note(m.name, d.stat);
          if (m.name === CFG.RANGER_NAME) S.ranger_gear = rep_;
          else S.gears[m.name] = rep_;
          if (support_cfg(m.name + "+")) {
            const alt = {};
            if (d.alt && typeof d.alt === "object")
              for (const k of Object.keys(d.alt).slice(0, 20)) {
                const w = d.alt[k];
                if (w && typeof w.name === "string" && w.name.length <= 40)
                  alt[k] = { name: w.name, level: clamp_int(w.level, 0, 20) };
              }
            S.gears[m.name + "+"] = {
              slots: alt,
              bag: {},
              map: rep_.map,
              x: rep_.x,
              y: rep_.y,
              at: now(),
            };
          }
          return;
        }
        case "gear_replaced":
          if (m.name === CFG.RANGER_NAME) return void on_gear_replaced(d);
          return;
      }
    } catch (e) {
      say("bad cm ignored: " + ((e && e.message) || e));
    }
  });

  // Fires once for every completed purchase from OUR stand
  game.on("sale", function (d) {
    S.last_sale = now();
    say(
      "Sold " +
        (d && d.num) +
        "x " +
        (d && d.item && (d.item.name || d.item)) +
        " to " +
        (d && d.buyer)
    );
  });
