#!/usr/bin/env bash
# PERF-첫로딩 P1: 측정 기준선 한 벌(docs/design/first-load.md 7절). 같은 조건을 ROUNDS번(기본 3) 따로 띄워 재고 요약표를 만든다.
# 앞준비: (cd scripts && npm ci), @playwright/test 설치, 빌드 결과를 serve-built.mjs로 띄움(아래 ORIGIN).
# 사용법: ORIGIN=http://127.0.0.1:8125 OUT=/tmp/perf bash scripts/perf/run-baseline.sh
# 측정 하나가 실패해도 나머지를 계속 재고, 요약은 모인 줄로 만든다(이 스크립트는 0으로 끝난다).
set -uo pipefail
ORIGIN="${ORIGIN:-http://127.0.0.1:8125}"
OUT="${OUT:-/tmp/perf-baseline}"
ROUNDS="${ROUNDS:-3}"
LOAD_PROFILES="${LOAD_PROFILES:-local,phone,phone-warm}"
SWITCH_PROFILES="${SWITCH_PROFILES:-local,phone}"
mkdir -p "$OUT"
: > "$OUT/perf.jsonl"
export WEB2_TEST_ORIGIN="$ORIGIN" APP_E2E_ORIGIN="$ORIGIN"
for round in $(seq 1 "$ROUNDS"); do
  echo "== round $round/$ROUNDS"
  PERF_ROUND="$round" PERF_RUNS=1 PERF_PROFILES="$LOAD_PROFILES" \
    npx playwright test scripts/perf/first-load.spec.mjs --workers=1 --reporter=line > "$OUT/load-$round.log" 2>&1 \
    || echo "round $round first-load: 실패(기록은 $OUT/load-$round.log)"
  PERF_ROUND="$round" PERF_PROFILES="$SWITCH_PROFILES" \
    npx playwright test scripts/perf/tab-switch.spec.mjs --workers=1 --reporter=line > "$OUT/switch-$round.log" 2>&1 \
    || echo "round $round tab-switch: 실패(기록은 $OUT/switch-$round.log)"
  grep -hE '^(PERF|PERF_SHELL|PERF_SWITCH) \{' "$OUT/load-$round.log" "$OUT/switch-$round.log" >> "$OUT/perf.jsonl" || true
done
node scripts/perf/summarize.mjs "$OUT/perf.jsonl" > "$OUT/summary.md"
cat "$OUT/summary.md"
exit 0
