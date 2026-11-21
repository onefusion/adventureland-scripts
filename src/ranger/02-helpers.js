  // ============================ HELPERS ===========================
  // shared helpers live in the "lib" code slot (AL Lib v1.js)
  const { wait, now, d2, safe, call, unit_cost } = AL;
  const say_game = AL.logger("Ranger");
  function console_line(msg) {
    let t = "";
    try {
      t = new Date().toLocaleTimeString();
    } catch (e) {}
    try {
      console.log("[" + character.name + " " + t + "] " + msg);
    } catch (e) {}
  }
  const ev_keep = AL.runtime.ev_keep; // the lines that matter for "why did that happen" are also kept in the game's storage: game_log(get("events")) shows the last 50

  const say = (msg, color) => {
    ev_keep(msg);
    // status and report lines, plus every problem line (red / amber colour), also go to the console where they are easy to copy
    if (CFG.CONSOLE_ALL || (CFG.CONSOLE_STATUS && (/^(Loop since last status|Goal: |Farm goal|Boss|boss|Monster hunt|DANGER|Dead|Told the|Courier|Delivery received|Stopgap|Bank |ERROR|Cannot|Could not|Hurt and)/.test(String(msg)) || color === "#CF575F" || color === "#E1A951" || color === "#E0A040")))
      console_line(msg);
    return say_game(msg, color);
  };
  const { describe_dest, log_move, travel } = AL.mover({
    say,
    default_ms: 90000,
  });
