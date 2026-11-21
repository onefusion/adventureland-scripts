// @include AL-Lib.js
// @include gear.js
// @include config.js
// @include planners.js
// @include runtime.js
// @include lead.js

// delivered with require_code("lib") (probe 2026-11-20: sync, module body runs on EVERY call, exports/module.exports work, a top-level return does not).
// The guard keeps the file usable as a plain script (tests run it in a bare vm context where `module` does not exist).
if (typeof module !== "undefined") module.exports = AL;
