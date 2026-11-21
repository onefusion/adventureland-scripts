#!/bin/bash
# Runs the whole mock-world suite in two parallel shards (about 85 s on 2 CPUs).
#   tests/run_suite.sh v6   -> the dist/ build (default)      tests/run_suite.sh v5   -> the v5 files in the repo root
# Extra: DUMP_LOGS=prefix writes <prefix>_s0.log / _s1.log with every log line of every scenario (diff two builds with it).
cd "$(dirname "$0")" || exit 1
if [ "${1:-v6}" = "v5" ]; then
  export MERCHANT_FILE="AutoMerchant v5.js" RANGER_FILE="AutoRanger v5.js" PRIEST_FILE="AutoPriest v5.js" WARRIOR_FILE="AutoWarrior v5.js" LIB_FILE="AL Lib v2.js"
else
  export MERCHANT_FILE="dist/AutoMerchant v6.js" RANGER_FILE="dist/AutoRanger v6.js" PRIEST_FILE="dist/AutoPriest v6.js" WARRIOR_FILE="dist/AutoWarrior v6.js" LIB_FILE="dist/AL Libs v6.js"
fi
tmp=$(mktemp -d)
for i in 0 1; do
  if [ -n "$DUMP_LOGS" ]; then export DUMP_LOGS="${DUMP_LOGS%%_s*}_s$i.log"; fi
  SHARD=$i/2 node v4_smoke.js > "$tmp/s$i.out" 2>&1 &
done
wait
cat "$tmp"/s0.out "$tmp"/s1.out | grep -v "^PASS" | grep -E "^FAIL|^   |^      |scenario\(s\) failed" | head -80
echo "passed: $(cat "$tmp"/s0.out "$tmp"/s1.out | grep -c '^PASS')  failed: $(cat "$tmp"/s0.out "$tmp"/s1.out | grep -c '^FAIL')"
