  // ============================ JOB QUEUE =========================
  // ONE queue replaces v3's S.request / S.junk_req. See agent/merchant-ranger-coordination-spec.md.
  // Core rule: he finishes his current ATOMIC action, then takes the next job. Compound/upgrade rounds stop at a
  // group / item boundary (yield_now()); a running job (including a junk trip) is never pre-empted.
  const P = AL.proto;
  const IDLE_LABEL = "Merchant: open for business";
  function act(label, est_s, round) {
    ACT.label = label;
    ACT.at = Date.now();
    ACT.est_s = est_s || 0;
    ACT.round = !!round;
  }
  const act_remaining_s = () =>
    Math.max(0, (ACT.est_s || 0) - (Date.now() - ACT.at) / 1000);
  const queued_jobs = () =>
    S.jobs
      .filter((j) => j.state === "QUEUED" && j !== S.cur)
      .sort(
        (a, b) =>
          P.PRIORITY[a.jtype] - P.PRIORITY[b.jtype] ||
          a.created_at - b.created_at
      );
  const has_jobs = () => queued_jobs().length > 0;
  const yield_now = () => has_jobs();
  const job_est = (j) => P.ETA_S[j.jtype + "_job"] || 60;

  function walk_s(from, job) {
    if (!Number.isFinite(job.x) || !Number.isFinite(job.y))
      return P.WALK_S_OTHER_MAP;
    if (from.map !== job.map) return P.WALK_S_OTHER_MAP + 10;
    const speed = Math.max(20, Number(character.speed) || 50);
    return Math.max(P.WALK_S_SAME_MAP_MIN, Math.round(d2(from, job) / speed));
  }
  // ETA = time left on the current action + queued actions ahead + walk to the Ranger's town.
  // Fixed per-action estimates (AL.proto.ETA_S), not live measurement.
  function eta_for(job) {
    if (job.state === "ARRIVED" || job.state === "TRANSFERRING") return 10;
    const shop_s =
      job.jtype === "restock" &&
      (quantity(CFG.HP_POTION) < job.hp || quantity(CFG.MP_POTION) < job.mp)
        ? P.ETA_S.shop_run
        : 0;
    if (job === S.cur)
      return Math.round(act_remaining_s() + walk_s(character, job));
    let t = act_remaining_s();
    if (ACT.round) t += P.ETA_S.round_yield_cleanup; // a yielding round still puts its items back in the bank
    let from = character;
    for (const a of queued_jobs()) {
      if (a === job) break;
      t += job_est(a);
      from = CFG.STAND_SPOT;
    }
    if (S.cur) from = CFG.STAND_SPOT; // he is out on another job
    return Math.round(t + shop_s + walk_s(from, job));
  }
  function send_status(job) {
    return AL.send(job.from, {
      type: "job_status",
      id: job.id,
      state: job.state,
      eta: eta_for(job),
      doing: ACT.label,
    });
  }
  function set_state(job, state) {
    job.state = state;
    job.state_at = now();
    return send_status(job);
  }
  // final state: DONE | CANCELLED | FAILED(job.reason)
  function end_job(job, state) {
    if (job.ended_at) return;
    job.state = state;
    job.ended_at = now();
    S.jobs = S.jobs.filter((j) => j !== job);
    S.finished[job.id] = {
      state,
      at: now(),
      from: job.from,
      reason: job.reason || "",
    };
    for (const k of Object.keys(S.finished))
      if (now() - S.finished[k].at > 180000) delete S.finished[k];
    if (state === "FAILED") {
      say(
        "Job " +
          job.jtype +
          " " +
          job.id +
          " FAILED: " +
          (job.reason || "failed"),
        "#CF575F"
      );
      AL.send(job.from, {
        type: "job_failed",
        id: job.id,
        reason: job.reason || "failed",
      });
    } else if (state === "DONE") {
      AL.send(
        job.from,
        Object.assign({ type: "job_done", id: job.id }, job.result || {})
      );
    }
  }
  function abort_walk() {
    return abort();
  }
  function cancel_job(job, why) {
    say("Job " + job.jtype + " " + job.id + " cancelled: " + why);
    if (job === S.cur) {
      job.cancelled = true;
      if (job.state === "EN_ROUTE") abort_walk(); // already walking over: turn back at once
    } else end_job(job, "CANCELLED");
  }

  function on_request(from, d) {
    const jt = String(d.jtype || "");
    if (jt !== "restock" && jt !== "junk" && jt !== "stack") return;
    if (S.courier_note && S.courier_note.from === from) S.courier_note = null; // the courier has arrived: the notice is used up
    const dup = S.jobs.find((j) => j.id === d.id);
    if (dup) return void send_status(dup); // the Ranger re-sent it (resume after a reload): just confirm
    const fin = S.finished[d.id];
    if (fin) {
      if (fin.state === "CANCELLED")
        AL.send(from, { type: "cancel_ack", id: d.id });
      else if (fin.state === "FAILED")
        AL.send(from, {
          type: "job_failed",
          id: d.id,
          reason: fin.reason || "failed",
        });
      return;
    }
    if (S.jobs.length >= CFG.MAX_QUEUE)
      return void AL.send(from, {
        type: "job_failed",
        id: d.id,
        reason: "queue_full",
      });
    const job = {
      id: d.id,
      jtype: jt,
      from,
      created_at: now(),
      map: String(d.map || "main"),
      x: Number(d.x),
      y: Number(d.y),
      state: "QUEUED",
      state_at: now(),
      hp: 0,
      mp: 0,
      count: 0,
      names: [],
      courier: [],
      cancelled: false,
      reason: "",
      result: null,
    };
    // a courier trip: the order is for the whole party, and the gear waiting for the other Rangers rides along
    if (Array.isArray(d.courier))
      job.courier = d.courier
        .filter(
          (n) =>
            typeof n === "string" &&
            n !== from &&
            (roster().indexOf(n) !== -1 || !!support_cfg(n))
        )
        .slice(0, 4);
    if (jt === "restock") {
      job.hp = clamp_int(d.hp, 0, CFG.MAX_REQUEST);
      job.mp = clamp_int(d.mp, 0, CFG.MAX_REQUEST);
      if (!job.hp && !job.mp) return;
    } else {
      job.count = clamp_int(d.count, 1, 42);
      job.names = Array.isArray(d.names)
        ? d.names
            .slice(0, 42)
            .filter((n) => typeof n === "string" && n.length <= 40)
        : [];
    }
    // a newer request of the same kind from the same character replaces his older, still-waiting one
    for (const old of S.jobs.filter(
      (j) =>
        j.from === from && j.jtype === jt && j !== S.cur && j.state === "QUEUED"
    ))
      end_job(old, "CANCELLED");
    S.jobs.push(job);
    send_status(job); // the first status is the ack: it carries the ETA
    say(
      "Job " +
        jt +
        " from " +
        from +
        " (" +
        (jt === "restock"
          ? job.hp + " HP / " + job.mp + " MP"
          : job.count + " item(s)") +
        "), ETA " +
        eta_for(job) +
        "s, " +
        queued_jobs().length +
        " waiting"
    );
    if (ACT.label !== IDLE_LABEL) say_raw(busy_report("Job queued"), "#CF575F");
    // an idle walk (back to the stand) is not an action: drop it and go
    if (S.idle_walk && !S.cur) abort_walk();
  }
  function on_cancel(from, d) {
    AL.send(from, { type: "cancel_ack", id: d.id });
    const job = S.jobs.find((j) => j.id === d.id && j.from === from);
    if (job) cancel_job(job, "asked by " + from);
  }
  // The Ranger starts his portal trip to the main map: drop any trip toward his old town, go to the main-town safe spot and wait there
  function on_travel_to_main(from) {
    S.ranger_to_main_at = now();
    let any = false;
    for (const j of S.jobs.slice()) {
      if (j.from !== from || j.map === "main") continue;
      any = true;
      AL.send(from, { type: "cancel_ack", id: j.id });
      cancel_job(j, from + " is travelling to the main map");
    }
    if (any) {
      S.hold_until = now() + CFG.HOLD_AT_SAFE_MS;
      if (!S.cur && S.idle_walk) abort_walk(); // only a walk home is dropped; a bank / shop trip finishes
    }
  }
  // Restart handshake: the other side lists the jobs it has in flight. Any of ours it does not know is a ghost: kill it.
  function on_hello(from, d) {
    const theirs = Array.isArray(d.jobs)
      ? d.jobs.filter(P.id_ok).slice(0, 30)
      : [];
    for (const j of S.jobs.filter((x) => x.from === from))
      if (theirs.indexOf(j.id) === -1)
        cancel_job(j, "ghost job after " + from + " restarted");
    if (d.want_reply)
      AL.send(from, {
        type: "hello",
        jobs: S.jobs.filter((j) => j.from === from).map((j) => j.id),
        want_reply: false,
      });
  }
  function send_hello() {
    AL.send(CFG.RANGER_NAME, {
      type: "hello",
      jobs: S.jobs.map((j) => j.id),
      want_reply: true,
    });
  }
