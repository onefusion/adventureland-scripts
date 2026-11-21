  // ============================ HELPERS ===========================
  // shared helpers live in the "lib" code slot (AL Lib v1.js)
  const { wait, now, d2, safe, call, unit_cost, clamp_int, at_spot } = AL;
  const say_raw = AL.logger("Merchant");
  // activity trail: what the Merchant is doing / has just done, so a stall can be diagnosed from the game log
  const TRAIL = [];
  const ACT = { label: "starting", at: Date.now(), est_s: 0, round: false };
  // v5: copy a line to the browser console with a clock time (never lets a console problem stop the script)
  function console_line(tag, msg) {
    let t = "";
    try {
      t = new Date().toLocaleTimeString();
    } catch (e) {}
    try {
      console.log(tag + " " + t + "] " + msg);
    } catch (e) {}
  }
  function say(msg, color) {
    TRAIL.push(
      Math.round((Date.now() - ACT.at) / 1000) + "s|" + String(msg).slice(0, 60)
    );
    if (TRAIL.length > 6) TRAIL.shift();
    // status and report lines, plus every problem line (red / amber colour), also go to the console where they are easy to copy
    if (
      CFG.CONSOLE_ALL ||
      (CFG.CONSOLE_STATUS &&
        (/^(Schedule: |Hourly report|Report sheet|Also due after |Upgrade round|Private sale|Market watch|Manual sell round|Manual hold|Bank excess|Sold |Bank junk sweep|Bank (sort|merge|data|layout)|Compound round|Exchange run|Craft report|Gear sweep|Surplus check|Courier notice|Waiting for the courier|Donation|Lottery|Junk pickup|Bag tidy|Copy limit|Flip|FLIP|ERROR|Dead|HP critical|Could not|Cannot)/.test(
          String(msg)
        ) ||
          color === "#CF575F" ||
          color === "#E1A951" ||
          color === "#E0A040"))
    )
      console_line("[Merchant", msg);
    return say_raw(msg, color);
  }
  function busy_report(why) {
    return (
      why +
      " - Merchant is busy: '" +
      ACT.label +
      "' for " +
      Math.round((Date.now() - ACT.at) / 1000) +
      "s, map " +
      character.map +
      ", moving=" +
      !!character.moving +
      ", smart=" +
      !!(typeof smart !== "undefined" && smart.moving) +
      ", stand=" +
      !!character.stand +
      ". Last log: " +
      (TRAIL.slice(-4).join(" // ") || "none")
    );
  }
  const is_trusted = (name) =>
    name === CFG.RANGER_NAME || CFG.TRUSTED_NAMES.indexOf(name) !== -1;

  // An open stand makes the Merchant crawl, so EVERY move goes through travel() and travel()
  // closes the stand first (retrying if the close does not stick).
  async function close_stand_now() {
    for (let attempt = 0; attempt < 3 && character.stand; attempt++) {
      await call(() => close_stand());
      await call(() => wait_for(() => !character.stand, 2000));
    }
    return !character.stand;
  }
  const { describe_dest, log_move, travel, abort, traveling } = AL.mover({
    say,
    default_ms: CFG.TRAVEL_TIMEOUT_MS,
    before: async () => {
      if (character.stand && !(await close_stand_now()))
        say("Stand would not close - moving slowly", "#CF575F");
    },
  });
