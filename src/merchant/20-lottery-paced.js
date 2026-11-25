  // ===== Rose's lotteries =====
  // The lotteries have no code functions, only socket messages (the same ones the game's own windows send):
  //   lottery_status -> lottery_status {product:"daily_item", current:{prize, ticketPrice, accountLimit, closesAt, purchasesPermitted}, accountTickets}
  //   lottery_purchase {requestId} -> lottery_purchase {success}
  //   money_lottery_status -> money_lottery_status {product:"money_lottery", current:{drawId, jackpotGold, ticketPrice, accountLimit, closesAt, purchasesPermitted}, accountTickets}
  //   money_lottery_quick_pick -> money_lottery_quick_pick {success, numbers}
  //   money_lottery_purchase {requestId, numbers, drawId} -> money_lottery_purchase {success, receipt:{numbers}}
  // Sean 2026-11-24: every lottery message is also kept in the game's storage (last 40), so the reason for a missed ticket can be read later even after the log scrolled away:  console.log(get("lottery_notes"))
  function lsay(msg, color) {
    say(msg, color);
    try {
      const n = JSON.parse(get("lottery_notes") || "[]");
      n.push(new Date().toISOString() + " " + msg);
      set("lottery_notes", JSON.stringify(n.slice(-40)));
    } catch (e) {}
  }
  const lottery_day = () => String(Math.floor(Date.now() / 86400000)); // UTC day number
  function lottery_ledger() {
    let l = null;
    try {
      l = JSON.parse(get("lottery_ledger") || "null");
    } catch (e) {}
    if (!l || l.day !== lottery_day()) l = { day: lottery_day(), spent: 0 };
    return l;
  }
  const lottery_left = () =>
    Math.max(0, CFG.LOTTERY_DAILY_CAP - lottery_ledger().spent);
  function lottery_spend(n, what) {
    const l = lottery_ledger();
    l.spent += n;
    try {
      set("lottery_ledger", JSON.stringify(l));
    } catch (e) {}
    donate_track_out(n);
    lsay(
      "Lottery: bought " +
        what +
        " for " +
        n +
        " gold (today " +
        l.spent +
        " / " +
        CFG.LOTTERY_DAILY_CAP +
        ")",
      "#A33AA0"
    );
  }
  // ============================ PACED REQUESTS (v5) ============================
  // The lottery sockets, the donation and the event exchange all hit server-side rate limits ("throttled"). v4 paced only the
  // lottery, round by round. v5 sends every such request through ONE queue: they go out one at a time, at least CFG.PACE_MS
  // after the previous one FINISHED (answer or timeout), whichever round asks. Retry back-off (growing waits) stays where it is.
  const PACE = { chain: Promise.resolve(), last: 0, n: 0, held_ms: 0 };
  function paced(fn) {
    const job = PACE.chain.then(async () => {
      const gap = CFG.PACE_MS - (Date.now() - PACE.last);
      if (gap > 0) {
        PACE.held_ms += gap;
        await wait(gap);
      }
      PACE.n++;
      try {
        return await fn();
      } finally {
        PACE.last = Date.now();
      }
    });
    PACE.chain = job.catch(() => {});
    return job;
  }
  function sock_ask_raw(ev, payload, reply, ms) {
    return new Promise((resolve) => {
      const sk = parent.socket;
      let done = false;
      const fin = (d) => {
        if (done) return;
        done = true;
        try {
          sk.off(reply, h);
        } catch (e) {}
        resolve(d);
      };
      const h = (d) => fin(d);
      sk.on(reply, h);
      sk.emit(ev, payload);
      setTimeout(() => fin(null), ms || 8000);
    });
  }
  const sock_ask = (ev, payload, reply, ms) =>
    paced(() => sock_ask_raw(ev, payload, reply, ms));
  const lottery_off = () => {
    try {
      const v = get("lottery_off");
      return v === true || v === "true";
    } catch (e) {
      return false;
    }
  };
  const lottery_due = () =>
    CFG.LOTTERY_ENABLED &&
    !lottery_off() &&
    !is_paused() &&
    !has_jobs() &&
    now() >= S.lottery_next &&
    lottery_left() >= 1;
  async function lottery_round() {
    S.lottery_next = now() + CFG.LOTTERY_EVERY_MS;
    await drain_stand("the lottery");
    if (!(await open_bank_for_compound())) return go_home();
    const bank_gold = Number(character.bank && character.bank.gold) || 0;
    const floor = Math.round(bank_gold * CFG.LOTTERY_BANK_FLOOR_PCT);
    const spare = Math.max(0, bank_gold - floor);
    const budget = Math.min(spare, lottery_left());
    if (budget < 100000) {
      lsay(
        "Lottery: nothing to spend - spare gold " +
          spare +
          " (bank " +
          bank_gold +
          " minus floor " +
          floor +
          "), daily cap left " +
          lottery_left()
      );
      return go_home();
    }
    const before = character.gold;
    const dep = await call(() => bank_withdraw(budget));
    const got = await call(() =>
      wait_for(() => character.gold >= before + budget - 1, 5000)
    );
    if (dep.failed || got.failed) {
      lsay(
        "Lottery: could not withdraw " +
          budget +
          ": " +
          (dep.reason || got.reason),
        "#CF575F"
      );
      return go_home();
    }
    let npc = find_npc("lotterylady");
    if (!npc) npc = CFG.LOTTERY_NPC_FALLBACK;
    act("Lottery", 90, true);
    const r = await travel(
      { map: npc.map, x: npc.x, y: npc.y },
      0,
      "visiting Rose (lottery)"
    );
    if (r.failed) {
      lsay("Lottery: could not reach Rose: " + r.reason, "#CF575F");
      return go_home();
    }
    let left = budget;
    const closes = [];
    const item = await sock_ask("lottery_status", {}, "lottery_status");
    const money = await sock_ask(
      "money_lottery_status",
      {},
      "money_lottery_status"
    );
    lsay(
      "Lottery status - item: " +
        JSON.stringify(item || "no answer").slice(0, 400)
    );
    lsay(
      "Lottery status - money: " +
        JSON.stringify(money || "no answer").slice(0, 400)
    );
    // item lottery
    const ic = item && item.available && item.current;
    if (CFG.LOTTERY_ITEM && ic) {
      closes.push(Date.parse(ic.closesAt));
      // Sean 2026-11-23: an account may now buy 2 Item Lottery tickets per day (accountLimit says so): buy every ticket that is left, one after the other,
      // each with its own requestId (a retry of ONE ticket reuses its id, so a ticket is never bought twice)
      let room = (ic.accountLimit || 1) - (item.accountTickets || 0);
      let bought = 0;
      let buy_failed = false;
      while (room > 0 && ic.purchasesPermitted && ic.ticketPrice <= left && ic.ticketPrice <= lottery_left()) {
        const rid = "i" + Date.now() + Math.random().toString(36).slice(2, 10);
        let res = null;
        // Sean 2026-11-24: the server answered {"success":false,"reason":"invalid_purchase_request"} to { requestId } alone. The money lottery sends the drawId too, so the item ticket is tried with the drawId first,
        // then (if the server still calls it invalid) with the requestId alone. The same requestId throughout, so a ticket can never be bought twice.
        const variants = [{ requestId: rid, drawId: ic.drawId }, { requestId: rid }];
        let vi = 0;
        for (let t = 0; t < 6; t++) {
          await wait(1500 + t * 2500);
          res = await sock_ask(
            "lottery_purchase",
            variants[vi],
            "lottery_purchase",
            10000
          );
          if (res && res.reason === "invalid_purchase_request" && vi < variants.length - 1) {
            lsay("Lottery: the server called the item ticket request invalid (" + JSON.stringify(variants[vi]).slice(0, 120) + ") - trying another form");
            vi++;
            continue;
          }
          if (!(res && res.reason === "throttled")) break;
        }
        if (res && res.success) {
          left -= ic.ticketPrice;
          room--;
          bought++;
          lottery_spend(
            ic.ticketPrice,
            "an Item Lottery ticket " + (bought + (item.accountTickets || 0)) + " of " + (ic.accountLimit || 1) + " (prize " +
              JSON.stringify(ic.prize).slice(0, 120) +
              ")"
          );
        } else {
          lsay(
            "Lottery: item ticket not bought: " +
              JSON.stringify(res || "no answer"),
            "#CF575F"
          );
          buy_failed = true;
          break;
        }
      }
      if (!bought && buy_failed) {
        // the reason was logged above ("item ticket not bought: ...")
      } else if (!bought)
        lsay(
          "Lottery: no item ticket - " +
            (room <= 0
              ? "ticket limit reached (" + (item.accountTickets || 0) + " of " + (ic.accountLimit || 1) + ")"
              : !ic.purchasesPermitted
              ? "the server says purchases are not permitted (state " + item.state + ")"
              : "price " + ic.ticketPrice + " is above what is left to spend")
        );
      else if (room > 0)
        lsay("Lottery: " + room + " more item ticket(s) allowed today, not bought (price " + ic.ticketPrice + ", left to spend " + Math.min(left, lottery_left()) + ")");
    }
    // money lottery
    const mc = money && money.available && money.current;
    if (CFG.LOTTERY_MONEY_TICKETS > 0 && mc) {
      closes.push(Date.parse(mc.closesAt));
      let room = Math.min(
        CFG.LOTTERY_MONEY_TICKETS,
        (mc.accountLimit || 0) - (money.accountTickets || 0)
      );
      while (
        room > 0 &&
        mc.purchasesPermitted &&
        mc.ticketPrice <= left &&
        mc.ticketPrice <= lottery_left()
      ) {
        // the server rate-limits these requests ("throttled"): pause between requests and retry a few times with a growing wait
        let q = null;
        for (let t = 0; t < 5; t++) {
          await wait(1500 + t * 2500);
          q = await sock_ask(
            "money_lottery_quick_pick",
            {},
            "money_lottery_quick_pick"
          );
          if (!(q && q.reason === "throttled")) break;
        }
        if (!q || !q.success || !q.numbers) {
          lsay(
            "Lottery: quick pick failed: " + JSON.stringify(q || "no answer"),
            "#CF575F"
          );
          break;
        }
        const rid = "m" + Date.now() + Math.random().toString(36).slice(2, 10);
        let res = null;
        for (let t = 0; t < 5; t++) {
          if (t) await wait(1500 + t * 2500);
          res = await sock_ask(
            "money_lottery_purchase",
            { requestId: rid, numbers: q.numbers, drawId: mc.drawId },
            "money_lottery_purchase",
            10000
          );
          if (!(res && res.reason === "throttled")) break; // same requestId on a retry, so a ticket can never be bought twice
        }
        if (!res || !res.success) {
          lsay(
            "Lottery: money ticket not bought: " +
              JSON.stringify(res || "no answer"),
            "#CF575F"
          );
          break;
        }
        left -= mc.ticketPrice;
        room--;
        lottery_spend(
          mc.ticketPrice,
          "a Money Lottery ticket [" +
            ((res.receipt && res.receipt.numbers) || q.numbers).join(", ") +
            "]"
        );
      }
    }
    // next visit: after the earliest draw closes (new tickets), but never sooner than the normal interval allows
    const next_draw = closes.filter((t) => t > now()).sort((a, b) => a - b)[0];
    if (next_draw)
      S.lottery_next = Math.max(
        now() + 10 * 60000,
        Math.min(now() + 6 * 3600000, next_draw + 30000)
      );
    lsay(
      "Lottery done: spent " +
        (budget - left) +
        " gold; next visit " +
        Math.round((S.lottery_next - now()) / 60000) +
        " min"
    );
    return go_home();
  }
