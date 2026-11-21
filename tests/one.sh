#!/bin/bash
# Run ONE scenario (name prefix) against the dist build (default) or the v5 files:  bash tests/one.sh SS1        bash tests/one.sh SS1 v5
# LOGN=60 shows more log lines of a failing scenario; add -v to see every check.
cd "$(dirname "$0")" || exit 1
if [ "${2:-v6}" = "v5" ]; then
  export MERCHANT_FILE="AutoMerchant v5.js" RANGER_FILE="AutoRanger v5.js" PRIEST_FILE="AutoPriest v5.js" WARRIOR_FILE="AutoWarrior v5.js" LIB_FILE="AL Lib v2.js"
else
  export MERCHANT_FILE="dist/AutoMerchant v6.js" RANGER_FILE="dist/AutoRanger v6.js" PRIEST_FILE="dist/AutoPriest v6.js" WARRIOR_FILE="dist/AutoWarrior v6.js" LIB_FILE="dist/AL Libs v6.js"
fi
node v4_smoke.js "$1" ${3:-}
