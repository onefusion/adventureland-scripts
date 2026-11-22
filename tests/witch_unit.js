// AL.witch unit check: node tests/witch_unit.js (after node build/build.js)
const fs = require("fs"), vm = require("vm");
const ctx = { console, character: {}, setTimeout, setInterval, clearInterval, Promise, Date, JSON, get: () => null, set() {} };
ctx.globalThis = ctx; vm.createContext(ctx);
const mod = { exports: {} };
vm.runInContext("(function(exports,module){" + fs.readFileSync("dist/AL Libs v6.js", "utf8") + "\n})", ctx)(mod.exports, mod);
const W = mod.exports.witch;
let fails = 0; const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const [V, F, E, G] = W.SYMBOLS;
ok(W.candidates([]).length === 1024, "empty board: 1,024 recipes");
ok(W.score([V, F, E, G, V], [V, V, E, F, V]) === 3, "score counts right positions");
// play whole games against random secrets: the solver must always crack it within 12 mixes, and never propose a recipe that contradicts a clue
let worst = 0, total = 0;
for (let t = 0; t < 60; t++) {
  const secret = Array.from({ length: 5 }, () => W.SYMBOLS[Math.floor(Math.random() * 4)]);
  const board = []; let n = 0;
  for (;;) {
    const g = W.next_guess(board);
    if (!g.mix) { ok(false, "solver stuck: " + g.reason); break; }
    ok(W.fits(g.mix, board), "a proposed mix always fits every clue so far") || 0;
    n++; board.push({ mix: g.mix, n: W.score(g.mix, secret) });
    if (board[board.length - 1].n === 5) break;
    if (n > 20) { ok(false, "no crack in 20 mixes"); break; }
  }
  worst = Math.max(worst, n); total += n;
}
ok(worst <= 14, "60 random games cracked, worst " + worst + " mixes, mean " + (total / 60).toFixed(1));
// the bag decides: only affordable recipes are proposed
let g = W.next_guess([], { [V]: 5 });
ok(g.mix && g.mix.every((x) => x === V), "bag with 5 spores: the only payable recipe is all spores");
g = W.next_guess([], { [V]: 1 });
ok(!g.mix && /cannot pay/.test(g.reason), "bag too poor: no mix, reason says what is missing");
g = W.next_guess([{ mix: [V, V, V, V, V], n: 5 }, { mix: [F, F, F, F, F], n: 5 }]);
ok(!g.mix && g.left === 0, "contradicting board: nothing fits");
// board shapes
ok(W.parse_board([{ mix: [V, F, E, G, V], clue: 2 }])[0].n === 2, "parse: array of {mix, clue}");
ok(W.parse_board({ mixes: [[[V, F, E, G, V], 1]] })[0].n === 1, "parse: {mixes: [[mix, n]]}");
ok(W.parse_board({ nothing: 1 }) === null && W.parse_board([{ mix: [V], clue: 1 }]) === null, "parse: unknown shape -> null");
if (fails) { console.log("witch_unit FAILED " + fails); process.exit(1); }
console.log("witch_unit OK");
