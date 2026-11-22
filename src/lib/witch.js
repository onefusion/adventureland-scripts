// ============================== AL.witch: the Witch's Cipher solver (2026-11-21) ==============================
// The cauldron is Mastermind with 4 symbols and 5 slots (4^5 = 1,024 recipes). A mix gives ONE clue: how many of its 5 positions are right. The realm shares the board of mixes and clues.
// A mix that fits every clue on the board (could still be the recipe) earns a Witch's Parcel, so next_guess() returns one of the recipes that are still possible.
// Pure functions only: no game calls (tests run them in a bare context). The live shape of server.status.witchcipher is not known yet, so parse_board() is defensive and returns null when it cannot read it.
AL.witch = (function () {
  "use strict";
  const SYMBOLS = ["verdantspore", "frostscale", "embercoal", "gloomfeather"];
  const SLOTS = 5;
  const score = (a, b) => {
    let n = 0;
    for (let i = 0; i < SLOTS; i++) if (a[i] === b[i]) n++;
    return n;
  };
  const fits = (mix, board) => board.every((e) => score(mix, e.mix) === e.n);
  function all_recipes(symbols) {
    const s = symbols || SYMBOLS;
    let out = [[]];
    for (let i = 0; i < SLOTS; i++) out = [].concat(...out.map((r) => s.map((x) => r.concat(x))));
    return out;
  }
  // the recipes that still fit every clue
  const candidates = (board, symbols) => all_recipes(symbols).filter((r) => fits(r, board || []));
  const need = (mix) => mix.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {});
  const affordable = (mix, have) => Object.keys(need(mix)).every((k) => ((have && have[k]) || 0) >= need(mix)[k]);
  // one of the still-possible recipes, the one the bag can pay for (have = {ingredient: count}) and, among those, the one that splits the remaining candidates best.
  // Returns {mix, left, affordable, reason}: mix is null when no possible recipe can be paid for (reason says what is missing most).
  function next_guess(board, have, symbols) {
    const cand = candidates(board, symbols);
    if (!cand.length) return { mix: null, left: 0, affordable: 0, reason: "no recipe fits every clue (board unreadable or the recipe changed)" };
    const pay = have ? cand.filter((r) => affordable(r, have)) : cand;
    if (!pay.length) {
      const miss = {};
      for (const r of cand.slice(0, 64)) for (const [k, v] of Object.entries(need(r))) miss[k] = Math.max(miss[k] || 0, v - ((have && have[k]) || 0));
      return { mix: null, left: cand.length, affordable: 0, reason: "the bag cannot pay for any of the " + cand.length + " possible recipes (short of: " + Object.keys(miss).filter((k) => miss[k] > 0).map((k) => k + " x" + miss[k]).join(", ") + ")" };
    }
    // information: prefer the guess whose clue answers are spread over the most different values (a cheap stand-in for a full minimax; 1,024 recipes at most)
    let best = null;
    for (const g of pay) {
      const buckets = {};
      for (const c of cand) buckets[score(g, c)] = (buckets[score(g, c)] || 0) + 1;
      const worst = Math.max.apply(null, Object.values(buckets));
      const key = worst * 10 - Object.keys(buckets).length; // lower is better
      if (!best || key < best.key) best = { g, key };
    }
    return { mix: best.g, left: cand.length, affordable: pay.length, reason: "" };
  }
  // The shared board as the game publishes it. Accepts a few plausible shapes: an array (or {mixes|board|history|guesses: [...]}) whose entries are
  // {mix|recipe|guess|ingredients|items: [5], clue|n|hits|right|correct|score|exact: number} or [[5 names], n]. Anything else -> null.
  function parse_board(raw) {
    let list = raw;
    if (list && !Array.isArray(list) && typeof list === "object") list = list.mixes || list.board || list.history || list.guesses || list.clues || null;
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const e of list) {
      let mix = null, n = null;
      if (Array.isArray(e) && e.length === 2 && Array.isArray(e[0])) [mix, n] = e;
      else if (e && typeof e === "object") {
        mix = e.mix || e.recipe || e.guess || e.ingredients || e.items || null;
        for (const k of ["clue", "n", "hits", "right", "correct", "score", "exact"]) if (typeof e[k] === "number") { n = e[k]; break; }
      }
      if (!Array.isArray(mix) || mix.length !== SLOTS || typeof n !== "number") return null;
      out.push({ mix: mix.map(String), n });
    }
    return out;
  }
  return { SYMBOLS, SLOTS, score, fits, candidates, next_guess, affordable, parse_board };
})();
